# Evermere model kit

Original models generated from the editable Blender script at `frontend/scripts/build-3d-kit.py`, using Rishaan's committed artwork as visual direction. These files contain no extracted Zelda or Genshin assets.

The ranger and spellweaver embed textures, an articulated skeleton with knees, and `idle`, `walk`, `strike`, `arms-up`, `t-pose`, and `crouch` clips. Ruins, oaks, and the moonwell share the woodland palette and material language. The runtime instances the oak geometry and shares static model geometry to limit draw calls.

GLB exports embed their required images. The separate ground PNGs are loaded by the terrain material; the other PNGs are editable source texture outputs for rebuilding the GLBs. Blender is needed only to regenerate assets.

## Waystone

`evermere-waystone.glb` is the first of the in-house replacements for the third-party `assetyard/` pack (it stands in for `reach-shrine.glb`). `frontend/scripts/build-waystone.py` sculpts it in Blender at about 2 million triangles, bakes it onto a 30,000-triangle mesh with 4K colour, normal, occlusion/roughness and emission maps, and compresses the textures with `frontend/scripts/pack-ktx2.py`.

Its textures are KTX2 (`KHR_texture_basisu`), so they stay compressed in GPU memory: about 28 MB rather than 357 MB for raw 4K maps. Loading it requires a `KTX2Loader` on the `GLTFLoader`, with its transcoder path pointing at a copy of `three/examples/jsm/libs/basis/`. Rebuilding needs Blender and `basisu` (`brew install basis_universal`).
