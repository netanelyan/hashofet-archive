// Store data that is not part of the Shopify theme/product export:
// collections, the main menu and the page list. Edit here, then rebuild.

export const STORE = {
  name: 'חנות השופט',
  description: 'חולצות כדורגל של קבוצות ונבחרות, עונות חדשות ורטרו.',
  vendor: 'Hanut Hashofet',
  // URL prefix of the site. GitHub project pages live under /<repo-name>.
  // Set SITE_BASE='' when serving from a custom domain root.
  base: '/hashofet-archive',
  siteUrl: 'https://netanelyan.github.io/hashofet-archive',
  moneyFormat: '₪{{amount}}',
  // products that used an alternate product template
  productTemplates: {
    'מיסטרי-בוקס': 'mystery-box',
    'מיסטרי-בוקס-ילדים': 'mystery-box',
  },
};

const segs = (title) => title.split('|').map((s) => s.trim()).filter(Boolean);
const teamOf = (title) => segs(title)[0];
const handleize = (s) => s.trim().replace(/['"״׳().,!?:;/\\|]+/g, '').replace(/\s+/g, '-');

function kind(p) {
  for (const s of segs(p.title).slice(1)) {
    const m = s.match(/^(\d{2})\/(\d{2})$/);
    if (m) return { type: 'club', year: Number(m[1]) > 50 ? 1900 + Number(m[1]) : 2000 + Number(m[1]) };
    if (/^(19|20)\d{2}$/.test(s)) return { type: 'national', year: Number(s) };
  }
  return { type: null, year: null };
}

export function collectionsConfig(products) {
  const info = products.map((p) => ({ p, team: teamOf(p.title), ...kind(p) }));
  const nationalTeams = new Set(info.filter((x) => x.type === 'national').map((x) => x.team));
  const clubTeams = new Set(info.filter((x) => x.type === 'club').map((x) => x.team));
  const isShirt = (x) => x.type || nationalTeams.has(x.team) || clubTeams.has(x.team);

  const out = [{ handle: 'all', title: 'כל החולצות', products }];
  const byTeam = new Map();
  for (const x of info) {
    if (!isShirt(x)) continue;
    if (!byTeam.has(x.team)) byTeam.set(x.team, []);
    byTeam.get(x.team).push(x.p);
  }
  for (const [team, ps] of byTeam) out.push({ handle: handleize(team), title: team, products: ps, group: nationalTeams.has(team) ? 'national' : 'club' });

  const where = (f) => info.filter(f).map((x) => x.p);
  out.push({ handle: 'קבוצות', title: 'קבוצות', products: where((x) => isShirt(x) && !nationalTeams.has(x.team)) });
  out.push({ handle: 'נבחרות', title: 'נבחרות', products: where((x) => nationalTeams.has(x.team)) });
  out.push({ handle: 'רטרו', title: 'רטרו', products: where((x) => x.year && x.year < 2020) });
  out.push({ handle: 'מהדורות-מיוחדות', title: 'מהדורות מיוחדות', products: where((x) => /מהדורה|מהודרה/.test(x.p.title)) });
  out.push({ handle: 'חליפות-ילדים', title: 'חליפות לילדים', products: where((x) => /ילדים/.test(x.p.title) && isShirt(x)) });
  const shoes = where((x) => /^נעל/.test(x.p.title));
  out.push({ handle: 'נעלי-כדורגל', title: 'נעלי כדורגל', products: shoes, template: 'shoes-collection' });
  out.push({ handle: 'נייק', title: 'נייק', products: shoes.filter((p) => /נייק/.test(p.title)) });
  return out.filter((c) => c.products.length);
}

export function mainMenu(collections) {
  const top = (group, n) => collections
    .filter((c) => c.group === group)
    .sort((a, b) => b._all.length - a._all.length)
    .slice(0, n)
    .map((c) => ({ title: c.title, url: `/collections/${c.handle}` }));
  return [
    { title: 'כל החולצות', url: '/collections/all' },
    { title: 'קבוצות', url: '/collections/קבוצות', links: top('club', 15) },
    { title: 'נבחרות', url: '/collections/נבחרות', links: top('national', 15) },
    { title: 'רטרו', url: '/collections/רטרו' },
    { title: 'חליפות לילדים', url: '/collections/חליפות-ילדים' },
    { title: 'מיסטרי בוקס', url: '/pages/יוצר-מיסטרי' },
    { title: 'טבלת מידות', url: '/pages/טבלת-מידות' },
  ];
}

// handle -> template suffix (templates/page.<suffix>.json)
export const pagesConfig = [
  { handle: 'שאלות-נפוצות', title: 'שאלות נפוצות', template: '' },
  { handle: 'takanon', title: 'תקנון', template: 'takanon' },
  { handle: 'תקנון', title: 'תקנון', template: 'takanon' },
  { handle: 'טבלת-מידות', title: 'טבלת מידות', template: '-2' },
  { handle: 'יוצר-מיסטרי', title: 'יוצר מיסטרי', template: 'mysterymaker' },
  { handle: 'הוראות-כביסה', title: 'הוראות כביסה', template: 'horaotcvisa' },
  { handle: 'החזרות-והחלפות', title: 'החזרות והחלפות', template: 'ehzer' },
  // the footer linked to the returns app page; serve the returns policy there
  { handle: 'returns', title: 'החזרות והחלפות', template: 'ehzer', path: 'apps/rtl/returns.html' },
  { handle: 'מדריך-תשלום-באשראי', title: 'מדריך לתשלום באשראי', template: 'creditcard' },
  { handle: 'מונדיאל', title: 'מידע על המונדיאל', template: 'mondial' },
  { handle: 'צור-קשר', title: 'צור קשר', template: 'contact' },
];
