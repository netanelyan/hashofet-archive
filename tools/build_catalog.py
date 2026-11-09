"""Step 1 of the archive build.

Reads the Shopify product export + local image backup (in the folder above the
repo) and writes:
  docs/img/full/*.webp, docs/img/thumb/*.webp   optimized product images
  docs/files/*                                  theme images (logo etc.)
  tools/catalog.json                            product data for the renderer

Usage: python tools/build_catalog.py
"""
import csv
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
SRC = REPO.parent
CSV_PATH = next(SRC.glob("products_export*.csv"))
MANIFEST = SRC / "backup_assets" / "image_manifest.json"
DOCS = REPO / "docs"
SIZES = {"full": 1000, "thumb": 480}


def convert(src: Path, stem: str):
    dims = None
    for name, px in SIZES.items():
        dst = DOCS / "img" / name / f"{stem}.webp"
        if dst.exists():
            if name == "full":
                with Image.open(dst) as im:
                    dims = im.size
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(src) as im:
            im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
            im.thumbnail((px, px), Image.LANCZOS)
            im.save(dst, "WEBP", quality=80, method=4)
            if name == "full":
                dims = im.size
    return dims


def num(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    pimgs = manifest["product_images"]
    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8")))

    groups, order = {}, []
    for r in rows:
        h = r["Handle"]
        if h not in groups:
            groups[h] = []
            order.append(h)
        groups[h].append(r)

    products = []
    for pos, h in enumerate(order):
        rs = groups[h]
        head = rs[0]
        if head["Status"] not in ("active", "unlisted"):
            continue

        # images, in Image Position order, plus variant images
        urls = []
        for r in sorted((r for r in rs if r["Image Src"]), key=lambda r: int(r["Image Position"] or 0)):
            if r["Image Src"] not in urls:
                urls.append(r["Image Src"])
        for r in rs:
            if r["Variant Image"] and r["Variant Image"] not in urls:
                urls.append(r["Variant Image"])
        alts = {r["Image Src"]: r["Image Alt Text"] for r in rs if r["Image Src"]}
        images = []
        for u in urls:
            m = pimgs.get(u)
            if not m or not (SRC / m["local_path"]).exists():
                continue
            stem = Path(m["filename"]).stem[:12]
            dims = convert(SRC / m["local_path"], stem)
            images.append({"key": stem, "src_url": u, "w": dims[0], "h": dims[1], "alt": alts.get(u, "")})
        img_index = {im["src_url"]: i for i, im in enumerate(images)}

        option_names = [head[f"Option{n} Name"] for n in (1, 2, 3) if head[f"Option{n} Name"]]
        variants = []
        for r in rs:
            if not r["Variant Price"] and not r["Option1 Value"]:
                continue
            variants.append({
                "options": [r[f"Option{n} Value"] for n in range(1, len(option_names) + 1)],
                "price": num(r["Variant Price"], 0),
                "compare": num(r["Variant Compare At Price"]),
                "sku": r["Variant SKU"],
                "available": (not r["Variant Inventory Tracker"]) or num(r["Variant Inventory Qty"], 0) > 0 or r["Variant Inventory Policy"] == "continue",
                "tracker": r["Variant Inventory Tracker"],
                "policy": r["Variant Inventory Policy"],
                "image": img_index.get(r["Variant Image"]),
            })

        products.append({
            "handle": h,
            "title": head["Title"].strip(),
            "body_html": head["Body (HTML)"],
            "vendor": head["Vendor"],
            "type": head["Type"],
            "tags": [t.strip() for t in head["Tags"].split(",") if t.strip()],
            "status": head["Status"],
            "published": head["Published"] == "true",
            "seo_title": head["SEO Title"],
            "seo_description": head["SEO Description"],
            "option_names": option_names,
            "variants": variants,
            "images": images,
            "position": pos,
        })
        sys.stdout.write(f"\r{pos + 1}/{len(order)}")

    (REPO / "tools" / "catalog.json").write_text(
        json.dumps(products, ensure_ascii=False, indent=0), encoding="utf-8")

    files = DOCS / "files"
    files.mkdir(parents=True, exist_ok=True)
    for name, m in manifest["theme_images"].items():
        src = SRC / m["local_path"]
        if src.exists() and not (files / name).exists():
            shutil.copy2(src, files / name)
    print(f"\n{len(products)} products")


if __name__ == "__main__":
    main()
