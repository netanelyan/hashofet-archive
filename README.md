# Hashofet archive

Static showcase of the Hashofet (חנות השופט) Shopify store. No cart, no orders, display only.

- `index.html`, `assets/` – the site (vanilla HTML/CSS/JS, RTL Hebrew)
- `data/products.json` – product catalog (titles, options, last prices, image paths)
- `img/full`, `img/thumb` – product images converted to WebP
- `build.py` – regenerates `data/` and `img/` from the Shopify product export and the image backup in the parent folder

## Rebuild

```
pip install pillow
python build.py
```

## Hosting

Enable GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.

To preview locally: `python -m http.server` and open http://localhost:8000.
