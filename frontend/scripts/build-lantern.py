"""Evermere wayfarer lantern: an original hexagonal iron lantern, modelled, painted and baked in Blender.

Run from frontend/ (needs basisu: brew install basis_universal):
  Blender --background --factory-startup --python scripts/build-lantern.py
Writes public/models/evermere-lantern.glb. Append `-- --high out.blend` to stop after modelling.

Blackened wrought iron with worn edges and rust in its seams, warm amber glass lit from within and
sooted at the top, a crescent or a star of ironwork on each pane, scroll curls at the foot of each
corner, a flared roof with vented cap and a ring to hang it by. The collar at its base clamps onto
the lamp posts along the Evermere road.
"""
import math
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bakekit import (apply_modifier, arrays, cells, concavity, fbm, join, mesh_object, paint, reset_scene,  # noqa: E402
                     save_high, sculpt_material, ship, smooth, tag, write_positions)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
IRON, GLASS = 1, 2
SIDES = 6
FOOT, BODY_TOP = 0.078, 0.36
R_FOOT, R_TOP = 0.13, 0.15


def ring_at(r, z, offset=0.0):
    return [np.array((r * math.cos(k * math.tau / SIDES + offset), r * math.sin(k * math.tau / SIDES + offset), z)) for k in range(SIDES)]


def prism(name, r, z0, z1, sides=SIDES, offset=0.0):
    verts = [(r * math.cos(k * math.tau / sides + offset), r * math.sin(k * math.tau / sides + offset), z) for z in (z0, z1) for k in range(sides)]
    faces = [list(range(sides))[::-1], list(range(sides, 2 * sides))] + [(k, (k + 1) % sides, sides + (k + 1) % sides, sides + k) for k in range(sides)]
    return mesh_object(name, verts, faces)


def bar(name, p0, p1, width, depth, outward):
    """A square-section bar from p0 to p1; `outward` orients its depth."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    axis = (p1 - p0) / np.linalg.norm(p1 - p0)
    across = np.cross(axis, outward)
    across /= np.linalg.norm(across)
    out = np.cross(across, axis)
    verts = [p + across * sx * width / 2 + out * sy * depth / 2 for p in (p0, p1) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    faces = [(0, 1, 2, 3)[::-1], (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return mesh_object(name, verts, faces)


def tube(name, points, radius, closed=False):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, p in zip(spline.points, points):
        point.co = (*map(float, p), 1.0)
    spline.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.object


def crescent(r=0.03):
    """Outline of a disc with a smaller disc bitten from it: the long arc of the first circle between
    the two horns, then back along the arc of the second circle that lies inside the first."""
    c2, r2 = np.array((0.42 * r, 0.12 * r)), 0.82 * r
    d = np.linalg.norm(c2)
    along = (r * r - r2 * r2 + d * d) / (2 * d)
    half = math.sqrt(r * r - along * along)
    mid, perp = c2 / d * along, np.array((-c2[1], c2[0])) / d
    horns = (mid + perp * half, mid - perp * half)

    def arc(centre, radius, p0, p1, inside):
        """The arc from p0 to p1 whose midpoint satisfies `inside` (choosing between the two ways round)."""
        a0, a1 = (math.atan2(*(p - centre)[::-1]) for p in (p0, p1))
        span = (a1 - a0) % math.tau
        middle = centre + radius * np.array((math.cos(a0 + span / 2), math.sin(a0 + span / 2)))
        if not inside(middle):
            span -= math.tau
        a = a0 + np.linspace(0, span, 90)
        return centre + radius * np.c_[np.cos(a), np.sin(a)]

    outer = arc(np.zeros(2), r, horns[0], horns[1], lambda q: np.linalg.norm(q - c2) > r2)
    inner = arc(c2, r2, horns[1], horns[0], lambda q: np.linalg.norm(q) < r)
    shape = np.r_[outer, inner[1:-1]]
    return shape - (shape.max(0) + shape.min(0)) / 2


def star(r=0.024, points=4):
    a = np.arange(points * 2) * math.pi / points + math.pi / 2
    radius = np.where(np.arange(points * 2) % 2 == 0, r, r * 0.32)
    return np.c_[np.cos(a) * radius, np.sin(a) * radius]


def scroll(base, radial, turns=1.6, size=0.032):
    """A flat iron curl at the foot of a corner, curling outward and up in the corner's radial plane."""
    t = np.linspace(0, 1, 60)
    angle = -math.pi / 2 + turns * math.tau * t
    r = size * (1 - 0.82 * t)
    centre = base + radial * size * 0.9 + np.array((0, 0, size * 0.15))
    return [centre + radial * (r_ * math.cos(a)) + np.array((0, 0, r_ * math.sin(a))) for r_, a in zip(r, angle)][::-1]


def build_iron():
    pieces = []
    bottom, top = ring_at(R_FOOT, FOOT), ring_at(R_TOP, BODY_TOP)
    up = np.array((0, 0, 1.0))
    for k in range(SIDES):
        radial = top[k] * (1, 1, 0) / np.linalg.norm(top[k][:2])
        pieces.append(bar(f"post{k}", bottom[k] - up * 0.004, top[k] + up * 0.006, 0.013, 0.013, radial))
        for ring, height in ((bottom, 0.018), (top, 0.016)):
            a, b = ring[k], ring[(k + 1) % SIDES]
            mid = (a + b) / 2
            pieces.append(bar(f"rail{k}", a - (b - a) * 0.03, b + (b - a) * 0.03, height, 0.011, mid * (1, 1, 0) / np.linalg.norm(mid[:2])))
        # Rivets where each post meets its rails.
        for p in (bottom[k] + up * 0.006, top[k] - up * 0.005):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0042, segments=12, ring_count=8, location=tuple(p + radial * 0.0072))
            pieces.append(bpy.context.object)
        pieces.append(tube(f"scroll{k}", scroll(bottom[k] + up * 0.004 + radial * 0.004, radial), 0.0028))

    collar = prism("collar", 0.062, 0.0, 0.052, sides=40)
    bead = prism("bead", 0.068, 0.04, 0.05, sides=40)
    plate = prism("plate", 0.168, 0.05, 0.064)
    step = prism("step", 0.148, 0.064, FOOT)
    pieces += [collar, bead, plate, step]

    # Flared roof: hexagonal rings rising on a concave curve from a wide eave to the chimney.
    steps, eave_z, crown_z = 18, BODY_TOP + 0.002, 0.47
    rings = []
    for i in range(steps + 1):
        t = i / steps
        r = 0.064 + (0.205 - 0.064) * (1 - t) ** 1.9
        z = eave_z + (crown_z - eave_z) * t - 0.006 * math.sin(math.pi * min(t * 3, 1))
        rings.append(ring_at(r, z))
    verts = [p for ring in rings for p in ring]
    faces = [(i * SIDES + k, i * SIDES + (k + 1) % SIDES, (i + 1) * SIDES + (k + 1) % SIDES, (i + 1) * SIDES + k) for i in range(steps) for k in range(SIDES)]
    roof = mesh_object("roof", verts, faces)
    apply_modifier(roof, "SOLIDIFY", thickness=0.0035, offset=-1)
    pieces.append(roof)
    for k in range(SIDES):
        pieces.append(tube(f"hip{k}", [ring[k] + np.array((0, 0, 0.002)) for ring in rings], 0.0042))
    pieces.append(tube("eave", rings[0] + [rings[0][0]], 0.0055, closed=True))

    chimney = prism("chimney", 0.06, crown_z - 0.01, 0.522)
    vents = []
    for k in range(SIDES):
        a = (k + 0.5) * math.tau / SIDES
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.0115, depth=0.05, location=(0.055 * math.cos(a), 0.055 * math.sin(a), 0.497), rotation=(0, math.pi / 2, a))
        vents.append(bpy.context.object)
    cutter = join(vents, "vents")
    boolean = chimney.modifiers.new("Vents", "BOOLEAN")
    boolean.operation, boolean.object = "DIFFERENCE", cutter
    bpy.context.view_layer.objects.active = chimney
    bpy.ops.object.modifier_apply(modifier=boolean.name)
    bpy.data.objects.remove(cutter)
    pieces.append(chimney)
    cap_rings = [ring_at(0.084 - 0.064 * (i / 8) ** 0.7, 0.522 + 0.04 * i / 8) for i in range(9)]
    cap = mesh_object("cap", [p for ring in cap_rings for p in ring],
                      [(i * SIDES + k, i * SIDES + (k + 1) % SIDES, (i + 1) * SIDES + (k + 1) % SIDES, (i + 1) * SIDES + k) for i in range(8) for k in range(SIDES)])
    apply_modifier(cap, "SOLIDIFY", thickness=0.003, offset=-1)
    pieces.append(cap)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.013, segments=20, ring_count=12, location=(0, 0, 0.568))
    pieces.append(bpy.context.object)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.031, minor_radius=0.0055, major_segments=40, minor_segments=12, location=(0, 0, 0.6115), rotation=(math.pi / 2, 0, 0))
    pieces.append(bpy.context.object)

    # Ironwork on the panes: a crescent and a star in turn, standing just proud of the glass.
    for k in range(SIDES):
        a, b, c, d = bottom[k], bottom[(k + 1) % SIDES], top[(k + 1) % SIDES], top[k]
        centre = (a + b + c + d) / 4
        u = (b - a) / np.linalg.norm(b - a)
        v = ((c + d) / 2 - (a + b) / 2)
        v /= np.linalg.norm(v)
        n = np.cross(u, v)
        n *= np.sign(n @ (centre * (1, 1, 0)))
        shape, height = (crescent(), 0.055) if k % 2 == 0 else (star(), 0.05)
        pts = [centre + u * x + v * (y + height) + n * 0.0005 for x, y in shape]
        pieces.append(tube(f"ornament{k}", pts, 0.0026, closed=True))
        # The mullion stops short of the ornament, which hangs between its two halves.
        reach = np.abs(shape[:, 1]).max() + 0.004
        pieces.append(bar(f"mullion{k}a", (a + b) / 2 + v * 0.008, centre + v * (height - reach), 0.005, 0.005, n))
        pieces.append(bar(f"mullion{k}b", centre + v * (height + reach), (c + d) / 2 - v * 0.008, 0.005, 0.005, n))

    iron = join(pieces, "Lantern iron")
    apply_modifier(iron, "REMESH", mode="VOXEL", voxel_size=0.0009)
    tag(iron, IRON)
    return iron


def build_glass():
    bottom, top = ring_at(R_FOOT - 0.004, FOOT + 0.006), ring_at(R_TOP - 0.004, BODY_TOP - 0.006)
    panes = []
    for k in range(SIDES):
        a, b, c, d = bottom[k], bottom[(k + 1) % SIDES], top[(k + 1) % SIDES], top[k]
        pane = mesh_object(f"pane{k}", [a, b, c, d], [(0, 1, 2, 3)])
        apply_modifier(pane, "SUBSURF", subdivision_type="SIMPLE", levels=6)
        apply_modifier(pane, "SOLIDIFY", thickness=0.003, offset=0)
        panes.append(pane)
    glass = join(panes, "Lantern glass")
    tag(glass, GLASS)
    return glass


def weather(iron):
    co, normal, edges = arrays(iron.data)
    dents, _ = cells(co * 160, 5)
    hammer = -0.00035 * smooth(0.5, 0.1, dents) + 0.00025 * fbm(co * 90, 3, 7)
    write_positions(iron.data, co + normal * hammer[:, None])
    co, normal, edges = arrays(iron.data)
    curve = concavity(co, normal, edges)
    seam, edge = np.clip(curve * 2.5, 0, 1), np.clip(-curve * 3.0, 0, 1)
    z = co[:, 2]

    albedo = np.array((0.036, 0.034, 0.033)) * (0.8 + 0.45 * np.clip(fbm(co * 30, 4, 11) + 0.5, 0, 1))[:, None]
    metal = np.full(len(co), 0.62)
    rough = 0.52 + 0.12 * fbm(co * 50, 3, 13)
    # Edges rubbed back to bare steel by hands and weather.
    wear = smooth(0.25, 0.75, edge + 0.3 * fbm(co * 120, 2, 17))
    albedo = albedo * (1 - wear[:, None]) + np.array((0.32, 0.31, 0.29)) * wear[:, None]
    metal = metal * (1 - wear) + wear
    rough = rough * (1 - wear) + 0.32 * wear
    # Rust settles in seams and on the lower iron, then runs down in streaks.
    rust_noise = fbm(co * 45, 4, 19)
    streak = smooth(0.2, 0.6, fbm(co * (60, 60, 6), 3, 21))
    rust = np.clip(smooth(0.12, 0.5, rust_noise + seam * 0.7 + 0.12 * smooth(0.12, 0.05, z) - 0.3) + 0.3 * streak * seam, 0, 1)
    rust_colour = np.array((0.15, 0.06, 0.022)) + np.array((0.13, 0.06, 0.02)) * np.clip(fbm(co * 140, 2, 23) + 0.5, 0, 1)[:, None]
    albedo = albedo * (1 - rust[:, None]) + rust_colour * rust[:, None]
    metal *= 1 - rust
    rough = rough * (1 - rust) + 0.88 * rust
    albedo *= (1 - 0.5 * seam)[:, None]
    paint(iron.data, albedo, rough, metal, grain=0.7 + 0.3 * rust)


def glaze(glass):
    co, normal, _ = arrays(glass.data)
    z = co[:, 2]
    radial = np.linalg.norm(co[:, :2], axis=1)
    # The candle sits low in the lantern: each pane has a hot spot a third of the way up, facing the flame,
    # falling off toward the iron at its corners.
    angle = np.arctan2(co[:, 1], co[:, 0])
    facing = (np.round((angle / (math.tau / SIDES)) - 0.5) + 0.5) * (math.tau / SIDES)
    across = radial * np.sin(angle - facing)
    flame = np.exp(-((z - 0.19) / 0.085) ** 2 - (across / 0.06) ** 2)
    soot = smooth(0.27, 0.35, z + 0.015 * fbm(co * 40, 3, 31))
    bubbles, _ = cells(co * 220, 37)
    seed = smooth(0.18, 0.05, bubbles)
    glow = np.clip((0.12 + 0.88 * flame) * (1 - 0.75 * soot) * (0.9 + 0.1 * fbm(co * 25, 3, 33)) - 0.08 * seed, 0, 1)
    inner = (co[:, :2] * normal[:, :2]).sum(1) / np.maximum(radial, 1e-6) < 0
    albedo = np.array((0.15, 0.06, 0.012)) * (1 - 0.7 * soot[:, None]) + np.array((0.02, 0.015, 0.01)) * soot[:, None]
    rough = 0.1 + 0.25 * soot + 0.1 * seed
    glow = np.where(inner, glow * 0.6, glow)
    paint(glass.data, albedo, rough, np.zeros(len(co)), glow=glow, grain=0.15 + 0.4 * soot)


def main():
    reset_scene()
    sculpt = sculpt_material(glow_colour=(1.0, 0.38, 0.07), grain_scale=420.0)
    iron, glass = build_iron(), build_glass()
    weather(iron)
    glaze(glass)
    highs = [iron, glass]
    if "--high" in ARGS:
        save_high(ARGS[ARGS.index("--high") + 1], highs, sculpt)
        return
    ship("evermere-lantern", highs, sculpt, target=12000, cage=0.003, reach=0.01, emission_strength=0.9)


main()
