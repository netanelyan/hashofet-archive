// Archive mode: the store is closed. Keeps the theme working as a showcase and
// turns every cart / checkout action into a "store is closed" message.
(function () {
  var MSG = 'החנות סגורה ולא מקבלת הזמנות. האתר נשאר לתצוגה בלבד.';
  var SHORT = 'החנות סגורה, אי אפשר להזמין.';

  function toast(text) {
    var t = document.createElement('div');
    t.className = 'archive-toast';
    t.setAttribute('role', 'status');
    t.textContent = text || SHORT;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  // Block cart requests (add to cart, mystery box builder, cart drawer...)
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\/cart(\/|\.js|$|\?)/.test(u)) {
      toast();
      var body = JSON.stringify({ status: 422, message: SHORT, description: SHORT, errors: SHORT, items: [], item_count: 0 });
      return Promise.resolve(new Response(body, { status: 422, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, init);
  };

  // Forms that would post to Shopify (cart, contact, newsletter)
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f && f.method && f.method.toLowerCase() === 'post') { e.preventDefault(); toast(); }
  }, true);

  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.className = 'archive-bar';
    bar.textContent = MSG;
    document.body.insertBefore(bar, document.body.firstChild);

    if (window.variantStrings) {
      window.variantStrings.addToCart = 'החנות סגורה';
    }
    document.querySelectorAll('.product-form__submit').forEach(function (b) { b.disabled = true; });

    // Static search: filter the pre-rendered product grid by ?q=
    if (document.body.dataset.archiveSearch !== undefined || location.pathname.replace(/\/$/, '').endsWith('/search')) {
      var q = new URLSearchParams(location.search).get('q') || '';
      document.querySelectorAll('input[name="q"]').forEach(function (i) { i.value = q; });

      var norm = function (s) { return (s || '').toLowerCase().replace(/[|/\-]/g, ' ').replace(/\s+/g, ' ').trim(); };
      var terms = norm(q).split(' ').filter(Boolean);
      var items = document.querySelectorAll('#product-grid ul > .grid__item');
      var shown = 0;
      items.forEach(function (li) {
        var ok = terms.every(function (t) { return norm(li.textContent).indexOf(t) !== -1; });
        li.hidden = !ok;
        if (ok) shown++;
      });
      document.querySelectorAll('.pagination-wrapper').forEach(function (p) { p.hidden = true; });
      var status = document.querySelector('#ProductCount, .template-search__header p, [role="status"]');
      if (status && q) status.textContent = shown + ' תוצאות עבור "' + q + '"';
    }
  });
})();
