#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/storybound-art-pack.zip" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "$script_dir/.." && pwd -P)"
git_root="$(git -C "$repo_root" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$git_root" || "$git_root" != "$repo_root" ]]; then
  echo "Refusing to run: scripts must be inside the Storybound repository." >&2
  exit 1
fi

zip_path="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).expanduser().resolve())' "$1")"
if [[ ! -f "$zip_path" ]]; then
  echo "Art pack zip not found: $zip_path" >&2
  exit 1
fi

python3 - "$repo_root" "$zip_path" <<'PY'
import os
import pathlib
import stat
import sys
import zipfile

repo = pathlib.Path(sys.argv[1]).resolve()
models = repo / "frontend" / "public" / "models"
archive = pathlib.Path(sys.argv[2])
allowed = ("assetyard/", "polyhaven/")

with zipfile.ZipFile(archive) as zf:
    for entry in zf.infolist():
        name = entry.filename.replace("\\", "/")
        rel = pathlib.PurePosixPath(name)
        if rel.is_absolute() or ".." in rel.parts or not name.startswith(allowed):
            continue
        mode = entry.external_attr >> 16
        if stat.S_ISLNK(mode):
            print(f"SKIP symlink: {name}")
            continue
        dest = (models / pathlib.Path(*rel.parts)).resolve()
        if not dest.is_relative_to(models.resolve()):
            raise SystemExit(f"Refusing path outside models folder: {name}")
        if entry.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            print(f"SKIP existing (never overwrite): {dest.relative_to(repo)}")
            continue
        with zf.open(entry) as src, dest.open("xb") as out:
            while chunk := src.read(1024 * 1024):
                out.write(chunk)
        print(f"INSTALLED {dest.relative_to(repo)}")

expected = (
    "assetyard/ashfen-ranger.glb",
    "assetyard/hollow-warden.glb",
    "assetyard/vale-shieldmaiden.glb",
    "assetyard/arming-sword.glb",
    "assetyard/reach-shrine.glb",
    "assetyard/wayfarer-lantern.glb",
    "assetyard/gloom-stalker.glb",
    "assetyard/ashfen-dragon.glb",
    "polyhaven/fern_02/fern_02.gltf",
    "polyhaven/rock_moss_set_01/rock_moss_set_01.gltf",
)
for rel in expected:
    state = "OK" if (models / rel).is_file() else "MISSING"
    print(f"{state}: frontend/public/models/{rel}")
PY

for path in \
  frontend/public/models/assetyard/ashfen-ranger.glb \
  frontend/public/models/polyhaven/fern_02/fern_02.gltf; do
  if ! git -C "$repo_root" check-ignore -q -- "$path"; then
    echo "Refusing to finish: expected art path is not ignored: $path" >&2
    exit 1
  fi
done

echo "Git status (no files were staged by this script):"
git -C "$repo_root" status --short
