# Evermere model kit

Original models generated from the editable Blender script at `frontend/scripts/build-3d-kit.py`, using Rishaan's committed artwork as visual direction. These files contain no extracted Zelda or Genshin assets.

The ranger and spellweaver embed textures, an articulated skeleton with knees, and `idle`, `walk`, `strike`, `arms-up`, `t-pose`, and `crouch` clips. Ruins, oaks, and the moonwell share the woodland palette and material language. The runtime instances the oak geometry and shares static model geometry to limit draw calls.

GLB exports embed their required images. The separate ground PNGs are loaded by the terrain material; the other PNGs are editable source texture outputs for rebuilding the GLBs. Blender is needed only to regenerate assets.
