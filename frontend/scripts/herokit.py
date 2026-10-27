"""Shared parts of the two human heroes (build-ashfen-ranger.py, build-vale-shieldmaiden.py): the skeleton, the bare
anatomy under the clothes (head, face, hands), cloth and leather surface helpers, a material with woven and grained
micro detail, and every clip the game plays on a hero.

The rig follows the game's conventions (Actor.ts): Hips, Spine..Spine2, Neck, Head, {side}Shoulder/Arm/ForeArm/Hand
with three-joint fingers, {side}UpLeg/Leg/Foot/ToeBase. Hand bones run along the fingers (+Y) with the palm on -Z, so
the thumb is on -X of the right hand and +X of the left, which is how Actor.holdWeapon and holdWand seat the sword
and the wand. Sword clips are posed by wrist position and blade direction (`arm` and `grip`), so the blade the game
puts in the fist points where the pose says.
"""
import math

import bpy
import numpy as np
from mathutils import Quaternion, Vector

from bakekit import fbm, smooth
from charkit import Pose, Shape, align, aim, ball, bezier, box, clip, cone, ease, ellipsoid, frame, rot, smin, tube

SIDES = (("Left", 1), ("Right", -1))
FINGERS = ("Index", "Middle", "Ring", "Pinky")
FORWARD = np.array([0.0, -1.0, 0.0])


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def toward(v, n, angle):
    v, n = unit(v), np.asarray(n, float)
    n = unit(n - v * (n @ v))
    return math.cos(angle) * v + math.sin(angle) * n


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- skeleton

def joints(female=False):
    """Rest joints of a 1.8 m adult (the game rescales to 1.9 m) in a relaxed A-pose, hands half closed."""
    w = 0.9 if female else 1.0          # shoulder breadth
    J = {k: np.array(v, float) for k, v in {
        "Hips": (0, 0.0, 0.985), "Spine": (0, 0.004, 1.07), "Spine1": (0, 0.006, 1.18), "Spine2": (0, 0.004, 1.3),
        "Neck": (0, 0.018, 1.5), "Head": (0, 0.006, 1.6), "HeadEnd": (0, -0.004, 1.81)}.items()}
    hands = {}
    for side, s in SIDES:
        J[side + "Shoulder"] = np.array([s * 0.028, 0.0, 1.455])
        J[side + "Arm"] = np.array([s * 0.172 * w, 0.012, 1.44])
        J[side + "ForeArm"] = np.array([s * (0.172 * w + 0.12), 0.03, 1.17])
        wrist = J[side + "Hand"] = np.array([s * (0.172 * w + 0.21), 0.0, 0.935])
        knuckle = wrist + np.array([s * 0.03, -0.012, -0.088])
        d = unit(knuckle - wrist)
        f = unit(FORWARD - d * (FORWARD @ d))
        n = unit(np.cross(d, FORWARD)) * s          # palm normal: in toward the thigh
        hands[side] = (d, f, n)
        J[side + "HandEnd"] = knuckle
        lens = ((0.042, 0.025, 0.02), (0.046, 0.028, 0.021), (0.043, 0.027, 0.02), (0.034, 0.02, 0.018))
        for i, (finger, off, ln, splay) in enumerate(zip(FINGERS, (0.026, 0.008, -0.009, -0.025), lens, (0.08, 0.02, -0.04, -0.1))):
            p = knuckle + f * off - d * (0.005 * abs(i - 1.0) ** 1.3)
            v = unit(d + f * splay)
            for k, (length, curl) in enumerate(zip(ln, (0.16, 0.26, 0.18))):
                v = toward(v, n, curl)
                J[f"{side}Hand{finger}{k + 1}"] = p
                p = p + v * length
            J[f"{side}Hand{finger}End"] = p
        p, v = wrist + d * 0.022 + f * 0.022 + n * 0.008, unit(d * 0.85 + f * 0.45 + n * 0.32)
        for k, (length, curl) in enumerate(zip((0.04, 0.032, 0.026), (0.08, 0.15, 0.12))):
            v = toward(v, n, curl)
            J[f"{side}HandThumb{k + 1}"] = p
            p = p + v * length
        J[f"{side}HandThumbEnd"] = p
        J[side + "UpLeg"] = np.array([s * 0.088, 0.004, 0.94])
        J[side + "Leg"] = np.array([s * 0.1, -0.008, 0.515])
        J[side + "Foot"] = np.array([s * 0.108, 0.03, 0.088])
        J[side + "ToeBase"] = np.array([s * 0.118, -0.095, 0.022])
        J[side + "ToeEnd"] = np.array([s * 0.124, -0.165, 0.02])
    return J, hands


def bones(J, hands):
    up = (0, -1, 0)
    out = [("Hips", J["Hips"], J["Spine"], None, up), ("Spine", J["Spine"], J["Spine1"], "Hips", up),
           ("Spine1", J["Spine1"], J["Spine2"], "Spine", up), ("Spine2", J["Spine2"], J["Neck"], "Spine1", up),
           ("Neck", J["Neck"], J["Head"], "Spine2", up), ("Head", J["Head"], J["HeadEnd"], "Neck", up)]
    for side, _ in SIDES:
        back = -hands[side][2]       # the back of the hand is bone +Z, so the palm faces -Z as the game expects
        out += [(side + "Shoulder", J[side + "Shoulder"], J[side + "Arm"], "Spine2", up),
                (side + "Arm", J[side + "Arm"], J[side + "ForeArm"], side + "Shoulder", up),
                (side + "ForeArm", J[side + "ForeArm"], J[side + "Hand"], side + "Arm", up),
                (side + "Hand", J[side + "Hand"], J[side + "HandEnd"], side + "ForeArm", back)]
        for finger in (*FINGERS, "Thumb"):
            for k in (1, 2, 3):
                tail = J[f"{side}Hand{finger}{k + 1}"] if k < 3 else J[f"{side}Hand{finger}End"]
                out.append((f"{side}Hand{finger}{k}", J[f"{side}Hand{finger}{k}"], tail, side + "Hand" if k == 1 else f"{side}Hand{finger}{k - 1}", back))
        out += [(side + "UpLeg", J[side + "UpLeg"], J[side + "Leg"], "Hips", up),
                (side + "Leg", J[side + "Leg"], J[side + "Foot"], side + "UpLeg", up),
                (side + "Foot", J[side + "Foot"], J[side + "ToeBase"], side + "Leg", (0, 0, 1)),
                (side + "ToeBase", J[side + "ToeBase"], J[side + "ToeEnd"], side + "Foot", (0, 0, 1))]
    return out


# ---------------------------------------------------------------- bare anatomy

def neck(body, J, female=False):
    r = 0.9 if female else 1.0
    body.add(cone((0, 0.022, 1.46), (0, 0.016, 1.63), 0.05 * r, 0.044 * r), "Neck", k=0.03)
    for side, s in SIDES:         # the two cords of the neck, ear to collarbone
        body.add(cone((s * 0.045, 0.026, 1.635), (s * 0.016, -0.034, 1.48), 0.0135 * r ** 3, 0.011 * r ** 3), "Neck", k=0.02)
    if not female:
        body.add(ellipsoid((0, -0.04, 1.565), (0.011, 0.012, 0.016)), "Neck", k=0.016)       # Adam's apple


def lift(z):
    """How far the lower face's landmarks rise above where they were first laid out, so the face divides like a real
    one: the nose ends about 5 cm below the eyes, the lips part about 2 cm below the nose and the chin ends about
    4.5 cm below the lips (head-scaled). Nothing above the cheekbones moves."""
    return np.interp(z, (1.54, 1.556, 1.575, 1.596, 1.62, 1.64, 1.665), (0.0155, 0.0155, 0.0115, 0.0095, 0.009, 0.0065, 0.0))


def face_point(c, g):
    """Face points scale about the head centre `c` by `g`, the lower face lifted as lift() says."""
    def P(x, y, z):
        return c + (np.array((x, y, z + lift(z)), float) - c) * g
    return P


def lip_curves(P, n=9):
    """The upper and lower lip's centre lines with their radii, shared by head() and face_paint()."""
    return ((bezier(P(-0.023, -0.097, 1.598), P(0, -0.115, 1.6055), P(0.023, -0.097, 1.598), n), 0.0033),
            (bezier(P(-0.02, -0.096, 1.5915), P(0, -0.111, 1.5865), P(0.02, -0.096, 1.5915), n), 0.0043))


def head(body, J, female=False):
    """Skull, face and ears, sculpted about the head centre (eyes at z 1.688). Returns the eye centres, the point
    mapping used (so hair and beard land on the same face) and the head's scale."""
    add, cut = body.add, body.cut
    g = 0.84 if female else 0.88       # overall size: a head an eighth of the body
    jaw = 0.82 if female else 1.0      # jaw breadth
    brow = 0.75 if female else 1.0
    c = np.array((0, 0.0, 1.69))

    P = face_point(c, g)

    def R(*r):
        return np.array(r, float) * g

    add(ellipsoid(P(0, 0.012, 1.722), R(0.078, 0.098, 0.094), frame((0, 0.3, 1), (0, -1, 0.3))), "Head", k=0.03)          # cranium
    add(ellipsoid(P(0, -0.03, 1.73), R(0.068, 0.062, 0.07)), "Head", k=0.03)                                                 # forehead
    add(tube([P(-0.054, -0.076, 1.711), P(-0.026, -0.093, 1.716), P(0, -0.095, 1.71), P(0.026, -0.093, 1.716), P(0.054, -0.076, 1.711)],
             0.0115 * brow * g), "Head", k=0.02)                                                                            # brow ridge
    for side, s in SIDES:
        add(ellipsoid(P(s * 0.053, -0.071, 1.664), R(0.021, 0.017, 0.015)), "Head", k=0.018)                                 # cheekbone
        add(ellipsoid(P(s * 0.043, -0.056, 1.638), R(0.026, 0.03, 0.033) * (0.85 if female else 1.0)), "Head", k=0.035)       # cheek
        taper = 0.9 if female else 1.0                                                                                    # a softer, narrower chin
        add(tube([P(s * 0.064 * jaw, 0.006, 1.662), P(s * 0.06 * jaw, -0.012, 1.602), P(s * 0.04 * jaw * taper, -0.06, 1.562), P(s * 0.013, -0.082, 1.556)],
                 R(0.012, 0.014, 0.012, 0.011)), "Head", k=0.03)                                                             # jaw line
        add(ellipsoid(P(s * 0.034, -0.086, 1.668), R(0.017, 0.008, 0.008)), "Head", k=0.012)                                # under the eye
    add(ellipsoid(P(0, -0.052, 1.635), R(0.05 * jaw, 0.03, 0.06)), "Head", k=0.03)                                         # fills between cheek and jaw
    add(ellipsoid(P(0, -0.068, 1.638), R(0.046, 0.026, 0.03)), "Head", k=0.03)                                                # fills the gutter between muzzle and cheeks
    add(ellipsoid(P(0, -0.062, 1.596), R(0.05, 0.03, 0.022)), "Head", k=0.02)                                                     # round the mouth, so it sits in the face
    add(ellipsoid(P(0, -0.084, 1.562), R(0.019 * jaw, 0.014, 0.016)), "Head", k=0.022)                                       # chin
    add(ellipsoid(P(0, -0.077, 1.616), R(0.024 * jaw, 0.013, 0.032)), "Head", k=0.016)                                       # upper jaw under the nose
    # Nose: bridge, tip, wings and nostrils.
    add(cone(P(0, -0.093, 1.697), P(0, -0.112, 1.64), 0.0062 * g, 0.0088 * g), "Head", k=0.01)
    add(ball(P(0, -0.112, 1.633), 0.0102 * g), "Head", k=0.008)
    for side, s in SIDES:
        add(ellipsoid(P(s * 0.0125, -0.1, 1.628), R(0.0085, 0.009, 0.0075)), "Head", k=0.006)
        cut(ellipsoid(P(s * 0.0076, -0.106, 1.621), R(0.0042, 0.0055, 0.0026)), k=0.002)
    # Eyes: a socket under the brow holds the eyeball; the lids wrap the ball's front, the upper with a crease above.
    centres = []
    radius = 0.0122 / g                # eyeballs keep their real size however the head is scaled
    for side, s in SIDES:
        e = np.array((s * 0.032, -0.079 + (radius - 0.0118), 1.688))
        centres.append(P(*e))
        cut(ellipsoid(P(s * 0.032, -0.095, 1.69), R(0.02, 0.015, 0.0145)), k=0.008)

        def lid(lift, out, r, tag="lid"):
            pts = []
            for a in np.linspace(-1.15, 1.15, 13):
                el = lift * math.cos(a * 1.5) + 0.05 * a * (1 if lift > 0 else -0.4)
                d = np.array((s * math.sin(a) * math.cos(el), -math.cos(a) * math.cos(el), math.sin(el)))
                pts.append(P(*(e + d * (radius + out))))
            return tube(pts, r * g)
        add(lid(0.38, 0.0013, 0.0026), "Head", "lid", k=0.0035)
        add(lid(-0.34, 0.001, 0.0017), "Head", "lid", k=0.003)
        cut(lid(0.78, 0.0035, 0.0011), k=0.002)
    # Mouth: full lips over the teeth line, the corners tucked in, a soft philtrum.
    lip = 1.05 if female else 1.0
    for curve, r in lip_curves(P, 13):
        taper = 0.4 + 0.6 * np.sin(np.linspace(0, math.pi, len(curve))) ** 0.7       # full in the middle, thin at the corners
        add(tube(curve, r * lip * g * taper), "Head", k=0.008)
    cut(tube(bezier(P(-0.016, -0.098, 1.5795), P(0, -0.108, 1.574), P(0.016, -0.098, 1.5795), 9), 0.0028 * g), k=0.007)    # the groove above the chin
    cut(tube(bezier(P(-0.02, -0.099, 1.5948), P(0, -0.114, 1.5958), P(0.02, -0.099, 1.5948), 9), 0.0006 * g), k=0.002)
    for side, s in SIDES:
        cut(ball(P(s * 0.0036, -0.108, 1.612), 0.002 * g), k=0.003)
        # Ears: a rim, the bowl and a lobe, flat to the skull.
        e = P(s * 0.078, 0.008, 1.672)
        add(ellipsoid(e, R(0.009, 0.019, 0.03), frame((0, 0.25, 1), (s, 0, 0))), "Head", "ear", k=0.008)
        add(tube(bezier(e + R(s * 0.006, 0.0, -0.027), e + R(s * 0.012, 0.03, 0.01), e + R(s * 0.006, -0.002, 0.03), 9), 0.0045 * g), "Head", "ear", k=0.005)
        cut(ellipsoid(e + R(s * 0.008, -0.002, 0.0), R(0.0045, 0.011, 0.015), frame((0, 0.25, 1), (s, 0, 0))), k=0.004)
    return centres, P, g


def eyeballs(name, centres, iris=(0.24, 0.17, 0.09), radius=0.0118):
    """Wet eyeballs with an iris and pupil painted in vertex colour; bound to Head by the caller."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    colour = nodes.new("ShaderNodeVertexColor")
    links.new(colour.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.08
    out = []
    for side, c in zip(("Left", "Right"), centres):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=18, radius=radius, location=tuple(c))
        eye = bpy.context.object
        eye.name = f"{side} eye"
        eye.data.shade_smooth()
        co = np.array([v.co for v in eye.data.vertices])
        look = unit(np.array((0, -1, -0.04)))
        cosang = (co / radius) @ look
        col = np.ones((len(co), 4))
        # The white is never white: greyer toward the corners and in the upper lid's shadow, so the eye sits in the
        # face instead of staring out of it.
        shade = (0.55 + 0.45 * smooth(0.45, 0.95, cosang)) * (1 - 0.3 * smooth(0.2, 0.7, co[:, 2] / radius))
        col[:, :3] = np.array((0.72, 0.67, 0.63)) * shade[:, None]
        ring = smooth(0.83, 0.85, cosang)
        limbus = 1 - 0.55 * smooth(0.87, 0.835, cosang)                 # the iris darkens to a ring at its rim
        col[:, :3] = col[:, :3] * (1 - ring[:, None]) + (np.array(iris) * (0.7 + 0.5 * fbm(co * 900, 2, seed=3)) [:, None] * limbus[:, None]) * ring[:, None]
        pupil = smooth(0.968, 0.975, cosang)
        col[:, :3] = col[:, :3] * (1 - pupil[:, None]) + 0.01 * pupil[:, None]
        layer = eye.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        layer.data.foreach_set("color", (col ** np.array((2.2, 2.2, 2.2, 1))).astype(np.float32).ravel())
        eye.data.materials.append(mat)
        out.append(eye)
    return out


def hand(body, J, hands, side, s, glove=None):
    """A working hand: palm, knuckles, three-jointed fingers with nails. `glove` (a tag) covers it in leather instead."""
    add = body.add
    d, f, n = hands[side]
    W, K = J[side + "Hand"], J[side + "HandEnd"]
    skin = glove or "skin"
    add(ellipsoid(W + d * 0.012, (0.024, 0.017, 0.016), frame(d, n)), side + "Hand", skin, k=0.012)
    add(ellipsoid(lerp(W, K, 0.55) - n * 0.003, (0.037, 0.05, 0.0135), frame(K - W, n)), side + "Hand", skin, k=0.012)
    add(ellipsoid(lerp(W, K, 0.4) + f * 0.02 + n * 0.008, (0.015, 0.03, 0.014), frame(K - W, n)), side + "Hand", skin, k=0.012)   # thumb pad
    for finger, r in zip(FINGERS, (0.0088, 0.009, 0.0085, 0.0075)):
        pts = [J[f"{side}Hand{finger}{k}"] for k in (1, 2, 3)] + [J[f"{side}Hand{finger}End"]]
        radii = (r, r * 0.9, r * 0.82, r * 0.72)
        add(ball(pts[0] - n * 0.002, r * 1.12), side + "Hand", skin, k=0.006)
        for k in range(3):
            add(cone(pts[k], pts[k + 1], radii[k], radii[k + 1]), f"{side}Hand{finger}{k + 1}", skin, k=0.004)
        if glove is None:
            v = unit(pts[3] - pts[2])
            back = -unit(n - v * (n @ v))                  # the nail side of the fingertip
            add(ellipsoid(pts[3] - v * 0.006 + back * radii[3] * 0.62, (radii[3] * 0.72, 0.0068, 0.0016), frame(v, back)), f"{side}Hand{finger}3", "nail", k=0.0015)
    pts = [J[f"{side}HandThumb{k}"] for k in (1, 2, 3)] + [J[f"{side}HandThumbEnd"]]
    for k, (ra, rb) in enumerate(((0.0125, 0.0105), (0.0105, 0.0092), (0.0092, 0.008))):
        add(cone(pts[k], pts[k + 1], ra, rb), f"{side}HandThumb{k + 1}", skin, k=0.005)
    if glove is None:
        v = unit(pts[3] - pts[2])
        back = -unit(n - v * (n @ v))
        add(ellipsoid(pts[3] - v * 0.007 + back * 0.0055, (0.0062, 0.0075, 0.0016), frame(v, back)), side + "HandThumb3", "nail", k=0.0015)


def limbs(body, J, female=False, arm_r=1.0, leg_r=1.0, arm_tag="skin", leg_tag="skin"):
    """Arms and legs as the clothes see them: soft muscle masses, to be covered by sleeves and trousers."""
    add = body.add
    r = 0.88 if female else 1.0
    for side, s in SIDES:
        S, E, W = J[side + "Arm"], J[side + "ForeArm"], J[side + "Hand"]
        add(ellipsoid(S + np.array((s * 0.02, 0.0, -0.02)), np.array((0.05, 0.065, 0.05)) * r * arm_r, frame(E - S, FORWARD)), side + "Arm", arm_tag, k=0.03)   # deltoid
        add(cone(S, E, 0.043 * r * arm_r, 0.034 * r * arm_r), side + "Arm", arm_tag, k=0.02)
        add(cone(E, W, 0.036 * r * arm_r, 0.024 * r * arm_r), side + "ForeArm", arm_tag, k=0.02)
        add(ellipsoid(lerp(E, W, 0.25), np.array((0.042, 0.075, 0.035)) * r * arm_r, frame(W - E, FORWARD)), side + "ForeArm", arm_tag, k=0.025)
        H, K, A = J[side + "UpLeg"], J[side + "Leg"], J[side + "Foot"]
        add(cone(H + np.array((s * 0.012, 0, 0.02)), K, 0.085 * r * leg_r, 0.05 * r * leg_r), side + "UpLeg", leg_tag, k=0.04)
        add(ellipsoid(lerp(H, K, 0.4) + FORWARD * 0.015, np.array((0.07, 0.17, 0.068)) * r * leg_r, frame(K - H, FORWARD)), side + "UpLeg", leg_tag, k=0.04)
        add(ball(K + FORWARD * 0.01, 0.05 * r * leg_r), side + "Leg", leg_tag, k=0.03)
        add(cone(K, A, 0.048 * r * leg_r, 0.032 * r * leg_r), side + "Leg", leg_tag, k=0.02)
        add(ellipsoid(lerp(K, A, 0.3) - FORWARD * 0.022, np.array((0.05, 0.11, 0.05)) * r * leg_r, frame(A - K, FORWARD)), side + "Leg", leg_tag, k=0.03)   # calf


def torso(body, J, female=False):
    add = body.add
    if female:
        add(ellipsoid((0, 0.01, 1.35), (0.13, 0.095, 0.15)), "Spine2", k=0.04)
        add(ellipsoid((0, 0.012, 1.19), (0.115, 0.08, 0.1)), "Spine1", k=0.05)
        add(ellipsoid((0, 0.014, 1.0), (0.165, 0.1, 0.1)), "Hips", k=0.05)
        for side, s in SIDES:
            add(ellipsoid((s * 0.055, -0.07, 1.335), (0.055, 0.045, 0.05)), "Spine2", k=0.04)
    else:
        add(ellipsoid((0, 0.008, 1.355), (0.155, 0.11, 0.155)), "Spine2", k=0.04)
        add(ellipsoid((0, 0.012, 1.2), (0.13, 0.09, 0.1)), "Spine1", k=0.05)
        add(ellipsoid((0, 0.014, 1.01), (0.15, 0.1, 0.1)), "Hips", k=0.05)
        for side, s in SIDES:
            add(ellipsoid((s * 0.065, -0.07, 1.37), (0.07, 0.04, 0.055)), "Spine2", k=0.04)       # pecs
    for side, s in SIDES:
        add(cone((s * 0.02, 0.03, 1.5), (s * 0.165, 0.015, 1.455), 0.045, 0.04), side + "Shoulder", k=0.04)   # trapezius over the shoulder
        add(ellipsoid((s * 0.07, 0.03, 0.93), (0.08, 0.08, 0.09)), "Hips", k=0.04)                               # seat


# ---------------------------------------------------------------- cloth and leather surface

def blur(values, edges, passes):
    """Average a per-vertex field with its neighbours `passes` times."""
    count = np.maximum(np.bincount(edges.ravel(), minlength=len(values)).astype(float), 1)
    v = values.astype(float).copy()
    shape = v.shape
    v = v.reshape(len(values), -1)
    for _ in range(passes):
        acc = np.zeros_like(v)
        np.add.at(acc, edges[:, 0], v[edges[:, 1]])
        np.add.at(acc, edges[:, 1], v[edges[:, 0]])
        v = 0.5 * v + 0.5 * acc / count[:, None]
    return v.reshape(shape)


def seams(tags, edges, passes=3):
    """1 on the border between two materials (garment edges), fading over a few vertices."""
    edge = (tags[edges[:, 0]] != tags[edges[:, 1]]).astype(float)
    hit = np.zeros(len(tags))
    np.maximum.at(hit, edges[:, 0], edge)
    np.maximum.at(hit, edges[:, 1], edge)
    return np.clip(blur(hit, edges, passes) * 2.5, 0, 1)


def drape(co, centre, top, bottom, count, amp, seed):
    """Hanging folds: ridges round a vertical axis through `centre`, deeper toward the hem (z from top to bottom)."""
    angle = np.arctan2(co[:, 0] - centre[0], co[:, 1] - centre[1])
    depth = smooth(top, bottom, co[:, 2])
    warp = 1.4 * fbm(co * np.array((6, 6, 2.5)), 3, seed=seed)
    wave = np.sin(angle * count + warp + 0.6 * np.sin(angle * count * 0.37 + seed))
    return amp * depth * (0.55 * wave + 0.45 * np.abs(wave) - 0.2), wave


def swing(co, mask, centre, top, hem, count, amp, seed):
    """Hanging folds for a skirt: the selected vertices swing out and in round a vertical axis through `centre`, both
    faces of the cloth together (a push along the normal would only thicken it). The folds are irregular in spacing and
    depth, start below `top` and are fullest toward `hem`. Returns the moved positions."""
    co = co.copy()
    radial = co[mask, :2] - np.asarray(centre, float)
    angle = np.arctan2(radial[:, 0], radial[:, 1])
    radial /= np.linalg.norm(radial, axis=1)[:, None]
    wave = np.sin(angle * count + 1.6 * fbm(co[mask] * np.array((5, 5, 1.5)), 3, seed=seed) + 0.8 * np.sin(angle * 4 + 2.0))
    z = co[mask, 2]
    depth = smooth(top, top - 0.17, z) * (0.8 + 0.4 * smooth(top - 0.17, hem, z)) * (0.75 + 0.5 * fbm(co[mask] * 3, 2, seed=seed + 1))
    co[mask, :2] += radial * (amp * depth * ((0.5 + 0.5 * wave) ** 1.4 - 0.2))[:, None]
    return co


def bunching(co, at, radius, spacing, amp, axis, seed):
    """Compression folds round a joint (elbow, knee, ankle): wavy rings across `axis`, fading over `radius`."""
    near = np.exp(-(np.linalg.norm(co - at, axis=1) / radius) ** 2)
    along = co @ unit(axis)
    wave = np.sin(along / spacing * 2 * math.pi + 3.0 * fbm(co * 25, 2, seed=seed))
    return amp * near * (0.6 * wave - 0.4 * np.abs(wave))


# ---------------------------------------------------------------- material with micro detail

def hero_material(name="Hero sculpt"):
    """Bakeable channels from the painted attributes, plus detail finer than the vertices: a woven thread pattern where
    `weave` is painted (scaled by `thread`, in metres), pebbled grain where `leather` is, pores where `pores` is, and
    fine scratches where `brush` is (metal)."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]

    def attribute(name, socket="Fac"):
        node = nodes.new("ShaderNodeAttribute")
        node.attribute_name = name
        return node.outputs[socket]

    def op(kind, a, b=None):
        node = nodes.new("ShaderNodeMath")
        node.operation = kind
        for socket, value in zip(node.inputs, (a, b)):
            if value is None:
                continue
            if isinstance(value, (int, float)):
                socket.default_value = value
            else:
                links.new(value, socket)
        return node.outputs[0]

    def vec(kind, a, b):
        node = nodes.new("ShaderNodeVectorMath")
        node.operation = kind
        for socket, value in zip(node.inputs, (a, b)):
            if isinstance(value, (tuple, list)):
                socket.default_value = value
            else:
                links.new(value, socket)
        return node.outputs[0]

    def noise(vector, scale, detail=4.0, roughness=0.55):
        node = nodes.new("ShaderNodeTexNoise")
        node.inputs["Scale"].default_value = scale
        node.inputs["Detail"].default_value = detail
        node.inputs["Roughness"].default_value = roughness
        links.new(vector, node.inputs["Vector"])
        return node.outputs["Fac"]

    def wave(vector, scale, direction):
        node = nodes.new("ShaderNodeTexWave")
        node.wave_type, node.bands_direction = "BANDS", direction
        node.inputs["Scale"].default_value = scale
        node.inputs["Distortion"].default_value = 1.5
        node.inputs["Detail"].default_value = 1.0
        links.new(vector, node.inputs["Vector"])
        return node.outputs["Fac"]

    # Threads: two band sets at right angles (a plain weave), each over/under alternating with the other.
    jitter = nodes.new("ShaderNodeTexNoise")
    jitter.inputs["Scale"].default_value = 60.0
    links.new(coords, jitter.inputs["Vector"])
    shifted = vec("ADD", coords, vec("MULTIPLY", jitter.outputs["Color"], (0.0015, 0.0015, 0.0015)))
    warp_threads = wave(shifted, 900.0, "Z")
    weft_threads = wave(shifted, 900.0, "X")
    weft2 = wave(shifted, 900.0, "Y")
    cross = op("MAXIMUM", weft_threads, weft2)
    checker = op("GREATER_THAN", noise(coords, 450.0, 0.0), 0.5)
    weave = op("ADD", op("MULTIPLY", warp_threads, checker), op("MULTIPLY", cross, op("SUBTRACT", 1.0, checker)))
    weave = op("ADD", op("MULTIPLY", weave, 0.75), op("MULTIPLY", noise(coords, 140.0, 3.0), 0.25))
    voronoi = nodes.new("ShaderNodeTexVoronoi")
    voronoi.feature = "DISTANCE_TO_EDGE"
    voronoi.inputs["Scale"].default_value = 700.0
    links.new(coords, voronoi.inputs["Vector"])
    pebble = op("POWER", op("MINIMUM", op("MULTIPLY", voronoi.outputs["Distance"], 6.0), 1.0), 0.5)
    leather = op("ADD", op("MULTIPLY", pebble, 0.7), op("MULTIPLY", noise(coords, 220.0, 5.0), 0.3))
    pores = noise(coords, 1500.0, 2.0)
    stretch = vec("MULTIPLY", coords, (40.0, 40.0, 900.0))
    scratches = noise(stretch, 1.0, 3.0, 0.7)

    w_weave, w_leather, w_pores, w_brush = attribute("weave"), attribute("leather"), attribute("pores"), attribute("brush")
    shade = op("ADD", 1.0, op("ADD", op("MULTIPLY", w_weave, op("SUBTRACT", op("MULTIPLY", weave, 0.5), 0.25)),
                               op("MULTIPLY", w_leather, op("SUBTRACT", op("MULTIPLY", leather, 0.3), 0.15))))
    tint = nodes.new("ShaderNodeMix")
    tint.data_type, tint.blend_type = "RGBA", "MULTIPLY"
    tint.inputs["Factor"].default_value = 1
    links.new(attribute("albedo", "Color"), tint.inputs["A"])
    rgb = nodes.new("ShaderNodeCombineColor")
    for socket in ("Red", "Green", "Blue"):
        links.new(shade, rgb.inputs[socket])
    links.new(rgb.outputs["Color"], tint.inputs["B"])
    colour = tint.outputs["Result"]
    rough = op("ADD", attribute("rough"), op("ADD", op("MULTIPLY", w_brush, op("SUBTRACT", op("MULTIPLY", scratches, 0.3), 0.15)),
                                             op("MULTIPLY", w_leather, op("SUBTRACT", op("MULTIPLY", leather, 0.25), 0.12))))
    links.new(colour, bsdf.inputs["Base Color"])
    links.new(rough, bsdf.inputs["Roughness"])
    links.new(attribute("metal"), bsdf.inputs["Metallic"])
    height = op("ADD", op("ADD", op("MULTIPLY", w_weave, weave), op("MULTIPLY", w_leather, leather)),
                op("ADD", op("MULTIPLY", w_pores, op("MULTIPLY", pores, 0.6)), op("MULTIPLY", w_brush, op("MULTIPLY", scratches, 0.4))))
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.45
    bump.inputs["Distance"].default_value = 0.0005
    links.new(height, bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    emission = nodes.new("ShaderNodeEmission")
    channels = {"colour": colour, "rough": rough, "metal": attribute("metal")}
    return mat, bsdf, emission, channels


def store(mesh, albedo, rough, metal, **detail):
    """Paint for hero_material: albedo is display-referred (sRGB-like) and stored linear."""
    n = len(albedo)
    colour = mesh.color_attributes.new("albedo", "FLOAT_COLOR", "POINT")
    colour.data.foreach_set("color", np.c_[np.clip(albedo, 0, 1) ** 2.2, np.ones(n)].astype(np.float32).ravel())
    for name in ("rough", "metal", "weave", "leather", "pores", "brush"):
        values = {"rough": rough, "metal": metal}.get(name, detail.get(name, 0.0))
        values = np.broadcast_to(np.asarray(values, np.float32), (n,))
        mesh.attributes.new(name, "FLOAT", "POINT").data.foreach_set("value", np.ascontiguousarray(np.clip(values, 0, 1)))


# ---------------------------------------------------------------- posing helpers

HANDS = {}


def curl_hand(p, side, curl, thumb=None, spread=0.0):
    palm = Vector(HANDS[side][2])
    for finger in (*FINGERS, "Thumb"):
        for k in (1, 2, 3):
            name = f"{side}Hand{finger}{k}"
            b = p.rig.data.bones[name]
            axis = (b.tail_local - b.head_local).normalized().cross(palm)
            amount = (thumb if thumb is not None else curl * 0.6) if finger == "Thumb" else curl * (1.15 if k == 2 else 1.0)
            p.q[name] = rot(axis, amount)


def fist(p, side):
    curl_hand(p, side, 1.25, thumb=0.55)


def arm(p, side, wrist, pole):
    """Two-bone IK for an arm: put the wrist on `wrist` (world), elbow toward `pole`."""
    acc, pos = p.world()
    s0, e0, w0 = p.head[side + "Arm"], p.head[side + "ForeArm"], p.head[side + "Hand"]
    l1, l2 = (e0 - s0).length, (w0 - e0).length
    sh = pos[side + "Arm"]
    to = Vector(wrist) - sh
    dist = min(max(to.length, 1e-4), l1 + l2 - 1e-3)
    u = to.normalized()
    sidev = (Vector(pole) - u * u.dot(Vector(pole))).normalized()
    cos_a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
    elbow = sh + u * (l1 * cos_a) + sidev * (l1 * math.sqrt(max(0.0, 1 - cos_a * cos_a)))
    w = sh + u * dist
    rest_pole = Vector((0, 0.3, -0.2))
    w_upper = align(e0 - s0, rest_pole, elbow - sh, sidev)
    w_fore = align(w0 - e0, rest_pole, w - elbow, sidev)
    p.q[side + "Arm"] = acc[side + "Shoulder"].inverted() @ w_upper
    p.q[side + "ForeArm"] = w_upper.inverted() @ w_fore


def grip(p, side, fingers, thumb):
    """Turn the hand so its fingers run along `fingers` and its thumb side (where a held blade leaves the fist) along `thumb`."""
    acc, _ = p.world()
    d, f, _ = HANDS[side]
    world = align(Vector(d), Vector(f), Vector(fingers), Vector(thumb))
    p.q[side + "Hand"] = acc[side + "ForeArm"].inverted() @ world


def hold(p, side, wrist, pole, blade, edge):
    """A sword hand: wrist at `wrist`, blade out of the thumb side along `blade`, knuckles along `edge`."""
    arm(p, side, wrist, pole)
    fingers = Vector(edge) - Vector(blade) * Vector(edge).dot(Vector(blade))
    grip(p, side, fingers, blade)
    fist(p, side)


def lean(p, bow=0.0, twist=0.0, tilt=0.0, nod=0.0, look=0.0):
    p.q["Spine"] = rot((0, 0, 1), twist * 0.25) @ rot((1, 0, 0), bow * 0.3) @ rot((0, 1, 0), tilt * 0.3)
    p.q["Spine1"] = rot((0, 0, 1), twist * 0.35) @ rot((1, 0, 0), bow * 0.35) @ rot((0, 1, 0), tilt * 0.35)
    p.q["Spine2"] = rot((0, 0, 1), twist * 0.4) @ rot((1, 0, 0), bow * 0.35) @ rot((0, 1, 0), tilt * 0.35)
    p.q["Neck"] = rot((0, 0, 1), -twist * 0.35 + look * 0.4) @ rot((1, 0, 0), nod * 0.5 - bow * 0.4)
    p.q["Head"] = rot((0, 0, 1), -twist * 0.35 + look * 0.6) @ rot((1, 0, 0), nod * 0.5 - bow * 0.4)


def hang(p, side, s, swing=0.0, out=0.13, elbow=0.18, curl=0.25):
    """Arm hanging from the shoulder, swung forward (+) or back, elbow softly bent."""
    acc, _ = p.world()
    rest = p.head[side + "ForeArm"] - p.head[side + "Arm"]
    p.q[side + "Arm"] = acc[side + "Shoulder"].inverted() @ aim(rest, rot((1, 0, 0), -swing) @ Vector((s * out, 0.02, -1)))
    fore = (p.head[side + "Hand"] - p.head[side + "ForeArm"]).normalized()
    p.q[side + "ForeArm"] = rot(fore.cross(Vector((0, -1, 0))), elbow)
    p.q[side + "Hand"] = Quaternion()
    curl_hand(p, side, curl)


def stand(p, drop=0.0, spread=0.0, stagger=0.0, toe_out=0.1, shift=0.0):
    """Feet planted (stance `spread` wider, right foot `stagger` back), knees taking `drop`, weight shifted sideways."""
    p.offset = p.offset + Vector((shift, 0, -drop))
    for side, s in SIDES:
        a = p.head[side + "Foot"] + Vector((s * spread, stagger * (1 if s < 0 else -1) * 0.5, 0))
        p.leg(side + "UpLeg", side + "Leg", side + "Foot", a, pole=(s * 0.12, -1, 0), foot_rot=rot((0, 0, 1), s * toe_out))


def blend_into(p, t, keys):
    """Slerp between key poses: keys = [(time, fn)]."""
    times = [k[0] for k in keys]
    i = max(0, min(len(keys) - 2, int(np.searchsorted(times, t, side="right")) - 1))
    (t0, a), (t1, b) = keys[i], keys[i + 1]
    w = ease((t - t0) / (t1 - t0)) if t1 > t0 else 1.0
    pa, pb = Pose(p.rig), Pose(p.rig)
    a(pa)
    b(pb)
    for name in set(pa.q) | set(pb.q):
        p.q[name] = pa.q.get(name, Quaternion()).slerp(pb.q.get(name, Quaternion()), w)
    p.offset = pa.offset.lerp(pb.offset, w)


# ---------------------------------------------------------------- clips

class Style:
    """Per-hero posture: the ranger is loose and low, the shieldmaiden square and upright."""

    def __init__(self, bow=0.06, sway=1.0, stance=0.05, guard_drop=0.06):
        self.bow, self.sway, self.stance, self.guard_drop = bow, sway, stance, guard_drop


def idle(style):
    def pose(p, t):
        w = 2 * math.pi * t / 4.0
        breathe = math.sin(2 * w)
        p.q["Hips"] = rot((0, 1, 0), 0.025 * style.sway * math.sin(w)) @ rot((0, 0, 1), 0.04 * math.sin(w))
        lean(p, style.bow + 0.012 * breathe, twist=0.03 * math.sin(w + 1), tilt=-0.03 * style.sway * math.sin(w), look=0.18 * math.sin(w + 0.4) ** 3, nod=0.04)
        for side, s in SIDES:
            p.q[side + "Shoulder"] = rot((0, 1, 0), -s * 0.012 * breathe)
            hang(p, side, s, swing=0.02 + 0.02 * math.sin(w + s), out=0.12, elbow=0.14 + 0.03 * math.sin(w + s), curl=0.14)
        stand(p, drop=0.01, spread=0.03, shift=0.012 * style.sway * math.sin(w))
    return pose


def gait(period, speed, duty, lift, bow, bob, swing, run=False):
    def pose(p, t):
        phase = t / period
        travel = speed * period
        p.offset = Vector((0.014 * math.sin(2 * math.pi * phase) * (0.5 if run else 1), -speed * t,
                           -(0.05 if run else 0.022) + bob * math.cos(4 * math.pi * phase)))
        p.q["Hips"] = rot((0, 0, 1), 0.09 * math.sin(2 * math.pi * phase)) @ rot((0, 1, 0), 0.03 * math.sin(2 * math.pi * phase)) @ rot((1, 0, 0), 0.08 if run else 0.02)
        lean(p, bow, twist=-0.15 * math.sin(2 * math.pi * phase), nod=0.06 + bow * 0.6)
        for side, s in SIDES:
            f = (phase + (0 if s > 0 else 0.5)) % 1
            cycle = math.floor(phase + (0 if s > 0 else 0.5))
            rest, ball_ = p.head[side + "Foot"], p.head[side + "ToeBase"]
            start = -duty * travel / 2 - travel * cycle + (0 if s > 0 else travel * 0.5)
            if f < duty:
                y, z = start, 0.0
                k = f / duty
                pitch = -0.22 * (1 - ease(k / 0.16)) if k < 0.16 else 0.5 * ease((k - 0.62) / 0.38) if k > 0.62 else 0.0
            else:
                k = (f - duty) / (1 - duty)
                y = start - travel * ease(k)
                z = lift * math.sin(math.pi * min(1.0, k * 1.12)) ** 1.3
                pitch = 0.5 * (1 - ease(k / 0.45)) - 0.22 * ease((k - 0.55) / 0.45)
            foot = rot((1, 0, 0), pitch)
            pivot = ball_ if pitch > 0 else Vector((rest.x, rest.y + 0.03, 0.03))
            ankle = pivot + Vector((0, y - rest.y, z)) + foot @ (rest - pivot)
            p.leg(side + "UpLeg", side + "Leg", side + "Foot", ankle, pole=(s * 0.1, -1, 0), foot_rot=rot((0, 0, 1), s * 0.06) @ foot)
            p.q[side + "ToeBase"] = rot((1, 0, 0), -pitch * 0.9) if pitch > 0 and f < duty else rot((1, 0, 0), 0.1 if f >= duty else 0)
            fwd = -swing * math.sin(2 * math.pi * (f + 0.25))
            if run:
                acc, _ = p.world()
                rest_arm = p.head[side + "ForeArm"] - p.head[side + "Arm"]
                p.q[side + "Arm"] = acc[side + "Shoulder"].inverted() @ aim(rest_arm, rot((1, 0, 0), -fwd) @ Vector((s * 0.16, 0.05, -1)))
                fore = (p.head[side + "Hand"] - p.head[side + "ForeArm"]).normalized()
                p.q[side + "ForeArm"] = rot(fore.cross(Vector((0, -1, 0))), 1.35 + 0.25 * max(0.0, fwd))
                curl_hand(p, side, 0.9, thumb=0.4)
            else:
                hang(p, side, s, swing=fwd, elbow=0.18 + 0.3 * max(0.0, fwd), curl=0.2)
    return pose


SWORD = "Right"


def guard_pose(style):
    """Sword up and forward in the right hand, the wand hand held out and low on the left, knees bent."""
    def pose(p, t, period=4.0):
        w = 2 * math.pi * t / period
        b = math.sin(w)
        p.q["Hips"] = rot((0, 0, 1), -0.28) @ rot((1, 0, 0), 0.05)
        lean(p, 0.12 + 0.01 * b, twist=0.2, look=0.12, nod=0.02)
        hold(p, "Right", (-0.2, -0.33, 1.08 + 0.008 * b), (-1.0, 0.4, -0.8), (0.12, -0.55, 0.83), (0, -0.6, -0.4))
        arm(p, "Left", (0.3, -0.24, 1.04 + 0.006 * b), (1.0, 0.6, -0.5))
        grip(p, "Left", (0.15, -0.8, -0.2), (0.25, -0.2, 0.95))
        curl_hand(p, "Left", 1.1, thumb=0.5)
        stand(p, drop=style.guard_drop + 0.006 * b, spread=style.stance + 0.04, stagger=0.24, toe_out=0.22)
    return pose


def slash_horizontal(style):
    g = guard_pose(style)

    def windup(q):
        g(q, 0.5)
        q.q["Hips"] = rot((0, 0, 1), -0.55) @ rot((1, 0, 0), 0.04)
        lean(q, 0.1, twist=-0.55, look=0.5)
        hold(q, "Right", (-0.42, 0.02, 1.33), (-0.4, 0.6, -0.9), (0.15, 0.85, 0.35), (0, 0.2, -1))
        q.offset = q.offset + Vector((-0.02, 0.04, 0))

    def cut(q):
        g(q, 0.9)
        q.q["Hips"] = rot((0, 0, 1), 0.1) @ rot((1, 0, 0), 0.06)
        lean(q, 0.16, twist=0.25, look=-0.1)
        hold(q, "Right", (-0.08, -0.52, 1.2), (-0.8, 0.2, -0.9), (0.15, -1.0, 0.05), (0, 0.05, -1))
        q.offset = q.offset + Vector((0, -0.09, -0.02))

    def follow(q):
        g(q, 1.1)
        q.q["Hips"] = rot((0, 0, 1), 0.45) @ rot((1, 0, 0), 0.06)
        lean(q, 0.14, twist=0.65, look=-0.4)
        hold(q, "Right", (0.22, -0.38, 1.12), (-0.4, 0.3, -1.0), (0.95, 0.1, -0.15), (0, 0.3, -1))
        q.offset = q.offset + Vector((0.02, -0.1, -0.03))

    def pose(p, t):
        blend_into(p, t, [(0, lambda q: g(q, 0)), (0.45, windup), (0.85, cut), (1.08, follow), (1.6, lambda q: g(q, 1.6)), (2.47, lambda q: g(q, 2.47))])
        stand(p, drop=style.guard_drop, spread=style.stance + 0.04, stagger=0.24, toe_out=0.22)
    return pose


def slash_overhead(style):
    g = guard_pose(style)

    def raised(q):
        g(q, 0.9)
        lean(q, -0.12, twist=0.05, nod=-0.1)
        hold(q, "Right", (-0.1, 0.04, 1.75), (-1.0, 0.0, 0.2), (0.05, 0.75, 0.65), (0, -0.6, 0.6))
        arm(q, "Left", (0.15, -0.1, 1.5), (1, 0.3, -0.3))
        q.offset = q.offset + Vector((0, 0.03, 0.02))

    def chop(q):
        g(q, 1.3)
        lean(q, 0.42, twist=0.05, nod=-0.15)
        hold(q, "Right", (-0.06, -0.5, 1.18), (-1.0, 0.3, -0.4), (0.0, -0.75, -0.2), (0, 0.2, -1))
        q.offset = q.offset + Vector((0, -0.12, -0.06))

    def low(q):
        g(q, 1.6)
        lean(q, 0.5, twist=0.1, nod=-0.25)
        hold(q, "Right", (-0.05, -0.42, 0.9), (-1.0, 0.3, 0.0), (0.05, -0.35, -0.94), (0, 1, -0.2))
        q.offset = q.offset + Vector((0, -0.12, -0.09))

    def pose(p, t):
        blend_into(p, t, [(0, lambda q: g(q, 0)), (0.4, lambda q: g(q, 0.4)), (1.0, raised), (1.38, chop), (1.6, low), (2.05, lambda q: g(q, 2.05)), (2.47, lambda q: g(q, 2.47))])
        stand(p, drop=style.guard_drop, spread=style.stance + 0.04, stagger=0.24, toe_out=0.22)
    return pose


def thrust(style):
    g = guard_pose(style)

    def drawn(q):
        g(q, 0.8)
        q.q["Hips"] = rot((0, 0, 1), -0.45)
        lean(q, 0.08, twist=-0.35, look=0.35)
        hold(q, "Right", (-0.3, 0.06, 1.12), (-1.0, 0.5, -0.5), (0.05, -1.0, 0.1), (0, 0.1, -1))
        q.offset = q.offset + Vector((0, 0.06, 0))

    def lunge(q):
        g(q, 1.4)
        q.q["Hips"] = rot((0, 0, 1), 0.05) @ rot((1, 0, 0), 0.08)
        lean(q, 0.26, twist=0.25, look=-0.15)
        hold(q, "Right", (-0.05, -0.66, 1.2), (-1.0, 0.2, -0.6), (0.0, -1.0, 0.05), (0, 0.05, -1))
        arm(q, "Left", (0.32, 0.06, 1.0), (1, 0.4, -0.3))
        q.offset = q.offset + Vector((0, -0.2, -0.06))

    def pose(p, t):
        blend_into(p, t, [(0, lambda q: g(q, 0)), (0.85, drawn), (1.4, lunge), (1.6, lunge), (1.97, lambda q: g(q, 1.97))])
        stand(p, drop=style.guard_drop, spread=style.stance + 0.04, stagger=0.3 if 1.0 < t < 1.8 else 0.24, toe_out=0.22)
    return pose


def stagger(style):
    g = guard_pose(style)

    def knocked(q):
        g(q, 0.3)
        q.offset = q.offset + Vector((0, 0.13, 0.0))
        lean(q, -0.3, twist=0.25, nod=-0.5, look=0.3)
        hold(q, "Right", (-0.34, -0.12, 1.2), (-1, 0.3, -0.6), (-0.3, -0.3, 0.9), (0, -0.6, -0.4))
        arm(q, "Left", (0.42, -0.08, 1.15), (1, 0.4, -0.4))

    def pose(p, t):
        blend_into(p, t, [(0, lambda q: g(q, 0)), (0.3, knocked), (0.95, lambda q: g(q, 0.95)), (2.47, lambda q: g(q, 2.47))])
        stand(p, drop=style.guard_drop, spread=style.stance + 0.04, stagger=0.24, toe_out=0.22)
    return pose


def build_clips(rig, style, hands):
    HANDS.update(hands)
    for name, length, fn in (("idle", 4.0, idle(style)), ("walk_forward", 1.1, gait(1.1, 1.4, 0.6, 0.1, style.bow, 0.016, 0.3)),
                             ("run_forward", 0.7, gait(0.7, 4.2, 0.38, 0.22, style.bow + 0.12, 0.03, 0.5, run=True)),
                             ("sword_idle", 4.0, guard_pose(style)), ("sword_slash_horizontal", 2.47, slash_horizontal(style)),
                             ("sword_slash_overhead", 2.47, slash_overhead(style)), ("sword_thrust", 1.97, thrust(style)),
                             ("stagger_back", 2.47, stagger(style))):
        clip(rig, name, length, fn)


# ---------------------------------------------------------------- local solid modelling for garments

def minus(a, b):
    """a with b carved out, without touching anything else in the body (Body.cut carves everything before it)."""
    return Shape(lambda p: np.maximum(a.fn(p), -b.fn(p)), a.lo, a.hi)


def intersect(a, b):
    return Shape(lambda p: np.maximum(a.fn(p), b.fn(p)), np.maximum(a.lo, b.lo), np.minimum(a.hi, b.hi))


def union(*shapes):
    return Shape(lambda p: np.min([s.fn(p) for s in shapes], axis=0), np.min([s.lo for s in shapes], axis=0), np.max([s.hi for s in shapes], axis=0))


def below(z_of, lo, hi):
    """Everything under a surface z = z_of(x, y): a half-space with a shaped edge (hems, cuffs)."""
    return Shape(lambda p: p[:, 2] - z_of(p[:, 0], p[:, 1]), lo, hi)


def above(z_of, lo, hi):
    return Shape(lambda p: z_of(p[:, 0], p[:, 1]) - p[:, 2], lo, hi)


def band(c, rx, ry, half_height, thick, tilt=(0.0, 0.0)):
    """A flat strap round the body (belt): an elliptic ring `thick` deep and 2*half_height tall, tilted by (dz/dx, dz/dy)."""
    c = np.asarray(c, float)

    def fn(p):
        q = p - c
        e = (np.sqrt((q[:, 0] / rx) ** 2 + (q[:, 1] / ry) ** 2) - 1) * min(rx, ry)
        z = q[:, 2] - tilt[0] * q[:, 0] - tilt[1] * q[:, 1]
        return np.maximum(np.abs(e) - thick, np.abs(z) - half_height) - 0.0015
    reach = np.array((rx + thick, ry + thick, half_height + abs(tilt[0]) * rx + abs(tilt[1]) * ry + thick))
    return Shape(fn, c - reach, c + reach)


def strap(points, normals, width, thick):
    """A flat leather strap through `points`, its broad face toward `normals` (one per point)."""
    parts = []
    for i in range(len(points) - 1):
        a, b = np.asarray(points[i], float), np.asarray(points[i + 1], float)
        n = unit(np.asarray(normals[i], float) + np.asarray(normals[i + 1], float))
        seg = b - a
        parts.append(box((a + b) / 2, (width, np.linalg.norm(seg) / 2 + 0.004, thick), frame(seg, n), rounding=min(thick * 0.9, 0.002)))
    return union(*parts)


def shrink_dyed_maps(obj, size=2048):
    """The dyed heroes ship colour and ORM at 2K as JPEG: the game re-dyes the colour map on a canvas per look
    (avatars.ts), and a 4K canvas would stall a frame. The 4K bake is downsampled, so it stays clean."""
    for slot in obj.material_slots:
        for node in slot.material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image and not node.image.name.endswith("-normal"):
                node.image.scale(size, size)
                node.image.pack()


def soft_union(k, *shapes):
    """Shapes blended into one with smooth-min radius k (one garment piece from several masses)."""
    def fn(p):
        d = shapes[0].fn(p)
        for s in shapes[1:]:
            d = smin(d, s.fn(p), k)
        return d
    return Shape(fn, np.min([s.lo for s in shapes], axis=0) - k, np.max([s.hi for s in shapes], axis=0) + k)


def prism_y(cx, cz, rx, rz, y_front, curve=0.0):
    """Everything in front of a curved plane (y < y_front + curve * ((z - cz) / rz)^2) inside an x-z ellipse: a face opening."""
    def fn(p):
        e = (np.sqrt(((p[:, 0] - cx) / rx) ** 2 + ((p[:, 2] - cz) / rz) ** 2) - 1) * min(rx, rz)
        plane = p[:, 1] - (y_front + curve * ((p[:, 2] - cz) / rz) ** 2 + curve * 0.6 * ((p[:, 0] - cx) / rx) ** 2)
        return np.maximum(e, plane)
    return Shape(fn, (cx - rx, -1.0, cz - rz), (cx + rx, y_front + abs(curve) * 2, cz + rz))


def feather(albedo, tags, edges, soft, passes=5):
    """Blend colour across borders between the `soft` tags (beard into skin, hairline), which otherwise step
    from one vertex to the next; hard borders (hems, buckles) stay crisp."""
    soft_v = np.isin(tags, soft)
    border = seams(tags, edges, 3) * soft_v
    blurred = blur(albedo, edges, passes)
    return albedo + (blurred - albedo) * border[:, None]


def weathering(co, albedo, rough, metal, ridge, hollow, seam, cloth, leather, steel, seed=60):
    """Use and age over the base paint. Cloth gets rows of stitching beside its seams and blotchy stains, both only
    darkening it (avatars.ts dyes cloth by hue or greyness, which a multiply keeps); leather gets lighter, rougher
    scuffs and fine cracks where it creases; steel gets tarnish in its hollows and spots of rust."""
    albedo, rough, metal = albedo.copy(), rough.copy(), metal.copy()
    stain = smooth(0.56, 0.72, fbm(co * 16, 3, seed=seed)) * (0.6 + 0.4 * fbm(co * 80, 2, seed=seed + 1))
    stitches = smooth(0.15, 0.3, seam) * (1 - smooth(0.5, 0.7, seam)) * (np.sin(co @ np.array((1.0, 0.8, 1.3)) * 1300) > 0.15)
    albedo[cloth] *= (1 - 0.22 * stain[cloth] - 0.3 * stitches[cloth])[:, None]
    rough[cloth] -= 0.08 * stain[cloth]
    scuff = smooth(0.6, 0.74, fbm(co * 55, 3, seed=seed + 2)) * (0.4 + 0.6 * ridge)
    crack = (1 - smooth(0.0, 0.018, np.abs(fbm(co * 32, 3, seed=seed + 3) - 0.5))) * (0.35 + 0.65 * ridge)
    albedo[leather] = lerp(albedo[leather], albedo[leather] * 1.45 + 0.04, (0.55 * scuff[leather])[:, None])
    albedo[leather] *= (1 - 0.4 * crack[leather])[:, None]
    rough[leather] += 0.2 * scuff[leather]
    rust = smooth(0.64, 0.76, fbm(co * 40, 3, seed=seed + 4)) * (0.3 + 0.7 * hollow)
    albedo[steel] *= (1 - 0.35 * hollow[steel])[:, None]
    albedo[steel] = lerp(albedo[steel], np.array((0.36, 0.2, 0.1)) * (0.7 + 0.5 * fbm(co[steel] * 150, 2, seed=seed + 5))[:, None], (0.85 * rust[steel])[:, None])
    metal[steel] *= 1 - 0.85 * rust[steel]
    rough[steel] = lerp(rough[steel], 0.85, rust[steel]) + 0.1 * hollow[steel]
    return albedo, np.clip(rough, 0.05, 1), metal


def face_paint(co, albedo, tags, female, colour, lip=(0.5, 0.22, 0.22)):
    """The face's colour over the base skin: warmth in the cheeks, nose and ears, a cool shadow round the eyes, lips
    shaded from a fuller centre to soft edges (painted by distance to the curves head() built them on, since the
    smooth blend round the mouth leaves no clean border to tag), brows as tapering strokes of hair laid on the nearest
    skin, and a thin lash line on the upper lid's rim."""
    g = 0.84 if female else 0.88
    lip_scale = 1.05 if female else 1.0
    c = np.array((0, 0.0, 1.69))
    P = face_point(c, g)
    skin = np.isin(tags, ("skin", "lid"))
    near_face = np.nonzero(skin & (co[:, 1] < -0.04) & (co[:, 2] > P(0, 0, 1.54)[2]) & (co[:, 2] < P(0, 0, 1.78)[2]))[0]
    out = albedo.copy()
    pts = co[near_face]
    face = out[near_face]
    blob = lambda at, r: np.exp(-np.sum(((pts - at) / np.asarray(r)) ** 2, axis=1))
    mottle = fbm(pts * 300, 3, seed=52)
    # Warm blood under thin skin: cheeks, nose tip, chin; a cooler, darker band round the eyes.
    warm = sum(blob(P(s * 0.047, -0.08, 1.638), (0.024, 0.03, 0.02)) for _, s in SIDES) * (0.32 if female else 0.22)
    warm += blob(P(0, -0.11, 1.635), (0.012, 0.02, 0.012)) * 0.3 + blob(P(0, -0.085, 1.56), (0.02, 0.03, 0.014)) * 0.12
    face = lerp(face, np.array((0.8, 0.43, 0.38)) * (0.92 + 0.16 * mottle)[:, None], np.clip(warm, 0, 0.5)[:, None])
    radius = 0.0122 / g
    eyes = [P(s * 0.032, -0.079 + (radius - 0.0118), 1.688) for _, s in SIDES]
    socket = sum(blob(e + np.array((0, 0, -0.002)), (0.024, 0.04, 0.016)) for e in eyes)
    face = lerp(face, face * np.array((0.84, 0.76, 0.78)), np.clip(socket, 0, 1)[:, None] * 0.25)       # the bake's occlusion adds the rest
    # Lips: fullest colour on each lip's centre line, fading over a couple of millimetres; the parting darker.
    for curve, r in lip_curves(P, 24):
        dist = np.linalg.norm(pts[:, None, :] - np.array(curve)[None, :, :], axis=2)
        k = np.argmin(dist, axis=1)
        d = dist[np.arange(len(pts)), k]
        reach = r * lip_scale * g * (0.4 + 0.6 * np.sin(k / (len(curve) - 1) * math.pi) ** 0.7)
        w = smooth(reach + 0.0045, reach + 0.001, d)
        face = lerp(face, np.array(lip) * (0.92 + 0.14 * mottle)[:, None], (0.92 * w)[:, None])
    parting = bezier(P(-0.02, -0.099, 1.5948), P(0, -0.114, 1.5958), P(0.02, -0.099, 1.5948), 24)
    d = np.min(np.linalg.norm(pts[:, None, :] - np.array(parting)[None, :, :], axis=2), axis=1)
    face *= (1 - 0.15 * smooth(0.0012, 0.0003, d))[:, None]
    # Brows: thick at the inner end, tapering to the tail, made of short hair strokes slanting up and out.
    for _, s in SIDES:
        xs = np.linspace(0.012, 0.054, 16)
        arc = np.array([P(s * x, -0.11, 1.708 + 0.0065 * math.sin((x - 0.008) / 0.05 * math.pi) - 0.002 * (x > 0.046)) for x in xs])
        arc = np.array([pts[np.argmin(np.linalg.norm((pts - a) * np.array((1, 0.25, 1)), axis=1))] for a in arc])
        dist = np.linalg.norm(pts[:, None, :] - arc[None, :, :], axis=2)
        k = np.argmin(dist, axis=1)
        d = dist[np.arange(len(pts)), k]
        t = k / (len(xs) - 1)                                   # 0 at the inner end, 1 at the tail
        width = (0.0078 - 0.0045 * t) * g * (0.85 if female else 1.0)
        strokes = 0.5 + 0.5 * np.sin((pts[:, 0] * s * 1.6 + pts[:, 2] * 1.0) * 2600 + 2.5 * fbm(pts * 500, 2, seed=50))
        w = smooth(width, width * 0.3, d) * (0.7 + 0.3 * strokes) * (0.92 - 0.3 * t)
        face = lerp(face, np.array(colour) * 0.75, w[:, None])
    out[near_face] = face
    # Lash line: the upper lid's rim, where it meets the eyeball, dark; the rest of the lid only shadowed.
    lid = np.nonzero((tags == "lid") & (co[:, 1] < -0.04))[0]
    for e in eyes:
        rel = co[lid] - e
        rim = smooth(radius + 0.0034, radius + 0.0016, np.linalg.norm(rel, axis=1)) * smooth(0.0, 0.004, rel[:, 2])
        out[lid] = out[lid] * (1 - 0.55 * rim)[:, None]
    out[lid] *= 0.92
    return out
