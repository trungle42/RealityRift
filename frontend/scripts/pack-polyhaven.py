"""Compress the Poly Haven (CC0) forest dressing the adventure loads into small KTX2 files that are committed.

Run from frontend/ after scripts/fetch-forest-assets.py has downloaded the sources (which stay gitignored):
  python3 scripts/pack-polyhaven.py
Needs basisu on PATH (Homebrew: brew install basis_universal).

The fern and mossy rocks become GLBs through pack-ktx2.py. The ground textures tile across the
terrain, so the colour maps stay 2K and the normal maps drop to 1K. TextureLoader flipped the old
JPEGs on upload and KTX2 textures are never flipped, so they are flipped here at encode time;
otherwise the normal maps would light the ground from the wrong side.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "models" / "polyhaven"
PACK = Path(__file__).with_name("pack-ktx2.py")
GROUND = {
    "Diffuse": ["-etc1s", "-quality", "100", "-mipmap"],
    "nor_gl": ["-uastc", "-quality", "90", "-effort", "4", "-normal_map", "-resample_factor", "0.5", "-mipmap", "-mip_renorm"],
}

# The fern's colour map is a JPEG, so its leaflet cut-outs come from Poly Haven's separate alpha mask.
EXTRA = {"fern_02": ["--alpha", f"fern_02_diff-fern_02_alpha={ROOT / 'fern_02' / 'textures' / 'fern_02_alpha_2k.png'}"]}

for model in ("fern_02", "rock_moss_set_01"):
    subprocess.run([sys.executable, str(PACK), str(ROOT / model / f"{model}.gltf"), str(ROOT / model / f"{model}.glb"), *EXTRA.get(model, [])], check=True)

for ground in ("forest_floor", "mossy_cobblestone"):
    for name, codec in GROUND.items():
        out = ROOT / ground / f"{name}.ktx2"
        run = subprocess.run(["basisu", str(ROOT / ground / f"{name}.jpg"), "-ktx2", "-y_flip", "-output_file", str(out), "-no_stats", *codec], capture_output=True, text=True)
        if run.returncode:
            raise SystemExit(f"basisu failed on {ground}/{name}:\n{run.stdout}{run.stderr}")
        print(f"{out.relative_to(ROOT)}: {out.stat().st_size / 1e6:.2f} MB")
