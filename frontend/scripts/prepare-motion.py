"""Mechanically split generated sprite sheets and align frames to a shared ground line.

Usage: python scripts/prepare-motion.py ranger /absolute/source.png
Requires Pillow and NumPy. Original artwork is never overwritten.
"""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('hero', choices=['ranger', 'mage'])
parser.add_argument('source', type=Path)
args = parser.parse_args()
source = Image.open(args.source).convert('RGBA')
pixels = np.asarray(source)
mask = pixels[:, :, 3] > 45
height, width = mask.shape
# The generated rows have deliberately different action heights. Search gutters
# locally per column, avoiding the legs/heads of adjacent animation rows.
guides = [0, 233, 438, 643, 808, 1027, 1254] if args.hero == 'ranger' else [0, 213, 421, 624, 787, 1003, 1254]
guides = [round(y / 1254 * height) for y in guides]
frames = []
for row in range(6):
    counts = mask[guides[row]:guides[row + 1]].sum(axis=0)
    xs = [0]
    for col in range(1, 5):
        center = round(width * col / 5)
        xs.append(min(range(center - 27, center + 28), key=lambda x: (counts[x], abs(x - center))))
    xs.append(width)
    row_frames = []
    for col in range(5):
        x0, x1 = xs[col:col + 2]
        ys = mask[:, x0:x1].sum(axis=1)
        top = 0 if row == 0 else min(range(guides[row] - 21, guides[row] + 22), key=lambda y: (ys[y], abs(y - guides[row])))
        bottom = height if row == 5 else min(range(guides[row + 1] - 21, guides[row + 1] + 22), key=lambda y: (ys[y], abs(y - guides[row + 1])))
        tile = source.crop((x0, top, x1, bottom))
        bbox = tile.getchannel('A').point(lambda a: 255 if a > 45 else 0).getbbox()
        if not bbox:
            raise ValueError(f'Empty frame {row}, {col}')
        row_frames.append(tile.crop(bbox))
    frames.append(row_frames)

factor = 196 / float(np.median([frame.height for frame in frames[0]]))
atlas = Image.new('RGBA', (1280, 1536))
for row, group in enumerate(frames):
    for col, frame in enumerate(group):
        frame = frame.resize((round(frame.width * factor), round(frame.height * factor)), Image.Resampling.LANCZOS)
        if frame.width > 250 or frame.height > 240:
            frame.thumbnail((250, 240), Image.Resampling.LANCZOS)
        atlas.alpha_composite(frame, (col * 256 + (256 - frame.width) // 2, row * 256 + 240 - frame.height))
output = Path(__file__).resolve().parents[1] / 'public' / 'art' / f'{args.hero}-motion.webp'
atlas.save(output, quality=90, method=6)
print(f'{output}: {atlas.width}x{atlas.height}, 30 aligned frames')
