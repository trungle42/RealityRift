# Evermere model kit

Original models generated from the editable Blender script at `frontend/scripts/build-3d-kit.py`, using Rishaan's committed artwork as visual direction. These files contain no extracted Zelda or Genshin assets.

The ranger and spellweaver embed textures, an articulated skeleton with knees, and `idle`, `walk`, `strike`, `arms-up`, `t-pose`, and `crouch` clips. Ruins, oaks, and the moonwell share the woodland palette and material language. The runtime instances the oak geometry and shares static model geometry to limit draw calls.

GLB exports embed their required images. The separate ground PNGs are loaded by the terrain material; the other PNGs are editable source texture outputs for rebuilding the GLBs. Blender is needed only to regenerate assets.

## Waystone

`evermere-waystone.glb` is the first of the in-house replacements for the third-party `assetyard/` pack (it stands in for `reach-shrine.glb`). `frontend/scripts/build-waystone.py` sculpts it in Blender at about 2 million triangles, bakes it onto a 30,000-triangle mesh with 4K colour, normal, occlusion/roughness and emission maps, and compresses the textures with `frontend/scripts/pack-ktx2.py`.

Its textures are KTX2 (`KHR_texture_basisu`), so they stay compressed in GPU memory: about 28 MB rather than 357 MB for raw 4K maps. The adventure loads it through a `KTX2Loader` whose transcoder lives in `frontend/public/basis/`, copied from `three/examples/jsm/libs/basis/`; recopy those two files when upgrading three. Rebuilding needs Blender and `basisu` (`brew install basis_universal`).

## Lantern and sword

`evermere-lantern.glb` (replacing `wayfarer-lantern.glb` on the road's lamp posts) and `evermere-sword.glb` (replacing `arming-sword.glb` in both heroes' hands) are built by `frontend/scripts/build-lantern.py` and `frontend/scripts/build-sword.py`. Both use `frontend/scripts/bakekit.py`, the shared pipeline for props: the script models and paints a dense high-poly, and `ship()` decimates a game mesh, bakes 4K colour, occlusion/roughness/metal, normal and emission maps through emission passes (so metal keeps its true colour), and packs the GLB to KTX2.

The lantern is blackened iron with crescent and star ironwork over amber glass lit from within; its collar clamps onto the post. The sword has a fullered steel blade, a bronze guard with trefoil ends, a cord-bound leather grip and a wheel pommel whose triskele glows faintly mint. `Actor.holdWeapon` measures the sword's own geometry, so a rebuilt sword needs no code change as long as the guard stays its widest part.

## Poly Haven forest dressing

The fern, the mossy rocks and the forest-floor and cobblestone ground textures come from [Poly Haven](https://polyhaven.com) under CC0, so they are committed. `frontend/scripts/fetch-forest-assets.py` downloads the sources (gitignored) and `frontend/scripts/pack-polyhaven.py` packs them: `polyhaven/fern_02/fern_02.glb` and `polyhaven/rock_moss_set_01/rock_moss_set_01.glb` with KTX2 textures, and `Diffuse.ktx2`/`nor_gl.ktx2` for each ground set (flipped at encode time, because KTX2 textures are not flipped on upload as the old JPEGs were). `forest/tree.glb` is reduced from Poly Haven's `island_tree_01` by `prepare-forest.py`.

Only the Asset Yard characters (`assetyard/`) are left outside the repo; without them the game uses its built-in stand-in characters.
