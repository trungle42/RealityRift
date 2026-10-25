"""Evermere arming sword: an original sword, modelled, painted and baked in Blender.

Run from frontend/ (needs basisu: brew install basis_universal):
  Blender --background --factory-startup --python scripts/build-sword.py
Writes public/models/evermere-sword.glb. Append `-- --high out.blend` to stop after modelling.

A fullered steel blade with polished edge bevels and lengthwise brushing; an aged bronze crossguard
that curves toward the blade and ends in trefoils, with a triskele on its boss; a leather grip bound
in a spiral cord between bronze risers; and a wheel pommel whose triskele holds a faint mint light,
the same old magic as the waystone. The blade runs along +Z; the game measures the sword itself
(Actor.measureBlade), so only its proportions matter.
"""
import math
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bakekit import (apply_modifier, arrays, cells, concavity, fbm, join, mesh_object, outward, paint, reset_scene,  # noqa: E402
                     save_high, sculpt_material, ship, smooth, tag, write_positions)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
STEEL, BRONZE, LEATHER, INLAY = 1, 2, 3, 4
BLADE_BASE, BLADE_TIP = 0.008, 0.765


def blade_width(t):
    """Half-width along the blade (t from guard to tip): a steady taper, then an ogival point."""
    w = 0.025 * (1 - 0.34 * t)
    point = np.clip((1 - t) / 0.16, 0, 1)
    return np.where(t > 0.84, w * np.sqrt(point) + 0.0004 * (1 - point), w)


def build_blade():
    rows, across = 420, 61
    t = np.linspace(0, 1, rows)
    u = np.linspace(-1, 1, across)
    verts, faces = [], []
    for ti in t:
        half = float(blade_width(ti))
        thick = 0.0034 * (1 - 0.55 * ti)
        fuller = 0.55 * smooth(0.0, 0.03, ti) * smooth(0.64, 0.5, ti)
        for side in (1, -1):
            for uj in (u if side == 1 else u[::-1])[1:-1]:
                # A flattened diamond section that breaks at a crisp shoulder into the sharpened edge bevel,
                # with a broad rounded fuller down the middle.
                body = 1 - 0.35 * abs(uj) ** 1.4
                shoulder = 0.8
                edge = np.where(abs(uj) > shoulder, (1 - abs(uj)) / (1 - shoulder), 1.0)
                groove = fuller * np.exp(-(uj / 0.2) ** 2)
                y = side * thick * (body * (0.62 * edge + 0.38 * edge ** 3 if abs(uj) > shoulder else 1.0) - groove)
                verts.append((uj * half, y, BLADE_BASE + ti * (BLADE_TIP - BLADE_BASE)))
            verts.append(((1 if side == 1 else -1) * half, 0.0, BLADE_BASE + ti * (BLADE_TIP - BLADE_BASE)))
    ring = 2 * (across - 1)
    for i in range(rows - 1):
        for k in range(ring):
            a, b = i * ring + k, i * ring + (k + 1) % ring
            faces.append((a, b, b + ring, a + ring))
    tip = len(verts)
    verts.append((0.0, 0.0, BLADE_TIP + 0.0015))
    faces += [((rows - 1) * ring + (k + 1) % ring, (rows - 1) * ring + k, tip) for k in range(ring)]
    faces.append(tuple(range(ring))[::-1])
    blade = outward(mesh_object("Blade", verts, faces))
    tag(blade, STEEL)
    return blade


def loft(name, sections):
    """Join closed cross-section rings (lists of 3D points, same count) into a capped tube."""
    n = len(sections[0])
    verts = [p for ring in sections for p in ring]
    faces = [(i * n + k, i * n + (k + 1) % n, (i + 1) * n + (k + 1) % n, (i + 1) * n + k) for i in range(len(sections) - 1) for k in range(n)]
    faces += [tuple(range(n))[::-1], tuple(range((len(sections) - 1) * n, len(sections) * n))]
    return outward(mesh_object(name, verts, faces))


def chamfered(cx, cy, hx, hy, c=0.3):
    """An octagon: a rectangle with its corners cut, as forged bar stock is dressed."""
    pts = [(hx, hy * (1 - c)), (hx * (1 - c), hy), (-hx * (1 - c), hy), (-hx, hy * (1 - c)),
           (-hx, -hy * (1 - c)), (-hx * (1 - c), -hy), (hx * (1 - c), -hy), (hx, -hy * (1 - c))]
    return [(cx + a, cy + b) for a, b in pts]


def tube(name, points, radius):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, p in zip(spline.points, points):
        point.co = (*map(float, p), 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    return bpy.context.object


def triskele(centre, right, up, normal, size, radius, name):
    """Three linked spirals in the plane (right, up), raised `radius` off it along `normal`."""
    pieces = []
    for k in range(3):
        theta = math.pi / 2 + k * math.tau / 3
        c = np.array((math.cos(theta), math.sin(theta))) * size * 0.42
        t = np.linspace(0, 1, 90)
        a = theta + 2 * math.pi * 1.6 * (t - 1)
        r = size * (0.03 + 0.31 * t)
        pts2 = c + np.c_[np.cos(a), np.sin(a)] * r[:, None]
        end = np.array((math.cos(theta + math.tau / 3 * 0.5), math.sin(theta + math.tau / 3 * 0.5))) * size * 0.95
        sweep = np.array([pts2[-1] * (1 - s) ** 2 + 2 * (1 - s) * s * end + s * s * (np.array((math.cos(theta + math.tau / 3), math.sin(theta + math.tau / 3))) * size * 0.42 + np.array((math.cos(theta + math.tau / 3), math.sin(theta + math.tau / 3))) * size * 0.34) for s in np.linspace(0, 1, 30)])
        pts2 = np.r_[pts2, sweep[1:]]
        pieces.append(tube(f"{name}{k}", [centre + right * x + up * y + normal * radius * 0.6 for x, y in pts2], radius))
    return pieces


def build_hilt():
    pieces = []
    # Crossguard: forged bar curving gently toward the blade, thick at the boss and tapering out.
    xs = np.linspace(-0.098, 0.098, 90)
    sections = []
    for x in xs:
        s = abs(x) / 0.098
        lift = 0.013 * s ** 2.2
        hz, hy = 0.0105 * (1 - 0.42 * s), 0.0105 * (1 - 0.38 * s)
        sections.append([(x, y, lift + z) for z, y in chamfered(0, 0, hz, hy)])
    pieces.append(loft("Guard", sections))
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.0005))
    boss = bpy.context.object
    boss.scale = (0.036, 0.026, 0.034)
    bpy.ops.object.transform_apply(scale=True)
    apply_modifier(boss, "BEVEL", width=0.005, segments=4)
    pieces.append(boss)
    for side in (-1, 1):
        end = np.array((side * 0.1, 0, 0.0135))
        for offset, r in (((side * 0.008, 0, 0), 0.0098), ((side * 0.002, 0, 0.0085), 0.0072), ((side * 0.002, 0, -0.0085), 0.0072)):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=24, ring_count=16, location=tuple(end + offset))
            sphere = bpy.context.object
            sphere.scale = (1, 0.82, 1)
            pieces.append(sphere)
    for side in (-1, 1):
        pieces += triskele(np.array((0, side * 0.013, 0.0005)), np.array((side * 1.0, 0, 0)), np.array((0, 0, 1.0)), np.array((0, side * 1.0, 0)), 0.0125, 0.0009, f"boss{side}")

    # Grip core and its spiral cord binding.
    zs = np.linspace(-0.018, -0.124, 110)
    turns = 12
    grip_sections = []
    for z in zs:
        t = (z + 0.018) / -0.106
        r = 0.0128 + 0.0026 * math.sin(math.pi * t)
        ring = []
        for k in range(48):
            a = k * math.tau / 48
            cord = 0.0011 * (abs(math.sin(math.pi * (turns * t - a / math.tau))) ** 0.6)
            ring.append(((r + cord) * math.cos(a), (r + cord) * 0.86 * math.sin(a), z))
        grip_sections.append(ring)
    grip = loft("Grip", grip_sections)
    for z in (-0.017, -0.125):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.0136, minor_radius=0.0022, major_segments=48, minor_segments=12, location=(0, 0, z))
        riser = bpy.context.object
        riser.scale = (1, 0.88, 1)
        pieces.append(riser)

    # Wheel pommel: a raised rim around a dished centre on both faces, peened over the tang.
    centre = np.array((0, 0, -0.157))
    profile = [(0.0005, 0.0068), (0.012, 0.0068), (0.0165, 0.0072), (0.0195, 0.0098), (0.0235, 0.0104), (0.0275, 0.0096), (0.0296, 0.0068), (0.0302, 0.0)]
    profile = profile + [(r, -h) for r, h in profile[::-1][1:]]
    rings = []
    for r, h in profile:
        rings.append([tuple(centre + (r * math.cos(a), h, r * math.sin(a))) for a in np.linspace(0, math.tau, 72, endpoint=False)])
    pommel = loft("Pommel", rings)
    pieces.append(pommel)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.0085, depth=0.012, location=(0, 0, -0.128))
    pieces.append(bpy.context.object)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0062, segments=24, ring_count=12, location=tuple(centre + (0, 0, -0.031)))
    pieces.append(bpy.context.object)
    inlays = []
    for side in (-1, 1):
        inlays += triskele(centre + np.array((0, side * 0.0068, 0)), np.array((side * 1.0, 0, 0)), np.array((0, 0, 1.0)), np.array((0, side * 1.0, 0)), 0.0115, 0.00085, f"inlay{side}")

    bronze = join(pieces, "Hilt bronze")
    apply_modifier(bronze, "REMESH", mode="VOXEL", voxel_size=0.00045)
    tag(bronze, BRONZE)
    inlay = join(inlays, "Pommel inlay")
    apply_modifier(inlay, "REMESH", mode="VOXEL", voxel_size=0.0003)
    tag(inlay, INLAY)
    apply_modifier(grip, "SUBSURF", subdivision_type="SIMPLE", levels=1)
    tag(grip, LEATHER)
    return bronze, grip, inlay


def finish_blade(blade):
    co, normal, edges = arrays(blade.data)
    x, y, z = co.T
    t = (z - BLADE_BASE) / (BLADE_TIP - BLADE_BASE)
    across = np.abs(x) / np.maximum(blade_width(np.clip(t, 0, 1)), 1e-4)
    # A few shallow nicks along the edges from use, and faint hammer ripple in the flats.
    nick_dist, nick_id = cells(np.c_[x * 40, y * 40, z * 160], 3)
    nicks = 0.0006 * smooth(0.3, 0.05, nick_dist) * (nick_id < 0.25) * smooth(0.85, 0.98, across)
    ripple = 0.00006 * fbm(co * (60, 60, 14), 3, 5)
    write_positions(blade.data, co - normal * (nicks + ripple)[:, None])
    edge = smooth(0.79, 0.82, across)
    fuller = smooth(0.3, 0.12, across) * smooth(0.0, 0.03, t) * smooth(0.64, 0.5, t)
    patina = smooth(0.25, 0.6, fbm(co * (50, 50, 12), 4, 9)) * smooth(0.35, 0.02, t) * 0.7
    albedo = np.array((0.5, 0.505, 0.51)) * (0.88 + 0.16 * np.clip(fbm(co * (80, 80, 6), 3, 11) + 0.5, 0, 1))[:, None]
    albedo = albedo * (1 - edge[:, None]) + np.array((0.7, 0.7, 0.7)) * edge[:, None]
    albedo *= (1 - 0.35 * fuller - 0.45 * patina)[:, None]
    rough = 0.34 - 0.16 * edge + 0.08 * fuller + 0.22 * patina
    paint(blade.data, albedo, rough, np.full(len(co), 1.0) - 0.3 * patina, grain=0.15 + 0.5 * patina, brush=1 - 0.6 * edge)


def finish_bronze(bronze):
    co, normal, edges = arrays(bronze.data)
    dents, _ = cells(co * 700, 13)
    write_positions(bronze.data, co + normal * (-0.0002 * smooth(0.5, 0.1, dents) + 0.00008 * fbm(co * 400, 2, 14))[:, None])
    co, normal, edges = arrays(bronze.data)
    curve = concavity(co, normal, edges)
    hollow, high = np.clip(curve * 2.6, 0, 1), np.clip(-curve * 3.0, 0, 1)
    albedo = np.array((0.36, 0.23, 0.11)) * (0.8 + 0.3 * np.clip(fbm(co * 120, 3, 15) + 0.5, 0, 1))[:, None]
    # Broad tarnish from handling and weather, darker and browner than the metal beneath.
    albedo *= (1 - 0.45 * smooth(-0.05, 0.4, fbm(co * 55, 3, 16)))[:, None]
    shine = smooth(0.2, 0.7, high + 0.2 * fbm(co * 300, 2, 17))
    albedo = albedo * (1 - shine[:, None]) + np.array((0.74, 0.54, 0.29)) * shine[:, None]
    tarnish = smooth(0.15, 0.6, hollow + 0.25 * fbm(co * 200, 3, 19))
    albedo = albedo * (1 - 0.75 * tarnish[:, None])
    verdigris = smooth(0.55, 0.85, hollow + 0.3 * fbm(co * 260, 3, 21)) * 0.85
    albedo = albedo * (1 - verdigris[:, None]) + np.array((0.17, 0.34, 0.28)) * verdigris[:, None]
    rough = 0.4 - 0.16 * shine + 0.15 * tarnish + 0.4 * verdigris
    metal = 1 - 0.85 * verdigris
    paint(bronze.data, albedo, rough, metal, grain=0.4 + 0.5 * tarnish)


def finish_grip(grip):
    co, normal, edges = arrays(grip.data)
    curve = concavity(co, normal, edges)
    gap, ridge = np.clip(curve * 2.0, 0, 1), np.clip(-curve * 2.0, 0, 1)
    worn = smooth(0.15, 0.6, ridge + 0.3 * fbm(co * 160, 2, 25)) * smooth(-0.11, -0.05, co[:, 2]) * smooth(-0.02, -0.06, co[:, 2])
    albedo = np.array((0.075, 0.042, 0.022)) * (0.8 + 0.4 * np.clip(fbm(co * 200, 3, 27) + 0.5, 0, 1))[:, None]
    albedo = albedo * (1 - worn[:, None]) + np.array((0.16, 0.095, 0.05)) * worn[:, None]
    albedo *= (1 - 0.6 * gap)[:, None]
    rough = 0.62 - 0.14 * worn + 0.1 * gap
    paint(grip.data, albedo, rough, np.zeros(len(co)), grain=1.0)


def finish_inlay(inlay):
    co, normal, edges = arrays(inlay.data)
    albedo = np.tile(np.array((0.13, 0.19, 0.16)), (len(co), 1))
    paint(inlay.data, albedo, 0.3, 0.4, glow=0.28, grain=0.2)


def main():
    reset_scene()
    sculpt = sculpt_material(glow_colour=(0.3, 1.0, 0.72), grain_scale=900.0, brush_scale=(3000.0, 3000.0, 8.0))
    blade = build_blade()
    bronze, grip, inlay = build_hilt()
    finish_blade(blade)
    finish_bronze(bronze)
    finish_grip(grip)
    finish_inlay(inlay)
    highs = [blade, bronze, grip, inlay]
    if "--high" in ARGS:
        save_high(ARGS[ARGS.index("--high") + 1], highs, sculpt)
        return
    ship("evermere-sword", highs, sculpt, target=9000, cage=0.0012, reach=0.0035, emission_strength=1.6)


main()
