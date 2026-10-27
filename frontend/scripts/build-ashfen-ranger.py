"""The Ashfen ranger: the hero, sculpted, rigged and animated in Blender from scratch.

Run from frontend/:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build-ashfen-ranger.py
Writes public/models/characters/ashfen-ranger.glb. Append `-- --preview out.blend` to save the painted sculpt and rig
at a coarser voxel instead (no bake or export), for look development.

A bearded woodsman under a deep hood and cowl, in a short-sleeved, waxed forest-green coat split front and back,
long linen shirt sleeves under studded leather bracers, two belts (an iron buckle at the waist, a pouch on the low
one), a scarf at the throat, breeches and tall turned-cuff boots. The coat, hood and scarf are the only green (hue 62-175) on him, so avatars.ts can dye them crimson or
gold; for that the colour and metal maps ship as JPEG/PNG rather than KTX2. The model carries every hero clip the game
plays, the sword moves included (herokit.build_clips), so the game no longer needs a separate combat set.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
from mathutils.kdtree import KDTree  # noqa: E402
import numpy as np  # noqa: E402

from bakekit import fbm, reset_scene, smooth  # noqa: E402
from charkit import (Body, armature, arrays, bake_maps, ball, bezier, bind, concavity, cone, displace, ellipsoid,  # noqa: E402
                     export, frame, reset_pose, skin, tube)
import herokit as hk  # noqa: E402
from herokit import FORWARD, SIDES, band, lerp, minus, strap, union, unit  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None
NAME = "ashfen-ranger"
GREEN = ("coat", "hood", "scarf")


def elliptic(c, rx, ry, z0, z1, rx1=None, ry1=None):
    """A solid elliptic frustum between heights z0 (radii rx, ry) and z1 (rx1, ry1), its axis vertical through c."""
    c = np.asarray(c, float)
    rx1, ry1 = rx1 or rx, ry1 or ry

    def fn(p):
        t = np.clip((p[:, 2] - z0) / (z1 - z0), 0, 1)
        ax, ay = rx + (rx1 - rx) * t, ry + (ry1 - ry) * t
        e = (np.sqrt(((p[:, 0] - c[0]) / ax) ** 2 + ((p[:, 1] - c[1]) / ay) ** 2) - 1) * np.minimum(ax, ay)
        return np.maximum(e, np.maximum(p[:, 2] - max(z0, z1), min(z0, z1) - p[:, 2]))
    r = max(rx, rx1, ry, ry1)
    return hk.Shape(fn, c + np.array((-r, -r, 0)) + np.array((0, 0, min(z0, z1) - c[2])), c + np.array((r, r, 0)) + np.array((0, 0, max(z0, z1) - c[2])))


def ring(c, rx, ry, z, r, tilt=0.0, n=40):
    pts = [np.array((c[0] + rx * math.cos(a), c[1] + ry * math.sin(a), z + tilt * ry * math.sin(a))) for a in np.linspace(0, 2 * math.pi, n)]
    return tube(pts, r)


def sculpt(J, hands):
    body = Body()
    add = body.add
    # The coat skirt first, hollow, so the legs added later stay separate inside it. Four panels hang from a yoke:
    # split at the front and the back (a riding coat) and at the sides, each panel following its own thigh.
    hem = lambda x, y: 0.59 + 0.012 * np.sin(np.arctan2(x, y) * 3 + 0.7) + 0.006 * np.sin(np.arctan2(x, y) * 7) + 0.004 * np.sin(np.arctan2(x, y) * 23)
    outer = elliptic((0, 0.012, 0), 0.172, 0.122, 0.98, 0.56, 0.235, 0.19)
    inner = elliptic((0, 0.012, 0), 0.16, 0.11, 0.99, 0.5, 0.226, 0.182)
    skirt = minus(minus(outer, inner), hk.below(hem, outer.lo, outer.hi))
    for (name, sx, sy) in (("Left", 1, -1), ("Right", -1, -1), ("Left", 1, 1), ("Right", -1, 1)):
        gap = 0.009 if sy < 0 else 0.006
        quadrant = hk.Shape(lambda p, sx=sx, sy=sy, gap=gap: np.maximum(gap - sx * p[:, 0], 0.004 - sy * (p[:, 1] - 0.012)), outer.lo, outer.hi)
        top = hk.below(lambda x, y: 0.92 + 0 * x, outer.lo, outer.hi)
        add(hk.intersect(hk.intersect(skirt, quadrant), top), name + "UpLeg", "coat", k=0.002)
    yoke = minus(minus(elliptic((0, 0.012, 0), 0.17, 0.12, 1.02, 0.86, 0.19, 0.152), elliptic((0, 0.012, 0), 0.15, 0.1, 1.03, 0.8, 0.18, 0.14)), hk.below(lambda x, y: 0.87 + 0 * x, outer.lo, outer.hi))
    add(yoke, "Hips", "coat", k=0.004)
    hk.limbs(body, J, leg_r=0.94, arm_tag="linen", leg_tag="wool")
    # Coat body: chest, waist and hips, a raised front flap closing on the right, a stand collar under the cowl.
    add(ellipsoid((0, 0.012, 1.35), (0.165, 0.11, 0.16)), "Spine2", "coat", k=0.04)
    add(ellipsoid((0, 0.014, 1.19), (0.15, 0.104, 0.13)), "Spine1", "coat", k=0.06)
    add(ellipsoid((0, 0.016, 1.03), (0.168, 0.118, 0.1)), "Hips", "coat", k=0.05)
    for side, s in SIDES:
        add(ellipsoid((s * 0.066, -0.07, 1.37), (0.065, 0.035, 0.055)), "Spine2", "coat", k=0.05)
        add(cone((s * 0.03, 0.03, 1.5), (s * 0.18, 0.016, 1.455), 0.05, 0.047), side + "Shoulder", "coat", k=0.04)
        add(ellipsoid((s * 0.07, 0.035, 0.95), (0.085, 0.08, 0.075)), "Hips", "coat", k=0.04)
    # The coat closes edge to edge down the front, held at the chest by an iron clasp.
    add(hk.box((0.0, -0.125, 1.43), (0.006, 0.006, 0.075), frame((0, 0.08, 1), (0, -1, 0)), rounding=0.003), "Spine2", "coat", k=0.008)
    add(minus(hk.box((0.0, -0.134, 1.44), (0.026, 0.005, 0.016), rounding=0.003), hk.box((0.0, -0.134, 1.44), (0.016, 0.01, 0.007), rounding=0.002)), "Spine2", "iron", k=0.0015)
    # Short coat sleeves capping the shoulder; the linen shirt's long sleeve under them, then a studded bracer.
    for side, s in SIDES:
        S, E, W = J[side + "Arm"], J[side + "ForeArm"], J[side + "Hand"]
        d = hands[side][0]
        ax = unit(W - E)
        sleeve = minus(cone(S - unit(E - S) * 0.02, lerp(S, E, 0.42), 0.068, 0.064), cone(lerp(S, E, 0.2), lerp(S, E, 0.6), 0.056, 0.056))
        add(sleeve, side + "Arm", "coat", k=0.01)
        add(cone(lerp(S, E, 0.25), lerp(S, E, 1.0), 0.05, 0.047), side + "Arm", "linen", k=0.02)
        add(cone(E - ax * 0.02, lerp(E, W, 0.4), 0.049, 0.045), side + "ForeArm", "linen", k=0.02)
        # Bracer: a long tapering leather cuff with rolled edges, three rows of iron studs down its outer face.
        add(cone(lerp(E, W, 0.28), W - d * 0.008, 0.045, 0.035), side + "ForeArm", "leather", k=0.006)
        u = unit(np.cross(ax, (0, 0, 1)))
        v = np.cross(ax, u)
        for t, r in ((0.28, 0.047), (0.97, 0.0365)):
            c = lerp(E, W, t)
            add(tube([c + r * (math.cos(a) * u + math.sin(a) * v) for a in np.linspace(0, 2 * math.pi, 28)], 0.0035), side + "ForeArm", "leather", k=0.002)
        out = unit(np.array((s, 0.35, 0.1)) - ax * (np.array((s, 0.35, 0.1)) @ ax))
        across = unit(np.cross(ax, out))
        for row in (-1, 0, 1):
            for t in np.linspace(0.36, 0.9, 6):
                r = 0.045 + (0.035 - 0.045) * (t - 0.28) / 0.69
                n = unit(out + across * row * 0.55)
                add(ball(lerp(E, W, t) + n * (r + 0.0005), 0.0042), side + "ForeArm", "iron", k=0.0012)
        hk.hand(body, J, hands, side, s)
    # Two belts: a broad one at the waist with an iron buckle, a second slung low across the hips carrying a pouch;
    # a strap from the right shoulder to the left hip carries the scabbard behind.
    add(band((0, 0.014, 1.0), 0.17, 0.121, 0.022, 0.0055, tilt=(0.0, 0.12)), "Hips", "belt", k=0.003)
    buckle = minus(hk.box((0.0, -0.127, 0.997), (0.028, 0.006, 0.03), rounding=0.003), hk.box((0.004, -0.127, 0.997), (0.017, 0.012, 0.02), rounding=0.002))
    add(buckle, "Hips", "iron", k=0.0015)
    add(cone((-0.012, -0.134, 0.997), (0.02, -0.134, 0.997), 0.0024), "Hips", "iron", k=0.001)
    add(band((0.0, 0.014, 0.925), 0.182, 0.133, 0.016, 0.005, tilt=(0.3, 0.0)), "Hips", "belt", k=0.003, bias=0.003)
    add(minus(hk.box((-0.12, -0.104, 0.89), (0.02, 0.006, 0.022), frame((0, 0, 1), (-0.6, -1, 0)), rounding=0.003),
              hk.box((-0.12, -0.104, 0.89), (0.012, 0.012, 0.014), frame((0, 0, 1), (-0.6, -1, 0)), rounding=0.002)), "Hips", "iron", k=0.0015)
    add(hk.box((0.165, -0.05, 0.9), (0.028, 0.038, 0.045), frame((0, 0, 1), (1, -0.4, 0)), rounding=0.013), "Hips", "satchel", k=0.006)
    add(hk.box((0.172, -0.052, 0.93), (0.024, 0.041, 0.024), frame((0, 0, 1), (1, -0.4, 0)), rounding=0.008), "Hips", "satchel", k=0.004)
    add(band((0, 0.014, 1.245), 0.19, 0.143, 0.017, 0.004, tilt=(-1.15, 0.0)), "Spine2", "belt", k=0.003, bias=0.004)
    # A dark green scarf wound at the throat, showing in the hood's opening.
    add(ellipsoid((0, -0.005, 1.515), (0.075, 0.08, 0.04)), "Neck", "scarf", k=0.02)
    # Cowl and hood: a deep, round hood whose brim overhangs the brow, open round the face, falling into a cowl.
    # The rim stands proud of the face, so the face sits back in the hood's shadow with the lining showing round it.
    cavity = hk.soft_union(0.03, ellipsoid((0, -0.008, 1.69), (0.104, 0.126, 0.14)), ellipsoid((0, 0.05, 1.6), (0.1, 0.085, 0.09)),
                           ellipsoid((0, -0.05, 1.57), (0.09, 0.08, 0.055)))
    opening = hk.prism_y(0.0, 1.648, 0.066, 0.128, -0.106, curve=0.03)
    hood = hk.soft_union(0.04, ellipsoid((0, -0.006, 1.69), (0.118, 0.14, 0.152)), ellipsoid((0, 0.055, 1.6), (0.114, 0.1, 0.1)),
                         ellipsoid((0, -0.05, 1.565), (0.104, 0.094, 0.066)), ellipsoid((0, -0.1, 1.79), (0.05, 0.05, 0.03)))
    add(minus(hood, union(cavity, opening)), "Head", "hood", k=0.004, bias=0.014)
    cowl = minus(minus(ellipsoid((0, 0.02, 1.475), (0.185, 0.145, 0.05)), union(cavity, opening)), hk.below(lambda x, y: 1.43 + 0.012 * np.sin(np.arctan2(x, y) * 5), (-0.3, -0.3, 1.3), (0.3, 0.3, 1.7)))
    add(cowl, "Neck", "hood", k=0.02, bias=0.014)
    hk.neck(body, J)
    centres, P, g = hk.head(body, J)
    # Beard: full and short, over the jaw, cheeks and chin, a heavy moustache over the lip.
    for side, s in SIDES:
        add(tube([P(s * 0.066, 0.004, 1.652), P(s * 0.062, -0.016, 1.61), P(s * 0.042, -0.062, 1.566), P(s * 0.014, -0.092, 1.55)], np.array((0.01, 0.015, 0.017, 0.017)) * g), "Head", "beard", k=0.014)
        add(ellipsoid(P(s * 0.043, -0.06, 1.615), np.array((0.024, 0.026, 0.032)) * g), "Head", "beard", k=0.016)
        add(tube(bezier(P(s * 0.002, -0.109, 1.606), P(s * 0.018, -0.106, 1.603), P(s * 0.03, -0.092, 1.582), 7), np.array(0.0055) * g), "Head", "beard", k=0.005)
    add(ellipsoid(P(0, -0.094, 1.548), np.array((0.03, 0.022, 0.026)) * g), "Head", "beard", k=0.014)
    add(ellipsoid(P(0, -0.101, 1.575), np.array((0.014, 0.008, 0.009)) * g), "Head", "beard", k=0.006)
    eyes = centres
    # Hair: cropped close, a ragged line across the brow under the hood.
    hairline = lambda x, y: P(0, 0, 1.748)[2] + 0.012 * np.abs(x) / 0.06 + 0.004 * np.sin(x * 260) - 0.25 * np.maximum(0, y + 0.02)
    cap = hk.soft_union(0.02, ellipsoid(P(0, 0.012, 1.722), np.array((0.082, 0.102, 0.098)) * g, frame((0, 0.3, 1), (0, -1, 0.3))),
                        ellipsoid(P(0, -0.03, 1.73), np.array((0.072, 0.066, 0.074)) * g))
    add(hk.intersect(cap, hk.above(hairline, cap.lo, cap.hi)), "Head", "hair", k=0.004)
    # Breeches into tall boots with a turned-down cuff, two strap rings and a stitched sole.
    for side, s in SIDES:
        K, A, B, T = (J[side + n] for n in ("Leg", "Foot", "ToeBase", "ToeEnd"))
        add(cone(lerp(K, A, 0.14), A + np.array((0, 0, 0.02)), 0.057, 0.047), side + "Leg", "boot", k=0.01)
        add(ellipsoid(lerp(K, A, 0.3) - FORWARD * 0.02, (0.058, 0.118, 0.058), frame(A - K, FORWARD)), side + "Leg", "boot", k=0.03)
        add(cone(lerp(K, A, 0.03), lerp(K, A, 0.2), 0.066, 0.063), side + "Leg", "boot", k=0.006)
        add(ring(lerp(K, A, 0.03), 0.064, 0.064, lerp(K, A, 0.03)[2], 0.006), side + "Leg", "boot", k=0.004)
        for t in (0.55, 0.78):
            c = lerp(K, A, t)
            r = 0.057 + (0.047 - 0.057) * (t - 0.14) / 0.86 + 0.002
            add(ring(c, r, r, c[2], 0.0045, tilt=0.15), side + "Leg", "strap", k=0.002)
            add(hk.box(c + np.array((s * r, -0.004, 0.0)), (0.004, 0.009, 0.009), rounding=0.002), side + "Leg", "iron", k=0.001)
        add(ellipsoid((A[0], A[1] + 0.018, 0.064), (0.04, 0.05, 0.062)), side + "Foot", "boot", k=0.02)
        add(ellipsoid(lerp(A, B, 0.55) + np.array((0, 0, -0.012)), (0.046, 0.085, 0.038), frame(B - A, (0, 0, 1))), side + "Foot", "boot", k=0.025)
        add(ellipsoid(B + np.array((s * 0.002, -0.022, 0.004)), (0.045, 0.062, 0.033), frame((0, -1, 0.12), (0, 0, 1))), side + "ToeBase", "boot", k=0.02)
        add(hk.box((A[0] + s * 0.002, (A[1] + 0.06 + T[1]) / 2 - 0.004, 0.011), (0.049, (A[1] + 0.06 - T[1]) / 2 - 0.01, 0.011), rounding=0.008), side + "Foot", "sole", k=0.004)
    return body, eyes, g


def surface(obj, body, J):
    co, normal, edges = arrays(obj.data)
    tags = body.nearest(co, "tag")
    is_ = lambda *names: np.isin(tags, names)
    green, cloth, leather = is_(*GREEN), is_("coat", "hood", "linen", "wool"), is_("boot", "belt", "leather", "strap", "satchel")
    skin = is_("skin", "lid", "lip", "ear")
    # Cloth shape: hanging folds on the skirt and cowl, creases round the hood's crown, bunching at elbows, knees and ankles.
    hood_folds, _ = hk.drape(co, (0, 0.02), 1.82, 1.6, 9, 0.003, 5)
    cowl_folds, _ = hk.drape(co, (0, 0.02), 1.53, 1.43, 13, 0.004, 7)
    # The coat's skirt panels hang in folds, stiffer than wool.
    skirt = is_("coat") & (co[:, 2] < 0.95) & (co[:, 2] > 0.5)
    co = hk.swing(co, skirt, (0.0, 0.012), 0.97, 0.6, 12, 0.017, 3)
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()
    co, normal, edges = arrays(obj.data)
    offset = np.zeros(len(co))
    offset += is_("hood") * np.where(co[:, 2] > 1.56, hood_folds, cowl_folds)
    for side, s in SIDES:
        E, W, K, A = J[side + "ForeArm"], J[side + "Hand"], J[side + "Leg"], J[side + "Foot"]
        offset += is_("linen") * hk.bunching(co, E, 0.06, 0.034, 0.0025, W - E + np.array((0, 0, 0.08)), 11)
        offset += is_("wool") * (hk.bunching(co, K, 0.08, 0.022, 0.003, A - K, 13) + hk.bunching(co, lerp(K, A, 0.08), 0.05, 0.014, 0.0025, A - K, 14))
        offset += is_("boot") * hk.bunching(co, A + np.array((0, -0.02, 0.06)), 0.045, 0.011, 0.0018, (0, 0, 1), 15)
    # Waxed coat: soft creases and dents over the body, worn smooth.
    offset += is_("coat") * 0.0016 * fbm(co * np.array((14, 14, 6)), 3, seed=6)
    worn = fbm(co * 40, 3, seed=8)
    offset += leather * 0.0004 * fbm(co * 90, 3, seed=9)
    offset += is_("hair") * 0.0008 * fbm(np.c_[co[:, 0] * 700, co[:, 1] * 140, co[:, 2] * 700], 2, seed=19)
    offset += is_("beard") * 0.0012 * fbm(np.c_[co[:, 0] * 800, co[:, 1] * 800, co[:, 2] * 120], 2, seed=10)
    displace(obj, offset)
    co, normal, edges = arrays(obj.data)
    cav = concavity(co, normal, edges)
    ridge, hollow = smooth(0.0, 0.8, -cav), smooth(0.05, 1.0, cav)
    seam = hk.seams(tags, edges, 2)
    mottle = fbm(co * 7, 4, seed=21)
    grime = smooth(0.75, 0.15, co[:, 2]) * (0.6 + 0.4 * fbm(co * 5, 3, seed=22))
    albedo = np.zeros((len(co), 3))
    rough = np.full(len(co), 0.8)
    metal = np.zeros(len(co))
    weave = np.zeros(len(co))
    grain = np.zeros(len(co))

    def put(mask, colour, r, var=0.18, wear=None, weave_w=0.0, grain_w=0.0, m=0.0):
        c = np.array(colour)[None, :] * (1 - var + 2 * var * mottle[mask, None])
        if wear is not None:
            c = lerp(c, np.array(wear)[None, :], (0.6 * ridge[mask] * (0.5 + 0.5 * worn[mask]))[:, None])
        albedo[mask] = c
        rough[mask] = r
        weave[mask] = weave_w
        grain[mask] = grain_w
        metal[mask] = m

    put(is_("coat"), (0.165, 0.225, 0.125), 0.5, wear=(0.3, 0.33, 0.22), weave_w=0.35, grain_w=0.5)
    put(is_("scarf"), (0.07, 0.19, 0.16), 0.85, weave_w=1.0)
    put(is_("hood"), (0.15, 0.21, 0.118), 0.88, wear=(0.24, 0.28, 0.18), weave_w=1.0)
    put(is_("linen"), (0.64, 0.585, 0.49), 0.84, wear=(0.74, 0.7, 0.62), weave_w=1.0)
    put(is_("wool"), (0.2, 0.175, 0.148), 0.9, weave_w=0.8)
    put(is_("boot"), (0.25, 0.155, 0.09), 0.38, wear=(0.42, 0.3, 0.2), grain_w=1.0)
    put(is_("leather"), (0.31, 0.2, 0.11), 0.52, wear=(0.46, 0.33, 0.21), grain_w=1.0)
    put(is_("belt", "strap"), (0.2, 0.12, 0.07), 0.48, wear=(0.36, 0.24, 0.15), grain_w=1.0)
    put(is_("satchel"), (0.34, 0.235, 0.14), 0.58, wear=(0.48, 0.36, 0.24), grain_w=1.0)
    put(is_("lace"), (0.16, 0.1, 0.06), 0.6, var=0.1)
    put(is_("sole"), (0.08, 0.06, 0.05), 0.75, var=0.1)
    put(is_("iron"), (0.42, 0.41, 0.4), 0.38, wear=(0.62, 0.61, 0.6), m=1.0)
    put(is_("horn"), (0.36, 0.3, 0.22), 0.4, var=0.12)
    # Skin: warm, ruddier at the nose, cheeks, ears and knuckles; lips and lids a touch deeper; nails pale.
    face = co[:, 2] > 1.5
    flush = smooth(0.5, 1.0, np.exp(-np.linalg.norm((co - np.array((0, -0.09, 1.63))) / np.array((0.05, 0.04, 0.04)), axis=1) ** 2)) * face
    put(skin, (0.73, 0.54, 0.44), 0.55, var=0.08)
    albedo[skin] = lerp(albedo[skin], np.array((0.72, 0.42, 0.36)), (0.4 * flush[skin] + 0.25 * is_("ear")[skin] + 0.25 * ridge[skin] * ~face[skin])[:, None])
    put(is_("nail"), (0.82, 0.66, 0.6), 0.3, var=0.05)
    put(is_("hair"), (0.19, 0.13, 0.085), 0.6, var=0.25)
    hair = is_("hair")
    albedo[hair] *= (0.65 + 0.6 * fbm(np.c_[co[hair, 0] * 700, co[hair, 1] * 140, co[hair, 2] * 700], 2, seed=18))[:, None]
    beard = is_("beard")
    put(beard, (0.2, 0.135, 0.085), 0.65, var=0.25)
    albedo[beard] *= (0.65 + 0.6 * fbm(np.c_[co[beard, 0] * 900, co[beard, 1] * 900, co[beard, 2] * 140], 2, seed=17))[:, None]
    # Seams and stitch lines darker, quilting grooves shaded, cloth edges and hems worn, grime and mud toward the feet.
    albedo[cloth] *= (1 - 0.35 * seam[cloth])[:, None]
    albedo[leather] *= (1 - 0.3 * seam[leather])[:, None]
    albedo = lerp(albedo, np.array((0.2, 0.16, 0.11)), (0.55 * grime * (cloth | leather))[:, None])
    albedo *= (1 - np.where(skin, 0.12, 0.45) * hollow)[:, None]        # skin: the bake's occlusion is enough
    albedo = hk.face_paint(co, albedo, tags, False, (0.2, 0.135, 0.085))
    albedo = hk.feather(albedo, tags, edges, ("skin", "lid", "lip", "ear", "beard", "hair"), passes=8)
    # Stubble: the beard and hair thin out over the skin beside them in short dark hairs, so their edges are not cut.
    tree = KDTree(int((beard | hair).sum()))
    for i, p in enumerate(co[beard | hair]):
        tree.insert(p, i)
    tree.balance()
    shown = np.nonzero(skin & (co[:, 2] > 1.5))[0]
    gap = np.array([tree.find(co[i])[2] for i in shown])
    speckle = smooth(0.4, 0.7, fbm(co[shown] * 2200, 1, seed=16))
    stubble = smooth(0.028, 0.0, gap) ** 1.2 * (0.5 + 0.5 * speckle)
    albedo[shown] = lerp(albedo[shown], albedo[shown] * np.array((0.5, 0.47, 0.47)), (0.85 * stubble)[:, None])
    albedo[green] = np.clip(albedo[green], 0, 1)
    rough = np.clip(rough + 0.08 * hollow - 0.06 * ridge * leather, 0.05, 1)
    albedo, rough, metal = hk.weathering(co, albedo, rough, metal, ridge, hollow, seam, cloth | is_("scarf"), leather, is_("iron"))
    albedo[green] = np.clip(albedo[green], 0, 1)
    hk.store(obj.data, albedo, rough, metal, weave=weave, leather=grain, pores=skin.astype(float), brush=metal)


def main():
    reset_scene()
    J, hands = hk.joints()
    body, centres, g = sculpt(J, hands)
    voxel = float(ARGS[ARGS.index("--voxel") + 1]) if "--voxel" in ARGS else 0.003 if PREVIEW else 0.0012
    high = body.mesh("ranger high", voxel)
    print("high poly", len(high.data.polygons))
    surface(high, body, J)
    spec = hk.bones(J, hands)
    rig = armature("Armature", spec)
    mat = hk.hero_material()
    style = hk.Style(bow=0.07, sway=1.0, stance=0.05, guard_drop=0.07)
    eyes = hk.eyeballs(f"{NAME}-eyes", centres, iris=(0.36, 0.31, 0.19), radius=0.0122)
    if PREVIEW:
        high.data.materials.append(mat[0])
        high.data.shade_smooth()
        skin(high, rig, body)
        for eye in eyes:
            bind(eye, rig, "Head")
        hk.build_clips(rig, style, hands)
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(PREVIEW).resolve()))
        return
    low = bake_maps(NAME, high, mat, ao=0.5, target=46000)
    bpy.data.objects.remove(high)
    skin(low, rig, body)
    for eye in eyes:
        bind(eye, rig, "Head")
    hk.build_clips(rig, style, hands)
    reset_pose(rig)
    hk.shrink_dyed_maps(low)
    export(NAME, rig, [low, *eyes], keep=("colour", "data"), jpeg=True)


main()
