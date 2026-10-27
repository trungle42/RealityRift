"""Re-encode a GLB's textures as KTX2 (Basis Universal) so they stay compressed in GPU memory.

Run from frontend/:
  python3 scripts/pack-ktx2.py in.glb out.glb
The input may also be a .gltf with external buffer and image files; the output is always one GLB.
`--alpha IMAGE_NAME=mask.png` gives the named image a separate alpha mask (for cut-out foliage whose
colour map is a JPEG). `--keep colour,data` leaves textures of those roles as they are: the heroes keep their
colour and metal maps as PNG/JPEG, because the game dyes their cloth by reading those pixels (avatars.ts).
Needs basisu on PATH (Homebrew: brew install basis_universal). The game must load the result
through GLTFLoader with a KTX2Loader attached.

Normal maps use UASTC, which transcodes to BC7/ASTC on the GPU and keeps carved edges crisp, at
half resolution: a 4K UASTC normal map costs ~12 MB on disk and looked identical at 1.7 m.
Colour, packed occlusion/roughness/metal and emission use ETC1S at high quality: about a fifth
of UASTC's size on noisy stone with no visible loss at play distance. Emission maps are mostly
black, so they are stored at a quarter of the resolution. Every texture carries a full mip chain.
"""
import json
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

CODECS = {
    "colour": ["-etc1s", "-quality", "100", "-mipmap"],
    "normal": ["-uastc", "-quality", "90", "-effort", "4", "-normal_map", "-resample_factor", "0.5", "-mipmap", "-mip_renorm"],
    "data": ["-etc1s", "-quality", "90", "-linear", "-mipmap"],
    "glow": ["-etc1s", "-quality", "80", "-resample_factor", "0.25", "-mipmap"],
}


def read_glb(path):
    data = path.read_bytes()
    magic, version, _ = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2:
        raise SystemExit(f"{path} is not a glTF 2 binary")
    json_length, _ = struct.unpack_from("<I4s", data, 12)
    gltf = json.loads(data[20:20 + json_length])
    bin_at = 20 + json_length
    bin_length, _ = struct.unpack_from("<I4s", data, bin_at)
    if len(gltf.get("buffers", [])) != 1:
        raise SystemExit("Only single-buffer GLBs are supported")
    return gltf, data[bin_at + 8:bin_at + 8 + bin_length]


def read_gltf(path):
    """Load a .gltf and fold its external buffer and images into one GLB-style binary blob."""
    gltf = json.loads(path.read_text())
    if len(gltf.get("buffers", [])) != 1:
        raise SystemExit("Only single-buffer glTF files are supported")
    blob = bytearray((path.parent / gltf["buffers"][0].pop("uri")).read_bytes())
    for image in gltf.get("images", []):
        uri = image.pop("uri", None)
        if uri is None:
            continue
        data = (path.parent / uri).read_bytes()
        image["mimeType"] = "image/png" if uri.lower().endswith(".png") else "image/jpeg"
        image["bufferView"] = len(gltf["bufferViews"])
        gltf["bufferViews"].append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob += data
    return gltf, bytes(blob)


def write_glb(path, gltf, chunks):
    blob = bytearray()
    for view, chunk in zip(gltf["bufferViews"], chunks):
        blob += b"\0" * (-len(blob) % 4)
        view.update(buffer=0, byteOffset=len(blob), byteLength=len(chunk))
        blob += chunk
    blob += b"\0" * (-len(blob) % 4)
    gltf["buffers"] = [{"byteLength": len(blob)}]
    text = json.dumps(gltf, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    header = struct.pack("<4sII", b"glTF", 2, 28 + len(text) + len(blob))
    path.write_bytes(header + struct.pack("<I4s", len(text), b"JSON") + text + struct.pack("<I4s", len(blob), b"BIN\0") + bytes(blob))


def roles(gltf):
    """Map each image index to how its texture is sampled, from the materials that use it."""
    found = {}

    def mark(ref, role):
        if ref is not None:
            found.setdefault(gltf["textures"][ref["index"]]["source"], role)

    for mat in gltf.get("materials", []):
        pbr = mat.get("pbrMetallicRoughness", {})
        mark(pbr.get("baseColorTexture"), "colour")
        mark(mat.get("normalTexture"), "normal")
        mark(pbr.get("metallicRoughnessTexture"), "data")
        mark(mat.get("occlusionTexture"), "data")
        mark(mat.get("emissiveTexture"), "glow")
    return found


def main(src, dst, alphas=None, keep=()):
    if not shutil.which("basisu"):
        raise SystemExit("basisu not found: brew install basis_universal")
    gltf, blob = read_gltf(src) if src.suffix == ".gltf" else read_glb(src)
    chunks = [blob[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]] for v in gltf["bufferViews"]]
    with tempfile.TemporaryDirectory() as work:
        encoded_images = set()
        for index, role in roles(gltf).items():
            if role in keep:
                continue
            encoded_images.add(index)
            image = gltf["images"][index]
            suffix = ".png" if image.get("mimeType") == "image/png" else ".jpg"
            source, encoded = Path(work) / f"{index}{suffix}", Path(work) / f"{index}.ktx2"
            source.write_bytes(chunks[image["bufferView"]])
            mask = (alphas or {}).get(image.get("name"))
            extra = ["-alpha_file", str(mask)] if mask else []
            run = subprocess.run(["basisu", str(source), *extra, "-ktx2", "-output_file", str(encoded), "-no_stats", *CODECS[role]], capture_output=True, text=True)
            if run.returncode:
                raise SystemExit(f"basisu failed on {image.get('name', index)}:\n{run.stdout}{run.stderr}")
            chunks[image["bufferView"]] = encoded.read_bytes()
            image["mimeType"] = "image/ktx2"
            print(f"  {image.get('name', index)}: {role}, {len(chunks[image['bufferView']]) / 1e6:.2f} MB")
    for texture in gltf["textures"]:
        if texture["source"] in encoded_images:
            texture.setdefault("extensions", {})["KHR_texture_basisu"] = {"source": texture.pop("source")}
    for key in ("extensionsUsed", "extensionsRequired"):
        gltf[key] = sorted(set(gltf.get(key, [])) | {"KHR_texture_basisu"})
    write_glb(dst, gltf, chunks)
    print(f"{dst}: {dst.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    args = sys.argv[1:]
    alphas = {}
    while "--alpha" in args:
        at = args.index("--alpha")
        name, mask = args[at + 1].split("=", 1)
        alphas[name] = Path(mask)
        del args[at:at + 2]
    keep = ()
    if "--keep" in args:
        at = args.index("--keep")
        keep = tuple(args[at + 1].split(","))
        del args[at:at + 2]
    main(Path(args[0]), Path(args[1]), alphas, keep)
