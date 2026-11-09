// Local preview that behaves like GitHub Pages: site under /hashofet-archive,
// "/x" serves "x.html", "/dir/" serves "dir/index.html", 404.html otherwise.
// Usage: node tools/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE } from './site.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const BASE = process.env.SITE_BASE ?? STORE.base;
const PORT = Number(process.argv[2] || 8000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.woff2': 'font/woff2' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (BASE && !p.startsWith(BASE)) { res.writeHead(302, { Location: BASE + '/' }); return res.end(); }
  p = p.slice(BASE.length) || '/';
  const tries = [p, p + '.html', path.join(p, 'index.html')];
  for (const t of tries) {
    const f = path.join(ROOT, t);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404, { 'Content-Type': TYPES['.html'] });
  fs.createReadStream(path.join(ROOT, '404.html')).on('error', () => res.end('404')).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}${BASE}/`));
