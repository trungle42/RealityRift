"""The gloom stalker: Evermere's shadow foe, sculpted, rigged and animated in Blender from scratch.

Run from frontend/:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/build-gloom-stalker.py
Writes public/models/characters/gloom-stalker.glb. Append `-- --preview out.blend` to save the painted
sculpt and rig at a coarser voxel instead (no bake or export), for look development.

A gaunt, long-limbed wraith of ash and bruise-violet skin over a starved frame: every rib, tendon and knuckle is
modelled, a crest of horn grows back from its brow, and its eyes smoulder amber. It is sculpted as a distance field
of anatomical shapes (charkit.Body), so the same shapes also decide how the skin follows the skeleton. Its clips
carry the names and timing windows the game reads (Actor.ts ONE_SHOTS): idle, walk_forward, run_forward,
combat_idle, punch_right (a claw rake: wind-up 1.0 s, contact 1.5 s, recovered 1.95 s), hit_reaction (flinch
peaks at 1.15 s) and death_fall (down by 0.95 s).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402

from bakekit import fbm, reset_scene, ridged, sculpt_material, smooth  # noqa: E402
from charkit import (Body, Pose, aim, armature, bake_maps, ball, bezier, bind, clip, concavity, cone, displace, ease,  # noqa: E402
                     ellipsoid, export, frame, glossy, paint, reset_pose, rot, skin, tube, window, arrays)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = ARGS[ARGS.index("--preview") + 1] if "--preview" in ARGS else None
SIDES = (("Left", 1), ("Right", -1))
FINGERS = ("Index", "Middle", "Ring", "Pinky")
FORWARD = np.array([0.0, -1.0, 0.0])


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def toward(v, n, angle):
    """Turn direction v toward n by `angle` radians."""
    v, n = unit(v), np.asarray(n, float)
    n = unit(n - v * (n @ v))
    return math.cos(angle) * v + math.sin(angle) * n


# ---------------------------------------------------------------- skeleton

def joints():
    J = {k: np.array(v, float) for k, v in {
        "Hips": (0, 0.012, 1.0), "Spine": (0, 0.016, 1.09), "Spine1": (0, 0.02, 1.2), "Spine2": (0, 0.022, 1.32),
        "Neck": (0, 0.03, 1.53), "Head": (0, 0.008, 1.635), "HeadEnd": (0, -0.002, 1.87)}.items()}
    hands = {}
    for side, s in SIDES:
        J[side + "Shoulder"] = np.array([s * 0.03, 0.0, 1.475])
        J[side + "Arm"] = np.array([s * 0.165, 0.015, 1.47])
        J[side + "ForeArm"] = np.array([s * 0.375, 0.022, 1.222])
        wrist = J[side + "Hand"] = np.array([s * 0.57, -0.008, 0.99])
        knuckle = np.array([s * 0.622, -0.016, 0.928])
        d = unit(knuckle - wrist)
        f = unit(FORWARD - d * (FORWARD @ d))
        n = unit(np.cross(d, FORWARD)) * s          # palm normal: in toward the thigh
        hands[side] = (d, f, n)
        J[side + "HandEnd"] = knuckle
        for i, (finger, off, lens, splay) in enumerate(zip(FINGERS, (0.021, 0.007, -0.007, -0.02), ((0.05, 0.034, 0.027), (0.056, 0.039, 0.029), (0.052, 0.036, 0.027), (0.041, 0.029, 0.023)), (0.1, 0.03, -0.04, -0.12))):
            p = knuckle + f * off - d * (0.004 * abs(i - 1.2))
            v = unit(d + f * splay)
            for k, (length, curl) in enumerate(zip(lens, (0.22, 0.34, 0.28))):
                v = toward(v, n, curl)
                J[f"{side}Hand{finger}{k + 1}"] = p
                p = p + v * length
            J[f"{side}Hand{finger}End"] = p
        p, v = wrist + d * 0.024 + f * 0.024, unit(d * 0.55 + f * 0.75 + n * 0.35)
        for k, (length, curl) in enumerate(zip((0.034, 0.029, 0.024), (0.1, 0.25, 0.25))):
            v = toward(v, n, curl)
            J[f"{side}HandThumb{k + 1}"] = p
            p = p + v * length
        J[f"{side}HandThumbEnd"] = p
        J[side + "UpLeg"] = np.array([s * 0.092, 0.01, 0.965])
        J[side + "Leg"] = np.array([s * 0.105, -0.004, 0.53])
        J[side + "Foot"] = np.array([s * 0.115, 0.036, 0.095])
        J[side + "ToeBase"] = np.array([s * 0.125, -0.088, 0.03])
        J[side + "ToeEnd"] = np.array([s * 0.13, -0.17, 0.018])
    return J, hands


def bones(J, hands):
    up = (0, -1, 0)
    out = [("Hips", J["Hips"], J["Spine"], None, up), ("Spine", J["Spine"], J["Spine1"], "Hips", up),
           ("Spine1", J["Spine1"], J["Spine2"], "Spine", up), ("Spine2", J["Spine2"], J["Neck"], "Spine1", up),
           ("Neck", J["Neck"], J["Head"], "Spine2", up), ("Head", J["Head"], J["HeadEnd"], "Neck", up)]
    for side, _ in SIDES:
        n = hands[side][2]
        out += [(side + "Shoulder", J[side + "Shoulder"], J[side + "Arm"], "Spine2", up),
                (side + "Arm", J[side + "Arm"], J[side + "ForeArm"], side + "Shoulder", up),
                (side + "ForeArm", J[side + "ForeArm"], J[side + "Hand"], side + "Arm", up),
                (side + "Hand", J[side + "Hand"], J[side + "HandEnd"], side + "ForeArm", n)]
        for finger in (*FINGERS, "Thumb"):
            for k in (1, 2, 3):
                tail = J[f"{side}Hand{finger}{k + 1}"] if k < 3 else J[f"{side}Hand{finger}End"]
                out.append((f"{side}Hand{finger}{k}", J[f"{side}Hand{finger}{k}"], tail, side + "Hand" if k == 1 else f"{side}Hand{finger}{k - 1}", n))
        out += [(side + "UpLeg", J[side + "UpLeg"], J[side + "Leg"], "Hips", up),
                (side + "Leg", J[side + "Leg"], J[side + "Foot"], side + "UpLeg", up),
                (side + "Foot", J[side + "Foot"], J[side + "ToeBase"], side + "Leg", (0, 0, 1)),
                (side + "ToeBase", J[side + "ToeBase"], J[side + "ToeEnd"], side + "Foot", (0, 0, 1))]
    return out


# ---------------------------------------------------------------- sculpt

def lerp(a, b, t):
    return a + (b - a) * t


def back_of(z):
    """Depth of the back surface (toward +Y) along the spine, for vertebrae and the erector muscles."""
    return np.interp(z, (0.98, 1.1, 1.2, 1.3, 1.4, 1.5, 1.56), (0.083, 0.068, 0.078, 0.1, 0.107, 0.088, 0.062))


def spine_bone(z):
    return "Hips" if z < 1.06 else "Spine" if z < 1.16 else "Spine1" if z < 1.28 else "Spine2" if z < 1.51 else "Neck"


def sculpt(J, hands):
    body = Body()
    add, cut = body.add, body.cut
    # Torso: a deep, narrow ribcage over a starved, sunken belly.
    add(ellipsoid((0, 0.006, 1.365), (0.128, 0.1, 0.16)), "Spine2", k=0.03)
    add(ellipsoid((0, 0.016, 1.435), (0.142, 0.085, 0.07)), "Spine2", k=0.03)
    add(ellipsoid((0, 0.012, 1.19), (0.092, 0.066, 0.1)), "Spine1", k=0.05)
    add(ellipsoid((0, 0.018, 1.085), (0.098, 0.07, 0.07)), "Spine", k=0.04)
    add(ellipsoid((0, 0.018, 1.0), (0.118, 0.082, 0.075)), "Hips", k=0.035)
    for i in range(10):
        z0 = 1.475 - i * 0.031
        prof = math.sqrt(max(0.05, 1 - ((z0 - 0.03 - 1.365) / 0.175) ** 2))
        rx, ry = 0.128 * prof - 0.002, 0.1 * prof - 0.003
        end = 2.55 if i < 7 else 2.0 - (i - 7) * 0.2
        for side, s in SIDES:
            pts = [(s * rx * math.sin(a), 0.006 + ry * math.cos(a), z0 - 0.075 * (a / math.pi) ** 1.4 - i * 0.003 * a) for a in np.linspace(0.35, end, 9)]
            add(tube(pts, np.linspace(0.0095, 0.007, len(pts))), "Spine2" if i < 6 else "Spine1", "bone", k=0.016)
    add(cone((0, -0.085, 1.47), (0, -0.087, 1.34), 0.008, 0.007), "Spine2", "bone", k=0.024)
    for z, bone in ((1.255, "Spine1"), (1.205, "Spine1"), (1.155, "Spine"), (1.105, "Spine")):
        for side, s in SIDES:
            add(ellipsoid((s * 0.023, -0.058 + (1.255 - z) * 0.06, z), (0.019, 0.01, 0.02)), bone, k=0.006)
    for side, s in SIDES:
        add(cone((s * 0.075, -0.03, 1.05), (s * 0.108, 0.02, 1.07), 0.008, 0.01), "Hips", "bone", k=0.035)    # iliac crest
        add(ellipsoid((s * 0.058, 0.064, 0.95), (0.062, 0.048, 0.074)), "Hips", k=0.03)                      # glute
        add(cone((s * 0.03, 0.0, 1.02), (s * 0.075, -0.035, 1.24), 0.03, 0.022), "Spine1", k=0.03)           # obliques
    for z in np.arange(0.99, 1.56, 0.026):
        add(ball((0, back_of(z) - 0.004, z), 0.0098), spine_bone(z), "bone", k=0.011)
    for side, s in SIDES:
        add(tube([(s * 0.03, back_of(z) - 0.012, z) for z in (1.0, 1.12, 1.26, 1.4)], (0.024, 0.02, 0.02, 0.017)), "Spine1", k=0.02)
        add(ellipsoid((s * 0.086, 0.094, 1.42), (0.054, 0.07, 0.011), frame((s * 0.15, 0.12, 1), (0, 1, 0))), "Spine2", "bone", k=0.022)
        add(cone((s * 0.05, 0.104, 1.452), (s * 0.15, 0.07, 1.486), 0.008, 0.008), "Spine2", "bone", k=0.014)
        add(cone((s * 0.018, -0.068, 1.48), (s * 0.152, -0.002, 1.49), 0.0095, 0.0095), side + "Shoulder", "bone", k=0.016)
        add(cone((s * 0.022, 0.046, 1.585), (s * 0.15, 0.022, 1.49), 0.024, 0.02), side + "Shoulder", k=0.026)
        add(ellipsoid((s * 0.068, -0.074, 1.43), (0.06, 0.018, 0.042), frame((s * 1, 0.25, -0.25), (0, -1, 0))), "Spine2", k=0.035)
        add(cone((s * 0.02, 0.055, 1.6), (s * 0.165, 0.03, 1.49), 0.03, 0.022), side + "Shoulder", k=0.035)                 # trapezius
        add(tube([(s * 0.135, 0.045, 1.43), (s * 0.115, 0.07, 1.3), (s * 0.07, 0.075, 1.16)], (0.028, 0.022, 0.012)), "Spine1", k=0.03)   # latissimus
        for i, z in enumerate((1.405, 1.375, 1.345, 1.315)):                                                           # serratus
            add(ellipsoid((s * (0.118 - i * 0.002), -0.045 + i * 0.006, z), (0.011, 0.022, 0.0085), frame((0, -1, -0.35), (s, 0, 0))), "Spine2", k=0.012)
    add(ellipsoid((0, 0.088, 1.45), (0.1, 0.018, 0.11)), "Spine2", k=0.045)
    # Neck and head.
    add(cone((0, 0.026, 1.47), (0, 0.006, 1.68), 0.047, 0.039), "Neck", k=0.035)
    add(ball((0, -0.03, 1.574), 0.0085), "Neck", "bone", k=0.02)
    for side, s in SIDES:
        add(cone((s * 0.045, 0.018, 1.665), (s * 0.012, -0.056, 1.49), 0.011, 0.009), "Neck", k=0.016)
    add(ellipsoid((0, 0.034, 1.79), (0.074, 0.098, 0.082), frame((0, 0.62, 0.78), (0, 0, 1))), "Head", k=0.03)
    add(ellipsoid((0, -0.03, 1.792), (0.064, 0.055, 0.058)), "Head", k=0.035)
    add(tube([(-0.058, -0.066, 1.79), (-0.03, -0.083, 1.8), (0, -0.086, 1.797), (0.03, -0.083, 1.8), (0.058, -0.066, 1.79)], 0.0135), "Head", "bone", k=0.02)
    add(ellipsoid((0, -0.07, 1.735), (0.033, 0.034, 0.036)), "Head", k=0.026)                         # muzzle under the sockets
    add(cone((0, -0.087, 1.79), (0, -0.097, 1.738), 0.009, 0.007), "Head", "bone", k=0.014)            # flat nasal ridge
    for side, s in SIDES:
        add(cone((s * 0.03, -0.086, 1.752), (s * 0.07, -0.022, 1.762), 0.0115, 0.0105), "Head", "bone", k=0.016)   # cheekbone
        add(tube([(s * 0.06, -0.006, 1.754), (s * 0.05, -0.03, 1.698), (s * 0.022, -0.074, 1.672), (0, -0.088, 1.664)], (0.0125, 0.0115, 0.0105, 0.011)), "Head", "bone", k=0.022)
    add(ball((0, -0.088, 1.662), 0.0115), "Head", "bone", k=0.016)
    for side, s in SIDES:
        cut(ball((s * 0.074, -0.03, 1.792), 0.02), k=0.016)                                   # temples
        cut(ellipsoid((s * 0.029, -0.088, 1.766), (0.019, 0.022, 0.0135)), k=0.008)          # eye sockets
        cut(ball((s * 0.05, -0.07, 1.718), 0.022), k=0.018)                                   # cheek hollows
        cut(ellipsoid((s * 0.0075, -0.104, 1.745), (0.0032, 0.006, 0.009), frame((s * 0.3, 0, 1))), k=0.003)   # nostril slits
    mouth = [(-0.032, -0.088, 1.698), (-0.017, -0.1, 1.701), (0, -0.104, 1.702), (0.017, -0.1, 1.701), (0.032, -0.088, 1.698)]
    cut(tube(mouth, 0.0048), k=0.004)
    for row, (z, up) in enumerate(((1.707, -1), (1.697, 1))):           # needle teeth in the lipless mouth
        for i in range(9):
            a = (i - 4 + 0.5 * row) / 4.6
            x, y = 0.03 * a, -0.1 + 0.015 * a * a
            root = np.array((x, y + 0.002, z - up * 0.0035))
            add(cone(root, root + np.array((0, -0.0015, up * 0.0075 * (1 - 0.3 * abs(a)))), 0.0016, 0.0002), "Head", "tooth", k=0.0004)
    for side, s in SIDES:
        for i, (size, lift) in enumerate(((1.0, 1.0), (0.78, 0.7), (0.55, 0.45))):
            base = np.array((s * (0.048 + i * 0.01), -0.04 + i * 0.05, 1.838 - i * 0.022))
            mid = base + np.array((s * 0.03, 0.085, 0.07 * lift)) * size
            tip = base + np.array((s * 0.045, 0.2, 0.035 * lift - 0.02)) * size
            pts = bezier(base, mid, tip, 10)
            add(tube(pts, np.linspace(0.018 * size, 0.0015, len(pts)) ** 0.9 * (0.018 * size) ** 0.1), "Head", "horn", k=0.012)
    # Arms: bone, a thin wrap of muscle, cords of tendon.
    for side, s in SIDES:
        d, f, n = hands[side]
        S, E, W, K = J[side + "Arm"], J[side + "ForeArm"], J[side + "Hand"], J[side + "HandEnd"]
        back = -FORWARD
        add(ellipsoid(S + np.array([s * 0.02, 0, -0.012]), (0.042, 0.06, 0.042), frame(E - S, FORWARD)), side + "Arm", k=0.03)
        add(cone(S, E, 0.025, 0.019), side + "Arm", k=0.015)
        add(ellipsoid(lerp(S, E, 0.52) + FORWARD * 0.012, (0.022, 0.09, 0.021), frame(E - S, FORWARD)), side + "Arm", k=0.028)
        add(ellipsoid(lerp(S, E, 0.42) + back * 0.013, (0.024, 0.1, 0.023), frame(E - S, FORWARD)), side + "Arm", k=0.028)
        add(ball(E + back * 0.014, 0.0155), side + "ForeArm", "bone", k=0.016)
        add(ball(E, 0.02), side + "ForeArm", k=0.02)
        add(cone(E, W, 0.022, 0.0135), side + "ForeArm", k=0.015)
        add(ellipsoid(lerp(E, W, 0.27) + FORWARD * 0.005, (0.028, 0.072, 0.022), frame(W - E, FORWARD)), side + "ForeArm", k=0.022)
        add(cone(E + back * 0.014, W + back * 0.008, 0.0075, 0.0065), side + "ForeArm", "bone", k=0.008)
        add(ball(W, 0.0155), side + "Hand", k=0.01)
        add(ellipsoid(lerp(W, K, 0.5) - n * 0.002, (0.028, 0.042, 0.011), frame(K - W, n)), side + "Hand", k=0.01)
        for finger in FINGERS:
            base = J[f"{side}Hand{finger}1"]
            add(cone(lerp(W, base, 0.25), base, 0.0055, 0.0068), side + "Hand", "bone", k=0.006)
            pts = [J[f"{side}Hand{finger}{k}"] for k in (1, 2, 3)] + [J[f"{side}Hand{finger}End"]]
            radii = (0.0085, 0.0071, 0.006, 0.0052)
            for k in range(3):
                add(cone(pts[k], pts[k + 1], radii[k], radii[k + 1]), f"{side}Hand{finger}{k + 1}", k=0.005)
                add(ball(pts[k], radii[k] + 0.0012), f"{side}Hand{finger}{k + 1}" if k else side + "Hand", "bone", k=0.004)
            tip, v = pts[3], unit(pts[3] - pts[2])
            claw = [tip - v * 0.004, tip + v * 0.016 + n * 0.002, tip + v * 0.03 + n * 0.012]
            add(tube(claw, (0.0058, 0.0042, 0.0007)), f"{side}Hand{finger}3", "claw", k=0.002)
        pts = [J[f"{side}HandThumb{k}"] for k in (1, 2, 3)] + [J[f"{side}HandThumbEnd"]]
        for k, (ra, rb) in enumerate(((0.012, 0.0085), (0.0085, 0.007), (0.007, 0.0058))):
            add(cone(pts[k], pts[k + 1], ra, rb), f"{side}HandThumb{k + 1}", k=0.006)
        tip, v = pts[3], unit(pts[3] - pts[2])
        add(tube([tip - v * 0.004, tip + v * 0.014 + n * 0.002, tip + v * 0.025 + n * 0.01], (0.0058, 0.004, 0.0007)), f"{side}HandThumb3", "claw", k=0.002)
    # Legs: long bones, stringy muscle, knobbed knees and ankles, clawed feet.
    for side, s in SIDES:
        H, K, A, B, T = (J[side + n_] for n_ in ("UpLeg", "Leg", "Foot", "ToeBase", "ToeEnd"))
        back, out = -FORWARD, np.array([s, 0.0, 0.0])
        add(cone(H, K, 0.034, 0.025), side + "UpLeg", k=0.02)
        add(ellipsoid(lerp(H, K, 0.47) + FORWARD * 0.02 + out * 0.004, (0.043, 0.17, 0.034), frame(K - H, FORWARD)), side + "UpLeg", k=0.03)
        add(ellipsoid(lerp(H, K, 0.82) + FORWARD * 0.014 - out * 0.02, (0.024, 0.05, 0.022), frame(K - H, FORWARD)), side + "UpLeg", k=0.018)
        add(ellipsoid(lerp(H, K, 0.45) + back * 0.024, (0.038, 0.16, 0.03), frame(K - H, FORWARD)), side + "UpLeg", k=0.03)
        add(ellipsoid(lerp(H, K, 0.25) - out * 0.03, (0.03, 0.12, 0.03), frame(K - H, FORWARD)), side + "UpLeg", k=0.03)
        add(ball(K + FORWARD * 0.024, 0.018), side + "Leg", "bone", k=0.018)
        add(ball(K, 0.027), side + "Leg", k=0.025)
        add(cone(K, A, 0.025, 0.016), side + "Leg", k=0.015)
        add(cone(K + FORWARD * 0.021, A + FORWARD * 0.009, 0.0085, 0.007), side + "Leg", "bone", k=0.009)
        add(ellipsoid(lerp(K, A, 0.27) + back * 0.028, (0.033, 0.085, 0.028), frame(A - K, FORWARD)), side + "Leg", k=0.025)
        add(cone(lerp(K, A, 0.6) + back * 0.018, A + back * 0.03, 0.0085, 0.007), side + "Leg", k=0.022)
        for o in (-1, 1):
            add(ball(A + out * o * 0.021, 0.0115), side + "Foot", "bone", k=0.008)
        add(ellipsoid((A[0], A[1] + 0.008, 0.05), (0.024, 0.034, 0.048)), side + "Foot", k=0.022)          # heel
        add(ellipsoid(lerp(A, B, 0.55) - np.array([0, 0, 0.022]), (0.032, 0.075, 0.019), frame(B - A, (0, 0, 1))), side + "Foot", k=0.022)
        for i, off in enumerate((-0.026, -0.008, 0.009, 0.025)):
            base = B + out * off + np.array([0, 0.004 * abs(i - 1.5), 0])
            v = unit(np.array([out[0] * off * 1.2, -1, -0.12]))
            lens = (0.036, 0.024) if i < 3 else (0.027, 0.019)
            p1 = base + v * lens[0]
            v2 = toward(v, (0, 0, -1), 0.35)
            p2 = p1 + v2 * lens[1]
            r = 0.0105 - i * 0.0012
            add(ball(base, r + 0.001), side + "ToeBase", k=0.006)
            add(cone(base, p1, r, r * 0.8), side + "ToeBase", k=0.006)
            add(cone(p1, p2, r * 0.8, r * 0.65), side + "ToeBase", k=0.005)
            v3 = toward(v2, (0, 0, -1), 0.5)
            add(tube([p2 - v2 * 0.003, p2 + v2 * 0.014, p2 + v3 * 0.024 + np.array([0, 0, -0.004])], (r * 0.6, r * 0.42, 0.0008)), side + "ToeBase", "claw", k=0.002)
    return body


# ---------------------------------------------------------------- surface: wrinkles, veins, paint

def surface(obj, body, J, spans):
    """Skin detail on the dense mesh, then paint. `spans` maps each bone to its (head, tail)."""
    co, normal, edges = arrays(obj.data)
    tags = body.nearest(co, "tag")
    near = body.nearest(co, "bone")
    names = list(near)
    owner = np.array(names)[np.argmin(np.stack([near[n] for n in names], 1), 1)]
    head_of = np.array([spans[n][0] for n in owner])
    axis = np.array([unit(spans[n][1] - spans[n][0]) for n in owner])
    length = np.array([np.linalg.norm(spans[n][1] - spans[n][0]) for n in owner])
    along = (co * axis).sum(1)
    perp = co - axis * along[:, None]
    t = np.clip(((co - head_of) * axis).sum(1) / length, 0, 1)        # 0 at the bone's head, 1 at its tail
    skin = (tags == "skin") | (tags == "bone")
    torso = np.isin(owner, ["Hips", "Spine", "Spine1", "Spine2"])
    head = owner == "Head"
    hand = np.char.find(owner.astype(str), "Hand") >= 0
    joints = [J[j] for j in J if j.endswith(("ForeArm", "Leg", "Foot", "Neck", "Hand")) or ("Hand" in j and j[-1] in "123")]
    joint = np.clip(np.max([np.exp(-np.linalg.norm(co - p, axis=1) / (0.012 if (abs(p[0]) > 0.5) else 0.035)) for p in joints], axis=0), 0, 1)
    # Folds run across each limb (frequent along the bone), sinew runs along it (frequent across).
    # Skin folds: continuous bands across the bone, warped so no two run parallel, in patches (always at the joints).
    spacing = np.where(torso, 0.0095, np.where(hand, 0.0032, np.where(head, 0.005, 0.0065)))
    wave = 0.5 + 0.5 * np.cos(along / spacing * 2 * math.pi + 2.6 * fbm(co * 22, 2, seed=12))
    crease = smooth(0.8, 1.0, 1 - wave)
    patches = np.maximum(smooth(-0.05, 0.4, fbm(co * 6, 2, seed=13)), joint) * (0.5 + 0.5 * smooth(-0.3, 0.3, fbm(co * 40, 2, seed=15)))
    folds = wave
    fold_amp = np.where(torso, 0.0016, np.where(head, 0.0007, np.where(hand, 0.0006, 0.00055))) * patches * (0.7 + 0.6 * joint)
    sinew = fbm(perp * 280 + axis * along[:, None] * 10, 2, seed=14)
    veins = smooth(0.9, 0.985, ridged(perp * 26 + axis * along[:, None] * 9, 3, seed=4)) * skin * ~head
    crepe = fbm(co * 120, 3, seed=9)
    offset = skin * (fold_amp * (0.4 * (folds - 0.5) - 0.7 * crease) + 0.00025 * sinew * (tags == "skin") + 0.00025 * crepe) + 0.0008 * veins
    displace(obj, offset)
    co, normal, edges = arrays(obj.data)
    cav = concavity(co, normal, edges)
    ridge = smooth(0.0, 0.8, -cav)
    hollow = smooth(0.05, 1.0, cav)
    mottle = fbm(co * 9, 4, seed=21)
    bruise = smooth(0.05, 0.45, fbm(co * 4 + 3, 3, seed=33))
    patch = smooth(0.1, 0.5, fbm(co * 6 + 11, 3, seed=37))
    # The gloom: hands, feet and the ends of the limbs darken to soot, with a ragged edge.
    distal = np.where(hand | np.isin(owner, ["LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"]), 1.0,
                      np.where(np.isin(owner, ["LeftForeArm", "RightForeArm", "LeftLeg", "RightLeg"]), smooth(0.25, 1.0, t), 0.0))
    gloom = 0.65 * smooth(0.25, 0.85, distal + 0.25 * fbm(co * 10, 3, seed=41))
    warm = np.clip(joint + 0.6 * head + 0.4 * smooth(0.2, 0.6, fbm(co * 3 + 7, 2, seed=43)), 0, 1)
    base = lerp(np.array([0.27, 0.25, 0.28]), np.array([0.36, 0.29, 0.29]), warm[:, None]) * (0.72 + 0.5 * mottle)[:, None]
    albedo = lerp(base, np.array([0.29, 0.3, 0.25]), (0.35 * patch)[:, None])
    albedo = lerp(albedo, np.array([0.22, 0.13, 0.26]), (0.55 * bruise)[:, None])
    albedo = lerp(albedo, np.array([0.62, 0.58, 0.54]), (0.85 * ridge)[:, None])
    albedo = lerp(albedo, np.array([0.5, 0.33, 0.33]), (0.18 * ridge * (tags == "bone") + 0.25 * joint * hand)[:, None])
    albedo = lerp(albedo, np.array([0.14, 0.09, 0.14]), (0.3 * crease * patches * skin)[:, None])
    albedo = lerp(albedo, np.array([0.06, 0.035, 0.07]), (0.85 * hollow)[:, None])
    albedo = lerp(albedo, np.array([0.23, 0.2, 0.37]), (0.45 * veins)[:, None])
    albedo = lerp(albedo, np.array([0.15, 0.12, 0.16]) * (0.8 + 0.5 * ridge)[:, None], (gloom * skin)[:, None])
    albedo = lerp(albedo, np.array([0.17, 0.14, 0.11]), (0.45 * smooth(0.14, 0.02, co[:, 2]))[:, None])
    rough = 0.62 - 0.22 * hollow + 0.1 * ridge - 0.12 * gloom
    # Old wounds: pale scars raked across the torso and limbs in a few places, and dried grime caked in the folds.
    rake = co @ (np.array((0.55, 0.25, 0.8)) / np.linalg.norm((0.55, 0.25, 0.8)))
    scars = smooth(0.64, 0.72, fbm(co * 3, 2, seed=44)) * smooth(0.8, 0.96, np.abs(np.sin(rake * 260 + 2 * fbm(co * 18, 2, seed=45)))) * skin * ~head
    albedo = lerp(albedo, np.array([0.52, 0.4, 0.42]), (0.55 * scars)[:, None])
    caked = hollow * smooth(0.45, 0.7, fbm(co * 30, 3, seed=46)) * skin
    albedo = lerp(albedo, np.array([0.12, 0.1, 0.08]), (0.5 * caked)[:, None])
    rough = rough + 0.12 * scars + 0.2 * caked
    claw, horn, tooth = tags == "claw", tags == "horn", tags == "tooth"
    gloss = fbm(co * 400, 2, seed=5)
    albedo[claw] = lerp(np.array([0.045, 0.035, 0.035]), np.array([0.2, 0.17, 0.14]), np.clip(0.3 + 0.3 * gloss[claw], 0, 1)[:, None])
    rough[claw] = 0.28
    tip = np.clip((co[horn, 1] - 0.02) / 0.12, 0, 1)
    bands = 0.86 + 0.14 * np.sin(np.linalg.norm(co[horn] - J["Head"], axis=1) * 2 * math.pi / 0.009)
    albedo[horn] = lerp(np.array([0.07, 0.055, 0.06]), np.array([0.55, 0.5, 0.43]), tip[:, None]) * (bands * (0.85 + 0.3 * ridge[horn]))[:, None]
    rough[horn] = 0.42
    mouth = (np.abs(co[:, 2] - 1.703) < 0.008) & (co[:, 1] < -0.09) & (np.abs(co[:, 0]) < 0.035) & (hollow > 0.3)
    albedo[mouth] = (0.05, 0.015, 0.02)
    albedo[tooth] = (0.62, 0.56, 0.44)
    rough[tooth] = 0.32
    grain = np.where(claw | horn | tooth, 0.15, 1.0)
    paint(obj.data, np.clip(albedo, 0, 1) ** 2.2, np.clip(rough, 0.05, 1), np.zeros(len(co)), grain=grain)


def eyes(J):
    mat = glossy("gloom-stalker-eyes", (0.9, 0.42, 0.12), rough=0.12, glow=(1.0, 0.55, 0.18), strength=3.0)
    dark = glossy("gloom-stalker-pupils", (0.02, 0.008, 0.006), rough=0.08)
    out = []
    for side, s in SIDES:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.0112, location=(s * 0.029, -0.085, 1.765))
        eye = bpy.context.object
        eye.name = f"{side} eye"
        eye.scale = (1, 0.8, 0.72)
        bpy.ops.object.transform_apply(scale=True)
        eye.data.materials.append(mat)
        eye.data.shade_smooth()
        out.append(eye)
        # A narrow dark pupil set into the glow, so the eye has a gaze rather than being a lamp.
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=1.0, location=(s * 0.029, -0.0932, 1.765))
        pupil = bpy.context.object
        pupil.name = f"{side} pupil"
        pupil.scale = (0.0021, 0.0011, 0.0068)
        bpy.ops.object.transform_apply(scale=True)
        pupil.data.materials.append(dark)
        pupil.data.shade_smooth()
        out.append(pupil)
    return out


# ---------------------------------------------------------------- clips

def hang(p, side, s, swing=0.0, out=0.16, elbow=0.32, wrist=0.0, curl=0.15):
    """Arms hanging loose from the shoulders; `swing` sends the arm forward (+) or back."""
    reach(p, side, rot((1, 0, 0), -swing) @ Vector((s * out, -0.06, -1)), elbow, wrist, curl)


def reach(p, side, direction, elbow, wrist=0.0, curl=0.15):
    """Point the upper arm along a world direction, whatever the torso above it is doing."""
    rest = p.head[side + "ForeArm"] - p.head[side + "Arm"]
    acc, _ = p.world()
    p.q[side + "Arm"] = acc[side + "Shoulder"].inverted() @ aim(rest, Vector(direction))
    bend(p, side, elbow, wrist, curl)


def bend(p, side, elbow, wrist, curl):
    fore = (p.head[side + "Hand"] - p.head[side + "ForeArm"]).normalized()
    p.q[side + "ForeArm"] = rot(fore.cross(Vector((0, -1, 0))), elbow)
    b = p.rig.data.bones[side + "Hand"]
    hand = (b.tail_local - b.head_local).normalized()
    palm = Vector(HANDS[side][2])
    p.q[side + "Hand"] = rot(hand.cross(palm), wrist)
    for finger in (*FINGERS, "Thumb"):
        for k in (1, 2, 3):
            name = f"{side}Hand{finger}{k}"
            b = p.rig.data.bones[name]
            p.q[name] = rot((b.tail_local - b.head_local).normalized().cross(palm), curl * (0.6 if finger == "Thumb" else 1.0))


def lean(p, hunch, twist=0.0, head_up=None, side_tilt=0.0):
    p.q["Spine"] = rot((0, 0, 1), twist * 0.3) @ rot((1, 0, 0), hunch * 0.25)
    p.q["Spine1"] = rot((0, 0, 1), twist * 0.35) @ rot((1, 0, 0), hunch * 0.35) @ rot((0, 1, 0), side_tilt)
    p.q["Spine2"] = rot((0, 0, 1), twist * 0.35) @ rot((1, 0, 0), hunch * 0.4)
    p.q["Neck"] = rot((1, 0, 0), -hunch * 0.35 if head_up is None else -head_up * 0.5)
    p.q["Head"] = rot((1, 0, 0), -hunch * 0.4 if head_up is None else -head_up * 0.5)


def shoulders(p, forward, shrug=0.0):
    """Roll both shoulders forward (and up), the stalker's predatory hunch."""
    for side, s in SIDES:
        p.q[side + "Shoulder"] = rot((0, 1, 0), -s * shrug) @ rot((0, 0, 1), -s * forward)


def stand(p, drop=0.0, spread=0.0, stagger=0.0, toe_out=0.12):
    """Feet planted under the hips (stance `spread` wider, the right foot `stagger` back), knees taking `drop`."""
    p.offset = p.offset + Vector((0, 0, -drop))
    for side, s in SIDES:
        a = p.head[side + "Foot"] + Vector((s * spread, stagger * (1 if s < 0 else -1) * 0.5, 0))
        p.leg(side + "UpLeg", side + "Leg", side + "Foot", a, pole=(s * 0.25, -1, 0), foot_rot=rot((0, 0, 1), s * toe_out))


def guard(p, t, period=2.0):
    """The stalker's fighting crouch: low, hunched, claws up and spread."""
    w = 2 * math.pi * t / period
    breathe = math.sin(w)
    p.q["Hips"] = rot((1, 0, 0), 0.18) @ rot((0, 0, 1), 0.06 * math.sin(w))
    lean(p, 0.42 + 0.03 * breathe, twist=0.05 * math.sin(w), head_up=0.55)
    shoulders(p, 0.15, 0.08)
    for side, s in SIDES:
        reach(p, side, Vector((s * 0.55, -0.62, -0.4 + 0.03 * breathe)), 0.95 + 0.05 * math.sin(w + s), wrist=-0.25, curl=0.05 + 0.08 * (1 + math.sin(w * 2 + s)))
    stand(p, drop=0.13 + 0.01 * breathe, spread=0.07, stagger=0.16)


def idle(p, t):
    w = 2 * math.pi * t / 4.0
    p.q["Hips"] = rot((0, 1, 0), 0.03 * math.sin(w)) @ rot((1, 0, 0), 0.08)
    p.offset = Vector((0.012 * math.sin(w), 0, 0))
    lean(p, 0.52 + 0.03 * math.sin(2 * w), twist=0.06 * math.sin(w + 1), head_up=0.62 + 0.05 * math.sin(w * 2 + 0.7))
    shoulders(p, 0.22 + 0.02 * math.sin(2 * w), 0.06)
    p.turn("Head", rot((0, 0, 1), 0.22 * math.sin(w + 0.4) ** 3))
    for side, s in SIDES:
        hang(p, side, s, swing=0.14 + 0.03 * math.sin(w + s), out=0.22, elbow=0.6, wrist=0.15, curl=0.32 + 0.12 * max(0.0, math.sin(w * 3 + s)) ** 4)
    stand(p, drop=0.03, spread=0.02)


def gait(p, t, period, speed, duty, lift, hunch, bob, arm, run=False):
    """A locomotion cycle with the feet planted: hips travel forward, each ankle is placed by IK on its own track."""
    phase = t / period
    travel = speed * period
    p.offset = Vector((0.018 * math.sin(2 * math.pi * phase) * (0.4 if run else 1), -speed * t, -(0.06 if run else 0.035) + bob * math.cos(4 * math.pi * phase)))
    p.q["Hips"] = rot((0, 0, 1), 0.1 * math.sin(2 * math.pi * phase)) @ rot((1, 0, 0), 0.12 if run else 0.08)
    lean(p, hunch, twist=-0.16 * math.sin(2 * math.pi * phase), head_up=hunch * 0.95)
    shoulders(p, 0.18)
    for side, s in SIDES:
        f = (phase + (0 if s > 0 else 0.5)) % 1
        cycle = math.floor(phase + (0 if s > 0 else 0.5))
        rest = p.head[side + "Foot"]
        ball = p.head[side + "ToeBase"]
        start = -duty * travel / 2 - travel * cycle + (0 if s > 0 else travel * 0.5)
        if f < duty:
            y, z, pitch = start, 0.0, 0.0
            k = f / duty
            pitch = -0.25 * (1 - ease(k / 0.18)) if k < 0.18 else 0.55 * ease((k - 0.62) / 0.38) if k > 0.62 else 0.0
        else:
            k = (f - duty) / (1 - duty)
            y = start + (-travel) * ease(k)
            z = lift * math.sin(math.pi * min(1.0, k * 1.15)) ** 1.3
            pitch = 0.55 * (1 - ease(k / 0.45)) - 0.25 * ease((k - 0.55) / 0.45)
        foot = rot((1, 0, 0), pitch)
        pivot = ball if pitch > 0 else Vector((rest.x, rest.y + 0.03, 0.03))
        ankle = pivot + Vector((0, y - rest.y, z)) + foot @ (rest - pivot)
        p.leg(side + "UpLeg", side + "Leg", side + "Foot", ankle, pole=(s * 0.15, -1, 0), foot_rot=rot((0, 0, 1), s * 0.08) @ foot)
        p.q[side + "ToeBase"] = rot((1, 0, 0), -pitch * 0.9) if pitch > 0 and f < duty else rot((1, 0, 0), 0.15 if f >= duty else 0)
        fwd = -arm * math.sin(2 * math.pi * (f + 0.25))   # each arm swings against its own leg
        if run:
            reach(p, side, Vector((s * 0.2, -0.35 - 0.6 * max(0.0, fwd) + 0.4 * max(0.0, -fwd), -1)), 1.2 + 0.35 * max(0.0, fwd), wrist=-0.1, curl=0.25)
        else:
            hang(p, side, s, swing=fwd, elbow=0.35 + 0.35 * max(0.0, fwd), wrist=0.12, curl=0.2)


def walk(p, t):
    gait(p, t, 1.15, 1.25, 0.6, 0.11, 0.5, 0.018, 0.32)


def run(p, t):
    gait(p, t, 0.68, 4.0, 0.36, 0.24, 0.62, 0.035, 0.55, run=True)


def blend_into(p, t, keys):
    """Slerp between key poses: keys = [(time, fn)]; fn(pose) fills a pose. Legs are re-solved by each key's IK."""
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


def punch(p, t):
    def windup(q):
        guard(q, 0.3)
        q.turn("Spine1", rot((0, 0, 1), -0.32))
        q.turn("Spine2", rot((0, 0, 1), -0.22))
        reach(q, "Right", Vector((-0.45, 0.35, 0.75)), 1.55, wrist=0.35, curl=0.0)
        q.offset = q.offset + Vector((0, 0.05, 0.02))

    def strike(q):
        guard(q, 0.5)
        q.turn("Spine1", rot((0, 0, 1), 0.22))
        q.turn("Spine2", rot((0, 0, 1), 0.2))
        q.turn("Spine1", rot((1, 0, 0), 0.12))
        reach(q, "Right", Vector((-0.12, -1.0, -0.12)), 0.12, wrist=-0.2, curl=0.0)
        q.offset = q.offset + Vector((0, -0.11, -0.03))

    def follow(q):
        guard(q, 0.7)
        q.turn("Spine1", rot((0, 0, 1), 0.36))
        q.turn("Spine2", rot((0, 0, 1), 0.28))
        reach(q, "Right", Vector((0.4, -0.6, -0.65)), 0.4, wrist=-0.4, curl=0.3)
        q.offset = q.offset + Vector((0, -0.07, -0.04))

    blend_into(p, t, [(0, lambda q: guard(q, 0)), (0.95, lambda q: guard(q, 0.95)), (1.32, windup), (1.5, strike), (1.68, follow), (2.05, lambda q: guard(q, 2.05)), (2.2, lambda q: guard(q, 2.2))])
    stand(p, drop=0.0, spread=0.07, stagger=0.16)


def hurt(p, t):
    def flinch(q):
        guard(q, 1.1)
        q.offset = q.offset + Vector((0, 0.07, 0.02))
        q.turn("Spine1", rot((1, 0, 0), -0.28))
        q.turn("Spine2", rot((1, 0, 0), -0.25) @ rot((0, 0, 1), 0.15))
        q.turn("Head", rot((1, 0, 0), -0.35) @ rot((0, 0, 1), -0.25))
        for side, s in SIDES:
            reach(q, side, Vector((s * 0.85, -0.2, -0.15)), 0.5, wrist=0.4, curl=0.0)

    blend_into(p, t, [(0, lambda q: guard(q, 0)), (0.8, lambda q: guard(q, 0.8)), (1.15, flinch), (1.8, lambda q: guard(q, 1.8)), (2.0, lambda q: guard(q, 2.0))])
    stand(p, drop=0.0, spread=0.07, stagger=0.16)


def death(p, t):
    def buckle(q):
        guard(q, 0.4)
        q.offset = q.offset + Vector((0, 0.03, -0.32))
        q.turn("Spine1", rot((1, 0, 0), -0.2))
        q.turn("Head", rot((1, 0, 0), -0.5))
        for side, s in SIDES:
            reach(q, side, Vector((s * 0.9, 0.1, 0.1)), 0.4, wrist=0.3, curl=0.0)

    def fallen(q, settle):
        q.offset = Vector((0, 0.35, -0.885 + settle))
        q.q["Hips"] = rot((0, 1, 0), 0.12) @ rot((1, 0, 0), -1.53)
        lean(q, -0.05, twist=0.15, head_up=0.0)
        q.turn("Head", rot((0, 1, 0), 0.6))
        for side, s in SIDES:
            q.q[side + "UpLeg"] = rot((1, 0, 0), 0.35 if s > 0 else 0.15) @ rot((0, 1, 0), s * 0.12)
            q.q[side + "Leg"] = rot((1, 0, 0), -0.5 if s > 0 else -0.2)
            q.q[side + "Foot"] = rot((1, 0, 0), 0.5)
            reach(q, side, Vector((s * 1.0, 0.35, -0.2)), 0.35 + 0.3 * (s > 0), wrist=0.2, curl=0.45)

    keys = [(0, lambda q: guard(q, 0)), (0.1, lambda q: guard(q, 0.1)), (0.45, buckle), (0.95, lambda q: fallen(q, 0.0)), (1.2, lambda q: fallen(q, 0.012)), (1.6, lambda q: fallen(q, 0.0)), (2.0, lambda q: fallen(q, 0.0))]
    blend_into(p, t, keys)
    if t < 0.45:
        stand(p, drop=0.0, spread=0.07, stagger=0.16)


HANDS = {}


def main():
    reset_scene()
    J, hands = joints()
    HANDS.update(hands)
    body = sculpt(J, hands)
    high = body.mesh("gloom stalker high", float(ARGS[ARGS.index("--voxel") + 1]) if "--voxel" in ARGS else 0.004 if PREVIEW else 0.0016)
    print("high poly", len(high.data.polygons))
    spec = bones(J, hands)
    surface(high, body, J, {name: (np.asarray(h, float), np.asarray(t, float)) for name, h, t, _, _ in spec})
    rig = armature("Armature", spec)
    sculpt_mat = sculpt_material(grain_scale=420.0, brush_scale=(40.0, 40.0, 900.0))
    for node in sculpt_mat[0].node_tree.nodes:
        if node.type == "BUMP":
            node.inputs["Strength"].default_value = 0.55
    if PREVIEW:
        high.data.materials.append(sculpt_mat[0])
        high.data.shade_smooth()
        skin(high, rig, body)
        for eye in eyes(J):
            bind(eye, rig, "Head")
        build_clips(rig)
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(PREVIEW).resolve()))
        return
    low = bake_maps("gloom-stalker", high, sculpt_mat, target=38000)
    bpy.data.objects.remove(high)
    skin(low, rig, body)
    parts = [low]
    for eye in eyes(J):
        bind(eye, rig, "Head")
        parts.append(eye)
    build_clips(rig)
    reset_pose(rig)
    export("gloom-stalker", rig, parts)


def build_clips(rig):
    for name, length, fn in (("idle", 4.0, idle), ("walk_forward", 1.15, walk), ("run_forward", 0.68, run), ("combat_idle", 2.0, guard),
                             ("punch_right", 2.2, punch), ("hit_reaction", 2.0, hurt), ("death_fall", 2.0, death)):
        clip(rig, name, length, fn)


main()
