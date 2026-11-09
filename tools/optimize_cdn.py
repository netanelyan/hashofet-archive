"""Convert downloaded Shopify CDN files (tools/cdn-cache) to resized WebP in docs/cdn."""
import sys
from pathlib import Path
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
src_dir, out_dir = REPO / "tools" / "cdn-cache", REPO / "docs" / "cdn"
out_dir.mkdir(parents=True, exist_ok=True)
for f in src_dir.iterdir():
    dst = out_dir / (f.stem + ".webp")
    if dst.exists():
        continue
    try:
        with Image.open(f) as im:
            im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
            im.thumbnail((1600, 1600), Image.LANCZOS)
            im.save(dst, "WEBP", quality=80, method=4)
    except Exception as e:
        print("skip", f.name, e, file=sys.stderr)
