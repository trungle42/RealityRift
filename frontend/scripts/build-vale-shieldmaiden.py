"""The Vale shieldmaiden: the blue player's hero and, crowned in ice, the frost witch. Sculpted, rigged and animated in
Blender from scratch.

Run from frontend/:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build-vale-shieldmaiden.py
Writes public/models/characters/vale-shieldmaiden.glb. Append `-- --preview out.blend` to save the painted sculpt and
rig at a coarser voxel instead (no bake or export), for look development.

A northern warrior, bareheaded, her hair swept back into a high knot and tail with two braids forward over her
shoulders; a knee-length grey wool tunic with a front panel over a mail shirt, mail over her shoulders under round
steel plates, a wide leather corset with steel scales hanging from it, leather gloves and bracers, loose wool trousers
and tall fur-cuffed boots. Her cloth is the only unsaturated, non-metal grey on her, so avatars.ts can dye it royal
blue (colour and metal maps ship as JPEG/PNG).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from bakekit import fbm, reset_scene, smooth  # noqa: E402
from charkit import (Body, armature, arrays, bake_maps, ball, bezier, bind, concavity, cone, displace, ellipsoid,  # noqa: E402
                     export, frame, reset_pose, skin, tube)
import herokit as hk  # noqa: E402
from herokit import FORWARD, SIDES, band, lerp, minus, union, unit  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None
NAME = "vale-shieldmaiden"


def elliptic(c, rx, ry, z0, z1, rx1, ry1):
    """A solid elliptic frustum from height z0 (radii rx, ry) to z1 (rx1, ry1), its axis vertical through c."""
    c = np.asarray(c, float)

    def fn(p):
        t = np.clip((p[:, 2] - z0) / (z1 - z0), 0, 1)
        ax, ay = rx + (rx1 - rx) * t, ry + (ry1 - ry) * t
        e = (np.sqrt(((p[:, 0] - c[0]) / ax) ** 2 + ((p[:, 1] - c[1]) / ay) ** 2) - 1) * np.minimum(ax, ay)
        return np.maximum(e, np.maximum(p[:, 2] - max(z0, z1), min(z0, z1) - p[:, 2]))
    r = max(rx, rx1, ry, ry1)
    return hk.Shape(fn, (c[0] - r, c[1] - r, min(z0, z1)), (c[0] + r, c[1] + r, max(z0, z1)))


def hairline(x, y):
    """Across the brow in front, a hand's width above the brows, down past the temples to above the ears, low at the
    nape (the head is scaled 0.84 about z 1.69)."""
    zf = 1.69 + (1.786 - 1.69) * 0.84
    turn = np.abs(np.arctan2(x, -(y - 0.005)))
    return zf + 0.004 * (x / 0.05) ** 2 - 0.072 * smooth(0.55, 1.45, turn) - 0.07 * smooth(1.7, 2.8, turn)


def ring(c, axis, r, thick, n=36):
    axis = unit(axis)
    u = unit(np.cross(axis, (0.3, 0.2, 1.0)))
    v = np.cross(axis, u)
    return tube([np.asarray(c) + r * (math.cos(a) * u + math.sin(a) * v) for a in np.linspace(0, 2 * math.pi, n)], thick)


def sculpt(J, hands):
    body = Body()
    add = body.add
    # Tunic skirt first, hollow, in four panels (split at the sides and the front for striding).
    hem = lambda x, y: 0.56 + 0.008 * np.sin(np.arctan2(x, y) * 4 + 1.1)
    outer = elliptic((0, 0.012, 0), 0.175, 0.12, 0.98, 0.54, 0.25, 0.2)
    inner = elliptic((0, 0.012, 0), 0.163, 0.108, 0.99, 0.48, 0.24, 0.192)
    skirt = minus(minus(outer, inner), hk.below(hem, outer.lo, outer.hi))
    for name, sx, sy in (("Left", 1, -1), ("Right", -1, -1), ("Left", 1, 1), ("Right", -1, 1)):
        gap = 0.008 if sy < 0 else 0.0
        quadrant = hk.Shape(lambda p, sx=sx, sy=sy, gap=gap: np.maximum(gap - sx * p[:, 0], 0.004 - sy * (p[:, 1] - 0.012)), outer.lo, outer.hi)
        add(hk.intersect(hk.intersect(skirt, quadrant), hk.below(lambda x, y: 0.9 + 0 * x, outer.lo, outer.hi)), name + "UpLeg", "wool", k=0.002)
    # Mail shirt hem showing under the tunic, a hand's breadth longer.
    mail_hem = minus(minus(elliptic((0, 0.012, 0), 0.17, 0.116, 0.9, 0.5, 0.235, 0.188), elliptic((0, 0.012, 0), 0.16, 0.106, 0.92, 0.45, 0.226, 0.18)),
                     hk.below(lambda x, y: 0.505 + 0 * x, outer.lo, outer.hi))
    for name, sx in (("Left", 1), ("Right", -1)):
        half = hk.Shape(lambda p, sx=sx: 0.004 - sx * p[:, 0], outer.lo, outer.hi)
        add(hk.intersect(mail_hem, half), name + "UpLeg", "mail", k=0.002)
    yoke = minus(minus(elliptic((0, 0.012, 0), 0.17, 0.118, 1.02, 0.86, 0.19, 0.15), elliptic((0, 0.012, 0), 0.15, 0.1, 1.03, 0.8, 0.18, 0.14)),
                 hk.below(lambda x, y: 0.87 + 0 * x, outer.lo, outer.hi))
    add(yoke, "Hips", "wool", k=0.004)
    hk.limbs(body, J, female=True, leg_r=1.25, arm_r=1.1, arm_tag="wool", leg_tag="trousers")
    # Tunic body over the mail: a fitted chest, a high round neck, long sleeves.
    add(ellipsoid((0, 0.01, 1.345), (0.152, 0.11, 0.15)), "Spine2", "wool", k=0.04)
    add(ellipsoid((0, 0.012, 1.19), (0.145, 0.102, 0.125)), "Spine1", "wool", k=0.06)
    add(ellipsoid((0, 0.014, 1.02), (0.17, 0.112, 0.1)), "Hips", "wool", k=0.05)
    for side, s in SIDES:
        add(ellipsoid((s * 0.056, -0.07, 1.335), (0.054, 0.04, 0.048)), "Spine2", "wool", k=0.06)
        add(cone((s * 0.025, 0.03, 1.49), (s * 0.165, 0.016, 1.45), 0.046, 0.044), side + "Shoulder", "wool", k=0.04)
        add(ellipsoid((s * 0.07, 0.035, 0.94), (0.088, 0.082, 0.08)), "Hips", "wool", k=0.04)
    # Round shoulder plates on straps, each two lames deep.
    for side, s in SIDES:
        S, E = J[side + "Arm"], J[side + "ForeArm"]
        c = S + np.array((s * 0.012, 0.0, 0.012))
        add(minus(ellipsoid(c, (0.084, 0.076, 0.05), frame(E - S, (s, 0, 0.6))), ellipsoid(c - np.array((0, 0, 0.01)), (0.076, 0.068, 0.044), frame(E - S, (s, 0, 0.6)))),
            side + "Arm", "steel", k=0.002, bias=0.004)
        lame = lerp(S, E, 0.3) + np.array((s * 0.014, 0, 0.0))
        add(minus(ellipsoid(lame, (0.062, 0.042, 0.052), frame(E - S, (s, 0, 0.4))), ellipsoid(lame - unit(np.array((s, 0, 0.4))) * 0.008, (0.056, 0.036, 0.046), frame(E - S, (s, 0, 0.4)))),
            side + "Arm", "steel", k=0.002, bias=0.004)
        for i in range(3):         # rivets round the plate's edge
            a = -0.6 + i * 0.6
            p = c + 0.068 * np.array((s * math.cos(a) * 0.6, math.sin(a), 0.55)) / np.linalg.norm((0.6, 1, 0.55))
            add(ball(p + np.array((s * 0.03, 0, 0.0)), 0.004), side + "Arm", "steel", k=0.001)
    # Wool sleeves to the wrist, leather bracers over them, gloves.
    for side, s in SIDES:
        E, W = J[side + "ForeArm"], J[side + "Hand"]
        d = hands[side][0]
        add(cone(lerp(E, W, 0.3), W - d * 0.006, 0.042, 0.033), side + "ForeArm", "leather", k=0.005)
        for t, r in ((0.3, 0.044), (0.97, 0.035)):
            add(ring(lerp(E, W, t), W - E, r, 0.0032), side + "ForeArm", "leather", k=0.002)
        for t in (0.5, 0.75):
            add(ring(lerp(E, W, t), W - E, 0.042 + (0.034 - 0.042) * (t - 0.3) / 0.67 + 0.002, 0.0038), side + "ForeArm", "strap", k=0.0015)
        hk.hand(body, J, hands, side, s, glove="glove")
        add(cone(W - d * 0.01, W + d * 0.03, 0.03, 0.031), side + "Hand", "glove", k=0.006)
    # Mail over the shoulders and upper chest, under the plates.
    add(minus(ellipsoid((0, 0.009, 1.385), (0.16, 0.117, 0.125)), hk.below(lambda x, y: 1.29 + 0.03 * np.cos(np.arctan2(x, -y)), (-0.2, -0.2, 1.2), (0.2, 0.2, 1.6))),
        "Spine2", "mail", k=0.006, bias=0.003)
    # A steel breastplate over the mail, cut low round the neck.
    plate = minus(ellipsoid((0, 0.0, 1.355), (0.168, 0.128, 0.142)), ellipsoid((0, 0.004, 1.355), (0.16, 0.12, 0.134)))
    front = hk.Shape(lambda p: np.maximum(np.maximum(p[:, 1] + 0.035, 1.215 - p[:, 2]), p[:, 2] - 1.465), (-0.2, -0.2, 1.2), (0.2, 0.0, 1.48))
    add(minus(hk.intersect(plate, front), ball((0, -0.105, 1.5), 0.075)), "Spine2", "steel", k=0.004, bias=0.003)
    add(tube([(0, -0.132, 1.43), (0, -0.142, 1.33), (0, -0.132, 1.23)], 0.004), "Spine2", "steel", k=0.004)
    # A wide leather corset over the tunic, laced at the back, two buckled straps across the front.
    add(band((0, 0.013, 1.075), 0.152, 0.106, 0.068, 0.006, tilt=(0.0, 0.08)), "Spine1", "leather", k=0.004)
    for z in (1.03, 1.11):
        add(band((0, 0.013, z), 0.159, 0.113, 0.011, 0.004), "Spine1" if z > 1.07 else "Hips", "strap", k=0.002, bias=0.002)
        add(minus(hk.box((0.035, -0.12, z), (0.016, 0.005, 0.016), rounding=0.002), hk.box((0.035, -0.12, z), (0.009, 0.01, 0.009), rounding=0.002)), "Spine1", "steel", k=0.0012)
    for i in range(5):           # back lacing
        z = 1.025 + i * 0.024
        add(cone((-0.014, 0.12, z), (0.014, 0.12, z + 0.012), 0.0016), "Spine1", "strap", k=0.001)
        add(cone((0.014, 0.12, z), (-0.014, 0.12, z + 0.012), 0.0016), "Spine1", "strap", k=0.001)
    # Steel scales hanging from the corset's lower edge over the tunic, two staggered rows round the hips.
    for row, z in enumerate((0.975, 0.94)):
        for i in range(22):
            a = (i + 0.5 * row) / 22 * 2 * math.pi
            rx, ry = 0.178 + 0.008 * row, 0.126 + 0.008 * row
            c = np.array((rx * math.sin(a), 0.012 - ry * math.cos(a), z))
            n = unit(np.array((math.sin(a) / rx, -math.cos(a) / ry, 0.0)))
            scale = hk.intersect(ellipsoid(c + n * 0.004, (0.021, 0.034, 0.0026), frame((0, 0, 1) + n * 0.3, n)),
                                 hk.below(lambda x, y, z=z: z + 0.012 + 0 * x, c - 0.05, c + 0.05))
            add(scale, "Hips", "steel", k=0.001, bias=0.002)
    # A plain front panel over the skirt, a shade lighter, hemmed.
    apron = minus(elliptic((0, 0.012, 0), 0.18, 0.126, 0.97, 0.6, 0.245, 0.197), elliptic((0, 0.012, 0), 0.174, 0.12, 0.98, 0.55, 0.24, 0.192))
    add(hk.intersect(apron, hk.Shape(lambda p: np.maximum(np.abs(p[:, 0]) - 0.085, np.maximum(p[:, 1] + 0.03, 0.6 - p[:, 2])), (-0.1, -0.25, 0.6), (0.1, 0.0, 0.98))), "LeftUpLeg", "panel", k=0.002, bias=0.002)
    # Head: neck, face, hair swept back into a high knot with a tail, two braids forward over the shoulders, steel earrings.
    hk.neck(body, J, female=True)
    centres, P, g = hk.head(body, J, female=True)
    # The hair lies on the skull, its thickness growing from nothing at the hairline, so the edge is soft.
    skull = hk.soft_union(0.02, ellipsoid(P(0, 0.012, 1.722), np.array((0.078, 0.098, 0.094)) * g, frame((0, 0.3, 1), (0, -1, 0.3))),
                          ellipsoid(P(0, -0.03, 1.73), np.array((0.068, 0.062, 0.07)) * g))
    thick = lambda p: 0.0048 * smooth(0.0, 0.022, p[:, 2] - hairline(p[:, 0], p[:, 1]))
    cap = hk.Shape(lambda p: skull.fn(p) - thick(p), skull.lo - 0.006, skull.hi + 0.006)
    add(hk.intersect(cap, hk.above(lambda x, y: hairline(x, y) - 0.001, cap.lo, cap.hi)), "Head", "hair", k=0.003)
    knot = P(0, 0.035, 1.84)
    add(ellipsoid(knot, np.array((0.03, 0.033, 0.027)) * g), "Head", "hair", k=0.008)
    add(ring(knot - np.array((0, 0, 0.018)), (0, -0.35, 1), 0.026, 0.006), "Head", "hair", k=0.004)
    add(ring(knot - np.array((0, 0, 0.026)), (0, -0.35, 1), 0.02, 0.0035), "Head", "strap", k=0.002)
    tail = bezier(knot + np.array((0, 0.025, -0.005)), knot + np.array((0, 0.095, -0.07)), knot + np.array((0, 0.1, -0.37)), 16)
    add(tube(tail, np.linspace(0.026, 0.01, 16)), "Head", "hair", k=0.014)
    add(ellipsoid(tail[-1] + np.array((0, 0, -0.02)), (0.011, 0.009, 0.03)), "Head", "hair", k=0.01)
    for side, s in SIDES:
        braid(add, bezier(P(s * 0.06, 0.042, 1.66), np.array((s * 0.128, -0.07, 1.5)), np.array((s * 0.1, -0.178, 1.3)), 24), (0, -1, 0.2))
        lobe = P(s * 0.077, 0.004, 1.645)
        add(ring(lobe + np.array((s * 0.004, -0.004, -0.012)), (s, 0, 0), 0.006, 0.0012), "Head", "steel", k=0.0008, bias=0.009)   # biased so the jaw's skin stays skin
    # Loose wool trousers tucked into tall leather boots with a fur cuff and two strap rings.
    for side, s in SIDES:
        K, A, B, T = (J[side + n] for n in ("Leg", "Foot", "ToeBase", "ToeEnd"))
        add(cone(lerp(K, A, 0.0), lerp(K, A, 0.4), 0.062, 0.06), side + "Leg", "trousers", k=0.02)
        add(cone(lerp(K, A, 0.45), A + np.array((0, 0, 0.02)), 0.054, 0.046), side + "Leg", "boot", k=0.01)
        add(ellipsoid(lerp(K, A, 0.5), (0.072, 0.072, 0.034)), side + "Leg", "fur", k=0.014)
        for t in (0.68, 0.85):
            c = lerp(K, A, t)
            add(ring(c, A - K, 0.051 - 0.006 * (t - 0.6) / 0.4, 0.0042), side + "Leg", "strap", k=0.002)
        add(ellipsoid((A[0], A[1] + 0.018, 0.058), (0.04, 0.05, 0.055)), side + "Foot", "boot", k=0.02)
        add(ellipsoid(lerp(A, B, 0.55) + np.array((0, 0, -0.014)), (0.044, 0.085, 0.036), frame(B - A, (0, 0, 1))), side + "Foot", "boot", k=0.025)
        add(ellipsoid(B + np.array((s * 0.002, -0.02, 0.002)), (0.043, 0.058, 0.031), frame((0, -1, 0.12), (0, 0, 1))), side + "ToeBase", "boot", k=0.02)
        add(hk.box((A[0] + s * 0.002, (A[1] + 0.06 + T[1]) / 2 - 0.004, 0.009), (0.046, (A[1] + 0.06 - T[1]) / 2 - 0.01, 0.009), rounding=0.007), side + "Foot", "sole", k=0.004)
    return body, centres, g


def braid(add, path, toward):
    """A three-strand plait along `path`: lobes crossing alternately left and right over a core, tied off at the end."""
    for i, p in enumerate(path[:-1]):
        q = path[i + 1]
        r = 0.012 * (1 - 0.3 * i / len(path))
        along = unit(q - p)
        sidev = unit(np.cross(along, toward))
        bone = "Head" if p[2] > 1.6 else "Neck" if p[2] > 1.47 else "Spine2"
        strand = 1 if i % 2 else -1
        add(ellipsoid((p + q) / 2 + sidev * strand * r * 0.38, (r * 0.75, np.linalg.norm(q - p) * 1.05, r * 0.7), frame(along + sidev * strand * 0.55, toward)), bone, "hair", k=0.003)
        add(cone(p, q, r * 0.62), bone, "hair", k=0.003)
    tip = path[-1]
    down = unit(path[-1] - path[-2])
    add(cone(tip - down * 0.008, tip + down * 0.008, 0.0095, 0.009), "Spine2", "strap", k=0.002)
    add(cone(tip + down * 0.006, tip + down * 0.05, 0.0085, 0.003), "Spine2", "hair", k=0.003)


def surface(obj, body, J):
    co, normal, edges = arrays(obj.data)
    tags = body.nearest(co, "tag")
    is_ = lambda *names: np.isin(tags, names)
    cloth = is_("wool", "trousers", "panel")
    leather = is_("leather", "boot", "strap", "glove")
    skin_ = is_("skin", "lid", "lip", "ear")
    # The skirt hangs in loose folds, fuller toward the hem.
    skirt = is_("wool", "panel") & (co[:, 2] < 0.95) & (co[:, 2] > 0.5)
    co = hk.swing(co, skirt, (0.0, 0.012), 0.97, 0.56, 15, 0.022, 4)
    obj.data.vertices.foreach_set("co", co.ravel())
    obj.data.update()
    co, normal, edges = arrays(obj.data)
    offset = np.zeros(len(co))
    for side, s in SIDES:
        S, E, W, K, A = J[side + "Arm"], J[side + "ForeArm"], J[side + "Hand"], J[side + "Leg"], J[side + "Foot"]
        offset += is_("wool") * (hk.bunching(co, E, 0.07, 0.024, 0.003, W - E + np.array((0, 0, 0.08)), 21) + hk.bunching(co, lerp(S, E, 0.5), 0.07, 0.03, 0.002, E - S, 22))
        offset += is_("trousers") * (hk.bunching(co, K + np.array((0, 0, 0.05)), 0.09, 0.024, 0.003, A - K, 23) + hk.bunching(co, lerp(K, A, 0.4), 0.06, 0.02, 0.004, A - K, 27))
        offset += is_("boot") * hk.bunching(co, A + np.array((0, -0.02, 0.05)), 0.04, 0.011, 0.0015, (0, 0, 1), 24)
    # Mail: rows of interlinked rings, alternate rows offset by half a ring.
    mail = is_("mail")
    rows = co[:, 2] / 0.0065
    shifted = np.arctan2(co[:, 0], co[:, 1] - 0.01) * 0.15 / 0.0075 + 0.5 * (np.floor(rows) % 2)
    ring_d = np.hypot((rows % 1.0) - 0.5, (shifted % 1.0) - 0.5)
    links = smooth(0.18, 0.28, ring_d) * (1 - smooth(0.36, 0.48, ring_d))
    offset += mail * 0.0009 * (links - 0.4)
    offset += is_("fur") * 0.004 * fbm(np.c_[co[:, 0] * 300, co[:, 1] * 300, co[:, 2] * 60], 3, seed=25)
    combed = co[:, 2] > 1.62
    strands = np.where(combed, fbm(np.c_[co[:, 0] * 700, co[:, 1] * 50, co[:, 2] * 140], 2, seed=26), fbm(np.c_[co[:, 0] * 500, co[:, 1] * 500, co[:, 2] * 90], 2, seed=26))
    offset += is_("hair") * 0.0006 * strands
    displace(obj, offset)
    co, normal, edges = arrays(obj.data)
    cav = concavity(co, normal, edges)
    ridge, hollow = smooth(0.0, 0.8, -cav), smooth(0.05, 1.0, cav)
    seam = hk.seams(tags, edges, 2)
    mottle = fbm(co * 7, 4, seed=31)
    worn = fbm(co * 40, 3, seed=32)
    grime = smooth(0.7, 0.12, co[:, 2]) * (0.6 + 0.4 * fbm(co * 5, 3, seed=33))
    albedo, rough, metal = np.zeros((len(co), 3)), np.full(len(co), 0.8), np.zeros(len(co))
    weave, grain = np.zeros(len(co)), np.zeros(len(co))

    def put(mask, colour, r, var=0.16, wear=None, weave_w=0.0, grain_w=0.0, m=0.0):
        c = np.array(colour)[None, :] * (1 - var + 2 * var * mottle[mask, None])
        if wear is not None:
            c = lerp(c, np.array(wear)[None, :], (0.6 * ridge[mask] * (0.5 + 0.5 * worn[mask]))[:, None])
        albedo[mask], rough[mask], weave[mask], grain[mask], metal[mask] = c, r, weave_w, grain_w, m

    put(is_("wool"), (0.33, 0.33, 0.32), 0.9, var=0.12, wear=(0.42, 0.42, 0.41), weave_w=1.0)
    put(is_("trousers"), (0.27, 0.27, 0.265), 0.9, var=0.1, weave_w=0.9)
    put(is_("mail"), (0.5, 0.5, 0.5), 0.42, var=0.2, m=1.0)
    albedo[mail] *= (0.55 + 0.6 * links[mail])[:, None]
    put(is_("steel"), (0.5, 0.5, 0.5), 0.36, var=0.14, wear=(0.7, 0.7, 0.7), m=1.0)
    albedo[is_("steel")] *= (0.8 + 0.25 * fbm(co[is_("steel")] * 60, 3, seed=34))[:, None]
    put(is_("leather"), (0.3, 0.18, 0.1), 0.5, wear=(0.46, 0.32, 0.2), grain_w=1.0)
    put(is_("strap"), (0.2, 0.12, 0.07), 0.5, wear=(0.34, 0.22, 0.14), grain_w=1.0)
    put(is_("glove"), (0.24, 0.15, 0.09), 0.55, wear=(0.38, 0.27, 0.18), grain_w=1.0)
    put(is_("panel"), (0.37, 0.37, 0.36), 0.9, var=0.1, wear=(0.45, 0.45, 0.44), weave_w=1.0)
    put(is_("boot"), (0.25, 0.155, 0.09), 0.5, wear=(0.4, 0.28, 0.18), grain_w=1.0)
    put(is_("sole"), (0.08, 0.06, 0.05), 0.75, var=0.1)
    put(is_("fur"), (0.42, 0.31, 0.2), 0.85, var=0.3)
    put(skin_, (0.76, 0.565, 0.46), 0.55, var=0.07)
    albedo[skin_] = lerp(albedo[skin_], np.array((0.76, 0.45, 0.4)), (0.3 * is_("ear")[skin_] + 0.15 * ridge[skin_])[:, None])
    hair = is_("hair")
    put(hair, (0.52, 0.36, 0.22), 0.55, var=0.15)
    albedo[hair] *= (0.65 + 0.55 * strands[hair])[:, None]
    below = hairline(co[:, 0], co[:, 1]) - 0.011 - co[:, 2]       # the hair's tag reaches about 11 mm below the line
    fringe = skin_ & (below > -0.004) & (below < 0.012)
    wisps = smooth(0.012, 0.0, below[fringe]) ** 1.5 * (0.45 + 0.55 * strands[fringe])
    albedo[fringe] = lerp(albedo[fringe], np.array((0.46, 0.32, 0.2)), (0.7 * wisps)[:, None])
    albedo = hk.feather(albedo, tags, edges, ("skin", "lid", "lip", "ear", "hair"), passes=10)
    albedo[cloth] *= (1 - 0.3 * seam[cloth])[:, None]
    albedo[leather] *= (1 - 0.3 * seam[leather])[:, None]
    albedo = lerp(albedo, np.array((0.2, 0.17, 0.13)), (0.5 * grime * (cloth | leather))[:, None])
    albedo *= (1 - np.where(skin_, 0.12, 0.45) * hollow)[:, None]       # skin: the bake's occlusion is enough
    albedo = hk.face_paint(co, albedo, tags, True, (0.42, 0.28, 0.17))
    rough = np.clip(rough + 0.08 * hollow - 0.06 * ridge * leather, 0.05, 1)
    albedo, rough, metal = hk.weathering(co, albedo, rough, metal, ridge, hollow, seam, cloth, leather, is_("steel", "mail"))
    hk.store(obj.data, albedo, rough, metal, weave=weave, leather=grain, pores=skin_.astype(float), brush=metal)


def main():
    reset_scene()
    J, hands = hk.joints(female=True)
    body, centres, g = sculpt(J, hands)
    voxel = float(ARGS[ARGS.index("--voxel") + 1]) if "--voxel" in ARGS else 0.003 if PREVIEW else 0.0012
    high = body.mesh("maiden high", voxel)
    print("high poly", len(high.data.polygons))
    surface(high, body, J)
    rig = armature("Armature", hk.bones(J, hands))
    mat = hk.hero_material()
    style = hk.Style(bow=0.02, sway=0.6, stance=0.07, guard_drop=0.06)
    eyes = hk.eyeballs(f"{NAME}-eyes", centres, iris=(0.3, 0.42, 0.5), radius=0.0122)
    if PREVIEW:
        high.data.materials.append(mat[0])
        high.data.shade_smooth()
        skin(high, rig, body)
        for eye in eyes:
            bind(eye, rig, "Head")
        hk.build_clips(rig, style, hands)
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(PREVIEW).resolve()))
        return
    low = bake_maps(NAME, high, mat, target=50000, ao=0.5)
    bpy.data.objects.remove(high)
    skin(low, rig, body)
    for eye in eyes:
        bind(eye, rig, "Head")
    hk.build_clips(rig, style, hands)
    reset_pose(rig)
    hk.shrink_dyed_maps(low)
    export(NAME, rig, [low, *eyes], keep=("colour", "data"), jpeg=True)


main()
