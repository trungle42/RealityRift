"""Run a folder of object photos through /api/artifact and print results + latency.

Usage (server running on :8000):  python tools/test_photos.py path/to/photos
"""
import base64, io, json, sys, time, urllib.request
from pathlib import Path

from PIL import Image  # pip install pillow (dev only)

URL = "http://localhost:8000/api/artifact"


def encode(path: Path) -> str:
    im = Image.open(path).convert("RGB")
    im.thumbnail((512, 512))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def main(folder: str) -> None:
    files = sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    for p in files:
        body = json.dumps({"imageBase64": encode(p)}).encode()
        req = urllib.request.Request(URL, body, {"Content-Type": "application/json"})
        t = time.time()
        res = json.load(urllib.request.urlopen(req, timeout=30))
        a = res["artifact"]
        print(f"{p.name:24} {time.time()-t:4.1f}s {res['source']:8} {a['object']:18} -> "
              f"{a['artifactName']} ({a['artifactType']}/{a['element']}/{a['ability']}, {a['rarity']}, dmg {a['damage']})")


if __name__ == "__main__":
    main(sys.argv[1])
