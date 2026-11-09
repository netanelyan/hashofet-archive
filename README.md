# Hashofet archive

A static copy of the Hashofet (חנות השופט) Shopify store, rendered from the store's own
theme ("Ride" 14.0.0) so it looks the same as the live shop. The store is closed:
buy buttons read "החנות סגורה", cart requests are blocked and a notice bar sits on top.

## Layout

- `docs/` – the generated site (served by GitHub Pages)
- `theme/` – the exported Shopify theme, unmodified
- `tools/build_catalog.py` – products CSV + image backup → `tools/catalog.json`, `docs/img/`
- `tools/build.mjs` – renders the theme with liquidjs (Shopify tags, filters and objects shimmed)
- `tools/site.config.mjs` – data the theme export doesn't include: collections, main menu, pages
- `tools/overrides/` – theme files replaced for archive mode (buy buttons)
- `tools/archive/` – archive-mode CSS/JS (closed notice, cart blocking, static search)
- `tools/cdn-cache/` – original images the custom sections loaded from Shopify's CDN

## Rebuild

The product export (`products_export*.csv`) and `backup_assets/` are expected in the folder above the repo.

```
pip install pillow
cd tools && npm install && cd ..
python tools/build_catalog.py
node tools/build.mjs
node tools/serve.mjs        # preview at http://localhost:8000/hashofet-archive/
```

For a custom domain at the root, build with `SITE_BASE=''` (and update `STORE.siteUrl`).

## Hosting

GitHub Pages: Settings → Pages → Deploy from a branch → `main` / `/docs`.
