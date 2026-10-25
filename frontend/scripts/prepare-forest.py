"""Build a browser LOD from the CC0 Poly Haven tree without changing its textures."""
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[1] / 'public' / 'models'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(root / 'polyhaven/island_tree_01/island_tree_01.gltf'))
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    count = sum(len(face.vertices) - 2 for face in obj.data.polygons)
    if count > 25000:
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new('Browser LOD', 'DECIMATE')
        modifier.ratio = 25000 / count
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for face in obj.data.polygons:
        face.use_smooth = True
(root / 'forest').mkdir(exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(root / 'forest/tree.glb'), export_format='GLB', export_apply=True)
