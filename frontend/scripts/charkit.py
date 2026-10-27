"""Shared Blender pipeline for the in-house characters: SDF sculpting, rigging, skinning, clip authoring and export.

Imported by the build-<character>.py scripts, which run inside Blender. A character script lays out a skeleton,
sculpts the body as a signed distance field of anatomical shapes (bones, muscle bellies, tendons, cloth), each
owned by one bone, paints the dense surface, and authors the clips the game plays. `ship()` then meshes the field
through OpenVDB, decimates a game mesh and bakes 4K maps from the dense one (bakekit), skins the game mesh from the
same shapes (each vertex follows the bones whose shapes it lies on), and exports one GLB with the clips.

Coordinates are Blender's: Z up, the character faces -Y, its left hand is on +X. Joint rotations are written as
rotations in those axes, as if the parent chain were at rest (`Pose`), which keeps the clip code readable.
"""
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import bmesh
import bpy
import numpy as np
import openvdb
from mathutils import Matrix, Quaternion, Vector

from bakekit import OUT, TEXTURE, _image, _pixels, _route, apply_modifier, arrays, concavity, low_poly, paint  # noqa: F401

FPS = 30


# ---------------------------------------------------------------- signed distance shapes

class Shape:
    """A distance function over Nx3 points and the box it can reach into."""

    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, np.asarray(lo, float), np.asarray(hi, float)


def _v(p):
    return np.asarray(p, float)


def frame(along, toward=(0, -1, 0)):
    """Rows: x across, y `along`, z the part of `toward` square to it. For orienting ellipsoids and boxes."""
    y = _v(along) / np.linalg.norm(along)
    z = _v(toward) - y * (_v(toward) @ y)
    z /= np.linalg.norm(z)
    return np.array([np.cross(y, z), y, z])


def ball(c, r):
    c = _v(c)
    return Shape(lambda p: np.linalg.norm(p - c, axis=1) - r, c - r, c + r)


def ellipsoid(c, radii, axes=None):
    """Radii along the rows of `axes` (default the world axes)."""
    c, r = _v(c), _v(radii)
    m = np.eye(3) if axes is None else np.asarray(axes, float)

    def fn(p):
        q = (p - c) @ m.T
        k0 = np.linalg.norm(q / r, axis=1)
        k1 = np.maximum(np.linalg.norm(q / (r * r), axis=1), 1e-9)
        return k0 * (k0 - 1) / k1
    reach = np.abs(m.T) @ r
    return Shape(fn, c - reach, c + reach)


def cone(a, b, ra, rb=None):
    """A capsule whose radius runs from ra at a to rb at b."""
    a, b = _v(a), _v(b)
    rb = ra if rb is None else rb
    ba = b - a
    l2 = max(ba @ ba, 1e-12)

    def fn(p):
        t = np.clip((p - a) @ ba / l2, 0, 1)
        return np.linalg.norm(p - a - t[:, None] * ba, axis=1) - (ra + (rb - ra) * t)
    r = max(ra, rb)
    return Shape(fn, np.minimum(a, b) - r, np.maximum(a, b) + r)


def tube(points, radii):
    """A tapering tube through `points`; radii per point (or one radius)."""
    pts = [_v(p) for p in points]
    rs = np.broadcast_to(np.asarray(radii, float), (len(pts),))
    parts = [cone(pts[i], pts[i + 1], rs[i], rs[i + 1]) for i in range(len(pts) - 1)]

    def fn(p):
        return np.min([s.fn(p) for s in parts], axis=0)
    return Shape(fn, np.min([s.lo for s in parts], axis=0), np.max([s.hi for s in parts], axis=0))


def box(c, half, axes=None, rounding=0.0):
    c, h = _v(c), _v(half) - rounding
    m = np.eye(3) if axes is None else np.asarray(axes, float)

    def fn(p):
        q = np.abs((p - c) @ m.T) - h
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0) - rounding
    reach = np.abs(m.T) @ _v(half)
    return Shape(fn, c - reach, c + reach)


def bezier(p0, p1, p2, steps=8):
    """Points along a quadratic curve, for tubes that bend (ribs, horns, tendons)."""
    p0, p1, p2 = _v(p0), _v(p1), _v(p2)
    return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in np.linspace(0, 1, steps)]


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


# ---------------------------------------------------------------- the sculpted body

class Body:
    """Shapes added (smoothly unioned) or cut, in order. Each added shape belongs to a bone and a paint tag."""

    def __init__(self):
        self.ops = []

    def add(self, shape, bone, tag="skin", k=0.012, bias=0.0):
        """`bias` pushes the shape back when deciding which tag a surface point wears (a garment with an opening
        reads as near to everything inside the opening)."""
        self.ops.append(("add", shape, k, bone, tag, bias))
        return shape

    def cut(self, shape, k=0.004):
        self.ops.append(("cut", shape, k, None, None, 0.0))
        return shape

    def bounds(self, pad=0.03):
        adds = [op[1] for op in self.ops if op[0] == "add"]
        return np.min([s.lo for s in adds], axis=0) - pad, np.max([s.hi for s in adds], axis=0) + pad

    def field(self, voxel):
        """The distance field on a voxel grid, clamped to a narrow band; returns (grid, origin)."""
        lo, hi = self.bounds()
        dims = np.ceil((hi - lo) / voxel).astype(int) + 1
        band = voxel * 4
        grid = np.full(dims, band, np.float32)
        for mode, shape, k, *_ in self.ops:
            reach = k + band
            a = np.clip(np.floor((shape.lo - reach - lo) / voxel).astype(int), 0, dims)
            b = np.clip(np.ceil((shape.hi + reach - lo) / voxel).astype(int) + 1, 0, dims)
            if np.any(b <= a):
                continue
            idx = np.stack(np.meshgrid(*(np.arange(a[i], b[i]) for i in range(3)), indexing="ij"), -1).reshape(-1, 3)
            d = shape.fn(lo + idx * voxel).reshape(tuple(b - a))
            block = grid[a[0]:b[0], a[1]:b[1], a[2]:b[2]]
            if mode == "add":
                block[:] = smin(block, d, k)
            else:
                block[:] = -smin(-block, d, k)
        np.clip(grid, -band, band, out=grid)
        return grid, lo

    def mesh(self, name, voxel, adaptivity=0.0):
        grid, origin = self.field(voxel)
        vdb = openvdb.FloatGrid(float(voxel * 4))
        vdb.copyFromArray(grid)
        vdb.transform = openvdb.createLinearTransform(voxelSize=voxel)
        points, tris, quads = vdb.convertToPolygons(isovalue=0.0, adaptivity=adaptivity)
        points = points.astype(float) + origin
        obj = mesh_from_arrays(name, points, tris, quads)
        if signed_volume(obj.data) < 0:
            obj.data.flip_normals()
        return obj

    def sparse_mesh(self, name, voxel, chunk=40, adaptivity=0.0):
        """Like mesh(), but the field lives in a sparse OpenVDB grid filled chunk by chunk, so a model with a wide
        reach (a dragon's wings) costs memory only near its surface. A chunk whose centre is far outside a shape is
        skipped and one far inside is filled whole, which relies on the shapes being close to true distances."""
        lo, _ = self.bounds()
        band = voxel * 4
        grid = openvdb.FloatGrid(float(band))
        for mode, shape, k, *_ in self.ops:
            reach = k + band
            a = np.maximum(np.floor((shape.lo - reach - lo) / voxel).astype(int), 0)
            b = np.ceil((shape.hi + reach - lo) / voxel).astype(int) + 1
            for i in range(a[0], b[0], chunk):
                for j in range(a[1], b[1], chunk):
                    for kk in range(a[2], b[2], chunk):
                        start = np.array((i, j, kk))
                        size = np.minimum(start + chunk, b) - start
                        centre = lo + (start + (size - 1) / 2) * voxel
                        margin = np.linalg.norm(size) * voxel / 2 + band + k + voxel * 2
                        d0 = shape.fn(centre[None, :])[0]
                        if d0 > margin:
                            continue
                        block = np.zeros(tuple(size), np.float32)
                        grid.copyToArray(block, tuple(int(v) for v in start))
                        if d0 < -margin:
                            block[:] = -band if mode == "add" else band
                        else:
                            idx = np.stack(np.meshgrid(*(np.arange(start[n], start[n] + size[n]) for n in range(3)), indexing="ij"), -1).reshape(-1, 3)
                            d = shape.fn(lo + idx * voxel).reshape(tuple(size))
                            block[:] = smin(block, d, k) if mode == "add" else -smin(-block, d, k)
                        np.clip(block, -band, band, out=block)
                        grid.copyFromArray(block, tuple(int(v) for v in start))
        grid.transform = openvdb.createLinearTransform(voxelSize=voxel)
        points, tris, quads = grid.convertToPolygons(isovalue=0.0, adaptivity=adaptivity)
        obj = mesh_from_arrays(name, points.astype(float) + lo, tris, quads)
        if signed_volume(obj.data) < 0:
            obj.data.flip_normals()
        return obj

    def nearest(self, points, by="bone"):
        """For each point, the distance to every bone's shapes (dict) or the tag of the nearest shape."""
        if by == "bone":
            out = {}
            for mode, shape, _, bone, *_ in self.ops:
                if mode == "add":
                    d = _masked(shape, points)
                    out[bone] = np.minimum(out[bone], d) if bone in out else d
            return out
        best, tags = np.full(len(points), 9.0), np.full(len(points), "", object)
        for mode, shape, _, _, tag, bias in self.ops:
            if mode == "add":
                d = _masked(shape, points) + bias
                closer = d < best
                best[closer], tags[closer] = d[closer], tag
        return tags


def _masked(shape, points, margin=0.08):
    """Distances only inside the shape's reach (plus margin); everything else reads as far away."""
    inside = np.all((points > shape.lo - margin) & (points < shape.hi + margin), axis=1)
    d = np.full(len(points), 9.0)
    if inside.any():
        d[inside] = shape.fn(points[inside])
    return d


def mesh_from_arrays(name, verts, tris, quads):
    mesh = bpy.data.meshes.new(name)
    mesh.vertices.add(len(verts))
    mesh.vertices.foreach_set("co", np.ascontiguousarray(verts, np.float32).ravel())
    loops = np.concatenate([np.asarray(quads, np.int32).ravel(), np.asarray(tris, np.int32).ravel()])
    sizes = np.r_[np.full(len(quads), 4), np.full(len(tris), 3)].astype(np.int32)
    mesh.loops.add(len(loops))
    mesh.loops.foreach_set("vertex_index", loops)
    mesh.polygons.add(len(sizes))
    mesh.polygons.foreach_set("loop_start", np.r_[0, np.cumsum(sizes)[:-1]].astype(np.int32))
    mesh.update(calc_edges=True)
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def signed_volume(mesh):
    mesh.calc_loop_triangles()
    co = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    tri = np.empty(len(mesh.loop_triangles) * 3, np.int32)
    mesh.loop_triangles.foreach_get("vertices", tri)
    t = co[tri.reshape(-1, 3)]
    return np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum() / 6


def displace(obj, offsets):
    """Move each vertex along its normal by `offsets` (metres)."""
    co, normal, _ = arrays(obj.data)
    obj.data.vertices.foreach_set("co", (co + normal * offsets[:, None]).ravel())
    obj.data.update()


# ---------------------------------------------------------------- skeleton

def armature(name, bones):
    """bones: [(name, head, tail, parent, up)] in rest pose; `up` sets each bone's roll (its local +Z)."""
    data = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for bone_name, head, tail, parent, up in bones:
        bone = data.edit_bones.new(bone_name)
        bone.head, bone.tail = Vector(head), Vector(tail)
        bone.align_roll(Vector(up))
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def skin(obj, rig, body, softness=0.010, smoothing=6, deform=None):
    """Weights from the sculpt: a vertex follows the bones whose shapes it is nearest, blended over `softness`."""
    co, _, edges = arrays(obj.data)
    names = [b.name for b in rig.data.bones if deform is None or b.name in deform]
    near = body.nearest(co, "bone")
    d = np.stack([near.get(n, np.full(len(co), 9.0)) for n in names], 1)
    w = np.exp(-(d - d.min(1, keepdims=True)) / softness)
    count = np.bincount(edges.ravel(), minlength=len(co)).astype(float)
    for _ in range(smoothing):
        acc = np.zeros_like(w)
        np.add.at(acc, edges[:, 0], w[edges[:, 1]])
        np.add.at(acc, edges[:, 1], w[edges[:, 0]])
        w = 0.5 * w + 0.5 * acc / np.maximum(count, 1)[:, None]
    top = np.argsort(-w, axis=1)[:, :4]
    keep = np.zeros_like(w)
    rows = np.arange(len(co))[:, None]
    keep[rows, top] = w[rows, top]
    keep[keep < 0.02 * keep.max(1, keepdims=True)] = 0
    keep /= keep.sum(1, keepdims=True)
    for j, n in enumerate(names):
        group = obj.vertex_groups.new(name=n)
        for i in np.nonzero(keep[:, j])[0]:
            group.add([int(i)], float(keep[i, j]), "REPLACE")
    bind(obj, rig)


def bind(obj, rig, bone=None):
    """Parent to the rig with an Armature modifier; `bone` gives the whole mesh to one bone (eyes, teeth)."""
    if bone:
        obj.vertex_groups.new(name=bone).add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    obj.parent = rig
    obj.modifiers.new("Armature", "ARMATURE").object = rig


# ---------------------------------------------------------------- posing and clips

def rot(axis, angle):
    return Quaternion(Vector(axis).normalized(), angle)


def aim(a, b):
    """The rotation that turns direction a onto direction b."""
    return Vector(a).normalized().rotation_difference(Vector(b).normalized())


def align(u0, v0, u1, v1):
    """The rotation taking the frame (u0, v0) onto (u1, v1): u exactly, v as near as it can."""
    def basis(u, v):
        u = Vector(u).normalized()
        v = (Vector(v) - u * u.dot(Vector(v))).normalized()
        return Matrix((u, v, u.cross(v))).transposed()
    return (basis(u1, v1) @ basis(u0, v0).transposed()).to_quaternion()


class Pose:
    """Joint rotations in armature axes (relative to the parent at rest) plus the hips' offset, for one frame."""

    def __init__(self, rig):
        self.rig, self.q, self.offset = rig, {}, Vector()
        bones = rig.data.bones
        self.rest = {b.name: b.matrix_local.to_3x3() for b in bones}
        self.head = {b.name: b.head_local.copy() for b in bones}
        self.parent = {b.name: b.parent.name if b.parent else None for b in bones}
        self.order = [b.name for b in bones]

    def turn(self, bone, q):
        """Compose a further rotation onto a joint (applied after what it already has)."""
        self.q[bone] = q @ self.q.get(bone, Quaternion())

    def world(self):
        """Accumulated rotation and posed head position of every bone."""
        acc, pos = {}, {}
        for name in self.order:
            parent = self.parent[name]
            q = self.q.get(name, Quaternion())
            if parent is None:
                acc[name], pos[name] = q, self.head[name] + self.offset
            else:
                acc[name] = acc[parent] @ q
                pos[name] = pos[parent] + acc[parent] @ (self.head[name] - self.head[parent])
        return acc, pos

    def leg(self, upleg, leg, foot, target, pole=(0, -1, 0), foot_rot=Quaternion()):
        """Two-bone IK: put `foot`'s head (the ankle) on `target`, knee toward `pole`; `foot_rot` is the foot's world turn."""
        acc, pos = self.world()
        hip, knee0, ankle0 = self.head[upleg], self.head[leg], self.head[foot]
        l1, l2 = (knee0 - hip).length, (ankle0 - knee0).length
        h = pos[upleg]
        to = Vector(target) - h
        dist = min(max(to.length, 1e-4), l1 + l2 - 1e-4)
        u = to.normalized()
        side = (Vector(pole) - u * u.dot(Vector(pole))).normalized()
        cos_a = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
        knee = h + u * (l1 * cos_a) + side * (l1 * math.sqrt(max(0.0, 1 - cos_a * cos_a)))
        ankle = h + u * dist
        rest_pole = Vector(pole)
        w_thigh = align(knee0 - hip, rest_pole, knee - h, side)
        w_shin = align(ankle0 - knee0, rest_pole, ankle - knee, side)
        self.q[upleg] = acc[self.parent[upleg]].inverted() @ w_thigh
        self.q[leg] = w_thigh.inverted() @ w_shin
        self.q[foot] = w_shin.inverted() @ foot_rot

    def apply(self):
        for pb in self.rig.pose.bones:
            r = self.rest[pb.name]
            q = self.q.get(pb.name, Quaternion())
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = (r.inverted() @ q.to_matrix() @ r).to_quaternion()
            pb.location = r.inverted() @ self.offset if self.parent[pb.name] is None else Vector()


def clip(rig, name, duration, pose_at):
    """Sample pose_at(pose, t) at FPS over [0, duration] into an action on its own NLA track."""
    rig.animation_data_create()
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    frames = round(duration * FPS)
    previous = {}
    for f in range(frames + 1):
        pose = Pose(rig)
        pose_at(pose, f / FPS)
        pose.apply()
        for pb in rig.pose.bones:
            q = pb.rotation_quaternion
            if pb.name in previous and previous[pb.name].dot(q) < 0:
                pb.rotation_quaternion = -q
            previous[pb.name] = pb.rotation_quaternion.copy()
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if pose.parent[pb.name] is None:
                pb.keyframe_insert("location", frame=f)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    rig.animation_data.action = None
    return action


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def window(t, a, b):
    """0 before a, eased to 1 by b."""
    return ease((t - a) / (b - a))


# ---------------------------------------------------------------- bake, skin and ship

def bake_maps(name, high, sculpt, target, cage=0.003, reach=0.010, size=TEXTURE, ao=1.0):
    """Decimate a game mesh from `high`, unwrap it and bake colour (with AO), roughness/metal and normal maps. `ao`
    scales how deep the baked occlusion goes (the game applies it again from the ORM map): faces want less, or eye
    sockets and the mouth's line go black."""
    mat, bsdf, emission, channels = sculpt
    high.data.materials.clear()
    high.data.materials.append(mat)
    high.data.shade_smooth()
    _route(mat, bsdf, emission, None)
    low = low_poly(high, target)
    low.name = name
    low.data.shade_smooth()
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = low
    low.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002)
    bpy.ops.uv.pack_islands(margin=0.002, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    target_mat = bpy.data.materials.new("bake target")
    low.data.materials.append(target_mat)

    def bake(kind, image, samples, socket=None):
        _route(mat, bsdf, emission, socket)
        node = target_mat.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        target_mat.node_tree.nodes.active = node
        bpy.context.scene.cycles.samples = samples
        bpy.ops.object.select_all(action="DESELECT")
        high.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=cage, max_ray_distance=reach, margin=16)
        target_mat.node_tree.nodes.remove(node)

    ao_depth = ao
    colour, rough, metal, normal, ao = (_image(f"{name}-{n}", c, size) for n, c in (("colour", True), ("rough", False), ("metal", False), ("normal", False), ("ao", False)))
    for image, socket in ((colour, channels["colour"]), (rough, channels["rough"]), (metal, channels["metal"])):
        bake("EMIT", image, 8, socket)
    bake("NORMAL", normal, 8)
    bake("AO", ao, 96)
    _route(mat, bsdf, emission, None)
    occlusion = 1 - ao_depth * (1 - _pixels(ao)[:, :, 0])
    shaded = _pixels(colour)
    shaded[:, :, :3] *= (0.55 + 0.45 * occlusion)[:, :, None]
    colour.pixels.foreach_set(shaded.ravel())
    orm = _image(f"{name}-orm", False, size)
    packed = np.ones((size, size, 4), np.float32)
    packed[:, :, 0], packed[:, :, 1], packed[:, :, 2] = occlusion, _pixels(rough)[:, :, 0], _pixels(metal)[:, :, 0]
    orm.pixels.foreach_set(packed.ravel())
    for image in (colour, orm, normal):
        image.pack()
    low.data.materials.clear()
    low.data.materials.append(game_material(name, colour, orm, normal))
    return low


def game_material(name, colour, orm, normal):
    """glTF-ready PBR material. No emission map: the game flashes a struck foe by setting its emissive colour."""
    mat = bpy.data.materials.new(name)
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
    group = bpy.data.node_groups.get("glTF Material Output") or bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    if "Occlusion" not in group.interface.items_tree:
        group.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    output = nodes.new("ShaderNodeGroup")
    output.node_tree = group
    links.new(split.outputs["Red"], output.inputs["Occlusion"])
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(texture(normal).outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def glossy(name, colour, rough=0.2, glow=None, strength=2.0):
    """A plain untextured material (eyes, teeth), optionally glowing."""
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = rough
    if glow:
        bsdf.inputs["Emission Color"].default_value = (*glow, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def export(name, rig, meshes, pack=True, keep=(), jpeg=False):
    """Write public/models/characters/<name>.glb with every NLA track as a clip (rig None: a static model), then
    KTX2-pack its textures (except the roles in `keep`, see pack-ktx2.py). `jpeg` writes the textures as quality-92
    JPEG first, which keeps the maps left uncompressed for the game's dye small."""
    out = OUT / "characters" / f"{name}.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [rig, *meshes] if rig else meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig or meshes[0]
    bpy.context.scene.render.fps = FPS
    settings = dict(export_format="GLB", use_selection=True, export_animations=True, export_animation_mode="NLA_TRACKS",
                    export_force_sampling=True, export_skins=True, export_def_bones=False, export_image_format="AUTO",
                    export_yup=True, export_apply=False)
    if jpeg:
        settings.update(export_image_format="JPEG", export_image_quality=92)
    with tempfile.TemporaryDirectory() as work:
        lossless = Path(work) / f"{name}.glb"
        bpy.ops.export_scene.gltf(filepath=str(lossless), **settings)
        if pack:
            extra = ["--keep", ",".join(keep)] if keep else []
            subprocess.run([sys.executable, str(Path(__file__).with_name("pack-ktx2.py")), str(lossless), str(out), *extra], check=True)
        else:
            out.write_bytes(lossless.read_bytes())
    print(f"SHIPPED {out} size={out.stat().st_size / 1e6:.2f} MB")
    return out


def reset_pose(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()


def outward(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj
