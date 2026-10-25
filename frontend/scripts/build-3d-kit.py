"""Original Evermere assets, authored in Blender from the project's art direction.

Run with Blender --background --python scripts/build-3d-kit.py.
The script is the editable source; generated GLBs contain their own textures.
"""
import math
import random
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

random.seed(731)
OUT = Path(__file__).resolve().parents[1] / "public" / "models"
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def texture(name, color, kind="stone"):
    size = 512
    yy, xx = np.mgrid[0:size, 0:size] / size
    noise = np.zeros((size, size))
    for octave in range(1, 8):
        scale = 2 ** octave
        noise += (np.sin(xx * scale * 5 + np.cos(yy * scale * 3)) * np.cos(yy * scale * 4 + 0.7)) / (octave * 10)
    if kind == "cloth":
        noise += (np.sin(xx * 900) + np.sin(yy * 900)) * 0.025
    if kind == "leather":
        noise += np.sin(xx * 87 + np.sin(yy * 30)) * 0.035
    pixels = np.ones((size, size, 4), dtype=np.float32)
    for c in range(3):
        pixels[:, :, c] = np.clip(color[c] * (0.92 + noise), 0, 1)
    image = bpy.data.images.new(name, size, size)
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = str(OUT / f"{name}.png")
    image.file_format = "PNG"
    image.save()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    image_node = nodes.new("ShaderNodeTexImage")
    image_node.image = image
    mat.node_tree.links.new(image_node.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.84
    return mat


def plain(name, color, metal=0, glow=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = 0.55 if metal else 0.8
    bsdf.inputs["Metallic"].default_value = metal
    if glow:
        bsdf.inputs["Emission Color"].default_value = (*color, 1)
        bsdf.inputs["Emission Strength"].default_value = glow
    return mat


stone = texture("weathered-limestone", (0.57, 0.59, 0.49))
cloth = texture("ranger-emerald", (0.10, 0.24, 0.18), "cloth")
leather = texture("ranger-leather", (0.22, 0.16, 0.10), "leather")
gold = plain("antique-bronze", (0.48, 0.38, 0.18), 0.65)
silver = plain("forged-silver", (0.58, 0.66, 0.65), 0.75)
skin = plain("warm-skin", (0.65, 0.43, 0.29))
hair = plain("chestnut-hair", (0.19, 0.13, 0.075))
eyes = plain("dark-eyes", (0.035, 0.045, 0.03))
mint = plain("old-magic", (0.31, 0.8, 0.63), glow=1.6)
moss = plain("living-moss", (0.21, 0.31, 0.105))
ivy = plain("ivy-leaves", (0.12, 0.29, 0.13))

# Tiled surfaces for the real-time terrain: worn flagstones, living ground, bark.
size = 512
yy, xx = np.mgrid[0:size, 0:size] / size
nearest = np.full((size, size), 100.0)
second = nearest.copy()
for i in range(-1, 9):
    for j in range(-1, 9):
        px = (i + 0.5 + random.uniform(-0.3, 0.3)) / 7
        py = (j + 0.5 + random.uniform(-0.3, 0.3)) / 7
        d = np.hypot(xx - px, yy - py)
        second = np.where(d < nearest, nearest, np.minimum(second, d))
        nearest = np.minimum(nearest, d)
mortar = np.clip((second - nearest) * 80, 0, 1)
rng = np.random.default_rng(731)
frequency = np.fft.fftfreq(size)
fx, fy = np.meshgrid(frequency, frequency)
noise = np.zeros((size, size))
for radius, amplitude in [(0.018, 0.045), (0.075, 0.025), (0.24, 0.012)]:
    field = np.fft.ifft2(np.fft.fft2(rng.normal(size=(size, size))) * np.exp(-(fx * fx + fy * fy) / radius ** 2)).real
    noise += field / max(field.std(), 0.001) * amplitude
height = mortar * 0.7 + noise

def save_pixels(name, rgb):
    image = bpy.data.images.new(name, size, size)
    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(rgb, 0, 1)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(OUT / f"{name}.png")
    image.file_format = "PNG"
    image.save()

ground = np.empty((size, size, 3))
for c, base in enumerate((0.63, 0.62, 0.51)):
    ground[:, :, c] = base * (0.54 + mortar * 0.48 + noise)
save_pixels("old-flagstones", ground)
dx, dy = np.gradient(height)
normal = np.dstack((-dy * 3, -dx * 3, np.ones_like(height)))
normal /= np.linalg.norm(normal, axis=2)[:, :, None]
save_pixels("old-flagstones-normal", normal * 0.5 + 0.5)
ground[:, :, 0] = 0.50 + noise * 1.2
ground[:, :, 1] = 0.57 + noise * 1.1
ground[:, :, 2] = 0.38 + noise * 0.8
save_pixels("woodland-floor", ground)


def finish(obj, mat, bevel=0, smooth=False):
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("Worn edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    if smooth and hasattr(obj.data, "polygons"):
        for face in obj.data.polygons:
            face.use_smooth = True
    return obj


def box(name, p, scale, mat, bevel=0.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, bevel)


def sphere(name, p, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=1, location=p)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, smooth=True)


def tube(name, points, radius, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coord in zip(spline.points, points):
        point.co = (*coord, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return finish(obj, mat, smooth=True)


def export(name):
    # Join the authored parts into one material-batched mesh for browser rendering.
    parts = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in parts:
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            if modifier.type != "ARMATURE":
                bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=str(OUT / f"{name}.glb"), export_format="GLB", export_animations=True, export_apply=True)


# Modular pointed ruin, with actual voussoirs, mouldings, and climbing ivy.
for x in (-2.1, 2.1):
    box("Column plinth", (x, 0, 0.18), (1.15, 1.1, 0.36), stone, 0.07)
    for level in range(8):
        block = box("Weathered column block", (x, random.uniform(-0.025, 0.025), 0.56 + level * 0.42), (0.65 + random.random() * 0.06, 0.75, 0.40), stone, 0.04)
        block.rotation_euler.z = random.uniform(-0.018, 0.018)
    for dx in (-0.22, 0.22):
        tube("Carved column moulding", [(x + dx, -0.41, 0.5), (x + dx, -0.41, 3.65)], 0.036, stone)
    box("Capital", (x, 0, 3.76), (0.95, 0.95, 0.26), stone, 0.05)

# A pointed Gothic arch, with each block following a gently peaked curve.
for side in (-1, 1):
    curve = []
    for i in range(12):
        t = i / 11
        curve.append((side * 2.1 * (1 - t) ** 0.82, -0.02, 3.85 + 2.5 * math.sin(t * math.pi / 2)))
    for i in range(11):
        a, b = Vector(curve[i]), Vector(curve[i + 1])
        block = box("Arch voussoir", (a + b) / 2, (0.48, 0.77, (b - a).length + 0.035), stone, 0.035)
        block.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    tube("Gothic inner moulding", [(x * 0.92, -0.43, z - 0.07) for x, y, z in curve], 0.055, stone)
    tube("Gothic outer moulding", [(x * 1.09, -0.44, z + 0.09) for x, y, z in curve], 0.055, stone)
box("Keystone", (0, 0, 6.35), (0.48, 0.9, 0.6), stone, 0.04)
for x in (-2.1, 2.1):
    for vine in range(3):
        points = [(x + math.sin(i * 0.8 + vine) * 0.31, -0.48 - math.cos(i * 0.7) * 0.1, i * 0.3) for i in range(17)]
        tube("Climbing ivy stem", points, 0.027, moss)
        for i in range(1, 17):
            px, py, pz = points[i]
            for side in (-1, 1):
                leaf = sphere("Ivy leaf", (px + side * 0.13, py - 0.03, pz + 0.06), (0.15, 0.035, 0.1), ivy)
                leaf.rotation_euler.y = side * 0.65
    for i in range(10):
        sphere("Moss at the roots", (x + random.uniform(-0.5, 0.5), random.uniform(-0.4, 0.4), 0.33), (0.2, 0.15, 0.07), moss)
for i in range(5):
    angle = i / 5 * math.pi * 2
    tube("Mint star rune", [(math.sin(angle) * 0.55, -0.1, 2.5 + math.cos(angle) * 0.7), (0, -0.1, 2.5), (math.sin(angle + 0.65) * 0.22, -0.1, 2.5 + math.cos(angle + 0.65) * 0.25)], 0.018, mint)
export("evermere-arch")
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

# A rigidly skinned ranger, with separate shoulder, hand and leg articulation.
bpy.ops.object.armature_add()
rig = bpy.context.object
rig.name = "EvermereRanger"
bpy.ops.object.mode_set(mode="EDIT")
rig.data.edit_bones.remove(rig.data.edit_bones[0])
bones = {
    "Root": ((0, 0, 0), (0, 0, 0.2), None),
    "Torso": ((0, 0, 0.85), (0, 0, 1.48), "Root"),
    "Head": ((0, 0, 1.48), (0, 0, 1.91), "Torso"),
    "ArmL": ((-0.28, 0, 1.4), (-0.34, 0, 0.94), "Torso"),
    "ArmR": ((0.28, 0, 1.4), (0.34, 0, 0.94), "Torso"),
    "LegL": ((-0.13, 0, 0.84), (-0.13, 0, 0.48), "Root"),
    "LegR": ((0.13, 0, 0.84), (0.13, 0, 0.48), "Root"),
    "ShinL": ((-0.13, 0, 0.48), (-0.13, 0, 0.09), "LegL"),
    "ShinR": ((0.13, 0, 0.48), (0.13, 0, 0.09), "LegR"),
}
for name, (head, tail, parent) in bones.items():
    bone = rig.data.edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    if parent:
        bone.parent = rig.data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")


def bind(obj, bone):
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1, "REPLACE")
    modifier = obj.modifiers.new("Ranger rig", "ARMATURE")
    modifier.object = rig
    obj.parent = rig
    return obj


bind(sphere("Layered emerald tunic", (0, 0, 1.17), (0.25, 0.155, 0.37), cloth), "Torso")
bind(box("Leather breastplate", (0, -0.143, 1.21), (0.34, 0.075, 0.38), leather, 0.055), "Torso")
bind(box("Broad sword belt", (0, 0, 0.94), (0.48, 0.34, 0.085), leather), "Torso")
bind(box("Bronze belt buckle", (0, -0.185, 0.94), (0.09, 0.035, 0.075), gold, 0.01), "Torso")
for side in (-1, 1):
    bone = "ArmL" if side < 0 else "ArmR"
    bind(sphere("Fitted sleeve", (side * 0.30, 0, 1.21), (0.095, 0.10, 0.24), cloth), bone)
    bind(sphere("Leather bracer", (side * 0.33, -0.01, 1.02), (0.09, 0.10, 0.17), leather), bone)
    bind(sphere("Shoulder pauldron", (side * 0.29, 0, 1.44), (0.18, 0.20, 0.08), gold), bone)
    bind(sphere("Gloved hand", (side * 0.34, -0.02, 0.88), (0.065, 0.085, 0.11), leather), bone)
    for z in (0.94, 1.09):
        bind(box("Bracer clasp", (side * 0.33, -0.11, z), (0.12, 0.025, 0.025), gold, 0.005), bone)
    bone = "LegL" if side < 0 else "LegR"
    bind(sphere("Trousers", (side * 0.13, 0, 0.62), (0.115, 0.13, 0.27), leather), bone)
    bone = "ShinL" if side < 0 else "ShinR"
    bind(sphere("Tall leather boot", (side * 0.13, 0, 0.28), (0.11, 0.115, 0.25), leather), bone)
    bind(sphere("Boot toe", (side * 0.13, -0.085, 0.08), (0.11, 0.22, 0.075), leather), bone)
    for z in (0.22, 0.37, 0.46):
        bind(box("Boot strap", (side * 0.13, -0.105, z), (0.20, 0.035, 0.035), gold, 0.006), bone)

# Cape with a scalloped hem and actual folds instead of a cone.
verts, faces = [], []
for row in range(10):
    t = row / 9
    for col in range(13):
        u = col / 12
        x = (u - 0.5) * (0.53 + t * 0.42)
        y = 0.14 + t * 0.15 + math.sin(u * math.pi * 8) * t * 0.035
        z = 1.48 - t * 1.18 + (math.cos(u * math.pi * 8) * 0.025 if row == 9 else 0)
        verts.append((x, y, z))
        if row and col:
            a = row * 13 + col
            faces.append((a, a - 1, a - 14, a - 13))
data = bpy.data.meshes.new("Folded cloak")
data.from_pydata(verts, [], faces)
cape = bpy.data.objects.new("Emerald travelling cloak", data)
bpy.context.collection.objects.link(cape)
finish(cape, cloth, smooth=True)
bind(cape, "Torso")
for side in (-1, 1):
    bind(tube("Cloak embroidery", [(verts[row * 13 + (0 if side < 0 else 12)][0], verts[row * 13 + (0 if side < 0 else 12)][1] + 0.005, verts[row * 13 + (0 if side < 0 else 12)][2]) for row in range(10)], 0.008, gold), "Torso")

bind(sphere("Face", (0, -0.015, 1.70), (0.135, 0.125, 0.19), skin), "Head")
bind(sphere("Nose", (0, -0.139, 1.70), (0.026, 0.035, 0.045), skin), "Head")
for side in (-1, 1):
    bind(sphere("Eye", (side * 0.052, -0.126, 1.74), (0.018, 0.012, 0.009), eyes), "Head")
    ear = sphere("Elven ear", (side * 0.15, 0, 1.73), (0.065, 0.025, 0.037), skin)
    ear.rotation_euler.y = side * -0.5
    bind(ear, "Head")
for i in range(16):
    a = i / 16 * math.pi * 2
    bind(tube("Chestnut hair strand", [(math.sin(a) * 0.11, math.cos(a) * 0.10, 1.86), (math.sin(a) * 0.145, math.cos(a) * 0.13, 1.76), (math.sin(a) * 0.15, max(0, math.cos(a)) * 0.14, 1.57)], 0.018, hair), "Head")
# Travelling hood open around the face.
for i in range(9):
    a = i / 8 * math.pi
    bind(tube("Hood fold", [(math.cos(a) * 0.17, 0.04, 1.72 + math.sin(a) * 0.21), (math.cos(a) * 0.15, 0.16, 1.68 + math.sin(a) * 0.20)], 0.035, cloth), "Head")
bind(box("Utility pouch", (-0.26, 0.02, 0.89), (0.16, 0.17, 0.20), leather, 0.03), "Torso")
bind(box("Sword hilt", (0.35, -0.03, 0.85), (0.04, 0.05, 0.2), leather, 0.008), "ArmR")
bind(box("Sword crossguard", (0.35, -0.03, 0.74), (0.27, 0.06, 0.045), gold, 0.015), "ArmR")
bind(box("Forged blade", (0.35, -0.03, 0.40), (0.07, 0.025, 0.64), silver, 0.008), "ArmR")

# Smart UV projections ensure exported image materials survive the glTF pipeline.
for obj in list(bpy.context.scene.objects):
    if obj.type == "MESH":
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")

def animation(name, frames, pose):
    rig.animation_data_create()
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for frame in frames:
        for bone in rig.pose.bones:
            bone.rotation_mode = "XYZ"
            bone.rotation_euler = (0, 0, 0)
            bone.location = (0, 0, 0)
        pose(frame / 24)
        for bone in rig.pose.bones:
            bone.keyframe_insert("rotation_euler", frame=frame)
            bone.keyframe_insert("location", frame=frame)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, action)
    rig.animation_data.action = None

def locomotion(t, stride):
    angle = math.sin(t * math.pi * 2) * stride
    rig.pose.bones["LegL"].rotation_euler.x = angle
    rig.pose.bones["LegR"].rotation_euler.x = -angle
    rig.pose.bones["ArmL"].rotation_euler.x = -angle * 0.45
    rig.pose.bones["ArmR"].rotation_euler.x = angle * 0.45
    rig.pose.bones["ShinL"].rotation_euler.x = max(0, -angle) * 0.8
    rig.pose.bones["ShinR"].rotation_euler.x = max(0, angle) * 0.8
    rig.pose.bones["Root"].location.y = abs(math.sin(t * math.pi * 2)) * 0.025

def crouch(_t):
    rig.pose.bones["Root"].location.y = -0.30
    rig.pose.bones["Torso"].rotation_euler.x = -0.25
    for side in ("L", "R"):
        rig.pose.bones[f"Leg{side}"].rotation_euler.x = -1.1
        rig.pose.bones[f"Shin{side}"].rotation_euler.x = 1.85

animation("walk", range(1, 26, 3), lambda t: locomotion(t, 0.6))
animation("idle", [1, 13, 25], lambda t: setattr(rig.pose.bones["Torso"].rotation_euler, "x", math.sin(t * math.pi * 2) * 0.025))
animation("strike", [1, 4, 7, 10], lambda t: setattr(rig.pose.bones["ArmR"].rotation_euler, "x", math.sin(t / 0.42 * math.pi) * -2.3))
animation("arms-up", [1, 25], lambda t: (setattr(rig.pose.bones["ArmL"].rotation_euler, "z", 2.7), setattr(rig.pose.bones["ArmR"].rotation_euler, "z", -2.7)))
animation("t-pose", [1, 25], lambda t: (setattr(rig.pose.bones["ArmL"].rotation_euler, "z", 1.5), setattr(rig.pose.bones["ArmR"].rotation_euler, "z", -1.5)))
animation("crouch", [1, 25], crouch)
for track in rig.animation_data.nla_tracks:
    track.mute = False
bpy.context.scene.frame_set(1)
export("evermere-ranger")

# A companion silhouette and material treatment based on the dawn spellweaver.
hero_mesh = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
dawn_cloth = texture("dawn-weave", (0.57, 0.42, 0.23), "cloth")
for slot in hero_mesh.material_slots:
    if slot.material and slot.material.name == "ranger-emerald":
        slot.material = dawn_cloth
# The staff replaces the blade; the shared rig keeps the two heroes responsive.
import bmesh
bm = bmesh.new()
bm.from_mesh(hero_mesh.data)
blade_index = next((i for i, mat in enumerate(hero_mesh.data.materials) if mat.name == "forged-silver"), -1)
bmesh.ops.delete(bm, geom=[face for face in bm.faces if face.material_index == blade_index], context="FACES")
bm.to_mesh(hero_mesh.data)
bm.free()
bind(tube("Spellweaver's oak staff", [(0.35, -0.03, 0.18), (0.35, -0.03, 1.75)], 0.025, leather), "ArmR")
bind(sphere("Moon-glass focus", (0.35, -0.03, 1.83), (0.085, 0.07, 0.13), mint), "ArmR")
for side in (-1, 1):
    bind(tube("Bronze staff cradle", [(0.35, -0.03, 1.67), (0.35 + side * 0.13, -0.03, 1.8), (0.35 + side * 0.09, -0.03, 1.94)], 0.012, gold), "ArmR")
export("evermere-spellweaver")

# Branching oak with individual leaf silhouettes; the game instances this kit.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bark = texture("old-oak-bark", (0.28, 0.24, 0.17), "leather")
leaf_mats = [plain(f"oak-foliage-{i}", color) for i, color in enumerate([(0.22, 0.34, 0.10), (0.30, 0.40, 0.14), (0.37, 0.43, 0.18)])]
for i in range(7):
    a = i / 7 * math.pi * 2
    tube("Old oak root", [(0, 0, 0.7), (math.sin(a) * 0.7, math.cos(a) * 0.7, 0.15), (math.sin(a) * 1.25, math.cos(a) * 1.25, 0.02)], 0.12, bark)
tube("Twisted oak trunk", [(0, 0, 0), (0.15, 0, 1.4), (-0.06, 0.08, 2.9), (0.2, 0, 4.5)], 0.34, bark)
leaf_verts, leaf_faces = [], []
for branch in range(10):
    a = branch / 10 * math.pi * 2
    tip = Vector((math.sin(a) * 2.4, math.cos(a) * 2.4, 4.5 + branch % 3 * 0.5))
    tube("Oak bough", [(0, 0, 2.4), (tip.x * 0.5, tip.y * 0.5, 3.7), tip], 0.12, bark)
    for leaf in range(45):
        phi = random.random() * math.pi * 2
        r = random.random() ** 0.4 * 1.5
        center = tip + Vector((math.sin(phi) * r, math.cos(phi) * r, random.uniform(-0.5, 0.7)))
        across = Vector((math.sin(phi) * 0.22, math.cos(phi) * 0.22, random.uniform(-0.08, 0.08)))
        along = Vector((math.cos(phi) * 0.12, -math.sin(phi) * 0.12, 0.12))
        index = len(leaf_verts)
        leaf_verts.extend([center - along, center - across, center + along, center + across])
        leaf_faces.append((index, index + 1, index + 2, index + 3))
data = bpy.data.meshes.new("Oak canopy leaves")
data.from_pydata(leaf_verts, [], leaf_faces)
canopy = bpy.data.objects.new("Layered oak canopy", data)
bpy.context.collection.objects.link(canopy)
for mat in leaf_mats:
    canopy.data.materials.append(mat)
    mat.use_backface_culling = False
for face in data.polygons:
    face.material_index = random.randrange(3)
export("evermere-oak")

# Reusable carved props for the same woodland masonry language.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
for z, width, depth in [(0.12, 2.1, 1.8), (0.35, 1.8, 1.5)]:
    box("Moonwell footing", (0, 0, z), (width, depth, 0.24), stone, 0.065)
for i in range(12):
    a = i / 12 * math.pi * 2
    block = box("Basin stone", (math.sin(a) * 0.72, math.cos(a) * 0.72, 0.72), (0.40, 0.25, 0.48), stone, 0.04)
    block.rotation_euler.z = -a
    if i % 3 == 0:
        sphere("Moss between basin stones", (math.sin(a) * 0.8, math.cos(a) * 0.8, 0.92), (0.17, 0.1, 0.06), moss)
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.63, depth=0.04, location=(0, 0, 0.81))
finish(bpy.context.object, mint)
for i in range(3):
    a = i / 3 * math.pi * 2
    tube("Basin rune", [(math.sin(a) * 0.84, math.cos(a) * 0.84, 0.7), (math.sin(a) * 0.84, math.cos(a) * 0.84, 0.85)], 0.025, mint)
export("evermere-moonwell")
print("Evermere kit exported:", OUT)
