"""Shared Blender pipeline for the in-house props: noise, per-vertex painting, high-to-low baking and KTX2 export.

Imported by the build-*.py prop scripts, which run inside Blender. A prop script models a dense
high-poly mesh, paints per-vertex attributes on it (albedo, rough, metal, glow, plus micro-detail
weights), then calls `ship()` to decimate a game mesh, bake 4K maps from the high poly, and write
a KTX2-compressed GLB through pack-ktx2.py.

Every channel except the normal map is baked through an emission pass, so metal bakes its true
base colour (a diffuse-colour bake would read black on fully metallic surfaces).
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

OUT = Path(__file__).resolve().parents[1] / "public" / "models"
TEXTURE = 4096
_RNG = np.random.default_rng(731)
_GRAD = _RNG.normal(size=(4096, 3))
_GRAD /= np.linalg.norm(_GRAD, axis=1)[:, None]
_POINTS = _RNG.random((4096, 3))


# ---------------------------------------------------------------- noise (vectorised, deterministic)

def _hash(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    return (h & 0xFFFFFFF) % 4096


def perlin(p, seed=0):
    base = np.floor(p).astype(np.int64)
    f = p - base
    u = f * f * f * (f * (f * 6 - 15) + 10)
    out = np.zeros(len(p))
    for dx, dy, dz in product((0, 1), repeat=3):
        g = _GRAD[_hash(base[:, 0] + dx, base[:, 1] + dy, base[:, 2] + dz, seed)]
        weight = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
        out += weight * (g * (f - (dx, dy, dz))).sum(1)
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
        dist = np.linalg.norm(p - (cell + _POINTS[h]), axis=1)
        closer = dist < best
        best[closer], ident[closer] = dist[closer], _POINTS[h][closer, 0]
    return best, ident


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- mesh helpers

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = True
    scene.cycles.device = "GPU"


def apply_modifier(obj, kind, **settings):
    modifier = obj.modifiers.new(kind.title(), kind)
    for key, value in settings.items():
        setattr(modifier, key, value)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def mesh_object(name, verts, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(map(float, v)) for v in verts], [], faces)
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def outward(obj):
    """Wind every face of a closed mesh to face out; hand-built lofts can come out inside-out."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


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


def concavity(co, normal, edges, passes=3):
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


def tag(obj, part):
    """Record which part of the prop each vertex belongs to, so painting can tell iron from glass."""
    mesh = obj.data
    attr = mesh.attributes.get("part") or mesh.attributes.new("part", "INT", "POINT")
    attr.data.foreach_set("value", np.full(len(mesh.vertices), part, np.int32))


def parts(mesh):
    values = np.empty(len(mesh.vertices), np.int32)
    mesh.attributes["part"].data.foreach_get("value", values)
    return values


def paint(mesh, albedo, rough, metal, glow=None, grain=None, brush=None):
    """Store the surface for the bake. grain weights fine noise bump; brush weights scratches along Z."""
    n = len(albedo)
    colour = mesh.color_attributes.new("albedo", "FLOAT_COLOR", "POINT")
    colour.data.foreach_set("color", np.c_[albedo, np.ones(n)].astype(np.float32).ravel())
    for name, values in (("rough", rough), ("metal", metal), ("glow", glow), ("grain", grain), ("brush", brush)):
        values = np.broadcast_to(np.asarray(0.0 if values is None else values, np.float32), (n,))
        mesh.attributes.new(name, "FLOAT", "POINT").data.foreach_set("value", np.ascontiguousarray(values))


# ---------------------------------------------------------------- materials

def sculpt_material(glow_colour=(1.0, 0.62, 0.28), grain_scale=260.0, brush_scale=(900.0, 900.0, 6.0)):
    """Read the painted attributes, add micro detail finer than the vertices, and expose bakeable channels."""
    mat = bpy.data.materials.new("Sculpt")
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    coords = nodes.new("ShaderNodeTexCoord").outputs["Object"]

    def attribute(name, socket="Fac"):
        node = nodes.new("ShaderNodeAttribute")
        node.attribute_name = name
        return node.outputs[socket]

    def op(kind, a, b):
        node = nodes.new("ShaderNodeMath")
        node.operation = kind
        for socket, value in zip(node.inputs, (a, b)):
            if isinstance(value, (int, float)):
                socket.default_value = value
            else:
                links.new(value, socket)
        return node.outputs[0]

    def noise(vector, scale, detail=6.0, roughness=0.55):
        node = nodes.new("ShaderNodeTexNoise")
        node.inputs["Scale"].default_value = scale
        node.inputs["Detail"].default_value = detail
        node.inputs["Roughness"].default_value = roughness
        links.new(vector, node.inputs["Vector"])
        return node.outputs["Fac"]

    stretch = nodes.new("ShaderNodeVectorMath")
    stretch.operation = "MULTIPLY"
    links.new(coords, stretch.inputs[0])
    stretch.inputs[1].default_value = brush_scale
    fine = noise(coords, grain_scale)
    scratches = noise(stretch.outputs[0], 1.0, 3.0, 0.7)

    # Fine grain darkens and lightens the albedo a little wherever grain is painted.
    shade = op("ADD", 1.0, op("MULTIPLY", attribute("grain"), op("SUBTRACT", op("MULTIPLY", fine, 0.24), 0.12)))
    tint = nodes.new("ShaderNodeMix")
    tint.data_type, tint.blend_type = "RGBA", "MULTIPLY"
    tint.inputs["Factor"].default_value = 1
    links.new(attribute("albedo", "Color"), tint.inputs["A"])
    shade_rgb = nodes.new("ShaderNodeCombineColor")
    for socket in ("Red", "Green", "Blue"):
        links.new(shade, shade_rgb.inputs[socket])
    links.new(shade_rgb.outputs["Color"], tint.inputs["B"])
    colour = tint.outputs["Result"]
    # Brushed scratches nudge roughness up and down along the brushing direction.
    rough = op("ADD", attribute("rough"), op("MULTIPLY", attribute("brush"), op("SUBTRACT", op("MULTIPLY", scratches, 0.3), 0.15)))
    glow_rgb = nodes.new("ShaderNodeMix")
    glow_rgb.data_type = "RGBA"
    links.new(attribute("glow"), glow_rgb.inputs["Factor"])
    glow_rgb.inputs["A"].default_value = (0, 0, 0, 1)
    glow_rgb.inputs["B"].default_value = (*glow_colour, 1)

    links.new(colour, bsdf.inputs["Base Color"])
    links.new(rough, bsdf.inputs["Roughness"])
    links.new(attribute("metal"), bsdf.inputs["Metallic"])
    links.new(glow_rgb.outputs["Result"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    height = op("ADD", op("MULTIPLY", attribute("grain"), fine), op("MULTIPLY", attribute("brush"), op("MULTIPLY", scratches, 0.6)))
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.3
    bump.inputs["Distance"].default_value = 0.0006
    links.new(height, bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    emission = nodes.new("ShaderNodeEmission")
    channels = {"colour": colour, "rough": rough, "metal": attribute("metal"), "glow": glow_rgb.outputs["Result"]}
    return mat, bsdf, emission, channels


def _route(mat, bsdf, emission, socket):
    """Point the material output at the BSDF (socket None) or at an emission of one channel."""
    output = mat.node_tree.nodes["Material Output"]
    links = mat.node_tree.links
    if socket is None:
        links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    else:
        links.new(socket, emission.inputs["Color"])
        links.new(emission.outputs["Emission"], output.inputs["Surface"])


# ---------------------------------------------------------------- bake to a game mesh and ship

def low_poly(high, target):
    obj = high.copy()
    obj.data = high.data.copy()
    obj.name = high.name + " low"
    bpy.context.scene.collection.objects.link(obj)
    apply_modifier(obj, "DECIMATE", decimate_type="COLLAPSE", ratio=min(1.0, target / sum(len(p.vertices) - 2 for p in obj.data.polygons)))
    for name in ("albedo", "rough", "metal", "glow", "grain", "brush", "part"):
        if name in obj.data.attributes:
            obj.data.attributes.remove(obj.data.attributes[name])
    obj.data.materials.clear()
    return obj


def _image(name, colour, size=TEXTURE):
    image = bpy.data.images.new(name, size, size, alpha=False)
    image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return image


def _pixels(image):
    size = image.size[0]
    data = np.empty(size * size * 4, np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(size, size, 4)


def ship(name, highs, sculpt, target, cage=0.004, reach=0.012, emission_strength=1.0, double_sided=False):
    """Decimate, unwrap, bake 4K maps from the high poly, export and KTX2-pack public/models/<name>.glb."""
    mat, bsdf, emission, channels = sculpt
    _prepare(highs, sculpt)
    lows = [low_poly(high, target * sum(len(p.vertices) - 2 for p in high.data.polygons) / sum(sum(len(p.vertices) - 2 for p in h.data.polygons) for h in highs)) for high in highs]
    low = join(lows, name) if len(lows) > 1 else lows[0]
    low.name = name
    low.data.shade_smooth()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003)
    bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
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
        for obj in highs:
            obj.select_set(True)
        low.select_set(True)
        bpy.context.view_layer.objects.active = low
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=cage, max_ray_distance=reach, margin=16)
        target_mat.node_tree.nodes.remove(node)

    colour, rough, metal, glow, normal, ao = (_image(f"{name}-{n}", c) for n, c in (("colour", True), ("rough", False), ("metal", False), ("emit", True), ("normal", False), ("ao", False)))
    for image, socket in ((colour, channels["colour"]), (rough, channels["rough"]), (metal, channels["metal"]), (glow, channels["glow"])):
        bake("EMIT", image, 16, socket)
    bake("NORMAL", normal, 16)
    bake("AO", ao, 128)
    _route(mat, bsdf, emission, None)

    occlusion = _pixels(ao)[:, :, 0]
    shaded = _pixels(colour)
    shaded[:, :, :3] *= (0.5 + 0.5 * occlusion)[:, :, None]
    colour.pixels.foreach_set(shaded.ravel())
    orm = _image(f"{name}-orm", False)
    packed = np.zeros((TEXTURE, TEXTURE, 4), np.float32)
    packed[:, :, 0], packed[:, :, 1], packed[:, :, 2], packed[:, :, 3] = occlusion, _pixels(rough)[:, :, 0], _pixels(metal)[:, :, 0], 1
    orm.pixels.foreach_set(packed.ravel())
    for image in (colour, orm, normal, glow):
        image.pack()

    low.data.materials.clear()
    low.data.materials.append(_game_material(name, colour, orm, normal, glow, emission_strength, double_sided))
    for obj in highs:
        bpy.data.objects.remove(obj)
    bpy.ops.object.select_all(action="DESELECT")
    low.select_set(True)
    out = OUT / f"{name}.glb"
    with tempfile.TemporaryDirectory() as work:
        lossless = Path(work) / f"{name}.glb"
        bpy.ops.export_scene.gltf(filepath=str(lossless), export_format="GLB", use_selection=True, export_image_format="AUTO")
        subprocess.run([sys.executable, str(Path(__file__).with_name("pack-ktx2.py")), str(lossless), str(out)], check=True)
    print(f"SHIPPED {out} tris={sum(len(p.vertices) - 2 for p in low.data.polygons)} size={out.stat().st_size / 1e6:.2f} MB")


def _game_material(name, colour, orm, normal, emit, emission_strength, double_sided):
    mat = bpy.data.materials.new(name)
    mat.use_backface_culling = not double_sided
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
    links.new(texture(emit).outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def _prepare(highs, sculpt):
    for obj in highs:
        obj.data.materials.clear()
        obj.data.materials.append(sculpt[0])
        obj.data.shade_smooth()
    _route(sculpt[0], sculpt[1], sculpt[2], None)


def save_high(path, highs, sculpt):
    _prepare(highs, sculpt)
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(path).resolve()))
