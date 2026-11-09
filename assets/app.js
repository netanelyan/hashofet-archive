(() => {
  const FILTERS = [
    ["all", "הכל"],
    ["club", "קבוצות"],
    ["national", "נבחרות"],
    ["retro", "רטרו"],
    ["special", "מהדורות מיוחדות"],
    ["kids", "ילדים"],
    ["other", "אביזרים ועוד"],
  ];
  const TAG_LABEL = { retro: "רטרו", special: "מהדורה מיוחדת", kids: "ילדים" };
  const $ = (id) => document.getElementById(id);
  const grid = $("grid"), q = $("q"), sortSel = $("sort"), chips = $("chips");
  const dlg = $("dlg");
  let all = [], filter = "all";

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "₪" + (Number.isInteger(n) ? n : n.toFixed(2));
  const norm = (s) => s.toLowerCase().replace(/[|/\\-]/g, " ").replace(/\s+/g, " ").trim();

  function priceHtml(p) {
    if (p.price == null) return "";
    const cmp = p.compare && p.compare > p.price ? `<s>${money(p.compare)}</s>` : "";
    return `${money(p.price)}${cmp}`;
  }

  function renderChips() {
    chips.innerHTML = FILTERS.map(([k, label]) => {
      const n = k === "all" ? all.length : all.filter((p) => p.tags.includes(k)).length;
      if (!n) return "";
      return `<button class="chip" role="tab" data-k="${k}" aria-selected="${k === filter}">${label}<span>${n}</span></button>`;
    }).join("");
  }

  function render() {
    const terms = norm(q.value).split(" ").filter(Boolean);
    let list = all.filter((p) => (filter === "all" || p.tags.includes(filter)) && terms.every((t) => p._s.includes(t)));
    const s = sortSel.value;
    if (s === "old") list = [...list].reverse();
    else if (s === "name") list = [...list].sort((a, b) => a.team.localeCompare(b.team, "he") || a.order - b.order);
    $("empty").hidden = list.length > 0;
    grid.innerHTML = list.map((p) => {
      const img = p.images[0];
      const tag = p.tags.find((t) => TAG_LABEL[t]);
      return `<a class="card" href="#/p/${encodeURIComponent(p.id)}">
        <div class="ph">${img ? `<img src="${img.thumb}" alt="${esc(p.title)}" loading="lazy" decoding="async" width="480" height="480">` : `<span class="noimg">אין תמונה</span>`}
        ${tag ? `<span class="tag">${TAG_LABEL[tag]}</span>` : ""}</div>
        <h3>${esc(p.team)}</h3>
        <div class="sub">${esc(p.details.join(" · "))}</div>
        <div class="p">${priceHtml(p)}</div></a>`;
    }).join("");
  }

  function openProduct(id) {
    const p = all.find((x) => x.id === id);
    if (!p) return;
    $("dtitle").textContent = p.title.replace(/\s*\|\s*/g, " · ");
    $("dtags").innerHTML = [p.kind === "club" ? "קבוצה" : p.kind === "national" ? "נבחרת" : "", p.season ? `עונה ${p.season}` : "", ...p.tags.map((t) => TAG_LABEL[t] || "")]
      .filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("");
    $("dprice").innerHTML = p.price != null ? `<small>המחיר האחרון בחנות</small>${priceHtml(p)}` : "";
    $("dopts").innerHTML = p.options.map((o) => `<div class="opt"><b>${esc(o.name)}</b><div>${o.values.map((v) => `<span>${esc(v)}</span>`).join("")}</div></div>`).join("");
    const show = (i) => {
      $("dimg").src = p.images[i].full;
      $("dimg").alt = p.title;
      [...$("thumbs").children].forEach((b, j) => b.setAttribute("aria-current", i === j));
    };
    $("thumbs").innerHTML = p.images.length > 1
      ? p.images.map((im, i) => `<button data-i="${i}" aria-label="תמונה ${i + 1}"><img src="${im.thumb}" alt="" loading="lazy"></button>`).join("")
      : "";
    $("thumbs").onclick = (e) => { const b = e.target.closest("button"); if (b) show(+b.dataset.i); };
    if (p.images.length) show(0); else $("dimg").removeAttribute("src");
    document.title = `${p.title.replace(/\s*\|\s*/g, " · ")} · חנות השופט`;
    if (!dlg.open) dlg.showModal();
  }

  function route() {
    const m = location.hash.match(/^#\/p\/(.+)$/);
    if (m) openProduct(decodeURIComponent(m[1]));
    else if (dlg.open) dlg.close();
  }

  dlg.addEventListener("close", () => {
    document.title = "חנות השופט · ארכיון";
    if (location.hash.startsWith("#/p/")) history.pushState("", "", location.pathname + location.search);
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  $("close").onclick = () => dlg.close();
  chips.onclick = (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    filter = b.dataset.k;
    renderChips();
    render();
  };
  q.addEventListener("input", render);
  sortSel.addEventListener("change", render);
  window.addEventListener("hashchange", route);

  fetch("data/products.json")
    .then((r) => r.json())
    .then((data) => {
      all = data.map((p) => ({ ...p, _s: norm([p.title, p.season || "", p.year || ""].join(" ")) }));
      const oldest = Math.min(...all.map((p) => p.year || 9999));
      $("count").textContent = `${all.length} מוצרים שהיו בחנות, מהעונה האחרונה ועד חולצות רטרו מ-${oldest}.`;
      renderChips();
      render();
      route();
    })
    .catch(() => { grid.innerHTML = '<p class="empty">משהו נשבר בטעינה. כדאי לרענן את הדף.</p>'; });
})();
