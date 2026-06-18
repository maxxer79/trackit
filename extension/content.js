/* global chrome */
// Injects a floating "Track this item" button on supported retailer PRODUCT
// pages. Runs only in the top frame, only when configured, and only if the user
// hasn't turned it off. Uses a Shadow DOM so the host page's CSS can't affect
// it. The fetch goes straight to the user's instance; Trackit's CORS reflects
// the origin, so the page-origin request is allowed.

// Per-host product-URL markers. If a host isn't listed, we don't second-guess
// and show the button (better than hiding it on a real product page).
const HOST_PATTERNS = {
  'amazon.com': [/\/dp\//, /\/gp\/product\//],
  'bestbuy.com': [/\/site\/.+\/\d+\.p/, /\.p(\?|$)/],
  'walmart.com': [/\/ip\//],
  'target.com': [/\/p\//, /\/-\/A-/],
  'costco.com': [/\.product\./],
  'gamestop.com': [/\/products?\//],
  'newegg.com': [/\/p\//],
  'bhphotovideo.com': [/\/c\/product\//],
  'microcenter.com': [/\/product\//],
  'ebay.com': [/\/itm\//],
  'nintendo.com': [/\/store\/products\//],
  'lenovo.com': [/\/p\//],
  'homedepot.com': [/\/p\//],
  'lego.com': [/\/product\//],
  'samsclub.com': [/\/p\//],
  'toysrus.com': [/\/product/],
  'kohls.com': [/\/product\//],
  'officedepot.com': [/\/products?\//, /\/a\/products\//],
  'meijer.com': [/\/shopping\/product\//],
  'popmart.com': [/\/products\//],
};

function looksLikeProduct(href) {
  let u;
  try { u = new URL(href); } catch { return false; }
  const host = u.hostname.replace(/^www\./, '');
  const path = u.pathname + u.search;
  const key = Object.keys(HOST_PATTERNS).find((h) => host === h || host.endsWith('.' + h));
  if (!key) return true; // unmapped host — show rather than risk a false hide
  return HOST_PATTERNS[key].some((re) => re.test(path));
}

const dismissed = new Set();

if (window.top === window) {
  chrome.storage.local.get(['baseUrl', 'token', 'floatingButton'], (cfg) => {
    if (!cfg.baseUrl || !cfg.token || cfg.floatingButton === false) return;

    const sync = () => {
      const present = document.getElementById('trackit-fab-host');
      const show = looksLikeProduct(location.href) && !dismissed.has(location.href);
      if (show && !present) mount(cfg.baseUrl, cfg.token);
      else if (!show && present) present.remove();
    };

    sync();

    // Most of these retailers are SPAs that change the URL without reloading,
    // so the content script's one-time run isn't enough. Watch for URL changes.
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) {
        last = location.href;
        sync();
      }
    }, 1200);
  });
}

function apiBase(baseUrl) {
  return baseUrl.replace(/\/+$/, '').replace(/\/api$/i, '');
}

function mount(baseUrl, token) {
  const host = document.createElement('div');
  host.id = 'trackit-fab-host';
  host.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;';
  (document.body || document.documentElement).appendChild(host);

  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host, * { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
      .wrap { display:flex; align-items:center; gap:8px; }
      .btn {
        display:inline-flex; align-items:center; gap:8px;
        background:#0a84ff; color:#fff; border:none; cursor:pointer;
        font-size:14px; font-weight:600; padding:11px 16px; border-radius:999px;
        box-shadow:0 4px 14px rgba(0,0,0,.3); transition:transform .12s, background .12s;
      }
      .btn:hover { transform:translateY(-1px); }
      .btn:disabled { opacity:.6; cursor:default; }
      .btn.ok { background:#30d158; }
      .btn.err { background:#ff453a; }
      .dot { font-size:16px; line-height:1; }
      .x {
        width:22px; height:22px; border-radius:999px; border:none; cursor:pointer;
        background:rgba(0,0,0,.45); color:#fff; font-size:13px; line-height:1;
      }
    </style>
    <div class="wrap">
      <button class="btn" id="t"><span class="dot">＋</span><span id="label">Track this item</span></button>
      <button class="x" id="x" title="Hide on this page">✕</button>
    </div>
  `;

  const btn = root.getElementById('t');
  const label = root.getElementById('label');
  root.getElementById('x').addEventListener('click', () => {
    dismissed.add(location.href);
    host.remove();
  });

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.classList.remove('ok', 'err');
    label.textContent = 'Adding…';
    try {
      const res = await fetch(`${apiBase(baseUrl)}/api/tracking/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: location.href }),
      });
      if (res.status === 401) return done('Session expired', 'err');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return done(data.error || `Failed (${res.status})`, 'err');
      return done('Tracking ✓', 'ok', true);
    } catch {
      return done('Trackit unreachable', 'err');
    }
  });

  function done(text, kind, keepDisabled) {
    label.textContent = text;
    btn.classList.add(kind);
    if (!keepDisabled) {
      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove(kind);
        label.textContent = 'Track this item';
      }, 2500);
    }
  }
}
