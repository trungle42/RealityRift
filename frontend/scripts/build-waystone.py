"""Evermere waystone: an original carved standing stone, sculpted, painted and baked in Blender.

Run from frontend/ (needs basisu: brew install basis_universal):
  Blender --background --factory-startup --python scripts/build-waystone.py
Writes public/models/evermere-waystone.glb: a 30k-triangle mesh baked from a ~2M-triangle sculpt
at 4K, then texture-compressed to KTX2 by scripts/pack-ktx2.py. Append `-- --high out.blend` to
stop after the sculpt and save the high-poly scene for preview renders.

The front carries a triskele in raised relief inside a ring, with faint mint light along its coils,
a crescent with three star cups and a cup-and-ring mark. The front-left edge is inscribed in ogham
and spells EVERMERE, read upward. The back has a raised double spiral and cups. A mossy boulder
holds the foot of the stone.
"""
import math
import subprocess
import sys
import tempfile
from itertools import product
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

OUT = Path(__file__).resolve().parents[1] / "public" / "models"
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TEXTURE = 4096
RNG = np.random.default_rng(731)
GRAD = RNG.normal(size=(4096, 3))
GRAD /= np.linalg.norm(GRAD, axis=1)[:, None]
POINTS = RNG.random((4096, 3))

# Shaft proportions in metres. The top is a broken slope; the sides taper slightly.
HW0, HD0, TAPER = 0.24, 0.18, 0.085
TOP = 1.62
FRACTURE = Vector((0.62, 0.42, 0.66)).normalized()
FRACTURE_AT = Vector((0.22, 0.165, 1.6)) - FRACTURE * 0.15
CHIP = Vector((0.55, -0.5, 0.67)).normalized()
CHIP_AT = Vector((0.22, -0.165, 1.53)) - CHIP * 0.085
# The block was split from bedrock, not sawn: no two faces are quite parallel.
# The inscribed front-left arris (corners 0 and 4) stays put so the ogham meets it.
SKEW = np.random.default_rng(5).uniform(-1, 1, (8, 2)) * np.array([[0.016]] * 4 + [[0.03]] * 4)
SKEW[[0, 4]] = 0


# ---------------------------------------------------------------- noise

def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    return (h & 0xFFFFFFF) % 4096


def perlin(p, seed=0):
    base = np.floor(p).astype(np.int64)
    f = p - base
    u = f * f * f * (f * (f * 6 - 15) + 10)
    out = np.zeros(len(p))
    for dx, dy, dz in product((0, 1), repeat=3):
        g = GRAD[_hash(base[:, 0] + dx, base[:, 1] + dy, base[:, 2] + dz, seed)]
        value = (g * (f - (dx, dy, dz))).sum(1)
        weight = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
        out += weight * value
    return out * 1.6


def fbm(p, octaves=5, seed=0, gain=0.5):
    total, amp, norm = np.zeros(len(p)), 1.0, 0.0
    for octave in range(octaves):
        total += amp * perlin(p * 2.0 ** octave, seed + octave * 17)
        norm += amp
        amp *= gain
    return total / norm


def ridged(p, octaves=4, seed=0):
    total, amp, norm = np.zeros(len(p)), 1.0, 0.0
    for octave in range(octaves):
        total += amp * (1 - np.abs(perlin(p * 2.0 ** octave, seed + octave * 31)))
        norm += amp
        amp *= 0.5
    return total / norm


def cells(p, seed=0):
    """Distance to the nearest scattered feature point, and a stable random id for that cell."""
    base = np.floor(p).astype(np.int64)
    best, ident = np.full(len(p), 9.0), np.zeros(len(p))
    for offset in product((-1, 0, 1), repeat=3):
        cell = base + offset
        h = _hash(cell[:, 0], cell[:, 1], cell[:, 2], seed)
        dist = np.linalg.norm(p - (cell + POINTS[h]), axis=1)
        closer = dist < best
        best[closer], ident[closer] = dist[closer], POINTS[h][closer, 0]
    return best, ident


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- carved relief

class Relief:
    """A 1 mm height field for one face of the shaft; u runs across the face, z up it."""

    def __init__(self, half):
        self.u0, self.z0, self.px = -half - 0.03, -0.05, 0.001
        self.cut = np.zeros((int(1.8 / self.px), int((2 * half + 0.06) / self.px)), np.float32)
        self.field = np.zeros_like(self.cut)
        self.band = np.zeros_like(self.cut)
        self.glow = np.zeros_like(self.cut)
        self.depth = self.cut

    def grid(self):
        zs = self.z0 + np.arange(self.cut.shape[0]) * self.px
        us = self.u0 + np.arange(self.cut.shape[1]) * self.px
        return np.meshgrid(us, zs)

    def sink(self, centres, radius, depth, glow=0.0):
        """Lower a rounded field (the union of discs) so raised bands can stand proud of it."""
        u, z = self.grid()
        sdf = np.hypot(u - centres[0][0], z - centres[0][1]) - radius
        for cu, cz in centres[1:]:
            other, k = np.hypot(u - cu, z - cz) - radius, 0.035
            h = np.clip(0.5 + 0.5 * (other - sdf) / k, 0, 1)
            sdf = other * (1 - h) + sdf * h - k * h * (1 - h)
        self.field = np.maximum(self.field, depth * smooth(0.002, -0.004, sdf))
        self.glow = np.maximum(self.glow, glow * smooth(0.0, -0.02, sdf))

    def raise_band(self, points, radius):
        """Leave a band of original surface standing inside a sunken field, with rounded shoulders."""
        points = np.asarray(points, float)
        r = int(math.ceil(radius / self.px)) + 2
        offsets = np.arange(-r, r + 1)
        for u, z in points:
            cu, cz = (u - self.u0) / self.px, (z - self.z0) / self.px
            iu, iz = int(round(cu)), int(round(cz))
            dist = np.hypot(((iu + offsets)[None, :] - cu), ((iz + offsets)[:, None] - cz)) * self.px / radius
            win = np.s_[iz - r:iz + r + 1, iu - r:iu + r + 1]
            self.band[win] = np.maximum(self.band[win], smooth(1.0, 0.45, dist))

    def stroke(self, points, radius, depth, glow=False):
        """Cut a groove along points. Hand-carved and weathered: width, depth and line all waver."""
        points = np.asarray(points, float)
        wobble = np.c_[fbm(np.c_[points * 90, np.full(len(points), 0.5)], 2, 91), fbm(np.c_[points * 90, np.full(len(points), 1.5)], 2, 92)]
        widths = radius * (0.84 + 0.32 * np.clip(fbm(np.c_[points * 40, np.zeros(len(points))], 3, 93) + 0.5, 0, 1))
        depths = depth * (0.72 + 0.28 * np.clip(fbm(np.c_[points * 25, np.ones(len(points))], 3, 94) + 0.5, 0, 1))
        points = points + wobble * 0.0012
        r = int(math.ceil(widths.max() / self.px)) + 1
        offsets = np.arange(-r, r + 1)
        for (u, z), radius, depth in zip(points, widths, depths):
            cu, cz = (u - self.u0) / self.px, (z - self.z0) / self.px
            iu, iz = int(round(cu)), int(round(cz))
            us, zs = iu + offsets, iz + offsets
            dist = np.hypot((us[None, :] - cu), (zs[:, None] - cz)) * self.px / radius
            profile = np.where(dist < 1, np.power(np.clip(1 - dist * dist, 0, 1), 0.7), 0)
            win = np.s_[iz - r:iz + r + 1, iu - r:iu + r + 1]
            self.cut[win] = np.maximum(self.cut[win], depth * profile)
            if glow:
                self.glow[win] = np.maximum(self.glow[win], smooth(0.75, 0.15, dist))

    def soften(self):
        for grid in (self.cut, self.field, self.band, self.glow):
            for axis in (0, 1):
                grid[:] = (np.roll(grid, 1, axis) + grid * 2 + np.roll(grid, -1, axis)) / 4
        self.depth = np.maximum(self.field * (1 - self.band), self.cut)
        halo = self.band.copy()
        for _ in range(4):
            for axis in (0, 1):
                halo = (np.roll(halo, 2, axis) + halo * 2 + np.roll(halo, -2, axis)) / 4
        self.glow = self.glow * smooth(0.02, 0.3, halo) * (1 - self.band) ** 2

    def sample(self, u, z, grid):
        fu = np.clip((u - self.u0) / self.px, 0, grid.shape[1] - 1.001)
        fz = np.clip((z - self.z0) / self.px, 0, grid.shape[0] - 1.001)
        iu, iz = fu.astype(int), fz.astype(int)
        tu, tz = fu - iu, fz - iz
        top = grid[iz + 1, iu] * (1 - tu) + grid[iz + 1, iu + 1] * tu
        bottom = grid[iz, iu] * (1 - tu) + grid[iz, iu + 1] * tu
        return bottom * (1 - tz) + top * tz


def arc(center, radius, start, end, step=0.0006):
    count = max(8, int(abs(end - start) * radius / step))
    a = np.linspace(start, end, count)
    return np.c_[center[0] + radius * np.cos(a), center[1] + radius * np.sin(a)]


def spiral(center, inner, outer, end_angle, turns, step=0.0006):
    length = (inner + outer) * math.pi * turns
    t = np.linspace(0, 1, max(32, int(length / step)))
    a = end_angle + 2 * math.pi * turns * (t - 1)
    r = inner + (outer - inner) * t
    return np.c_[center[0] + r * np.cos(a), center[1] + r * np.sin(a)]


def bezier(*controls, step=0.0006):
    pts = [np.asarray(p, float) for p in controls]
    t = np.linspace(0, 1, max(16, int(np.linalg.norm(pts[-1] - pts[0]) * 1.6 / step)))[:, None]
    while len(pts) > 1:
        pts = [a * (1 - t) + b * t for a, b in zip(pts, pts[1:])]
    return pts[0]


def line(p0, p1, step=0.0006):
    return bezier(p0, p1, step=step)


def cup_and_ring(face, center, gap=None):
    face.stroke([center], 0.024, 0.02)
    face.stroke(arc(center, 0.05, 0, math.tau), 0.0075, 0.012)
    outer = (gap + 0.45, gap + math.tau - 0.45) if gap is not None else (0, math.tau)
    face.stroke(arc(center, 0.078, *outer), 0.0075, 0.012)
    if gap is not None:
        face.stroke(line(center, (center[0] + 0.105 * math.cos(gap), center[1] + 0.105 * math.sin(gap))), 0.0068, 0.011)


def carve_front():
    face = Relief(HW0)
    # A triskele in raised relief: the disc is cut back and the three coils left standing,
    # with mint light pooled in the sunken ground between them.
    c = (0.0, 1.17)
    face.sink([c], 0.152, 0.014, glow=0.9)
    face.stroke(arc(c, 0.168, 0, math.tau), 0.006, 0.011)
    ends = []
    for k in range(3):
        theta = math.pi / 2 + k * math.tau / 3
        centre = (c[0] + 0.068 * math.cos(theta), c[1] + 0.068 * math.sin(theta))
        face.raise_band(spiral(centre, 0.0, 0.054, theta, 2.1), 0.0068)
        ends.append((theta, (c[0] + 0.122 * math.cos(theta), c[1] + 0.122 * math.sin(theta))))
    for k in range(3):
        (t0, p0), (_, p2) = ends[k], ends[(k + 1) % 3]
        mid = t0 + math.tau / 6
        face.raise_band(bezier(p0, (c[0] + 0.15 * math.cos(mid), c[1] + 0.15 * math.sin(mid)), p2), 0.0068)
    # Crescent: the outline of one disc with a second disc bitten out of it, opening to the right.
    c1, r1, c2, r2 = np.array((-0.01, 0.78)), 0.074, np.array((0.022, 0.794)), 0.060
    outer = arc(c1, r1, 0, math.tau)
    inner = arc(c2, r2, 0, math.tau)
    face.stroke(outer[np.linalg.norm(outer - c2, axis=1) > r2], 0.0075, 0.013)
    face.stroke(inner[np.linalg.norm(inner - c1, axis=1) < r1], 0.0075, 0.013)
    for star in ((0.088, 0.865), (0.112, 0.775), (0.08, 0.688)):
        face.stroke([star], 0.011, 0.01)
    cup_and_ring(face, (0.025, 0.47), gap=-0.5)
    return face


def carve_back():
    face = Relief(HW0)
    # An S double spiral in raised relief: both coils wind the same way and one sweep joins them.
    a, b = (-0.068, 1.13), (0.068, 0.91)
    face.sink([a, b, (0.0, 1.02)], 0.112, 0.013)
    sa = spiral(a, 0.0, 0.086, -math.pi / 2, 2.6)
    sb = spiral(b, 0.0, 0.086, math.pi / 2, 2.6)
    for coil in (sa, sb):
        face.raise_band(coil, 0.0072)
    face.raise_band(bezier(sa[-1], sa[-1] + (0.075, 0), sb[-1] - (0.075, 0), sb[-1]), 0.0072)
    cup_and_ring(face, (-0.06, 0.55))
    for cup in ((0.085, 0.60), (0.11, 0.50), (0.07, 0.42)):
        face.stroke([cup], 0.018, 0.016)
    return face


OGHAM = {"E": ("notch", 4), "V": ("right", 3), "R": ("across", 5), "M": ("across", 1)}


def carve_ogham(front, side):
    """Ogham reads upward along the front-left arris; the arris itself is the stem line."""
    z, edge_f, edge_s = 0.34, -HW0 - 0.006, -HD0 - 0.006
    for letter in "EVERMERE":
        kind, count = OGHAM[letter]
        for _ in range(count):
            if kind == "notch":
                front.stroke(line((edge_f, z), (edge_f + 0.018, z)), 0.0062, 0.011)
                side.stroke(line((edge_s, z), (edge_s + 0.018, z)), 0.0062, 0.011)
            elif kind == "right":
                front.stroke(line((edge_f, z), (edge_f + 0.065, z)), 0.0062, 0.012)
            else:
                front.stroke(line((edge_f, z), (edge_f + 0.058, z + 0.02)), 0.0062, 0.012)
                side.stroke(line((edge_s, z), (edge_s + 0.058, z - 0.02)), 0.0062, 0.012)
            z += 0.024
        z += 0.046


# ---------------------------------------------------------------- mesh helpers

def apply_modifier(obj, kind, **settings):
    modifier = obj.modifiers.new(kind.title(), kind)
    for key, value in settings.items():
        setattr(modifier, key, value)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def arrays(mesh):
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    normal = np.empty_like(co)
    mesh.vertex_normals.foreach_get("vector", normal)
    edges = np.empty(len(mesh.edges) * 2, np.int64)
    mesh.edges.foreach_get("vertices", edges)
    return co.reshape(-1, 3), normal.reshape(-1, 3), edges.reshape(-1, 2)


def write_positions(mesh, co):
    mesh.vertices.foreach_set("co", co.ravel())
    mesh.update()


def concavity(co, normal, edges, passes=4):
    """Positive in hollows, negative on ridges, measured against the local edge length."""
    total, count = np.zeros_like(co), np.zeros(len(co))
    for a, b in ((0, 1), (1, 0)):
        np.add.at(total, edges[:, a], co[edges[:, b]])
        np.add.at(count, edges[:, a], 1)
    lap = total / np.maximum(count, 1)[:, None] - co
    spacing = np.linalg.norm(co[edges[:, 0]] - co[edges[:, 1]], axis=1).mean()
    value = (lap * normal).sum(1) / spacing
    for _ in range(passes):
        acc = np.zeros(len(co))
        for a, b in ((0, 1), (1, 0)):
            np.add.at(acc, edges[:, a], value[edges[:, b]])
        value = (value + acc / np.maximum(count, 1)) / 2
    return value


def paint(mesh, albedo, rough, glow, moss):
    colour = mesh.color_attributes.new("albedo", "FLOAT_COLOR", "POINT")
    colour.data.foreach_set("color", np.c_[albedo, np.ones(len(albedo))].astype(np.float32).ravel())
    for name, values in (("rough", rough), ("glow", glow), ("moss", moss)):
        mesh.attributes.new(name, "FLOAT", "POINT").data.foreach_set("value", values.astype(np.float32))


def stone_palette(p, cavity, ridge, carve):
    tone = np.clip(fbm(p * 2.2, 4, 3) * 0.9 + 0.5, 0, 1)
    warm, cool = np.array((0.335, 0.312, 0.265)), np.array((0.235, 0.245, 0.235))
    albedo = cool + (warm - cool) * tone[:, None]
    albedo *= (0.8 + 0.28 * np.clip(fbm(p * 18, 4, 5) + 0.5, 0, 1))[:, None]
    grain, grain_id = cells(p * 160, 6)
    speck = smooth(0.32, 0.12, grain)
    albedo *= (1 + speck * np.where(grain_id < 0.2, -0.35, np.where(grain_id > 0.85, 0.2, 0)))[:, None]
    # Algae and weather stains: broad, darker, faintly green, heavier toward the ground.
    stain = smooth(-0.15, 0.4, fbm(p * 1.7, 3, 7)) * (0.5 + 0.5 * smooth(1.3, 0.2, p[:, 2]))
    # Dark weathering crust in patches, and drip stains running down from the crown.
    crust = smooth(0.24, 0.3, fbm(p * 5, 3, 10) + 0.12 * fbm(p * 60, 2, 12)) * (0.75 + 0.25 * np.clip(fbm(p * 120, 2, 13) * 2 + 0.5, 0, 1))
    drip = smooth(0.12, 0.55, fbm(p * (20, 20, 0.9), 3, 11)) * smooth(0.5, 1.4, p[:, 2])
    albedo *= (1 - 0.45 * crust - 0.4 * drip)[:, None]
    albedo *= (1 - 0.28 * smooth(0.75, 0.15, p[:, 2] + 0.1 * fbm(p * 6, 2, 8)))[:, None]
    albedo = albedo * (1 - 0.6 * stain[:, None]) + np.array((0.03, 0.045, 0.02)) * stain[:, None]
    streak = smooth(0.1, 0.6, fbm(p * (24, 24, 1.3), 3, 9))
    albedo *= (1 - 0.22 * streak)[:, None]
    grime = np.clip(cavity * 2.6 + carve * 1.3, 0, 1)
    albedo *= (1 - 0.86 * grime)[:, None]
    albedo += np.array((0.0, 0.01, 0.0)) * grime[:, None]
    albedo *= (1 + 0.36 * np.clip(ridge * 2, 0, 1))[:, None]
    return albedo


def lichen(p, albedo, rough, keep):
    warp = np.c_[fbm(p * 14, 2, 44), fbm(p * 14, 2, 45), fbm(p * 14, 2, 46)] * 0.35
    dist, ident = cells(p * 11 + warp, 41)
    size = 0.16 + 0.22 * POINTS[(ident * 4095).astype(int), 1]
    crust = 0.7 + 0.3 * np.clip(fbm(p * 140, 2, 43) * 2, -1, 1)
    blot = smooth(size, size - 0.12, dist) * (ident < 0.3) * keep * crust
    pale, grey_green = np.array((0.50, 0.51, 0.45)), np.array((0.33, 0.36, 0.24))
    tint = np.where((ident < 0.025)[:, None], np.array((0.38, 0.21, 0.07)), np.where((ident < 0.12)[:, None], grey_green, pale))
    albedo[:] = albedo * (1 - blot[:, None] * 0.75) + tint * blot[:, None] * 0.75
    rough[:] = rough * (1 - blot) + 0.8 * blot


def moss_cushion(p):
    """Moss grows in rounded clumps with dark gaps between them, not as an even felt."""
    dist, _ = cells(p * 85, 55)
    clump = smooth(0.9, 0.2, dist + 0.3 * fbm(p * 160, 2, 57))
    return 0.003 + 0.0035 * clump + 0.004 * smooth(-0.4, 0.5, fbm(p * 14, 3, 33))


def moss_colour(p):
    hue = np.clip(fbm(p * 6, 3, 51) * 1.2 + 0.5, 0, 1)
    deep, olive, bright = np.array((0.022, 0.040, 0.009)), np.array((0.060, 0.085, 0.020)), np.array((0.110, 0.150, 0.030))
    colour = np.where((hue < 0.5)[:, None], deep + (olive - deep) * (hue * 2)[:, None], olive + (bright - olive) * (hue * 2 - 1)[:, None])
    tips = np.clip(fbm(p * 110, 2, 53) * 1.5 + 0.5, 0, 1) ** 2
    return colour * (0.7 + 0.6 * tips)[:, None]


# ---------------------------------------------------------------- sculpt

def half_extents(z):
    t = np.clip(z / TOP, 0, 1.1)
    return HW0 * (1 - TAPER * t), HD0 * (1 - TAPER * t)


def top_height(x, y):
    return TOP + 0.06 * (-x / HW0) + 0.035 * (y / HD0)


def build_shaft():
    verts = []
    for z in (0.02, None):
        for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            hw, hd = half_extents(np.array(TOP if z is None else z))
            px, py = x * float(hw) + SKEW[len(verts), 0], y * float(hd) + SKEW[len(verts), 1]
            verts.append((px, py, float(top_height(px, py)) if z is None else z))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new("shaft")
    mesh.from_pydata(verts, [], faces)
    # Long ago the back-right corner of the crown split away along a clean fracture plane.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for at, plane in ((FRACTURE_AT, FRACTURE), (CHIP_AT, CHIP)):
        cut = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=at, plane_no=plane, clear_outer=True)
        bmesh.ops.contextual_create(bm, geom=[e for e in cut["geom_cut"] if isinstance(e, bmesh.types.BMEdge)])
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("Waystone shaft", mesh)
    bpy.context.scene.collection.objects.link(obj)
    apply_modifier(obj, "BEVEL", width=0.05, segments=5, limit_method="NONE")
    apply_modifier(obj, "REMESH", mode="VOXEL", voxel_size=0.002)

    co, normal, edges = arrays(obj.data)
    x, y, z = co.T
    hw, hd = half_extents(z)
    nx, ny = x / hw, y / hd
    top = top_height(x, y)
    on_top = z > top - 0.025
    broad = np.abs(ny) >= np.abs(nx)
    front, back = (~on_top) & broad & (ny < 0), (~on_top) & broad & (ny >= 0)
    left = (~on_top) & ~broad & (nx < 0)

    relief_front, relief_back, relief_side = carve_front(), carve_back(), Relief(HD0)
    carve_ogham(relief_front, relief_side)
    for relief in (relief_front, relief_back, relief_side):
        relief.soften()
    carve, glow = np.zeros(len(co)), np.zeros(len(co))
    for mask, relief, u in ((front, relief_front, nx * HW0), (back, relief_back, -nx * HW0), (left, relief_side, ny * HD0)):
        carve[mask] = relief.sample(u[mask], z[mask], relief.depth)
        glow[mask] = relief.sample(u[mask], z[mask], relief.glow)
    erosion = 0.5 + 0.5 * np.clip(fbm(co * 5, 3, 11) * 1.6 + 0.55, 0, 1)
    carve *= erosion * (0.86 + 0.14 * np.clip(fbm(co * 70, 3, 12) + 0.5, 0, 1))

    # Every weathering term below must vary continuously across the arrises and the crown rim;
    # a term that switches per face leaves a visible step along the edge.
    crown = smooth(top - 0.045, top - 0.01, z)
    fracture = np.maximum(*(smooth(-0.012, -0.002, (co - np.array(at)) @ np.array(plane)) for at, plane in ((FRACTURE_AT, FRACTURE), (CHIP_AT, CHIP))))
    broken_top = np.maximum(crown, fracture) * 0.026 * ridged(co * 6, 4, 15) + smooth(0.08, 0.0, top - z) * 0.012 * fbm(co * 14, 3, 17)
    across = np.clip(np.where(broad, nx, ny), -1, 1)
    swell = 0.02 * perlin(co * (1.2, 1.2, 2.2), 87)
    pillow = 0.016 * (1 - across ** 2) + 0.012 * np.sin(np.clip(z / TOP, 0, 1) * math.pi) + swell
    shape = 0.032 * fbm(co * 1.1, 3, 19) - 0.012 * smooth(0.2, 0.6, fbm(co * 3.5, 3, 18)) + 0.008 * fbm(co * 3.5, 3, 20) + 0.005 * fbm(co * 9, 4, 21) + 0.0016 * fbm(co * 34, 3, 23)
    hollows = 0.005 * smooth(0.25, 0.55, fbm(co * 11, 3, 81))
    # Softer beds in the limestone weather back faster, leaving shallow horizontal grooves round the stone.
    bedding = 0.0013 * perlin(co * (1.5, 1.5, 26), 83) - 0.004 * smooth(0.25, 0.7, perlin(np.c_[co[:, :2] * 2, co[:, 2:] * 13], 84))
    runnels = 0.0018 * smooth(0.2, 0.7, fbm(co * (30, 30, 1.6), 3, 9))
    displacement = pillow + shape + bedding - broken_top - runnels - hollows - carve

    moss = smooth(0.46, 0.22, z + 0.10 * fbm(co * 4, 3, 25))
    moss = np.maximum(moss, crown * smooth(0.0, 0.35, fbm(co * 5, 3, 27) + 0.1) * 0.85)
    moss = np.maximum(moss, np.clip(carve / 0.008, 0, 1) * smooth(0.9, 0.45, z) * smooth(0.0, 0.3, fbm(co * 8, 2, 29)))
    moss = np.maximum(moss, smooth(0.25, 0.55, fbm(co * 3, 3, 31)) * smooth(0.95, 0.5, z) * (left | back) * 0.9)
    moss = np.clip(moss, 0, 1)
    displacement += moss * moss_cushion(co)
    sculpted = co + normal * displacement[:, None]

    # Chips and spalls are flat breaks across a vertical arris. Clip the corner with a plane;
    # pushing the corner in along its normals would tear a crease down the edge instead.
    # The inscribed front-left arris is spared most of the damage so the ogham stays legible.
    spall_dist, spall_id = cells(co * 3.0, 89)
    spall = smooth(0.42, 0.37, spall_dist) * (spall_id < 0.55) * (0.6 + 0.4 * np.clip(1 - (spall_dist / 0.42) ** 2, 0, 1))
    inscribed = (x < 0) & (y < 0) & (z > 0.3) & (z < 1.5)
    reach = (0.07 * smooth(0.2, 0.28, fbm(co * (7, 7, 2.4), 3, 13)) + 0.11 * spall) * (1 - crown) * np.where(inscribed, 0.15, 1)
    # Measure against the unweathered block, so a bulging face never reads as close to an edge.
    cut = np.maximum(reach - np.maximum(hw - np.abs(x), 0) - np.maximum(hd - np.abs(y), 0), 0)
    sculpted[:, 0] -= np.sign(sculpted[:, 0]) * cut / 2
    sculpted[:, 1] -= np.sign(sculpted[:, 1]) * cut / 2
    facet = smooth(0.0, 0.006, cut)
    sculpted -= normal * ((0.007 * ridged(co * 18, 3, 90) + 0.004 * fbm(co * 45, 3, 91)) * facet)[:, None]
    write_positions(obj.data, sculpted)

    co, normal, edges = arrays(obj.data)
    curve = concavity(co, normal, edges)
    cavity, ridge = np.clip(curve * 2.2, 0, 1), np.clip(-curve * 2.2, 0, 1)
    albedo = stone_palette(co, cavity, ridge, np.clip(carve / 0.01, 0, 1))
    rough = 0.84 + 0.06 * fbm(co * 15, 2, 35)
    # The fracture is younger than the faces: paler, cleaner, no lichen yet.
    fresh = np.maximum(fracture * 0.6, facet * 0.25)
    albedo = albedo * (1 - 0.5 * fresh[:, None]) + np.array((0.44, 0.42, 0.37)) * (1 - 0.4 * cavity)[:, None] * 0.5 * fresh[:, None]
    lichen(co, albedo, rough, (1 - moss) * (1 - fresh) * (carve < 0.002) * smooth(0.5, 0.9, z))
    albedo = albedo * (1 - moss[:, None]) + moss_colour(co) * moss[:, None]
    albedo *= (1 - 0.45 * cavity * moss)[:, None]
    rough = rough * (1 - moss) + 0.95 * moss
    glow = np.clip(glow * (1 - moss * 1.5) * erosion, 0, 1)
    paint(obj.data, albedo, rough, glow, moss)

    # A slight bow and twist, then the lean of a stone that has settled in soft ground.
    t = np.clip(co[:, 2] / TOP, 0, 1)
    twist = 0.07 * t
    co[:, 0], co[:, 1] = co[:, 0] * np.cos(twist) - co[:, 1] * np.sin(twist), co[:, 0] * np.sin(twist) + co[:, 1] * np.cos(twist)
    co[:, 0] += 0.035 * np.sin(t * math.pi * 0.9)
    write_positions(obj.data, co)
    lean = Matrix.Translation((0, 0, 0.25)) @ Matrix.Rotation(math.radians(-1.6), 4, "Y") @ Matrix.Rotation(math.radians(2.4), 4, "X") @ Matrix.Translation((0, 0, -0.25))
    obj.data.transform(lean)
    return obj


def build_boulder():
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=1)
    obj = bpy.context.object
    obj.name = "Waystone boulder"
    co, normal, _ = arrays(obj.data)
    co *= (1 + 0.16 * fbm(normal * 1.4, 3, 60))[:, None]
    co *= (0.58, 0.48, 0.30)
    co[:, 2] += 0.04
    # Fractured faces: clip the lump against a ring of tilted planes, as a split field stone would break.
    for k in range(9):
        heading = k * math.tau / 9 + RNG.uniform(-0.25, 0.25)
        tilt = RNG.uniform(0.15, 0.95)
        plane = np.array((math.cos(heading) * math.cos(tilt), math.sin(heading) * math.cos(tilt), math.sin(tilt)))
        reach = (co @ plane).max() * RNG.uniform(0.8, 0.92)
        beyond = np.maximum(co @ plane - reach, 0)
        co -= beyond[:, None] * plane
    co += normal * (0.03 * ridged(co * 2.6, 4, 61) + 0.012 * fbm(co * 6, 3, 63))[:, None]
    co[:, 2] = np.maximum(co[:, 2], -0.015)
    write_positions(obj.data, co)
    apply_modifier(obj, "REMESH", mode="VOXEL", voxel_size=0.0034)

    co, normal, edges = arrays(obj.data)
    up = normal[:, 2]
    shape = 0.005 * fbm(co * 9, 4, 65) + 0.0014 * fbm(co * 36, 3, 67)
    crack = 0.007 * smooth(0.93, 0.99, ridged(co * 4, 3, 69))
    hollows = 0.005 * smooth(0.25, 0.55, fbm(co * 11, 3, 85))
    moss = smooth(0.15, 0.6, up + 0.6 * fbm(co * 4, 3, 71)) * smooth(0.0, 0.08, co[:, 2])
    displacement = shape - crack - hollows + moss * moss_cushion(co) * 1.3
    write_positions(obj.data, co + normal * displacement[:, None])

    co, normal, edges = arrays(obj.data)
    curve = concavity(co, normal, edges)
    albedo = stone_palette(co * 1.3, np.clip(curve * 2.2, 0, 1), np.clip(-curve * 2.2, 0, 1), np.zeros(len(co))) * 0.92
    rough = 0.86 + 0.05 * fbm(co * 15, 2, 75)
    lichen(co * 1.2, albedo, rough, (1 - moss) * smooth(0.02, 0.1, co[:, 2]))
    soil = smooth(0.04, -0.01, co[:, 2])
    albedo = albedo * (1 - soil[:, None]) + np.array((0.08, 0.06, 0.04)) * soil[:, None]
    albedo = albedo * (1 - moss[:, None]) + moss_colour(co * 1.1) * moss[:, None]
    albedo *= (1 - 0.45 * np.clip(curve * 2.2, 0, 1) * moss)[:, None]
    rough = rough * (1 - moss) + 0.95 * moss
    paint(obj.data, albedo, rough, np.zeros(len(co)), moss)
    return obj


def sculpt_material():
    mat = bpy.data.materials.new("Waystone sculpt")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]

    def attribute(name, socket):
        node = nodes.new("ShaderNodeAttribute")
        node.attribute_name = name
        return node.outputs[socket]

    def noise(scale, detail, roughness=0.55):
        node = nodes.new("ShaderNodeTexNoise")
        node.inputs["Scale"].default_value = scale
        node.inputs["Detail"].default_value = detail
        node.inputs["Roughness"].default_value = roughness
        coords = nodes.new("ShaderNodeTexCoord")
        links.new(coords.outputs["Object"], node.inputs["Vector"])
        return node.outputs["Fac"]

    def math_node(op, a, b):
        node = nodes.new("ShaderNodeMath")
        node.operation = op
        for socket, value in zip(node.inputs, (a, b)):
            if isinstance(value, float):
                socket.default_value = value
            else:
                links.new(value, socket)
        return node.outputs[0]

    def remap(value, low, high, out_low, out_high):
        node = nodes.new("ShaderNodeMapRange")
        links.new(value, node.inputs["Value"])
        node.inputs["From Min"].default_value, node.inputs["From Max"].default_value = low, high
        node.inputs["To Min"].default_value, node.inputs["To Max"].default_value = out_low, out_high
        return node.outputs[0]

    # Mineral grains and fine mottling are finer than the sculpt's vertices, so they live in the shader.
    specks = nodes.new("ShaderNodeTexVoronoi")
    specks.inputs["Scale"].default_value = 240
    links.new(nodes.new("ShaderNodeTexCoord").outputs["Object"], specks.inputs["Vector"])
    grain = math_node("MULTIPLY", remap(noise(110, 8), 0.3, 0.7, 0.84, 1.1), remap(specks.outputs["Distance"], 0.0, 0.16, 0.7, 1.0))
    tint = nodes.new("ShaderNodeMix")
    tint.data_type, tint.blend_type = "RGBA", "MULTIPLY"
    tint.inputs["Factor"].default_value = 1
    links.new(attribute("albedo", "Color"), tint.inputs["A"])
    links.new(grain, tint.inputs["B"])
    links.new(tint.outputs["Result"], bsdf.inputs["Base Color"])
    links.new(attribute("rough", "Fac"), bsdf.inputs["Roughness"])
    links.new(attribute("glow", "Fac"), bsdf.inputs["Emission Strength"])
    bsdf.inputs["Emission Color"].default_value = (0.30, 1.0, 0.72, 1)

    fuzz = math_node("MULTIPLY", attribute("moss", "Fac"), noise(700, 3, 0.7))
    height = math_node("ADD", noise(240, 5), math_node("MULTIPLY", fuzz, 2.5))
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.0012
    links.new(height, bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


# ---------------------------------------------------------------- bake to a game mesh

def low_poly(high, target):
    obj = high.copy()
    obj.data = high.data.copy()
    obj.name = high.name + " low"
    bpy.context.scene.collection.objects.link(obj)
    apply_modifier(obj, "DECIMATE", decimate_type="COLLAPSE", ratio=target / (len(obj.data.polygons) * 2))
    for name in ("albedo", "rough", "glow", "moss"):
        if name in obj.data.attributes:
            obj.data.attributes.remove(obj.data.attributes[name])
    obj.data.materials.clear()
    return obj


def new_image(name, colour=True):
    image = bpy.data.images.new(name, TEXTURE, TEXTURE, alpha=False)
    image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return image


def bake(low, highs, kind, image, samples, **settings):
    nodes = low.data.materials[0].node_tree.nodes
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    nodes.active = target
    bpy.context.scene.cycles.samples = samples
    bpy.ops.object.select_all(action="DESELECT")
    for obj in highs:
        obj.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=0.018, max_ray_distance=0.05, margin=16, **settings)
    nodes.remove(target)


def pixels(image):
    data = np.empty(TEXTURE * TEXTURE * 4, np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(TEXTURE, TEXTURE, 4)


def game_material(colour, orm, normal, emit):
    mat = bpy.data.materials.new("Evermere waystone")
    mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]

    def texture(image):
        node = nodes.new("ShaderNodeTexImage")
        node.image = image
        return node

    links.new(texture(colour).outputs["Color"], bsdf.inputs["Base Color"])
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(texture(orm).outputs["Color"], split.inputs["Color"])
    links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(split.outputs["Blue"], bsdf.inputs["Metallic"])
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    output = nodes.new("ShaderNodeGroup")
    output.node_tree = group
    links.new(split.outputs["Red"], output.inputs["Occlusion"])
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(texture(normal).outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(texture(emit).outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.6
    return mat


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = True
    scene.cycles.device = "GPU"

    sculpt = sculpt_material()
    highs = [build_shaft(), build_boulder()]
    for obj in highs:
        obj.data.materials.append(sculpt)
        obj.data.shade_smooth()
    if "--high" in ARGS:
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(ARGS[ARGS.index("--high") + 1]).resolve()))
        return

    lows = [low_poly(highs[0], 20000), low_poly(highs[1], 10000)]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in lows:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = lows[0]
    bpy.ops.object.join()
    low = bpy.context.object
    low.name = "Evermere waystone"
    low.data.shade_smooth()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    bake_mat = bpy.data.materials.new("bake target")
    low.data.materials.append(bake_mat)

    colour, rough, normal, emit, ao = (new_image(n, c) for n, c in (("waystone-colour", True), ("rough", False), ("waystone-normal", False), ("waystone-emit", True), ("ao", False)))
    bake(low, highs, "DIFFUSE", colour, 16, pass_filter={"COLOR"})
    bake(low, highs, "ROUGHNESS", rough, 16)
    bake(low, highs, "EMIT", emit, 16)
    bake(low, highs, "NORMAL", normal, 16)
    bake(low, highs, "AO", ao, 128)

    occlusion = pixels(ao)[:, :, 0]
    shaded = pixels(colour)
    shaded[:, :, :3] *= (0.35 + 0.65 * occlusion ** 1.3)[:, :, None]
    colour.pixels.foreach_set(shaded.ravel())
    orm = new_image("waystone-orm", False)
    packed = np.zeros((TEXTURE, TEXTURE, 4), np.float32)
    packed[:, :, 0], packed[:, :, 1], packed[:, :, 3] = occlusion, pixels(rough)[:, :, 0], 1
    orm.pixels.foreach_set(packed.ravel())
    for image in (colour, orm, normal, emit):
        image.pack()

    low.data.materials.clear()
    low.data.materials.append(game_material(colour, orm, normal, emit))
    for obj in highs:
        bpy.data.objects.remove(obj)
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    # Export with lossless PNG bakes, then hand the GLB to the KTX2 packer for the GPU-compressed release.
    out = OUT / "evermere-waystone.glb"
    with tempfile.TemporaryDirectory() as work:
        lossless = Path(work) / "evermere-waystone.glb"
        bpy.ops.export_scene.gltf(filepath=str(lossless), export_format="GLB", use_selection=True, export_image_format="AUTO")
        subprocess.run([sys.executable, str(Path(__file__).with_name("pack-ktx2.py")), str(lossless), str(out)], check=True)
    print(f"WAYSTONE {out} tris={sum(len(p.vertices) - 2 for p in low.data.polygons)} size={out.stat().st_size / 1e6:.2f} MB")


main()
