// Step 2 of the archive build: renders the exported Shopify theme (theme/)
// into static HTML in docs/, using tools/catalog.json as the product data.
//
// Usage:  node tools/build.mjs            (SITE_BASE env var overrides the URL prefix)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Liquid, Drop, Tag, Value, Hash } from 'liquidjs';
import { collectionsConfig, mainMenu, pagesConfig, STORE } from './site.config.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEME = path.join(REPO, 'theme');
const OVERRIDES = path.join(REPO, 'tools', 'overrides');
const OUT = path.join(REPO, 'docs');
const BASE = process.env.SITE_BASE ?? STORE.base;

const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/^\s*\/\*[\s\S]*?\*\//, ''));
const enc = (p) => encodeURI(p);
const url = (p) => BASE + enc(p);

// ---------------------------------------------------------------- translations
const LOCALE = readJSON(path.join(THEME, 'locales', 'he.json'));
const LOCALE_EN = readJSON(path.join(THEME, 'locales', 'en.default.json'));
const SCHEMA_EN = readJSON(path.join(THEME, 'locales', 'en.default.schema.json'));
const dig = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function translate(key, args = {}) {
  let v = dig(LOCALE, key) ?? dig(LOCALE_EN, key);
  if (v == null) return key;
  if (typeof v === 'object') {
    const c = Number(args.count);
    v = (c === 0 && v.zero) || (c === 1 && v.one) || v.other || v.one || '';
  }
  return String(v).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (args[k] ?? ''));
}
const schemaT = (v) => (typeof v === 'string' && v.startsWith('t:') ? dig(SCHEMA_EN, v.slice(2)) ?? v : v);

// ---------------------------------------------------------------- drops
class Color extends Drop {
  constructor(hex) {
    super();
    let h = String(hex || '#000000').trim();
    let a = 1;
    let m = h.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const p = m[1].split(',').map((s) => parseFloat(s));
      [this.red, this.green, this.blue] = p;
      a = p[3] ?? 1;
    } else {
      h = h.replace('#', '');
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      this.red = parseInt(h.slice(0, 2), 16) || 0;
      this.green = parseInt(h.slice(2, 4), 16) || 0;
      this.blue = parseInt(h.slice(4, 6), 16) || 0;
      if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
    }
    this.alpha = a;
    this.rgb = `${this.red} ${this.green} ${this.blue}`;
    this.rgba = `${this.red} ${this.green} ${this.blue} / ${this.alpha}`;
    const [hh, s, l] = rgbToHsl(this.red, this.green, this.blue);
    this.hue = Math.round(hh); this.saturation = Math.round(s); this.lightness = Math.round(l);
  }
  get hex() { return '#' + [this.red, this.green, this.blue].map((n) => Math.round(n).toString(16).padStart(2, '0')).join(''); }
  valueOf() { return this.alpha < 1 ? `rgba(${this.red}, ${this.green}, ${this.blue}, ${this.alpha})` : this.hex; }
  toString() { return this.valueOf(); }
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
function hslToColor(h, s, l, a = 1) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const c = new Color('#000');
  Object.assign(c, new Color(`rgba(${Math.round(f(0) * 255)},${Math.round(f(8) * 255)},${Math.round(f(4) * 255)},${a})`));
  return c;
}
const toColor = (v) => (v instanceof Color ? v : new Color(String(v)));

class Font extends Drop {
  constructor(handle) {
    super();
    const [fam, var_] = String(handle || 'assistant_n4').split(/_(?=[ni]\d$)/);
    const families = { oswald: 'Oswald', avenir_next: 'Avenir Next', assistant: 'Assistant' };
    this.handle = handle;
    this.family = families[fam] || fam.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    this.fallback_families = 'sans-serif';
    this.style = var_?.[0] === 'i' ? 'italic' : 'normal';
    this.weight = Number(var_?.[1] || 4) * 100;
    this['system?'] = true; // no font preloading; families are loaded from Google Fonts
  }
  valueOf() { return this.handle; }
}

class ImageDrop extends Drop {
  // full/thumb: URLs; w/h: full-size dimensions
  constructor({ full, thumb, w, h, alt = '', id }) {
    super();
    this.src = full; this._thumb = thumb || full;
    this.width = w || 1000; this.height = h || 1000;
    this.aspect_ratio = this.width / this.height;
    this.alt = alt; this.id = id ?? Math.floor(Math.random() * 1e12);
    this.media_type = 'image'; this.preview_image = this; this.position = 1;
    this.presentation = { focal_point: null };
    this.attached_to_variant = false;
  }
  valueOf() { return this.src; }
  toJSON() { return { id: this.id, src: this.src, width: this.width, height: this.height, alt: this.alt, aspect_ratio: this.aspect_ratio }; }
}
const imageRegistry = new Map(); // url -> ImageDrop
function themeImage(ref) {
  // 'shopify://shop_images/x.png' -> local docs/files/x.png
  const name = String(ref).split('/').pop();
  const file = path.join(OUT, 'files', name);
  if (!fs.existsSync(file)) return null;
  const { w, h } = imageSize(file);
  return new ImageDrop({ full: url(`/files/${name}`), w, h });
}
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.slice(1, 4).toString() === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.slice(0, 4).toString() === 'RIFF') {
    const t = b.slice(12, 16).toString();
    if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === 'VP8L') { const n = b.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }; }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xc3) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return { w: 1000, h: 1000 };
}

let nextId = 9000000000;
class VariantDrop extends Drop {
  constructor(p, v, i) {
    super();
    this._p = p;
    this.id = p.id * 100 + i + 1;
    this.options = v.options;
    v.options.forEach((o, k) => { this[`option${k + 1}`] = o; });
    for (let k = v.options.length; k < 3; k++) this[`option${k + 1}`] = null;
    this.title = v.options.join(' / ') || 'Default Title';
    this.name = this.title;
    this.price = Math.round(v.price * 100);
    this.compare_at_price = v.compare ? Math.round(v.compare * 100) : null;
    this.sku = v.sku || '';
    this.barcode = '';
    this.inventory_management = v.tracker || null;
    this.inventory_policy = v.policy || 'deny';
    this.inventory_quantity = v.available ? 1 : 0;
    this.available = v.available;
    this.image = v.image != null ? p.images[v.image] : null;
    this.featured_image = this.image;
    this.featured_media = this.image;
    this.quantity_rule = { min: 1, max: null, increment: 1 };
    this.quantity_price_breaks = [];
    this.unit_price_measurement = null;
    this.requires_selling_plan = false;
    this.selling_plan_allocations = [];
    this.store_availabilities = [];
    this.requires_shipping = true;
    this.taxable = true;
    this.matched = true;
  }
  get url() { return `${this._p.url}?variant=${this.id}`; }
  get product() { return this._p; }
  valueOf() { return this.id; }
  toJSON() {
    return {
      id: this.id, title: this.title, option1: this.option1, option2: this.option2, option3: this.option3,
      sku: this.sku, requires_shipping: true, taxable: true, featured_image: this.image ? this.image.toJSON() : null,
      available: this.available, name: `${this._p.title} - ${this.title}`, public_title: this.title, options: this.options,
      price: this.price, weight: 0, compare_at_price: this.compare_at_price, inventory_management: this.inventory_management,
      barcode: '', featured_media: this.image ? { id: this.image.id, preview_image: this.image.toJSON() } : null,
      requires_selling_plan: false, selling_plan_allocations: [], quantity_rule: this.quantity_rule,
    };
  }
}

class ProductDrop extends Drop {
  constructor(c) {
    super();
    this._c = c;
    this.id = nextId + c.position;
    this.handle = c.handle;
    this.object_type = 'product';
    this.title = c.title;
    this.vendor = c.vendor;
    this.type = c.type;
    this.tags = c.tags;
    this.description = c.body_html;
    this.content = c.body_html;
    this.url = url(`/products/${c.handle}`);
    this.template_suffix = STORE.productTemplates[c.handle] || '';
    this.published = c.published && c.status === 'active';
    this.images = c.images.map((im, i) => new ImageDrop({
      full: url(`/img/full/${im.key}.webp`), thumb: url(`/img/thumb/${im.key}.webp`),
      w: im.w, h: im.h, alt: im.alt || c.title, id: this.id * 10 + i,
    }));
    this.images.forEach((im, i) => { im.position = i + 1; im.product_id = this.id; });
    this.media = this.images;
    this.featured_image = this.images[0] || null;
    this.featured_media = this.featured_image;
    const names = c.option_names;
    this.variants = c.variants.map((v, i) => new VariantDrop(this, v, i));
    this.has_only_default_variant = this.variants.length <= 1 && (names.length === 0 || names[0] === 'Title');
    this.options = this.has_only_default_variant ? ['Title'] : names;
    const prices = this.variants.map((v) => v.price);
    const cmp = this.variants.map((v) => v.compare_at_price || 0);
    this.price = Math.min(...prices, Infinity) === Infinity ? 0 : Math.min(...prices);
    this.price_min = this.price;
    this.price_max = Math.max(0, ...prices);
    this.price_varies = this.price_min !== this.price_max;
    this.compare_at_price = Math.min(...cmp.filter(Boolean), Infinity) === Infinity ? null : Math.min(...cmp.filter(Boolean));
    this.compare_at_price_min = this.compare_at_price || 0;
    this.compare_at_price_max = Math.max(0, ...cmp);
    this.compare_at_price_varies = this.compare_at_price_min !== this.compare_at_price_max;
    this.available = this.variants.some((v) => v.available);
    this.first_available_variant = this.variants.find((v) => v.available) || this.variants[0];
    this.selected_or_first_available_variant = this.first_available_variant;
    this.selected_variant = null;
    this['gift_card?'] = false;
    this['quantity_price_breaks_configured?'] = false;
    this.requires_selling_plan = false;
    this.selling_plan_groups = [];
    this.metafields = {};
    this.collections = [];
    this.options_with_values = this.has_only_default_variant ? [] : names.map((name, k) => {
      const vals = [...new Set(this.variants.map((v) => v.options[k]))];
      const sel = this.selected_or_first_available_variant?.options[k];
      const opt = { name, position: k + 1, selected_value: sel };
      opt.values = vals.map((val) => new OptionValueDrop(this, k, val, sel));
      return opt;
    });
    this.options_by_name = Object.fromEntries(this.options_with_values.map((o) => [o.name.toLowerCase(), o]));
  }
  valueOf() { return this.title; }
  toJSON() {
    return {
      id: this.id, title: this.title, handle: this.handle, description: this.description, vendor: this.vendor,
      type: this.type, tags: this.tags, price: this.price, price_min: this.price_min, price_max: this.price_max,
      available: this.available, price_varies: this.price_varies, compare_at_price: this.compare_at_price,
      compare_at_price_min: this.compare_at_price_min, compare_at_price_max: this.compare_at_price_max,
      compare_at_price_varies: this.compare_at_price_varies, variants: this.variants.map((v) => v.toJSON()),
      images: this.images.map((i) => i.src), featured_image: this.featured_image?.src ?? null,
      options: this.options, url: this.url, media: this.images.map((i) => ({ ...i.toJSON(), media_type: 'image', preview_image: i.toJSON() })),
    };
  }
}
class OptionValueDrop extends Drop {
  constructor(p, k, name, sel) {
    super();
    this.name = name;
    this.id = `${p.id}-${k}-${name}`;
    this.selected = name === sel;
    this.variant = p.variants.find((v) => v.options[k] === name) || null;
    this.available = p.variants.some((v) => v.options[k] === name && v.available);
    this.swatch = null;
    this.product_url = null;
  }
  valueOf() { return this.name; }
}

class CollectionDrop extends Drop {
  constructor({ handle, title, products, description = '', image = null, template = '' }) {
    super();
    this.id = nextId++;
    this.handle = handle;
    this.title = title;
    this.description = description;
    this.url = url(`/collections/${handle}`);
    this._all = products;
    this._page = null;
    this.image = image;
    this.featured_image = image || products[0]?.featured_image || null;
    this.template_suffix = template;
    this.sort_by = 'manual';
    this.default_sort_by = 'manual';
    this.sort_options = [];
    this.filters = [];
    this.current_vendor = null;
    this.current_type = null;
    this.all_tags = [];
    this.tags = [];
    this.metafields = {};
  }
  get products() { return this._page || this._all; }
  get products_count() { return this._all.length; }
  get all_products_count() { return this._all.length; }
  valueOf() { return this.title; }
}

class Link extends Drop {
  constructor({ title, url: u, links = [] }) {
    super();
    this.title = title;
    this.url = u.startsWith('http') || u.startsWith('#') ? u : url(u);
    this.links = links.map((l) => new Link(l));
    this.levels = this.links.length ? 1 + Math.max(...this.links.map((l) => l.levels)) : 0;
    this.active = false; this.current = false; this.child_active = false; this.child_current = false;
    this.handle = title; this.type = 'http_link';
  }
  valueOf() { return this.title; }
}
class LinkList extends Drop {
  constructor(handle, title, links) { super(); this.handle = handle; this.title = title; this.links = links.map((l) => new Link(l)); this.levels = Math.max(0, ...this.links.map((l) => l.levels + 1)); }
  valueOf() { return this.handle; }
}

class ColorScheme extends Drop {
  constructor(id, settings) { super(); this.id = id; this.settings = settings; }
  valueOf() { return this.id; }
}

// ---------------------------------------------------------------- data
const catalog = readJSON(path.join(REPO, 'tools', 'catalog.json'));
const products = catalog.map((c) => new ProductDrop(c));
const listed = products.filter((p) => p.published);
const productsByHandle = Object.fromEntries(products.map((p) => [p.handle, p]));

const collections = collectionsConfig(listed).map((c) => new CollectionDrop({
  ...c, image: c.image ? themeImage(c.image) : null,
}));
const collectionsByHandle = Object.fromEntries(collections.map((c) => [c.handle, c]));
for (const c of collections) for (const p of c._all) p.collections.push(c);
const collectionsList = Object.assign([...collections.filter((c) => c.handle !== 'all')], collectionsByHandle);
collectionsList._page = null;

const linklists = {
  'main-menu': new LinkList('main-menu', 'Main menu', mainMenu(collections)),
  footer: new LinkList('footer', 'Footer', []),
};

const pages = Object.fromEntries(pagesConfig.map((p) => [p.handle, {
  id: nextId++, handle: p.handle, title: p.title, content: '', url: url(`/pages/${p.handle}`),
  template_suffix: p.template, author: '', published_at: null, path: p.path,
}]));

// ---------------------------------------------------------------- settings
const schemaSettings = readJSON(path.join(THEME, 'config', 'settings_schema.json')).flatMap((g) => g.settings || []);
const dataRaw = readJSON(path.join(THEME, 'config', 'settings_data.json'));
const current = typeof dataRaw.current === 'string' ? dataRaw.presets[dataRaw.current] : dataRaw.current;

function convertSetting(type, v) {
  if (v == null || v === '') return v === '' && ['image_picker', 'collection', 'product', 'page', 'link_list', 'url', 'video', 'blog', 'article'].includes(type) ? null : v;
  switch (type) {
    case 'color': case 'color_background': return type === 'color' ? (String(v).trim() ? new Color(v) : null) : v;
    case 'font_picker': return new Font(v);
    case 'image_picker': return themeImage(v);
    case 'collection': return collectionsByHandle[v] || null;
    case 'collection_list': return (v || []).map((h) => collectionsByHandle[h]).filter(Boolean);
    case 'product': return productsByHandle[v] || null;
    case 'product_list': return (v || []).map((h) => productsByHandle[h]).filter(Boolean);
    case 'page': return pages[v] || null;
    case 'link_list': return linklists[v] || null;
    case 'url': return resolveUrl(v);
    case 'text': case 'textarea': case 'richtext': case 'inline_richtext': case 'html': case 'liquid': return schemaT(v);
    default: return schemaT(v);
  }
}
function resolveUrl(v) {
  const m = String(v).match(/^shopify:\/\/(\w+)\/?(.*)$/);
  if (!m) return v;
  const [, kind, h] = m;
  if (kind === 'collections') return url(h && h !== 'all' ? `/collections/${h}` : '/collections/all');
  if (kind === 'products') return url(`/products/${h}`);
  if (kind === 'pages') return url(`/pages/${h}`);
  if (kind === 'blogs' || kind === 'articles') return url('/');
  return url('/');
}
function applySchema(defs, values) {
  const out = {};
  for (const d of defs) {
    if (!d.id) continue;
    const raw = values && d.id in values ? values[d.id] : d.default;
    out[d.id] = convertSetting(d.type, raw);
  }
  for (const [k, v] of Object.entries(values || {})) if (!(k in out)) out[k] = v;
  return out;
}
const settings = applySchema(schemaSettings, current);
// color schemes
const csDef = schemaSettings.find((s) => s.type === 'color_scheme_group');
const schemes = Object.entries(current.color_schemes || {}).map(([id, s]) => {
  const vals = {};
  for (const d of csDef.definition) {
    const raw = s.settings?.[d.id] ?? d.default;
    vals[d.id] = d.type === 'color' ? new Color(raw) : raw;
  }
  return new ColorScheme(id, vals);
});
settings.color_schemes = Object.assign(schemes, Object.fromEntries(schemes.map((s) => [s.id, s])));
// static archive tweaks: no cart drawer, no predictive search, no customer accounts
settings.cart_type = 'page';
settings.predictive_search_enabled = false;

// ---------------------------------------------------------------- engine
// Shopify divides integers as integers unless the divisor is a float literal
// (e.g. "divided_by: 100.0"); liquidjs can't tell 100.0 from 100, so mark them.
const xf = (src) => src.replace(/divided_by:s*(d+).d+/g, 'divided_by_float: $1');
const themeFs = {
  existsSync: (f) => fs.existsSync(f),
  exists: async (f) => fs.existsSync(f),
  readFileSync: (f) => xf(fs.readFileSync(f, 'utf8')),
  readFile: async (f) => xf(fs.readFileSync(f, 'utf8')),
  resolve: (root, file, ext) => path.resolve(root, path.extname(file) ? file : file + ext),
  contains: (root, file) => path.resolve(file).startsWith(path.resolve(root)),
  sep: path.sep,
  dirname: path.dirname,
};
const engine = new Liquid({
  fs: themeFs,
  root: [OVERRIDES, THEME],
  partials: [path.join(OVERRIDES, 'snippets'), path.join(THEME, 'snippets')],
  extname: '.liquid',
  strictFilters: false,
  strictVariables: false,
  ownPropertyOnly: false,
  jsTruthy: false,
  dynamicPartials: true,
  relativeReference: false,
  cache: true,
  greedy: false,
});

const sectionCache = new Map(); // type -> { tpl, schema }
function loadSection(type) {
  if (sectionCache.has(type)) return sectionCache.get(type);
  const f = [path.join(OVERRIDES, 'sections', `${type}.liquid`), path.join(THEME, 'sections', `${type}.liquid`)].find(fs.existsSync);
  if (!f) { sectionCache.set(type, null); return null; }
  let src = xf(fs.readFileSync(f, 'utf8'));
  let schema = {};
  src = src.replace(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/, (_, j) => { try { schema = JSON.parse(j); } catch { } return ''; });
  src = src.replace(/\{%-?\s*(javascript|stylesheet)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g, '');
  const entry = { tpl: engine.parse(src, f), schema };
  sectionCache.set(type, entry);
  return entry;
}

let renderStack = []; // current page info for paginate
async function renderSection(id, data, scope, { groupName = null, wrap = true } = {}) {
  if (!data || data.disabled) return '';
  if (String(data.type).startsWith('shopify://apps') || data.type === 'apps') return '';
  const sec = loadSection(data.type);
  if (!sec) return '';
  const schema = sec.schema;
  const blockDefs = Object.fromEntries((schema.blocks || []).map((b) => [b.type, b]));
  const order = data.block_order || Object.keys(data.blocks || {});
  const blocks = order.map((bid) => {
    const b = data.blocks[bid];
    if (!b || b.disabled || String(b.type).startsWith('shopify://apps') || b.type === '@app') return null;
    return { id: bid, type: b.type, settings: applySchema(blockDefs[b.type]?.settings || [], b.settings), shopify_attributes: '' };
  }).filter(Boolean);
  const fullId = groupName ? `sections--archive__${id}` : `template--archive__${id}`;
  const section = {
    id: fullId, settings: applySchema(schema.settings || [], data.settings), blocks,
    index: scope.__sectionIndex = (scope.__sectionIndex || 0) + 1, location: groupName || 'template',
  };
  section.blocks.size = blocks.length;
  // settings of type "liquid" are evaluated by Shopify before the section renders
  const liquidIds = (defs) => (defs || []).filter((d) => d.type === 'liquid').map((d) => d.id);
  for (const id of liquidIds(schema.settings)) {
    if (section.settings[id]) section.settings[id] = await engine.parseAndRender(xf(section.settings[id]), { ...scope, section }, { globals: { ...scope, section } });
  }
  for (const b of blocks) {
    for (const id of liquidIds(blockDefs[b.type]?.settings)) {
      if (b.settings[id]) b.settings[id] = await engine.parseAndRender(xf(b.settings[id]), { ...scope, section, block: b }, { globals: { ...scope, section } });
    }
  }
  const html = await engine.render(sec.tpl, { ...scope, section }, { globals: { ...scope, section } });
  if (!wrap) return html;
  const cls = ['shopify-section', groupName ? `shopify-section-group-${groupName}` : '', schema.class || ''].filter(Boolean).join(' ');
  const tag = schema.tag || (groupName ? 'div' : 'section');
  return `<${tag} id="shopify-section-${fullId}" class="${cls}">${html}</${tag}>`;
}

async function renderGroup(name, scope) {
  const g = readJSON(path.join(THEME, 'sections', `${name}.json`));
  const out = [];
  for (const id of g.order) out.push(await renderSection(id, g.sections[id], scope, { groupName: name }));
  return out.join('');
}

// ---- tags
engine.registerTag('schema', { parse(tok, remain) { this.tpls = []; const s = this.liquid.parser.parseStream(remain); s.on('tag:endschema', () => s.stop()).on('template', () => { }).on('end', () => { }); s.start(); }, render() { return ''; } });
for (const name of ['javascript', 'stylesheet']) {
  engine.registerTag(name, { parse(tok, remain) { const s = this.liquid.parser.parseStream(remain); s.on(`tag:end${name}`, () => s.stop()).on('template', () => { }).on('end', () => { }); s.start(); }, render() { return ''; } });
}
engine.registerTag('style', {
  parse(tok, remain) {
    this.tpls = [];
    const s = this.liquid.parser.parseStream(remain);
    s.on('tag:endstyle', () => s.stop()).on('template', (t) => this.tpls.push(t)).on('end', () => { throw new Error('style not closed'); });
    s.start();
  },
  *render(ctx, emitter) {
    emitter.write('<style data-shopify>');
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    emitter.write('</style>');
  },
});
engine.registerTag('include', {
  parse(tok) { this.name = tok.args.trim().split(/[\s,]/)[0].replace(/['"]/g, ''); },
  render() { return ''; }, // only used for the Locksmith app
});
engine.registerTag('sections', {
  parse(tok) { this.name = tok.args.trim().replace(/['"]/g, ''); },
  *render(ctx) { return yield renderGroup(this.name, ctx.getAll()); },
});
engine.registerTag('section', {
  parse(tok) { this.name = tok.args.trim().replace(/['"]/g, ''); },
  *render(ctx) { return yield renderSection(this.name, { type: this.name, settings: {} }, ctx.getAll()); },
});

function splitArgs(s) {
  const out = []; let cur = ''; let q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
engine.registerTag('form', {
  parse(tok, remain) {
    const args = splitArgs(tok.args);
    this.type = args.shift().replace(/['"]/g, '');
    this.attrs = [];
    this.obj = null;
    for (const a of args) {
      const m = a.match(/^([\w-]+)\s*:\s*(.+)$/);
      if (m) this.attrs.push([m[1], m[2]]); else this.obj = a;
    }
    this.tpls = [];
    const s = this.liquid.parser.parseStream(remain);
    s.on('tag:endform', () => s.stop()).on('template', (t) => this.tpls.push(t)).on('end', () => { throw new Error('form not closed'); });
    s.start();
  },
  *render(ctx, emitter) {
    const attrs = {};
    for (const [k, expr] of this.attrs) attrs[k] = yield this.liquid.evalValue(expr, ctx);
    const actions = { product: '/cart/add', contact: '/contact', localization: '/localization', customer: '/contact#contact_form', create_customer: '/account', customer_login: '/account/login' };
    const action = BASE + (actions[this.type] || '/');
    const id = attrs.id || `${this.type}_form`;
    let html = `<form method="post" action="${action}" id="${id}" accept-charset="UTF-8"`;
    for (const [k, v] of Object.entries(attrs)) if (k !== 'id' && k !== 'return_to') html += ` ${k}="${v}"`;
    if (this.type === 'product') html += ' enctype="multipart/form-data"';
    html += `><input type="hidden" name="form_type" value="${this.type}" /><input type="hidden" name="utf8" value="✓" />`;
    emitter.write(html);
    ctx.push({ form: { id, errors: null, 'posted_successfully?': false, email: '', name: '', body: '', phone: '' } });
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    ctx.pop();
    emitter.write('</form>');
  },
});

engine.registerTag('paginate', {
  parse(tok, remain) {
    const m = tok.args.match(/^\s*(.+?)\s+by\s+(.+?)\s*$/);
    this.expr = m[1]; this.by = m[2];
    this.tpls = [];
    const s = this.liquid.parser.parseStream(remain);
    s.on('tag:endpaginate', () => s.stop()).on('template', (t) => this.tpls.push(t)).on('end', () => { throw new Error('paginate not closed'); });
    s.start();
  },
  *render(ctx, emitter) {
    const size = Number(yield this.liquid.evalValue(this.by, ctx)) || 50;
    const dot = this.expr.lastIndexOf('.');
    const owner = dot > 0 ? yield this.liquid.evalValue(this.expr.slice(0, dot), ctx) : null;
    const all = (yield this.liquid.evalValue(this.expr, ctx)) || [];
    const items = owner?._all ?? all;
    const page = ctx.getAll().__page || 1;
    const pages = Math.max(1, Math.ceil(items.length / size));
    const base = ctx.getAll().__pageBase;
    const pageUrl = (n) => (n === 1 ? base : `${base}/page-${n}`);
    if (owner && '_page' in owner) owner._page = items.slice((page - 1) * size, page * size);
    if (base) renderStack.push({ pages });
    const parts = [];
    for (let n = 1; n <= pages; n++) {
      if (pages > 7 && n !== 1 && n !== pages && Math.abs(n - page) > 2) {
        if (parts.at(-1)?.title !== '&hellip;') parts.push({ title: '&hellip;', is_link: false });
        continue;
      }
      parts.push({ title: String(n), url: pageUrl(n), is_link: n !== page });
    }
    const paginate = {
      current_page: page, current_offset: (page - 1) * size, items: items.length, page_size: size, pages, parts,
      previous: page > 1 ? { title: '&laquo;', url: pageUrl(page - 1), is_link: true } : null,
      next: page < pages ? { title: '&raquo;', url: pageUrl(page + 1), is_link: true } : null,
    };
    // top-level lists (e.g. "collections") are replaced by the current page's slice
    ctx.push(dot > 0 ? { paginate } : { paginate, [this.expr.trim()]: Object.assign(all.slice((page - 1) * size, page * size), all) });
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    ctx.pop();
    if (owner && '_page' in owner) owner._page = null;
  },
});

// ---- filters
const F = (name, fn) => engine.registerFilter(name, fn);
F('t', (key, ...args) => {
  const named = {};
  for (const a of args) if (Array.isArray(a)) named[a[0]] = a[1];
  return translate(String(key), named);
});
const asImage = (v) => {
  if (!v) return null;
  if (v instanceof ImageDrop) return v;
  if (v instanceof ProductDrop || v instanceof VariantDrop) return v.featured_image || v.image || null;
  if (v instanceof CollectionDrop) return v.featured_image;
  if (typeof v === 'string') return imageRegistry.get(v) || v;
  return v.preview_image || v.image || v.src || null;
};
function imageUrl(v, ...args) {
  const im = asImage(v);
  if (!im) return '';
  if (typeof im === 'string') return im;
  const opts = Object.fromEntries(args.filter(Array.isArray));
  let w = Number(opts.width || 0);
  if (!w && typeof args[0] === 'string') w = parseInt(args[0]) || 0; // img_url: '200x'
  const u = w && w <= 480 ? im._thumb : im.src;
  const out = u.includes('?') ? u : `${u}?v=1`;
  imageRegistry.set(out, im);
  return out;
}
F('image_url', imageUrl);
F('img_url', imageUrl);
F('product_img_url', imageUrl);
F('collection_img_url', imageUrl);
F('image_tag', (u, ...args) => {
  const opts = Object.fromEntries(args.filter(Array.isArray));
  const im = imageRegistry.get(u);
  const attrs = {};
  let w = im?.width, h = im?.height;
  if (opts.width && im) { w = Number(opts.width); h = Math.round(w / im.aspect_ratio); }
  if (opts.height && !opts.width && im) { h = Number(opts.height); w = Math.round(h * im.aspect_ratio); }
  attrs.src = u;
  attrs.alt = opts.alt ?? im?.alt ?? '';
  if (im && im._thumb !== im.src && opts.widths !== '' ) attrs.srcset = `${im._thumb}?v=1 480w, ${im.src}?v=1 ${im.width}w`;
  if (w) attrs.width = w;
  if (h) attrs.height = h;
  for (const [k, v] of Object.entries(opts)) {
    if (['width', 'height', 'alt', 'widths', 'preload'].includes(k)) continue;
    if (v === false || v == null) continue;
    attrs[k] = v;
  }
  const tag = '<img ' + Object.entries(attrs).map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ') + '>';
  safeHtml.add(tag);
  return tag;
});
// Shopify marks image_tag output as HTML-safe, so a following "| escape" is a no-op
const safeHtml = new Set();
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
F('escape', (s) => (safeHtml.has(s) ? s : escapeHtml(s)));
F('placeholder_svg_tag', (name, cls = '') => `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 525.5 525.5"><rect width="525.5" height="525.5" fill="#efece3"/></svg>`);
F('asset_url', (name) => url(`/assets/${name}`) + '?v=1');
F('asset_img_url', (name) => url(`/assets/${name}`) + '?v=1');
F('file_url', (name) => url(`/files/${name}`));
F('file_img_url', (name) => url(`/files/${name}`));
F('shopify_asset_url', (name) => url(`/assets/${name}`));
F('global_asset_url', (name) => url(`/assets/${name}`));
F('stylesheet_tag', (u) => `<link href="${u}" rel="stylesheet" type="text/css" media="all" />`);
F('script_tag', (u) => `<script src="${u}" type="text/javascript"></script>`);
F('preload_tag', (u) => `<link href="${u}" rel="preload" as="style">`);
F('inline_asset_content', (name) => { try { return fs.readFileSync(path.join(THEME, 'assets', name), 'utf8'); } catch { return ''; } });
F('font_face', () => '');
F('font_url', () => '');
F('font_modify', (font, prop, val) => {
  if (!(font instanceof Font)) return font;
  const f = new Font(font.handle);
  if (prop === 'weight') f.weight = val === 'bold' ? 700 : val === 'bolder' ? Math.min(900, f.weight + 300) : Number(val) || f.weight;
  if (prop === 'style') f.style = val;
  return f;
});
F('color_to_rgb', (c) => { const x = toColor(c); return `rgb(${x.red}, ${x.green}, ${x.blue})`; });
F('color_to_hex', (c) => toColor(c).hex);
F('color_to_hsl', (c) => { const x = toColor(c); return `hsl(${x.hue}, ${x.saturation}%, ${x.lightness}%)`; });
F('color_extract', (c, k) => toColor(c)[k]);
F('color_brightness', (c) => { const x = toColor(c); return (x.red * 299 + x.green * 587 + x.blue * 114) / 1000; });
F('color_lighten', (c, n) => { const x = toColor(c); return hslToColor(x.hue, x.saturation, Math.min(100, x.lightness + Number(n)), x.alpha); });
F('color_darken', (c, n) => { const x = toColor(c); return hslToColor(x.hue, x.saturation, Math.max(0, x.lightness - Number(n)), x.alpha); });
F('color_saturate', (c, n) => { const x = toColor(c); return hslToColor(x.hue, Math.min(100, x.saturation + Number(n)), x.lightness, x.alpha); });
F('color_desaturate', (c, n) => { const x = toColor(c); return hslToColor(x.hue, Math.max(0, x.saturation - Number(n)), x.lightness, x.alpha); });
F('color_modify', (c, k, v) => {
  const x = toColor(c);
  if (k === 'alpha') return new Color(`rgba(${x.red},${x.green},${x.blue},${v})`);
  if (['red', 'green', 'blue'].includes(k)) { const y = new Color(x.hex); y[k] = Number(v); return new Color(`rgba(${y.red},${y.green},${y.blue},${x.alpha})`); }
  const hsl = { hue: x.hue, saturation: x.saturation, lightness: x.lightness, [k]: Number(v) };
  return hslToColor(hsl.hue, hsl.saturation, hsl.lightness, x.alpha);
});
F('color_mix', (a, b, w) => {
  const x = toColor(a), y = toColor(b), p = Number(w) / 100;
  return new Color(`rgba(${Math.round(x.red * p + y.red * (1 - p))},${Math.round(x.green * p + y.green * (1 - p))},${Math.round(x.blue * p + y.blue * (1 - p))},${x.alpha * p + y.alpha * (1 - p)})`);
});
F('color_contrast', (a, b) => {
  const L = (c) => { const x = toColor(c); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(x.red) + 0.7152 * f(x.green) + 0.0722 * f(x.blue); };
  const [l1, l2] = [L(a), L(b)].sort((m, n) => n - m);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 10) / 10;
});
const fmtAmount = (cents, trim) => {
  const n = Number(cents || 0) / 100;
  let s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (trim) s = s.replace(/\.00$/, '');
  return s;
};
F('money', (c) => STORE.moneyFormat.replace('{{amount}}', fmtAmount(c)));
F('money_with_currency', (c) => STORE.moneyFormat.replace('{{amount}}', fmtAmount(c)) + ' ILS');
F('money_without_currency', (c) => fmtAmount(c));
F('money_without_trailing_zeros', (c) => STORE.moneyFormat.replace('{{amount}}', fmtAmount(c, true)));
const handleize = (s) => String(s ?? '').toLowerCase().trim().replace(/['"״׳().,!?:;/\\|]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
F('handle', handleize);
F('handleize', handleize);
F('url_encode', (s) => encodeURIComponent(String(s ?? '')).replace(/%20/g, '+'));
F('url_escape', (s) => encodeURI(String(s ?? '')));
F('url_param_escape', (s) => encodeURIComponent(String(s ?? '')));
F('link_to', (text, href, title = '') => `<a href="${href}" title="${title}">${text}</a>`);
F('within', (u) => u);
F('default_errors', () => '');
F('payment_type_svg_tag', () => '');
F('payment_type_img_url', () => '');
F('payment_button', () => '');
F('payment_terms', () => '');
F('login_button', () => '');
F('structured_data', () => '');
F('external_video_url', () => '');
F('external_video_tag', () => '');
F('video_tag', () => '');
F('media_tag', () => '');
F('model_viewer_tag', () => '');
F('format_address', () => '');
F('hmac_sha1', () => '');
F('hmac_sha256', () => '');
F('item_count_for_variant', () => 0);
F('line_items_for', () => []);
F('highlight', (s) => s);
F('highlight_active_tag', (s) => s);
F('avatar', () => '');
F('time_tag', (d) => String(d ?? ''));
F('pluralize', (n, one, many) => (Number(n) === 1 ? one : many));
F('divided_by', (a, b) => {
  const x = Number(a), y = Number(b);
  return Number.isInteger(x) && Number.isInteger(y) && !String(b).includes('.') ? Math.floor(x / y) : x / y;
});
F('divided_by_float', (a, b) => Number(a) / Number(b));
F('camelize', (s) => String(s).replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')));
F('json', (v) => JSON.stringify(v ?? null, (k, val) => (val instanceof Drop && typeof val.toJSON !== 'function' ? (typeof val.valueOf() === 'object' ? undefined : val.valueOf()) : val)));

// ---------------------------------------------------------------- page rendering
const layoutSrc = fs.readFileSync(path.join(THEME, 'layout', 'theme.liquid'), 'utf8');
const layoutTpl = engine.parse(xf(layoutSrc));

const shop = {
  name: STORE.name, url: STORE.siteUrl, domain: '', description: '', currency: 'ILS', money_format: STORE.moneyFormat,
  customer_accounts_enabled: false, customer_accounts_optional: true, enabled_payment_types: [], policies: [],
  metafields: {}, vendors: [STORE.vendor], types: [], 'features': { 'follow_on_shop?': false, 'login_with_shop_classic_customer_accounts?': false },
  checkout: { guest_login: false }, shipping_policy: null, refund_policy: null, privacy_policy: null, terms_of_service: null,
  locale: 'he', permanent_domain: '', password_message: '',
};
const routes = {
  root_url: BASE + '/', account_url: '#', account_login_url: '#', account_logout_url: '#', account_register_url: '#',
  account_addresses_url: '#', collections_url: url('/collections'), all_products_collection_url: url('/collections/all'),
  search_url: url('/search'), predictive_search_url: url('/search/suggest'), cart_url: url('/cart'), cart_add_url: url('/cart/add'),
  cart_change_url: url('/cart/change'), cart_update_url: url('/cart/update'), cart_clear_url: url('/cart/clear'),
  product_recommendations_url: url('/recommendations/products'),
};
const globals = {
  settings, shop, routes, linklists, pages, blogs: {}, articles: {},
  collections: collectionsList, all_products: productsByHandle,
  cart: { item_count: 0, items: [], total_price: 0, original_total_price: 0, items_subtotal_price: 0, 'empty?': true, note: '', attributes: {}, currency: { iso_code: 'ILS', symbol: '₪' }, cart_level_discount_applications: [], discount_applications: [], requires_shipping: false, taxes_included: true, duties_included: false },
  customer: null,
  localization: { available_countries: [], available_languages: [], country: { iso_code: 'IL', name: 'ישראל', currency: { iso_code: 'ILS', symbol: '₪' } }, language: { iso_code: 'he', endonym_name: 'עברית' } },
  powered_by_link: '', content_for_additional_checkout_buttons: '', additional_checkout_buttons: false,
  canonical_url: '', current_tags: null, current_page: 1, scripts: {}, 'predictive_search': {},
};

const headExtra = `
<script>
  window.Shopify = window.Shopify || { designMode: false, routes: { root: ${JSON.stringify(BASE + '/')} }, locale: 'he', country: 'IL', currency: { active: 'ILS', rate: '1.0' }, shop: '', theme: { name: 'Ride' } };
</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500&display=swap" rel="stylesheet">
<link href="${url('/archive/archive.css')}?v=1" rel="stylesheet">
<script src="${url('/archive/archive.js')}?v=1" defer></script>`;

const written = [];
async function renderPage(outPath, { template, page_type, page_title, page_description = '', scope = {} }) {
  const tplPath = path.join(THEME, 'templates', `${template}.json`);
  const tpl = readJSON(tplPath);
  const pageScope = {
    ...globals, ...scope,
    template: { name: page_type, suffix: template.split('.').slice(1).join('.') || null, directory: null, toString() { return template; } },
    request: { page_type, design_mode: false, locale: { iso_code: 'he', root_url: BASE }, host: '', origin: STORE.siteUrl, path: scope.__pageBase || '/' },
    page_title, page_description, content_for_header: '',
  };
  pageScope.canonical_url = STORE.siteUrl + (scope.__pageBase || '/');
  let content = '';
  for (const id of tpl.order) content += await renderSection(id, tpl.sections[id], pageScope);
  let html = await engine.render(layoutTpl, { ...pageScope, content_for_layout: content }, { globals: pageScope });
  html = postProcess(html);
  const file = path.join(OUT, outPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  written.push(outPath);
}

const cdnMap = new Map();
function postProcess(html) {
  html = html.replace('</head>', headExtra + '\n</head>');
  // prefix root-relative URLs with the site base (custom sections hard-code /pages/...)
  if (BASE) {
    html = html.replace(/((?:href|src|action|data-url|data-product-url)\s*=\s*["'])\/(?!\/)/g, (m, a, off, s) =>
      s.startsWith(BASE + '/', off + a.length) ? m : `${a}${BASE}/`);
  }
  // Shopify CDN files used by the custom sections -> local copies in docs/cdn
  html = html.replace(/https?:\/\/cdn\.shopify\.com\/s\/files\/[^"'\s)<>\\,|]+/g, (u) => {
    const name = decodeURIComponent(u.split('?')[0].split('/').pop());
    cdnMap.set(u.split('?')[0], name);
    return url(`/cdn/${name.replace(/\.[^.]+$/, '')}.webp`);
  });
  html = html.replace(/<link[^>]+href=""[^>]*>/g, '');
  return html;
}

async function downloadCdn() {
  // originals are cached in tools/cdn-cache, optimize_cdn.py writes docs/cdn/*.webp
  const cache = path.join(REPO, 'tools', 'cdn-cache');
  fs.mkdirSync(cache, { recursive: true });
  const missing = [];
  for (const [u, name] of cdnMap) {
    const file = path.join(cache, name);
    if (fs.existsSync(file)) continue;
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error(r.status);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    } catch (e) { missing.push(`${u} (${e.message})`); }
  }
  if (missing.length) console.warn('CDN files not downloaded:\n  ' + missing.join('\n  '));
  const r = spawnSync('python', [path.join(REPO, 'tools', 'optimize_cdn.py')], { stdio: 'inherit' });
  if (r.status !== 0) console.warn('optimize_cdn.py failed');
}

function copyDir(src, dst, filter = () => true) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, path.join(dst, f), filter);
    else if (filter(f)) fs.copyFileSync(s, path.join(dst, f));
  }
}

// ---------------------------------------------------------------- build
async function paged(outBase, opts) {
  renderStack = [];
  await renderPage(`${outBase}.html`, { ...opts, scope: { ...opts.scope, __page: 1 } });
  const pagesCount = Math.max(1, ...renderStack.map((r) => r.pages));
  for (let n = 2; n <= pagesCount; n++) await renderPage(`${outBase}/page-${n}.html`, { ...opts, scope: { ...opts.scope, __page: n } });
}

async function main() {
  const only = process.argv[2];
  copyDir(path.join(THEME, 'assets'), path.join(OUT, 'assets'), (f) => !f.endsWith('.liquid'));
  copyDir(path.join(REPO, 'tools', 'archive'), path.join(OUT, 'archive'));

  const pageTitle = (t) => t;
  if (!only || only === 'home') {
    await renderPage('index.html', { template: 'index', page_type: 'index', page_title: STORE.name, page_description: STORE.description, scope: { __pageBase: '/' } });
  }
  if (!only || only === 'products') {
    for (const p of products) {
      const t = p.template_suffix ? `product.${p.template_suffix}` : 'product';
      const related = listed.filter((x) => x !== p && x._c.title.split('|')[0].trim() === p._c.title.split('|')[0].trim()).concat(listed.filter((x) => x !== p)).slice(0, 4);
      await renderPage(`products/${p.handle}.html`, {
        template: t, page_type: 'product', page_title: p._c.seo_title || p.title, page_description: p._c.seo_description,
        scope: { product: p, __pageBase: `/products/${p.handle}`, recommendations: { performed: true, products: [...new Set(related)], products_count: 4 } },
      });
      if (only) break;
    }
  }
  if (!only || only === 'collections') {
    for (const c of collections) {
      const t = c.template_suffix ? `collection.${c.template_suffix}` : 'collection';
      await paged(`collections/${c.handle}`, { template: t, page_type: 'collection', page_title: c.title, scope: { collection: c, __pageBase: BASE + enc(`/collections/${c.handle}`) } });
      if (only) break;
    }
    await paged('collections', { template: 'list-collections', page_type: 'list-collections', page_title: 'קולקציות', scope: { __pageBase: BASE + '/collections' } });
  }
  if (!only || only === 'pages') {
    for (const pg of Object.values(pages)) {
      const t = pg.template_suffix ? `page.${pg.template_suffix}` : 'page';
      await renderPage(pg.path || `pages/${pg.handle}.html`, { template: t, page_type: 'page', page_title: pg.title, scope: { page: pg, __pageBase: `/pages/${pg.handle}` } });
    }
  }
  if (!only || only === 'search') {
    // every product is rendered once; archive.js filters them by ?q= in the browser
    const search = { performed: true, results: listed, results_count: listed.length, terms: '', types: ['product'], filters: [], sort_options: [], sort_by: 'relevance', default_sort_by: 'relevance' };
    await renderPage('search.html', { template: 'search', page_type: 'search', page_title: 'חיפוש', scope: { search, __pageBase: '/search' } });
    await renderPage('404.html', { template: '404', page_type: '404', page_title: 'הדף לא נמצא', scope: { __pageBase: '/404' } });
    fs.writeFileSync(path.join(OUT, 'search-index.json'), JSON.stringify(listed.map((p) => ({
      t: p.title, u: p.url, i: p.featured_image ? p.featured_image._thumb : null, p: p.price, c: p.compare_at_price,
    }))));
  }
  await downloadCdn();
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  console.log(`rendered ${written.length} pages, ${cdnMap.size} CDN files`);
}
main().catch((e) => { console.error(e); process.exit(1); });
