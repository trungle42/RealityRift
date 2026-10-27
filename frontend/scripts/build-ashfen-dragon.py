"""The Ashfen dragon: Umbraxis, the shadow dragon boss, sculpted in Blender from scratch.

Run from frontend/:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build-ashfen-dragon.py
Writes public/models/characters/ashfen-dragon.glb. Append `-- --preview out.blend` to save the painted sculpt at a
coarser voxel instead (no bake or export), for look development.

A rearing, coal-black dragon about 3.3 m tall: up on its hind legs with its forelimbs raised, wings half spread, neck
curved forward over a tan-plated throat and belly, two swept-back horns, a ridge of spines from brow to tail tip and a
long tail curling on the ground. The game shows it as a static figure scaled to 3.3 m (Adventure.spawnEnemy), so it
ships as a mesh without a rig. Its wings reach wide, so it is meshed sparsely (charkit.Body.sparse_mesh).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from bakekit import cells, fbm, reset_scene, smooth  # noqa: E402
from charkit import Body, Shape, arrays, bake_maps, ball, bezier, concavity, cone, displace, ellipsoid, export, frame, glossy, tube  # noqa: E402
import herokit as hk  # noqa: E402
from herokit import lerp, unit  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None
NAME = "ashfen-dragon"
SIDES = (1, -1)


def triangle(a, b, c, thick):
    """A flat slab `thick` either side of triangle abc (one panel of a wing membrane)."""
    a, b, c = (np.asarray(v, float) for v in (a, b, c))
    ba, cb, ac = b - a, c - b, a - c
    nor = np.cross(ba, ac)

    def fn(p):
        pa, pb, pc = p - a, p - b, p - c
        inside = (np.sign(np.cross(ba, nor) @ pa.T) + np.sign(np.cross(cb, nor) @ pb.T) + np.sign(np.cross(ac, nor) @ pc.T)) >= 2
        def seg(e, q):
            t = np.clip((q @ e) / (e @ e), 0, 1)
            return np.linalg.norm(q - t[:, None] * e, axis=1)
        edge = np.minimum(np.minimum(seg(ba, pa), seg(cb, pb)), seg(ac, pc))
        plane = np.abs(pa @ nor) / np.linalg.norm(nor)
        return np.where(inside, plane, edge) - thick
    return Shape(fn, np.minimum(np.minimum(a, b), c) - thick, np.maximum(np.maximum(a, b), c) + thick)


def wing(s):
    """Wing bones on side s: shoulder root, elbow, clawed wrist, three finger tips and where the membrane meets the flank."""
    root, elbow, wrist = (np.array(v) for v in ((s * 0.2, 0.02, 2.18), (s * 0.72, 0.28, 2.62), (s * 1.22, 0.46, 3.08)))
    tips = [np.array(v) for v in ((s * 2.05, 0.95, 2.98), (s * 1.98, 1.2, 2.32), (s * 1.55, 1.08, 1.66))]
    return root, elbow, wrist, tips, np.array((s * 0.18, 0.55, 1.5))


def seg_dist(p, a, b):
    ab = b - a
    t = np.clip((p - a) @ ab / (ab @ ab), 0, 1)
    return np.linalg.norm(p - a - t[:, None] * ab, axis=1)


def spine_curve():
    """The body's centre line from snout to tail tip, with a radius (across, up) at each point."""
    pts = [((0, -0.82, 2.94), (0.075, 0.06)), ((0, -0.62, 3.0), (0.12, 0.1)), ((0, -0.42, 3.06), (0.17, 0.15)),    # head
           ((0, -0.3, 2.92), (0.12, 0.13)), ((0, -0.22, 2.68), (0.13, 0.15)), ((0, -0.24, 2.42), (0.16, 0.18)),   # neck
           ((0, -0.18, 2.12), (0.27, 0.3)), ((0, -0.05, 1.82), (0.31, 0.34)), ((0, 0.12, 1.52), (0.29, 0.3)),     # chest, belly
           ((0, 0.3, 1.25), (0.27, 0.27)), ((0, 0.55, 1.0), (0.2, 0.2)), ((0.04, 0.9, 0.62), (0.15, 0.15)),       # hips, tail
           ((0.15, 1.35, 0.3), (0.11, 0.1)), ((0.42, 1.85, 0.14), (0.08, 0.07)), ((0.85, 2.2, 0.1), (0.055, 0.05)),
           ((1.2, 2.25, 0.1), (0.04, 0.035)), ((1.42, 2.05, 0.09), (0.025, 0.022)), ((1.36, 1.86, 0.09), (0.012, 0.01))]
    return [np.array(p, float) for p, _ in pts], [np.array(r, float) for _, r in pts]


def sculpt():
    body = Body()
    add, cut = body.add, body.cut
    pts, radii = spine_curve()
    # Trunk: overlapping ellipsoids along the spine, each squashed across and stretched along it.
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        for t in (0.0, 0.5):
            c = lerp(a, b, t)
            r = lerp(radii[i], radii[i + 1], t)
            along = np.linalg.norm(b - a) * 0.75 + r.mean() * 0.4
            tag = "tail" if i >= 10 else "body"
            add(ellipsoid(c, (r[0], along, r[1]), frame(b - a, (0, -0.3, 1) if i < 6 else (0, -1, 0.4))), "body", tag, k=0.12 if i < 11 else 0.06)
    # Head: skull, brow ridges over the eyes, a long jaw, nostrils, teeth, two great swept horns and smaller ones behind.
    add(ellipsoid((0, -0.45, 3.07), (0.2, 0.24, 0.16), frame((0, -1, -0.15), (0, 0, 1))), "body", "body", k=0.06)
    add(ellipsoid((0, -0.7, 2.98), (0.12, 0.22, 0.095), frame((0, -1, -0.25), (0, 0, 1))), "body", "body", k=0.06)
    add(ellipsoid((0, -0.64, 2.875), (0.115, 0.23, 0.065), frame((0, -1, 0.05), (0, 0, 1))), "body", "jaw", k=0.035)
    for s in SIDES:
        add(ellipsoid((s * 0.13, -0.42, 2.96), (0.06, 0.1, 0.09)), "body", "body", k=0.05)                       # jaw muscle
    cut(tube([(-0.11, -0.48, 2.93), (0, -0.88, 2.915), (0.11, -0.48, 2.93)], 0.009), k=0.006)                    # mouth line
    for s in SIDES:
        add(tube([(s * 0.16, -0.38, 3.15), (s * 0.13, -0.53, 3.17), (s * 0.08, -0.68, 3.09)], (0.045, 0.04, 0.022)), "body", "body", k=0.03)
        cut(ellipsoid((s * 0.145, -0.55, 3.1), (0.032, 0.042, 0.024)), k=0.01)                                   # eye socket
        cut(ellipsoid((s * 0.03, -0.9, 2.975), (0.012, 0.02, 0.009)), k=0.006)                                   # nostril
        add(tube([(s * 0.035, -0.86, 2.99), (s * 0.05, -0.78, 3.02)], 0.012), "body", "body", k=0.012)
        for i in range(9):                                                                                       # teeth
            y = -0.83 + i * 0.035
            x = s * (0.04 + 0.07 * i / 8)
            add(cone((x, y, 2.928), (x, y - 0.004, 2.895), 0.008, 0.001), "body", "tooth", k=0.002)
            add(cone((x * 0.95, y + 0.017, 2.905), (x * 0.95, y + 0.013, 2.935), 0.007, 0.001), "body", "tooth", k=0.002)
        horn = bezier(np.array((s * 0.1, -0.36, 3.15)), np.array((s * 0.17, -0.2, 3.38)), np.array((s * 0.22, 0.05, 3.45)), 14)
        add(tube(horn, np.linspace(0.05, 0.006, 14)), "body", "horn", k=0.03)
        small = bezier(np.array((s * 0.14, -0.3, 3.07)), np.array((s * 0.24, -0.18, 3.13)), np.array((s * 0.3, -0.06, 3.1)), 8)
        add(tube(small, np.linspace(0.025, 0.004, 8)), "body", "horn", k=0.02)
        for i in range(4):                                                                                       # jaw frills
            base = np.array((s * 0.085, -0.62 + i * 0.07, 2.88))
            add(cone(base, base + np.array((s * 0.07, 0.04, -0.02)), 0.014, 0.002), "body", "horn", k=0.01)
    # Spines: a ridge down the back of the neck, along the back and to the tail tip.
    along = np.cumsum([0] + [np.linalg.norm(pts[i + 1] - pts[i]) for i in range(len(pts) - 1)])
    for d in np.arange(0.35, along[-1] - 0.1, 0.075):
        i = min(int(np.searchsorted(along, d)) - 1, len(pts) - 2)
        t = (d - along[i]) / (along[i + 1] - along[i])
        c, r = lerp(pts[i], pts[i + 1], t), lerp(radii[i], radii[i + 1], t)
        tangent = unit(pts[i + 1] - pts[i])
        up = unit(np.array((0, 0.8, 0.6)) if i < 6 else np.array((0, 0, 1)) - tangent * tangent[2])
        up = unit(up - tangent * (up @ tangent))
        size = 0.25 + 0.75 * math.sin(min(1.0, d / along[-1] * 1.6) * math.pi * 0.9 + 0.2)
        base = c + up * r[1] * 1.08
        add(cone(base, base + (up * 0.13 - tangent * 0.07) * size, 0.04 * size + 0.008, 0.002), "body", "spike", k=0.02)
    # Hind legs: thick thighs, digitigrade shanks, clawed feet planted wide.
    for s in SIDES:
        hip, knee, ankle, ball_ = (np.array(v) for v in ((s * 0.26, 0.32, 1.2), (s * 0.4, -0.05, 0.78), (s * 0.38, 0.36, 0.32), (s * 0.4, 0.05, 0.06)))
        add(ellipsoid(lerp(hip, knee, 0.45), (0.2, 0.32, 0.22), frame(knee - hip, (s, 0, 0))), "body", "body", k=0.08)
        add(cone(knee, ankle, 0.13, 0.08), "body", "body", k=0.05)
        add(ellipsoid(lerp(knee, ankle, 0.35) + np.array((0, 0.06, 0)), (0.13, 0.2, 0.12), frame(ankle - knee, (0, 1, 0))), "body", "body", k=0.05)
        add(cone(ankle, ball_, 0.075, 0.06), "body", "body", k=0.04)
        for j, spread in enumerate((-0.35, 0.0, 0.35)):
            d = unit(np.array((math.sin(spread) * s, -math.cos(spread), -0.05)))
            p1 = ball_ + d * 0.16
            add(cone(ball_, p1, 0.05, 0.035), "body", "body", k=0.03)
            add(tube([p1, p1 + d * 0.06 + np.array((0, 0, -0.01)), p1 + d * 0.1 + np.array((0, 0, -0.05))], (0.03, 0.018, 0.002)), "body", "claw", k=0.008)
        add(tube([ankle + np.array((0, 0.04, -0.05)), ankle + np.array((0, 0.12, -0.2)), ankle + np.array((0, 0.1, -0.27))], (0.025, 0.015, 0.002)), "body", "claw", k=0.01)
    # Forelimbs: raised before the chest, three-fingered hands with hooked claws.
    for s in SIDES:
        shoulder, elbow, wrist = (np.array(v) for v in ((s * 0.27, -0.22, 2.02), (s * 0.4, -0.3, 1.66), (s * 0.28, -0.6, 1.78)))
        add(ellipsoid(lerp(shoulder, elbow, 0.45), (0.1, 0.22, 0.1), frame(elbow - shoulder, (0, -1, 0))), "body", "body", k=0.06)
        add(cone(elbow, wrist, 0.07, 0.045), "body", "body", k=0.04)
        for j, spread in enumerate((-0.4, 0.0, 0.4)):
            d = unit(np.array((math.sin(spread) * s * 0.6, -0.6, -0.75)))
            p1 = wrist + d * 0.09
            add(cone(wrist, p1, 0.03, 0.022), "body", "body", k=0.02)
            add(tube([p1, p1 + d * 0.05, p1 + d * 0.07 + np.array((0, 0.03, -0.02))], (0.018, 0.011, 0.0015)), "body", "claw", k=0.006)
    # Wings: an arm of bone from the shoulders to a clawed wrist, three long fingers, the membrane stretched between
    # them with its trailing edge scalloped between the finger tips.
    for s in SIDES:
        root, elbow, wrist, tips, attach = wing(s)
        add(cone(root, elbow, 0.075, 0.05), "body", "body", k=0.05)
        add(cone(elbow, wrist, 0.05, 0.035), "body", "wingbone", k=0.03)
        add(ball(wrist, 0.042), "body", "wingbone", k=0.02)
        add(tube([wrist, wrist + np.array((s * 0.04, -0.1, 0.12)), wrist + np.array((s * 0.02, -0.15, 0.13))], (0.025, 0.015, 0.002)), "body", "claw", k=0.008)
        for tip in tips:
            mid = lerp(wrist, tip, 0.5) + np.array((0, -0.04, 0.05))
            add(tube([wrist, mid, tip], (0.028, 0.018, 0.006)), "body", "wingbone", k=0.015)
        panels = [(wrist, tips[0], tips[1]), (wrist, tips[1], tips[2]), (wrist, tips[2], attach), (elbow, wrist, attach), (root, elbow, attach)]
        membrane = hk.union(*(triangle(a, b, c, 0.006) for a, b, c in panels))
        bites = hk.union(*(ball(lerp(a, b, 0.5) + unit(lerp(a, b, 0.5) - wrist) * np.linalg.norm(b - a) * 0.33, np.linalg.norm(b - a) * 0.42)
                          for a, b in ((tips[0], tips[1]), (tips[1], tips[2]), (tips[2], attach))))
        add(hk.minus(membrane, bites), "body", "membrane", k=0.02)
    return body


def surface(obj, body):
    co, normal, edges = arrays(obj.data)
    tags = body.nearest(co, "tag")
    is_ = lambda *n: np.isin(tags, n)
    hide = is_("body", "tail", "jaw")
    # Scales: domed cells, smaller on the head, neck and limbs; on the belly side they give way to broad plates.
    pts, radii = spine_curve()
    seg = np.array([lerp(pts[i], pts[i + 1], t) for i in range(len(pts) - 1) for t in np.linspace(0, 1, 6)])
    nearest_seg = np.argmin(np.linalg.norm(co[:, None, :] - seg[None, ::2, :], axis=2), axis=1) * 2
    centre = seg[nearest_seg]
    outward = co - centre
    belly_dir = np.array((0, -1, -0.35))
    tangent = np.gradient(seg, axis=0)[nearest_seg]
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    belly_dir = belly_dir - tangent * (tangent @ belly_dir)[:, None]
    belly_dir /= np.linalg.norm(belly_dir, axis=1, keepdims=True)
    facing = (outward / np.maximum(np.linalg.norm(outward, axis=1, keepdims=True), 1e-6) * belly_dir).sum(1)
    belly_w = smooth(0.45, 0.7, facing) * hide * (np.linalg.norm(co[:, :2] - centre[:, :2], axis=1) < 0.5)
    along = np.cumsum(np.r_[0, np.linalg.norm(np.diff(seg, axis=0), axis=1)])[nearest_seg]
    plates = 0.5 + 0.5 * np.cos(along / 0.055 * 2 * math.pi)
    size = np.where(co[:, 2] > 2.3, 0.022, np.where(np.abs(co[:, 0]) > 0.3, 0.026, 0.034))
    f1, ident = cells(co / size[:, None], seed=3)
    scale = smooth(0.15, 0.75, f1)
    offset = hide * ((1 - belly_w) * (-0.004 * scale) + belly_w * (-0.006 * smooth(0.8, 1.0, plates)))
    offset += is_("membrane") * 0.002 * fbm(co * np.array((30, 30, 30)), 3, seed=6)
    offset += is_("horn", "spike", "claw") * 0.0015 * np.sin(np.linalg.norm(co - np.array((0, -0.4, 3.1)), axis=1) * 200)
    displace(obj, offset)
    # The membranes billow back between the finger bones, the whole slab moving together (not along each face's normal).
    co, normal, edges = arrays(obj.data)
    for s in SIDES:
        root, elbow, wrist, tips, attach = wing(s)
        side = is_("membrane") & (co[:, 0] * s > 0.1)
        if not side.any():
            continue
        n = unit(np.cross(tips[0] - root, tips[2] - root)) * s
        n = n if n[1] > 0 else -n
        p = co[side]
        bones = np.min([seg_dist(p, a, b) for a, b in ((root, elbow), (elbow, wrist), *((wrist, t) for t in tips))], axis=0)
        co[side] += n * (0.09 * smooth(0.0, 0.45, bones))[:, None]
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()
    co, normal, edges = arrays(obj.data)
    cav = concavity(co, normal, edges)
    ridge, hollow = smooth(0.0, 0.8, -cav), smooth(0.05, 1.0, cav)
    mottle = fbm(co * 3, 4, seed=21)
    albedo = np.zeros((len(co), 3))
    base = np.array((0.075, 0.072, 0.07)) * (0.8 + 0.4 * mottle)[:, None] * (0.85 + 0.3 * ident)[:, None]
    albedo[:] = base
    albedo = lerp(albedo, np.array((0.2, 0.19, 0.18)), (0.5 * ridge * hide)[:, None])                        # worn scale edges
    plate = np.array((0.6, 0.5, 0.3)) * (0.8 + 0.3 * fbm(co * 8, 3, seed=22))[:, None]
    albedo = lerp(albedo, plate * (0.8 + 0.25 * smooth(0.7, 1.0, plates))[:, None], belly_w[:, None])
    mem = is_("membrane")
    albedo[mem] = np.array((0.11, 0.075, 0.07)) * (0.8 + 0.4 * fbm(co[mem] * 9, 3, seed=23))[:, None]
    albedo[is_("wingbone")] = (0.09, 0.085, 0.08)
    tip = smooth(0.0, 0.25, np.linalg.norm(co - np.array((0, -0.4, 3.1)), axis=1) - 0.25)
    for name, dark, light in (("horn", (0.1, 0.09, 0.08), (0.62, 0.56, 0.46)), ("spike", (0.07, 0.065, 0.06), (0.35, 0.32, 0.28)), ("claw", (0.05, 0.045, 0.045), (0.4, 0.37, 0.32))):
        m = is_(name)
        albedo[m] = lerp(np.array(dark), np.array(light), (0.4 * ridge[m] + 0.5 * tip[m] * (name == "horn"))[:, None])
    albedo[is_("tooth")] = (0.7, 0.64, 0.52)
    mouth = (np.abs(co[:, 2] - 2.915) < 0.012) & (co[:, 1] < -0.52) & (hollow > 0.25)
    albedo[mouth] = (0.25, 0.04, 0.03)
    albedo *= (1 - 0.5 * hollow)[:, None]
    rough = np.where(belly_w > 0.5, 0.55, 0.42) - 0.12 * ridge
    rough[mem] = 0.7
    rough[is_("horn", "claw", "tooth")] = 0.3
    hk.store(obj.data, albedo, rough, np.zeros(len(co)), leather=hide * (1 - belly_w) * 0.4 + mem * 0.6)


def eyes():
    mat = glossy(f"{NAME}-eyes", (0.9, 0.18, 0.06), rough=0.1, glow=(1.0, 0.25, 0.08), strength=4.0)
    out = []
    for s in SIDES:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.024, location=(s * 0.142, -0.568, 3.1))
        eye = bpy.context.object
        eye.scale = (0.7, 1.0, 0.6)
        bpy.ops.object.transform_apply(scale=True)
        eye.data.materials.append(mat)
        eye.data.shade_smooth()
        out.append(eye)
    return out


def main():
    reset_scene()
    body = sculpt()
    voxel = float(ARGS[ARGS.index("--voxel") + 1]) if "--voxel" in ARGS else 0.012 if PREVIEW else 0.0042
    high = body.sparse_mesh("dragon high", voxel)
    print("high poly", len(high.data.polygons))
    surface(high, body)
    mat = hk.hero_material("Dragon sculpt")
    parts = eyes()
    if PREVIEW:
        high.data.materials.append(mat[0])
        high.data.shade_smooth()
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(PREVIEW).resolve()))
        return
    low = bake_maps(NAME, high, mat, target=48000, cage=0.008, reach=0.025)
    bpy.data.objects.remove(high)
    export(NAME, None, [low, *parts])


main()
