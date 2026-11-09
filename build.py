"""Build the static archive of the Hashofet Shopify store.

Reads the Shopify product export + the local image backup (one folder up),
writes optimized WebP images and data/products.json next to this file.

Usage:  python build.py
"""
import csv
import json
import re
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE.parent
CSV_PATH = next(SRC.glob("products_export*.csv"))
MANIFEST = SRC / "backup_assets" / "image_manifest.json"
LOGO = SRC / "backup_assets" / "theme_images" / "logo_f9f1face-5020-48d4-8c50-ca485988fbe3.png"

OUT_IMG = HERE / "img"
OUT_DATA = HERE / "data"
SIZES = {"full": 1000, "thumb": 480}

SPECIAL_WORDS = ("מהדורה", "מהודרה")
OPTION_SKIP = {"Title"}


def segments(title):
    return [s.strip() for s in title.split("|") if s.strip()]


def classify(segs):
    """Return (kind, season, start_year, tags) from title segments."""
    tags = set()
    joined = " ".join(segs)
    if any(w in joined for w in SPECIAL_WORDS):
        tags.add("special")
    if "ילדים" in joined:
        tags.add("kids")
    season, year, kind = None, None, None
    for s in segs[1:]:
        m = re.fullmatch(r"(\d{2})/(\d{2})", s)
        if m:
            season, kind = s, "club"
            y = int(m.group(1))
            year = 1900 + y if y > 50 else 2000 + y
            break
        m = re.fullmatch(r"(19|20)\d{2}", s)
        if m:
            season, kind, year = s, "national", int(s)
            break
    if year and year < 2020:
        tags.add("retro")
    return kind, season, year, tags


def convert(src, stem):
    out = {}
    with Image.open(src) as im:
        im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
        for name, px in SIZES.items():
            dst = OUT_IMG / name / f"{stem}.webp"
            if not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                cp = im.copy()
                cp.thumbnail((px, px), Image.LANCZOS)
                cp.save(dst, "WEBP", quality=80, method=4)
            out[name] = dst.relative_to(HERE).as_posix()
    return out


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))["product_images"]
    rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8")))

    products, order = {}, []
    for r in rows:
        h = r["Handle"]
        if h not in products:
            products[h] = {"rows": [], "images": []}
            order.append(h)
        p = products[h]
        p["rows"].append(r)
        for key in ("Image Src", "Variant Image"):
            u = r[key]
            if u and u not in p["images"]:
                p["images"].append(u)

    # Teams that appear with a 4-digit year are national teams.
    national = set()
    for h in order:
        head = products[h]["rows"][0]
        segs = segments(head["Title"])
        if classify(segs)[0] == "national":
            national.add(segs[0])

    out, img_index = [], 0
    for idx, h in enumerate(order):
        rs = products[h]["rows"]
        head = rs[0]
        if head["Status"] != "active" or head["Published"] != "true":
            continue
        segs = segments(head["Title"])
        kind, season, year, tags = classify(segs)
        if kind is None:
            kind = "national" if segs and segs[0] in national else ("club" if len(segs) > 1 and tags & {"special"} else "other")
        if kind == "other":
            tags.add("other")
        else:
            tags.add(kind)

        options = []
        for n in (1, 2, 3):
            name = head[f"Option{n} Name"]
            if not name or name in OPTION_SKIP:
                continue
            vals = []
            for r in rs:
                v = r[f"Option{n} Value"]
                if v and v not in vals:
                    vals.append(v)
            options.append({"name": name, "values": vals})

        prices = [float(r["Variant Price"]) for r in rs if r["Variant Price"]]
        compares = [float(r["Variant Compare At Price"]) for r in rs if r["Variant Compare At Price"]]

        images = []
        for u in products[h]["images"]:
            m = manifest.get(u)
            if not m:
                continue
            src = SRC / m["local_path"]
            if not src.exists():
                continue
            img_index += 1
            images.append(convert(src, f"{img_index:04d}"))
        sys.stdout.write(f"\r{idx + 1}/{len(order)}")

        out.append({
            "id": h,
            "title": head["Title"].strip(),
            "team": segs[0] if segs else head["Title"],
            "details": segs[1:],
            "season": season,
            "year": year,
            "kind": kind,
            "tags": sorted(tags),
            "price": min(prices) if prices else None,
            "compare": max(compares) if compares else None,
            "options": options,
            "images": images,
            "seo": head["SEO Description"].strip(),
            "order": idx,
        })

    OUT_DATA.mkdir(exist_ok=True)
    (OUT_DATA / "products.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    (HERE / "assets").mkdir(exist_ok=True)
    with Image.open(LOGO) as im:
        im = im.convert("RGBA")
        im = im.crop(im.getbbox())
        im.thumbnail((600, 600), Image.LANCZOS)
        im.save(HERE / "assets" / "logo.webp", "WEBP", quality=90)
        fav = Image.new("RGBA", (64, 64), (227, 252, 2, 255))
        fav.save(HERE / "assets" / "favicon.png")

    print(f"\n{len(out)} products, {img_index} images")


if __name__ == "__main__":
    main()
