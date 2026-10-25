"""Fetch the explicitly listed CC0 Poly Haven files and preserve source metadata."""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "models" / "polyhaven"
ROOT.mkdir(parents=True, exist_ok=True)


def fetch(url, path, checksum=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or (checksum and hashlib.md5(path.read_bytes()).hexdigest() != checksum):
        subprocess.run(["curl", "-fsSL", url, "-o", str(path)], check=True)
    if checksum and hashlib.md5(path.read_bytes()).hexdigest() != checksum:
        raise ValueError(f"Checksum mismatch: {path.name}")


for asset in ["fern_02", "rock_moss_set_01", "island_tree_01", "mossy_cobblestone", "forest_floor"]:
    metadata = ROOT / asset / "source.json"
    fetch(f"https://api.polyhaven.com/files/{asset}", metadata)
    data = json.loads(metadata.read_text())
    if asset in ["mossy_cobblestone", "forest_floor"]:
        for channel in ["Diffuse", "nor_gl", "Rough"]:
            file = data[channel]["2k"]["jpg"]
            fetch(file["url"], metadata.parent / f"{channel}.jpg", file["md5"])
    else:
        file = data["gltf"]["2k"]["gltf"]
        fetch(file["url"], metadata.parent / f"{asset}.gltf", file["md5"])
        for name, dependency in file["include"].items():
            path = (metadata.parent / name).resolve()
            if ROOT.resolve() not in path.parents:
                raise ValueError("Asset dependency escaped the destination directory")
            fetch(dependency["url"], path, dependency["md5"])
        if asset == "fern_02":
            # The glTF's JPEG colour map has no alpha; the separate mask cuts the leaflets out of the frond cards.
            file = data["Alpha"]["2k"]["png"]
            fetch(file["url"], metadata.parent / "textures" / f"{asset}_alpha_2k.png", file["md5"])
    print(f"Ready: {asset}")
