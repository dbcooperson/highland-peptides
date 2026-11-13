// Shared helpers used by every page (catalog, product detail, cart).

// ---------- Entry gate (age + research-use certification, shown before anything else) ----------
function initEntryGate() {
  const gate = document.getElementById('entryGate');
  if (!gate) return;
  const alreadyAgreed = localStorage.getItem('ruo_gate_agreed') === 'yes';
  gate.style.display = alreadyAgreed ? 'none' : 'flex';

  const agreeBtn = document.getElementById('entryAgreeBtn');
  const exitBtn = document.getElementById('entryExitBtn');
  if (!agreeBtn || !exitBtn) return;

  agreeBtn.onclick = () => {
    localStorage.setItem('ruo_gate_agreed', 'yes');
    gate.style.display = 'none';
  };
  exitBtn.onclick = () => {
    window.location.href = 'https://www.google.com';
  };
}
initEntryGate();

// The referral-link discount was retired in Nov 2026. These stay as no-ops so
// existing checkout code keeps working; any saved referral token is cleared.
const HP_REFERRAL_CAMPAIGN_KEY = 'hp_referral_campaign';
function activeReferralCampaign() { return null; }
try { localStorage.removeItem(HP_REFERRAL_CAMPAIGN_KEY); } catch {}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'Request failed');
    error.code = data.code || '';
    error.field = data.field || '';
    throw error;
  }
  return data;
}

let hpAccountState = { authenticated: false, account: null };

async function refreshAccountState() {
  try {
    hpAccountState = await api('/api/account/me');
  } catch {
    hpAccountState = { authenticated: false, account: null };
  }
  window.hpAccountState = hpAccountState;
  return hpAccountState;
}

async function initAccountNavigation() {
  const actions = document.querySelector('.header-actions');
  if (!actions || actions.querySelector('.account-nav-link')) return;
  const link = document.createElement('a');
  link.href = '/account.html';
  link.className = 'account-nav-link';
  link.setAttribute('aria-label', 'Customer account');
  link.innerHTML = '<span class="account-nav-icon" aria-hidden="true"></span><span class="account-nav-text">Account</span>';
  const cartNav = actions.querySelector('.cart-nav');
  actions.insertBefore(link, cartNav || null);
  const state = await refreshAccountState();
  if (state.authenticated && state.account) {
    link.classList.add('signed-in');
    link.querySelector('.account-nav-text').textContent = state.account.name.split(/\s+/)[0] || 'Account';
    link.title = `Signed in as ${state.account.email}`;
  }
}

// ---------- First-party storefront analytics ----------
// Anonymous IDs are generated in the browser. The server hashes them and only
// stores aggregate behavior; names, emails, addresses, and IPs are not logged.
const HP_ANALYTICS_VISITOR_KEY = 'hp_analytics_visitor';
const HP_ANALYTICS_SESSION_KEY = 'hp_analytics_session';
const HP_ANALYTICS_SOURCE_KEY = 'hp_analytics_source';

function analyticsId(storage, key) {
  try {
    let id = storage.getItem(key);
    if (!id) {
      id = window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      storage.setItem(key, id);
    }
    return id;
  } catch {
    return '';
  }
}

function analyticsContext() {
  return {
    visitorId: analyticsId(localStorage, HP_ANALYTICS_VISITOR_KEY),
    sessionId: analyticsId(sessionStorage, HP_ANALYTICS_SESSION_KEY),
  };
}

function analyticsSource() {
  try {
    const existing = sessionStorage.getItem(HP_ANALYTICS_SOURCE_KEY);
    if (existing) return existing;
  } catch {}
  const params = new URLSearchParams(window.location.search);
  const campaignSource = params.get('utm_source');
  let source = campaignSource ? campaignSource.slice(0, 100) : 'Direct / unknown';
  if (!campaignSource && document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      source = referrer.hostname === window.location.hostname ? 'Direct / unknown' : referrer.hostname;
    } catch {}
  }
  try { sessionStorage.setItem(HP_ANALYTICS_SOURCE_KEY, source); } catch {}
  return source;
}

function hpTrack(type, details = {}) {
  const payload = {
    type,
    ...analyticsContext(),
    path: window.location.pathname,
    source: analyticsSource(),
    ...details,
  };
  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

window.hpTrack = hpTrack;
window.hpAnalyticsContext = analyticsContext;
hpTrack('page_view');

// ---------- Cart (persisted to localStorage so it survives navigation between pages) ----------
const CART_KEY = 'hp_cart';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function addToCart(sku, qty = 1) {
  const cart = getCart();
  cart[sku] = (cart[sku] || 0) + qty;
  saveCart(cart);
  const product = getCatalogProductBySku(sku);
  hpTrack('add_to_cart', {
    sku,
    productName: product ? product.name : '',
    quantity: qty,
  });
  setTimeout(() => showAddedToCartPopup(sku, qty), 0);
  return cart;
}

function removeFromCart(sku) {
  const cart = getCart();
  delete cart[sku];
  saveCart(cart);
  return cart;
}

// Sets an exact quantity; deletes the line if qty drops to 0 or below.
function setCartQty(sku, qty) {
  const cart = getCart();
  if (qty <= 0) {
    delete cart[sku];
  } else {
    cart[sku] = qty;
  }
  saveCart(cart);
  return cart;
}

function cartItemCount(cart) {
  return Object.values(cart).reduce((sum, q) => sum + q, 0);
}

// Updates the "Cart (N)" badge in the nav. Safe to call on pages without one.
function updateCartBadge() {
  const el = document.getElementById('cartCount');
  if (!el) return;
  const count = cartItemCount(getCart());
  el.textContent = count;
  el.setAttribute('aria-label', `${count} item${count === 1 ? '' : 's'}`);
}

function getCatalogProductBySku(sku) {
  const catalog = Array.isArray(window.siteCatalog) ? window.siteCatalog : [];
  return catalog.find(product => product.sku === sku) || null;
}

function productQuantityPricing(product, quantity) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const tiers = Object.entries(product && product.quantityDiscounts || {})
    .map(([minimum, savings]) => ({ minimum: Number(minimum), savings: Number(savings) }))
    .filter(tier => tier.minimum > 0 && tier.savings > 0 && qty >= tier.minimum)
    .sort((a, b) => b.minimum - a.minimum);
  const savings = tiers.length ? tiers[0].savings : 0;
  const listTotal = round2(Number(product && product.price || 0) * qty);
  return {
    quantity: qty,
    savings: round2(Math.min(listTotal, savings)),
    total: round2(Math.max(0, listTotal - savings)),
  };
}

function bundlePromotionConfig() {
  const promotion = window.sitePromotion || {};
  let tiers = Array.isArray(promotion.tiers) && promotion.tiers.length
    ? promotion.tiers
    : [{ minimumSubtotal: Number(promotion.minimumSubtotal) || 50, freeSku: promotion.freeSku || 'WA10', freeQuantity: Number(promotion.freeQuantity) || 1 }];
  tiers = tiers
    .map(tier => ({ minimumSubtotal: Number(tier.minimumSubtotal) || 0, freeSku: tier.freeSku, freeQuantity: Number(tier.freeQuantity) || 1 }))
    .filter(tier => tier.freeSku && tier.minimumSubtotal > 0)
    .sort((a, b) => a.minimumSubtotal - b.minimumSubtotal);
  return { tiers, label: promotion.label || '' };
}

function bundleQualifyingSubtotal(cart = getCart()) {
  return round2(Object.keys(cart).reduce((total, itemSku) => {
    const product = getCatalogProductBySku(itemSku);
    const quantity = Number(cart[itemSku] || 0);
    return product && quantity > 0 ? total + cartLinePricing(itemSku, cart).total : total;
  }, 0));
}

function bundleTierGiftName(tier) {
  const product = tier && getCatalogProductBySku(tier.freeSku);
  if (!product) return 'Reconstitution Solution';
  return `${product.name} ${cleanVialSpec(product.spec)}`.trim();
}

// Current tier = highest reached; next tier = the one to push toward.
function bundlePromotionState(cart = getCart()) {
  const { tiers, label } = bundlePromotionConfig();
  const qualifying = bundleQualifyingSubtotal(cart);
  const current = tiers.filter(tier => qualifying >= tier.minimumSubtotal).pop() || null;
  const next = tiers.find(tier => qualifying < tier.minimumSubtotal) || null;
  const shown = current || tiers[0] || { minimumSubtotal: 50, freeSku: 'WA10', freeQuantity: 1 };
  return {
    tiers,
    label,
    qualifying,
    current,
    next,
    unlocked: !!current,
    minimumSubtotal: shown.minimumSubtotal,
    freeSku: current ? current.freeSku : null,
    freeQuantity: current ? current.freeQuantity : 1,
    freeProduct: current ? getCatalogProductBySku(current.freeSku) : null,
    remaining: next ? round2(Math.max(0, next.minimumSubtotal - qualifying)) : 0,
    progress: next ? Math.min(100, Math.round((qualifying / next.minimumSubtotal) * 100)) : 100,
  };
}

function bundleTierLadderHTML(state) {
  return `<span class="bundle-tier-ladder">${state.tiers.map(tier => {
    const reached = state.qualifying >= tier.minimumSubtotal;
    const size = cleanVialSpec((getCatalogProductBySku(tier.freeSku) || {}).spec || '');
    return `<em class="${reached ? 'is-reached' : ''}">$${tier.minimumSubtotal}+ &rarr; ${escapeHTML(size || 'free gift')}</em>`;
  }).join('')}</span>`;
}

function bundlePromotionMessage(cart = getCart()) {
  const state = bundlePromotionState(cart);
  let headline;
  let detail;
  if (!state.current && state.next) {
    headline = `Add $${state.remaining.toFixed(2)} for a free ${escapeHTML(bundleTierGiftName(state.next))}`;
    detail = 'Free Reconstitution Solution with every order over $' + state.next.minimumSubtotal + ' (before shipping). Bigger orders get bigger bottles.';
  } else if (state.current && state.next) {
    headline = `Free ${escapeHTML(bundleTierGiftName(state.current))} unlocked`;
    detail = `Add $${state.remaining.toFixed(2)} more to upgrade it to a free ${escapeHTML(bundleTierGiftName(state.next))}.`;
  } else {
    headline = `Free ${escapeHTML(bundleTierGiftName(state.current))} unlocked`;
    detail = 'Top tier reached. It will be added to your order automatically.';
  }
  return `<strong>${headline}</strong><span>${detail}</span>
    <span class="bundle-progress" aria-hidden="true"><i style="width:${state.progress}%"></i></span>
    ${bundleTierLadderHTML(state)}${giveawayCartLineHTML(cart)}`;
}

// ---- Launch giveaway (site ribbon + cart entry count) ----------------------
function giveawayCartEntries(cart = getCart()) {
  return Object.keys(cart).reduce((sum, itemSku) => {
    const product = getCatalogProductBySku(itemSku);
    return product && product.category !== 'Supplies' ? sum + Math.max(0, Number(cart[itemSku] || 0)) : sum;
  }, 0);
}

function giveawayCartLineHTML(cart = getCart()) {
  if (!window.siteGiveaway || window.siteGiveaway.status !== 'active') return '';
  const entries = giveawayCartEntries(cart);
  return `<span class="gw-cart-entries">${entries
    ? `This order = ${entries} giveaway entr${entries === 1 ? 'y' : 'ies'} for $100 store credit. <a href="/giveaway.html">Details</a>`
    : 'Every peptide vial = 1 entry to win $100 store credit. <a href="/giveaway.html">Details</a>'}</span>`;
}

function initGiveawayRibbon() {
  fetch('/api/giveaway', { credentials: 'same-origin' })
    .then(response => (response.ok ? response.json() : null))
    .then(info => {
      if (!info || (info.status !== 'active' && info.status !== 'upcoming')) return;
      window.siteGiveaway = info;
      const end = new Date(new Date(info.endsAt).getTime() - 1)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
      const start = new Date(info.startsAt)
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
      const strip = document.querySelector('.ruo-strip');
      if (strip && !document.querySelector('.gw-ribbon')) {
        strip.insertAdjacentHTML('beforebegin', info.status === 'active'
          ? `<a class="gw-ribbon" href="/giveaway.html">Launch giveaway: every vial = 1 entry to win <b>$100 store credit</b> · ends ${end}</a>`
          : `<a class="gw-ribbon" href="/giveaway.html">Launch giveaway starts ${start}: win <b>$100 store credit</b></a>`);
      }
      if (info.status === 'active') {
        document.querySelectorAll('.bundle-promo-banner').forEach(banner => {
          if (!banner.querySelector('.gw-cart-entries')) banner.insertAdjacentHTML('beforeend', giveawayCartLineHTML());
        });
      }
    })
    .catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGiveawayRibbon);
else initGiveawayRibbon();

// ---- Research sets (bundles) ------------------------------------------------
// Mirrors server/bundles.js. The server recalculates everything at checkout.
function siteBundleList() {
  return Array.isArray(window.siteBundles) ? window.siteBundles : [];
}

function cartBundleAllocation(cart = getCart()) {
  const remaining = {};
  Object.keys(cart).forEach(sku => { remaining[sku] = Math.max(0, Math.floor(Number(cart[sku] || 0))); });
  const bundledUnits = {};
  const bundleSavings = {};
  const applied = [];
  [...siteBundleList()].sort((a, b) => b.savings - a.savings).forEach(bundle => {
    const sets = Math.min(...bundle.skus.map(sku => remaining[sku] || 0));
    if (!(sets > 0)) return;
    bundle.skus.forEach(sku => {
      const product = getCatalogProductBySku(sku);
      remaining[sku] -= sets;
      bundledUnits[sku] = (bundledUnits[sku] || 0) + sets;
      bundleSavings[sku] = round2((bundleSavings[sku] || 0) + (product ? product.price : 0) * Number(bundle.rate || 0) * sets);
    });
    applied.push({ ...bundle, sets, totalSavings: round2(bundle.savings * sets) });
  });
  return { bundledUnits, bundleSavings, applied };
}

// Bundle-aware price for one cart line.
function cartLinePricing(sku, cart = getCart(), allocation = cartBundleAllocation(cart)) {
  const product = getCatalogProductBySku(sku);
  const qty = Math.max(1, Math.floor(Number(cart[sku]) || 1));
  if (!product) return { quantity: qty, total: 0, savings: 0, bundleSavings: 0 };
  const inSets = Math.min(qty, allocation.bundledUnits[sku] || 0);
  const rest = qty - inSets;
  const restPricing = rest > 0 ? productQuantityPricing(product, rest) : { total: 0, savings: 0 };
  const bundleSavings = round2(inSets ? (allocation.bundleSavings[sku] || 0) * (inSets / (allocation.bundledUnits[sku] || inSets)) : 0);
  return {
    quantity: qty,
    total: round2(product.price * inSets - bundleSavings + restPricing.total),
    savings: round2(restPricing.savings + bundleSavings),
    bundleSavings,
  };
}

function addBundleToCart(bundleId) {
  const bundle = siteBundleList().find(item => item.id === bundleId);
  if (!bundle) return;
  const cart = getCart();
  bundle.skus.forEach(sku => { cart[sku] = (cart[sku] || 0) + 1; });
  saveCart(cart);
  if (typeof hpTrack === 'function') hpTrack('add_to_cart', { sku: bundle.skus.join('+'), productName: bundle.name, quantity: 1 });
  updateCartBadge();
  setTimeout(() => showAddedToCartPopup(bundle.skus[0], 1), 0);
}

function bundleCardHTML(bundle) {
  const products = bundle.skus.map(sku => getCatalogProductBySku(sku)).filter(Boolean);
  return `
    <article class="sn-bundle-card">
      ${bundle.image
        ? `<div class="sn-bundle-photo"><img src="${escapeHTML(bundle.image)}" alt="${escapeHTML(bundle.name)}" loading="lazy" decoding="async"></div>`
        : `<div class="sn-bundle-imgs">${products.map(p => `<span class="sn-bundle-img">${productMockupImageHTML(p)}</span>`).join('')}</div>`}
      <div class="sn-bundle-body">
        <span class="sn-bundle-area">${escapeHTML(bundle.area || 'Research set')}${bundle.tier === 'starter' ? ' · Starter' : ''}</span>
        <h3>${escapeHTML(bundle.name)}</h3>
        <ul>${products.map(p => `<li>${escapeHTML(p.name)} <span>${escapeHTML(cleanVialSpec(p.spec))}</span></li>`).join('')}</ul>
        <div class="sn-bundle-price"><s>$${bundle.listPrice.toFixed(2)}</s><strong>$${bundle.price.toFixed(2)}</strong><em>Save $${bundle.savings.toFixed(2)} (${Math.round(Number(bundle.rate || 0) * 100)}%)</em></div>
        <button type="button" class="sn-bundle-add" data-bundle="${escapeHTML(bundle.id)}">Add set to cart</button>
      </div>
    </article>`;
}

function renderBundleCards(container, bundles) {
  if (!container) return;
  const list = (bundles || siteBundleList()).filter(bundle => bundle.skus.every(sku => getCatalogProductBySku(sku)));
  container.innerHTML = list.map(bundleCardHTML).join('');
  container.querySelectorAll('.sn-bundle-add').forEach(button => {
    button.addEventListener('click', () => addBundleToCart(button.dataset.bundle));
  });
  const section = container.closest('[data-bundle-section]');
  if (section) section.hidden = !list.length;
}

// A set the cart is one item away from completing (best saving first).
function nearlyCompleteBundle(cart = getCart()) {
  const allocation = cartBundleAllocation(cart);
  const leftover = {};
  Object.keys(cart).forEach(sku => { leftover[sku] = Math.max(0, (cart[sku] || 0) - (allocation.bundledUnits[sku] || 0)); });
  return [...siteBundleList()]
    .map(bundle => ({ bundle, missing: bundle.skus.filter(sku => !(leftover[sku] > 0)) }))
    .filter(item => item.missing.length === 1 && item.bundle.skus.length > 1 && getCatalogProductBySku(item.missing[0]))
    .sort((a, b) => b.bundle.savings - a.bundle.savings)[0] || null;
}

// Up to 2 one-click suggestions: finish a research set first, then items that
// push the cart over the next free-solution tier, then popular items.
function smartCartSuggestions(cart, addedProduct) {
  const catalog = (Array.isArray(window.siteCatalog) ? window.siteCatalog : [])
    .filter(item => !cart[item.sku] && item.category !== 'Supplies');
  const picks = [];
  const take = (item, reason) => {
    if (item && picks.length < 2 && !picks.some(pick => pick.item.sku === item.sku)) picks.push({ item, reason });
  };
  const nearSet = nearlyCompleteBundle(cart);
  if (nearSet) take(getCatalogProductBySku(nearSet.missing[0]), `Completes the ${nearSet.bundle.name} · save $${nearSet.bundle.savings.toFixed(2)}`);

  const tier = bundlePromotionState(cart);
  if (tier.next) {
    const nextGift = bundleTierGiftName(tier.next);
    const sameGroup = item => (addedProduct && item.group === addedProduct.group ? 0 : 1);
    const crossers = catalog
      .filter(item => item.price >= tier.remaining)
      .sort((a, b) => sameGroup(a) - sameGroup(b) || a.price - b.price);
    crossers.slice(0, 2).forEach(item => take(item, `Unlocks a free ${nextGift.replace('Reconstitution Solution ', '')} solution`));
  }
  catalog
    .filter(item => item.popular)
    .sort((a, b) => (addedProduct && a.group === addedProduct.group ? 0 : 1) - (addedProduct && b.group === addedProduct.group ? 0 : 1))
    .forEach(item => take(item, addedProduct && item.group === addedProduct.group ? `Popular in ${item.group}` : 'Popular with researchers'));
  return picks;
}

function showAddedToCartPopup(sku, qty = 1) {
  if (document.getElementById('entryGate')?.style.display === 'flex') return;
  const product = getCatalogProductBySku(sku);
  if (!product || !document.body) return;

  let overlay = document.getElementById('addToCartPopup');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'addToCartPopup';
    overlay.className = 'cart-popup-overlay';
    document.body.appendChild(overlay);
  }

  const cart = getCart();
  const subtotal = round2(Object.keys(cart).reduce((sum, itemSku) => (
    getCatalogProductBySku(itemSku) ? sum + cartLinePricing(itemSku, cart).total : sum
  ), 0));
  const count = cartItemCount(cart);
  const suggestions = smartCartSuggestions(cart, product);
  overlay.innerHTML = `
    <div class="cart-popup-card" role="dialog" aria-modal="true" aria-labelledby="cartPopupTitle">
      <button type="button" class="cart-popup-close" aria-label="Close">&times;</button>
      <div class="cart-popup-success"><span aria-hidden="true">OK</span><strong id="cartPopupTitle">Product successfully added to your cart.</strong></div>
      <div class="cart-popup-product">
        <div class="cart-popup-media photo sku-mockup">${productMockupImageHTML(product)}</div>
        <div class="cart-popup-copy">
          <strong>${escapeHTML(product.name)}</strong>
          <span>${escapeHTML(cleanVialSpec(product.spec))} &bull; Qty ${qty}</span>
          <em>Guaranteed 99% purity</em>
        </div>
        <div class="cart-popup-price">$${(product.price * qty).toFixed(2)}</div>
      </div>
      <div class="cart-popup-totals">
        <span>${count} item${count === 1 ? '' : 's'} in cart</span>
        <strong>Subtotal $${subtotal.toFixed(2)}</strong>
      </div>
      <div class="bundle-promo-banner ${bundlePromotionState(cart).unlocked ? 'is-unlocked' : ''}">
        ${bundlePromotionMessage(cart)}
      </div>
      <div class="cart-popup-actions">
        <button type="button" class="cart-popup-checkout">Checkout</button>
        <button type="button" class="cart-popup-continue">Continue Shopping</button>
      </div>
      ${suggestions.length ? `
        <div class="cart-popup-suggestions">
          <div class="cart-popup-suggestions-title">Add one more</div>
          <div class="cart-popup-suggestion-grid">
            ${suggestions.map(({ item, reason }) => `
              <div class="cart-popup-suggestion">
                <a href="/product/${encodeURIComponent(item.slug)}?sku=${encodeURIComponent(item.sku)}" class="cart-popup-suggestion-media photo sku-mockup">${productMockupImageHTML(item)}</a>
                <span><strong>${escapeHTML(item.name)}</strong><em>${escapeHTML(cleanVialSpec(item.spec))} &bull; $${item.price.toFixed(2)}</em><small class="cart-popup-suggestion-reason">${escapeHTML(reason)}</small></span>
                <button type="button" class="cart-popup-suggestion-add" data-sku="${escapeHTML(item.sku)}">Add</button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  const close = () => {
    overlay.classList.remove('active');
    setTimeout(() => { overlay.hidden = true; }, 180);
  };

  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('active'));
  overlay.querySelector('.cart-popup-close').onclick = close;
  overlay.querySelector('.cart-popup-continue').onclick = close;
  overlay.querySelector('.cart-popup-checkout').onclick = () => {
    if (window.location.pathname.endsWith('/cart.html')) {
      close();
      document.getElementById('checkoutBtn')?.click();
      return;
    }
    window.location.href = '/cart.html?checkout=1';
  };
  overlay.onclick = event => {
    if (event.target === overlay) close();
  };
  overlay.querySelectorAll('.cart-popup-suggestion-add').forEach(button => {
    button.onclick = () => {
      addToCart(button.dataset.sku, 1);
      updateCartBadge();
      if (typeof renderCartPage === 'function' && window.location.pathname.endsWith('/cart.html')) renderCartPage();
    };
  });
}



function escapeHTML(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function cleanVialSpec(spec) {
  return String(spec || '').replace(/\s*x1\s*vial/i, '').replace(/\s+/g, ' ').trim();
}


const VIAL_LABEL_ALIASES = {
  'CJC-1295 without DAC + Ipamorelin': 'CJC W/O DAC + IPA',
  'CJC-1295 without DAC': 'CJC W/O DAC',
  'Cagrilintide + Semaglutide': 'CAGRI + SEMA',
  'Semax 10mg + Selank 10mg': 'SEMAX + SELANK',
  'Semax 5mg + Selank 5mg': 'SEMAX + SELANK',
  'BPC-157 + GHK-Cu + TB-500 + KPV Blend (Klow)': 'KLOW BLEND',
  'BPC-157 + GHK-Cu + TB-500 Blend (Glow)': 'GLOW BLEND',
  'BPC-157 + TB-500 Blend': 'BPC + TB-500',
  'Bacteriostatic Water': 'RECONSTITUTION SOLUTION',
  Tesamorelin: 'SR-TSM',
};

function productImageStyle(product) {
  if (!product || !product.image) return '';
  return ` style="--mockup-image:url('${escapeHTML(product.image)}')"`;
}

function productMockupImageHTML(product) {
  if (!product || !product.image) return '';
  const src = escapeHTML(product.image);
  const label = `${product.name || 'Product'} ${cleanVialSpec(product.spec || '')} research vial mockup`.trim();
  const studioClass = /higgsfield/i.test(product.image) ? ' studio-product-render' : '';
  return `<img class="sku-mockup-img${studioClass}" src="${src}" alt="${escapeHTML(label)}" loading="lazy" decoding="async">`;
}
function vialDisplayName(name) {
  const cleanName = String(name || '').trim();
  return VIAL_LABEL_ALIASES[cleanName] || cleanName;
}
function vialLabelSizeClass(name) {
  const raw = String(vialDisplayName(name) || '').replace(/[^a-z0-9]/gi, '');
  if (raw.length >= 18) return 'vial-label-xlong';
  if (raw.length >= 11) return 'vial-label-long';
  if (raw.length >= 9) return 'vial-label-medium';
  return 'vial-label-short';
}

function vialLabelHTML(name, spec, className = '') {
  const productName = escapeHTML(vialDisplayName(name));
  const strength = escapeHTML(cleanVialSpec(spec));
  const sizeClass = vialLabelSizeClass(name);
  return `
    <div class="vial-label-overlay ${className} ${sizeClass}">
      <strong title="${productName}">${productName}</strong>
      <em>${strength}</em>
    </div>
  `;
}

const SEARCH_ALIASES = {
  'Retatrutide': ['retatrutide', 'reta', 'rt', 'hp-3rt', 'glp-3rt', 'glp3rt', 'glp-3', '3rt', 'sr-3rt', 'sr3rt'],
  'Tirzepatide': ['tirzepatide', 'tirz', 'tr', 'hp-trz', 'glp-2tz', 'glp2tz', 'glp-2', '2tz', 'sr-2tz', 'sr2tz', 'sr-2rt'],
  'Tesamorelin': ['tesamorelin', 'tesa', 'hp-tsm', 'sr-tsm', 'srtsm'],
  'SS-31': ['ss-31', 'ss31', 'hp-31', 'sr-31', 'sr31'],
  'Semaglutide': ['sema', 'sem'],
  'Cagrilintide': ['cagri', 'cag'],
  'Cagrilintide + Semaglutide': ['cagri sema', 'cag sem', 'cagsem'],
  'CJC-1295 without DAC + Ipamorelin': ['cjc ipa', 'cjc ipamorelin', 'cjc w/o dac ipa', 'cjc no dac ipa'],
  'CJC-1295 without DAC': ['cjc no dac', 'cjc w/o dac'],
  'CJC-1295 with DAC': ['cjc dac'],
  'Bacteriostatic Water': ['bac water', 'bac', 'bacteriostatic water', 'sterile water', 'reconstitution solution', 'recon solution', 'recon'],
  'BPC-157': ['bpc'],
  'TB-500': ['tb500', 'tb'],
  'BPC-157 + TB-500 Blend': ['bpc tb', 'bpc tb500', 'wolverine', 'wolverine stack'],
  'BPC-157 + GHK-Cu + TB-500 Blend (Glow)': ['glow', 'glow blend'],
  'BPC-157 + GHK-Cu + TB-500 + KPV Blend (Klow)': ['klow', 'klow blend'],
  'GHK-Cu': ['ghk', 'ghk cu'],
  'MOTS-c': ['mots', 'motsc'],
  'NAD+': ['nad', 'nad plus'],
  'Melanotan II': ['mt2', 'mt-ii'],
  'Melanotan I': ['mt1', 'mt-i'],
};

function searchableValues(product) {
  const originalName = product.compoundName || product.name;
  return [
    product.name,
    originalName,
    product.spec,
    product.sku,
    product.category,
    product.group,
    product.description,
    ...(SEARCH_ALIASES[originalName] || []),
  ].filter(Boolean).map(value => String(value).toLowerCase());
}

// ---------- Shared product search (used by every public page) ----------
let productSearchCatalogPromise = null;

function productSearchResultHTML(p) {
  return `
    <a class="product-search-result" href="/product/${encodeURIComponent(p.slug)}?sku=${encodeURIComponent(p.sku)}">
      <div class="product-search-result-media photo sku-mockup">${productMockupImageHTML(p)}</div>
      <div class="product-search-result-copy">
        <span class="product-search-result-group">${escapeHTML(p.group || p.category)}</span>
        <strong>${escapeHTML(p.name)}</strong>
        <span>${escapeHTML(cleanVialSpec(p.spec))} | $${p.price.toFixed(2)}</span>
        <span class="product-search-result-proof">Guaranteed 99% purity</span>
      </div>
      <span class="product-search-result-arrow" aria-hidden="true">&rsaquo;</span>
    </a>
  `;
}

function ensureProductSearchOverlay() {
  let overlay = document.getElementById('productSearchOverlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'productSearchOverlay';
  overlay.className = 'product-search-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="product-search-dialog" role="dialog" aria-modal="true" aria-labelledby="productSearchTitle">
      <div class="product-search-header">
        <div>
          <div class="product-search-eyebrow">Product finder</div>
          <h2 id="productSearchTitle">Search the catalog</h2>
        </div>
        <button id="closeProductSearch" class="product-search-close" type="button" aria-label="Close search">&times;</button>
      </div>
      <label for="productSearchInput" class="sr-only">Search products</label>
      <div class="product-search-input-wrap">
        <span class="nav-search-icon" aria-hidden="true"></span>
        <input id="productSearchInput" type="search" placeholder="Search compounds, categories, or specifications" autocomplete="off">
      </div>
      <div class="product-search-quick-chips" id="productSearchQuickChips" aria-label="Quick search categories"></div>
      <div id="productSearchStatus" class="product-search-status" aria-live="polite"></div>
      <div id="productSearchResults" class="product-search-results"></div>
    </section>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function getProductSearchCatalog() {
  if (Array.isArray(window.siteCatalog) && window.siteCatalog.length) {
    return Promise.resolve(window.siteCatalog);
  }
  if (!productSearchCatalogPromise) {
    productSearchCatalogPromise = api('/api/catalog').then(data => {
      window.siteCatalog = data.products;
      window.siteFees = { packagingFee: data.packagingFee, shippingFee: data.shippingFee, internationalShippingFee: data.internationalShippingFee || 35, priorityShippingFee: data.priorityShippingFee || 19.99, shippingOptions: data.shippingOptions || [], orderFeeRate: data.orderFeeRate || 0, altPaymentDiscountRate: data.altPaymentDiscountRate || 0, accountCryptoDiscountRate: data.accountCryptoDiscountRate || 0 };
      window.sitePromotion = data.promotion || null;
      return data.products;
    });
  }
  return productSearchCatalogPromise;
}

function initProductSearch() {
  const openButton = document.getElementById('openProductSearch');
  if (!openButton || openButton.dataset.searchWired === 'yes') return;
  openButton.dataset.searchWired = 'yes';

  const overlay = ensureProductSearchOverlay();
  const closeButton = document.getElementById('closeProductSearch');
  const input = document.getElementById('productSearchInput');
  const results = document.getElementById('productSearchResults');
  const status = document.getElementById('productSearchStatus');
  const quickChips = document.getElementById('productSearchQuickChips');

  const renderQuickChips = async () => {
    const catalog = await getProductSearchCatalog();
    const groups = [...new Set(catalog.map(p => p.group || p.category).filter(Boolean))].slice(0, 6);
    if (quickChips) {
      quickChips.innerHTML = groups.map(group => `<button type="button" data-query="${escapeHTML(group)}">${escapeHTML(group)}</button>`).join('');
      quickChips.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => { input.value = btn.dataset.query; renderResults(); input.focus(); };
      });
    }
  };

  const renderResults = async () => {
    const catalog = await getProductSearchCatalog();
    const query = input.value.trim().toLowerCase();
    const matches = query
      ? catalog.filter(p => searchableValues(p).some(value => value.includes(query)))
      : catalog.filter(p => p.popular).slice(0, 8);

    status.textContent = query
      ? `${matches.length} result${matches.length === 1 ? '' : 's'}`
      : 'Popular research products';
    results.innerHTML = matches.length
      ? matches.slice(0, 24).map(productSearchResultHTML).join('')
      : '<div class="product-search-empty"><strong>No products found</strong><span>Try another compound, category, or specification.</span></div>';
  };

  const openSearch = () => {
    overlay.hidden = false;
    document.body.classList.add('search-open');
    input.value = '';
    status.textContent = 'Loading products';
    results.innerHTML = '';
    renderQuickChips();
    renderResults();
    requestAnimationFrame(() => input.focus());
  };

  const closeSearch = () => {
    overlay.hidden = true;
    document.body.classList.remove('search-open');
    openButton.focus();
  };

  openButton.addEventListener('click', openSearch);
  closeButton.addEventListener('click', closeSearch);
  input.addEventListener('input', renderResults);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeSearch();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) closeSearch();
  });
}

function showAccountWelcomePrompt() {
  if (hpAccountState.authenticated || document.getElementById('accountWelcomePrompt')) return;
  const key = 'hp_account_prompt_seen_at';
  const lastSeen = Number(localStorage.getItem(key) || 0);
  if (lastSeen && Date.now() - lastSeen < 7 * 86400000) return;
  localStorage.setItem(key, String(Date.now()));
  const overlay = document.createElement('div');
  overlay.id = 'accountWelcomePrompt';
  overlay.className = 'account-welcome-overlay';
  overlay.innerHTML = `<section class="account-welcome-card" role="dialog" aria-modal="true" aria-labelledby="accountWelcomeTitle">
    <button class="account-welcome-close" type="button" aria-label="Continue as guest">&times;</button>
    <h2 id="accountWelcomeTitle">Make checkout faster next time.</h2>
    <p>Create a verified account to <strong>track your order progress</strong>, keep your order history in one place, and keep any referral store credit in one place.</p>
    <div class="account-welcome-benefits"><span>Track order progress</span><span>Order history</span><span>Referral store credit</span></div>
    <a class="account-welcome-cta" href="/account.html?view=register">Create my account</a>
    <button class="account-welcome-skip" type="button">Continue as guest</button>
    <small>Accounts are optional. Guest checkout is always available.</small>
  </section>`;
  const close = () => { overlay.remove(); document.body.classList.remove('account-welcome-open'); };
  overlay.querySelector('.account-welcome-close').onclick = close;
  overlay.querySelector('.account-welcome-skip').onclick = close;
  overlay.onclick = event => { if (event.target === overlay) close(); };
  document.body.appendChild(overlay);
  document.body.classList.add('account-welcome-open');
}

async function initAccountWelcomePrompt() {
  if (!['/', '/index.html'].includes(location.pathname)) return;
  await refreshAccountState();
  if (hpAccountState.authenticated) return;
  const launch = () => setTimeout(showAccountWelcomePrompt, 650);
  const gate = document.getElementById('entryGate');
  if (gate && getComputedStyle(gate).display !== 'none') {
    document.getElementById('entryAgreeBtn')?.addEventListener('click', launch, { once: true });
  } else launch();
}

document.addEventListener('DOMContentLoaded', () => {
  initProductSearch();
  initAccountNavigation();
  initAccountWelcomePrompt();
  updateCartBadge();
});
function cartSubtotal() {
  const cart = getCart();
  return Object.keys(cart).filter(s => cart[s] > 0).reduce((sum, sku) => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    return p ? sum + cartLinePricing(sku, cart).total : sum;
  }, 0);
}

function cartPromoEligibleSubtotal() {
  const cart = getCart();
  return Object.keys(cart).filter(s => cart[s] > 0).reduce((sum, sku) => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    return p && p.promoEligible !== false ? sum + cartLinePricing(sku, cart).total : sum;
  }, 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function selectedShippingMethod() {
  const checked = document.querySelector('input[name="shippingMethod"]:checked');
  return checked && ['international', 'priority'].includes(checked.value) ? checked.value : 'domestic';
}

function selectedShippingFee() {
  const fees = window.siteFees || {};
  const method = selectedShippingMethod();
  if (method === 'international') return Number(fees.internationalShippingFee || 35);
  if (method === 'priority') return Number(fees.priorityShippingFee || 19.99);
  return Number(fees.shippingFee || 0);
}

function selectedShippingLabel() {
  const method = selectedShippingMethod();
  return method === 'international' ? 'International shipping' : method === 'priority' ? 'Priority Mail' : 'U.S. shipping';
}

function selectedCountryCode() {
  return (document.getElementById('buyerCountry')?.value || 'US').trim().toUpperCase();
}

function selectedCountryName() {
  const select = document.getElementById('buyerCountry');
  return select && select.selectedOptions && select.selectedOptions[0]
    ? select.selectedOptions[0].textContent.trim()
    : selectedCountryCode();
}

function updateShippingCountryNote() {
  const note = document.getElementById('shippingCountryNote');
  if (!note) return;
  const country = selectedCountryName() || 'United States';
  const method = selectedShippingMethod();
  note.textContent = method === 'international'
    ? `International shipping selected for ${country}. Please confirm this is the correct destination country before payment.`
    : method === 'priority'
      ? `Priority Mail selected. Priority Mail ships to U.S. addresses only.`
      : `U.S. shipping selected. Use International shipping for any destination outside the U.S.`;
}

let shippingAddressAutocomplete = null;
let googleAddressLoader = null;

function setAddressValidationStatus(message, tone = '') {
  const status = document.getElementById('addressValidationStatus');
  if (!status) return;
  status.textContent = message || '';
  status.dataset.tone = tone;
}

function googleAddressScript(browserKey) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (googleAddressLoader) return googleAddressLoader;
  googleAddressLoader = new Promise((resolve, reject) => {
    const callbackName = `__snowyGoogleMapsReady${Date.now()}`;
    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(browserKey)}&loading=async&libraries=places&v=weekly&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      delete window[callbackName];
      reject(new Error('Address search could not load.'));
    };
    document.head.appendChild(script);
  });
  return googleAddressLoader;
}

function addressComponent(components, type, text = 'longText') {
  const match = components.find(component => Array.isArray(component.types) && component.types.includes(type));
  return match ? String(match[text] || match.longText || '').trim() : '';
}

async function fillShippingAddress(placePrediction) {
  const place = placePrediction.toPlace();
  await place.fetchFields({ fields: ['addressComponents'] });
  const components = Array.isArray(place.addressComponents) ? place.addressComponents : [];
  if (!components.length) throw new Error('That suggestion did not include a complete address.');

  const streetNumber = addressComponent(components, 'street_number');
  const route = addressComponent(components, 'route', 'shortText');
  const streetAddress = addressComponent(components, 'street_address');
  const subpremise = addressComponent(components, 'subpremise');
  const locality = addressComponent(components, 'locality')
    || addressComponent(components, 'postal_town')
    || addressComponent(components, 'sublocality_level_1');
  const state = addressComponent(components, 'administrative_area_level_1', 'shortText');
  const country = addressComponent(components, 'country', 'shortText').toUpperCase();
  const postalCode = addressComponent(components, 'postal_code');
  const postalSuffix = addressComponent(components, 'postal_code_suffix');
  const fields = {
    buyerAddress1: streetAddress || [streetNumber, route].filter(Boolean).join(' '),
    buyerAddress2: subpremise ? `Unit ${subpremise}` : '',
    buyerCity: locality,
    buyerState: state,
    buyerZip: postalSuffix ? `${postalCode}-${postalSuffix}` : postalCode,
  };
  Object.entries(fields).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (input && value) input.value = value;
  });
  const countrySelect = document.getElementById('buyerCountry');
  if (countrySelect && country && countrySelect.querySelector(`option[value="${country}"]`)) {
    countrySelect.value = country;
    countrySelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  setAddressValidationStatus('Address selected. We will verify deliverability and any required apartment or unit before creating the order.', 'success');
  document.getElementById('buyerAddress2')?.focus();
}

async function initShippingAddressAutocomplete() {
  const field = document.getElementById('addressAutocompleteField');
  const mount = document.getElementById('addressAutocompleteMount');
  if (!field || !mount || shippingAddressAutocomplete) return;
  try {
    const config = await api('/api/address/config');
    if (!config.autocompleteEnabled || !config.browserKey) return;
    await googleAddressScript(config.browserKey);
    const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
    const autocomplete = new PlaceAutocompleteElement();
    autocomplete.placeholder = 'Start typing your street address';
    autocomplete.includedRegionCodes = [selectedCountryCode()];
    autocomplete.addEventListener('gmp-select', event => {
      fillShippingAddress(event.placePrediction).catch(err => {
        setAddressValidationStatus(err.message || 'Choose a complete street address.', 'error');
      });
    });
    mount.replaceChildren(autocomplete);
    shippingAddressAutocomplete = autocomplete;
    field.hidden = false;
  } catch (_) {
    field.hidden = true;
  }
}

function focusAddressError(error) {
  const fieldId = error?.field === 'address2' || ['missing_unit', 'invalid_unit'].includes(error?.code)
    ? 'buyerAddress2'
    : 'buyerAddress1';
  const input = document.getElementById(fieldId);
  if (input) {
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (['missing_unit', 'invalid_unit', 'invalid_address', 'address_validation_unavailable'].includes(error?.code)) {
    setAddressValidationStatus(error.message, 'error');
  }
}

// ---------- Checkout modal (lives on the cart page only) ----------
let checkoutVerifiedEmail = '';

function checkoutResearchEmail() {
  return String(document.getElementById('buyerEmail')?.value || '').trim().toLowerCase();
}

function setCheckoutEmailStatus(message, verified = false, error = false) {
  const status = document.getElementById('checkoutEmailStatus');
  checkoutVerifiedEmail = verified ? checkoutResearchEmail() : '';
  if (status) {
    status.textContent = message;
    status.style.color = verified ? 'var(--success)' : error ? 'var(--danger)' : 'var(--muted-on-light)';
  }
}

// Saves this cart against the verified email so we can send one "you left
// something in your cart" reminder if checkout is not finished.
function reportCheckoutStarted(email) {
  const cart = getCart();
  const items = Object.keys(cart).filter(sku => cart[sku] > 0).map(sku => ({ sku, quantity: cart[sku] }));
  if (!email || !items.length) return;
  fetch('/api/checkout-started', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, items }),
  }).catch(() => {});
}

async function refreshCheckoutEmailStatus() {
  const email = checkoutResearchEmail();
  if (!email) return setCheckoutEmailStatus('Enter your email to receive a code.');
  try {
    const result = await api(`/api/checkout-email/status?email=${encodeURIComponent(email)}`);
    if (checkoutResearchEmail() !== email) return;
    setCheckoutEmailStatus(result.verified ? 'Email verified for this checkout.' : 'Verify this email before choosing a payment method.', result.verified);
    if (result.verified) reportCheckoutStarted(email);
  } catch { setCheckoutEmailStatus('Could not check email verification status.', false, true); }
}

async function sendCheckoutEmailCode() {
  const email = checkoutResearchEmail();
  const button = document.getElementById('checkoutSendCodeBtn');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setCheckoutEmailStatus('Enter a valid email first.', false, true);
  button.disabled = true;
  try {
    const result = await api('/api/checkout-email/send', { method: 'POST', body: { email } });
    if (checkoutResearchEmail() === email) setCheckoutEmailStatus(result.message);
  } catch (err) { setCheckoutEmailStatus(err.message, false, true); }
  finally { button.disabled = false; }
}

async function verifyCheckoutEmailCode() {
  const email = checkoutResearchEmail();
  const code = String(document.getElementById('checkoutEmailCode').value || '').trim();
  const button = document.getElementById('checkoutVerifyCodeBtn');
  if (!/^\d{6}$/.test(code)) return setCheckoutEmailStatus('Enter the six-digit code from your email.', false, true);
  button.disabled = true;
  try {
    await api('/api/checkout-email/verify', { method: 'POST', body: {
      email, code, rememberDevice: document.getElementById('checkoutRememberDevice').checked,
    } });
    if (checkoutResearchEmail() === email) setCheckoutEmailStatus('Email verified for this checkout.', true);
    reportCheckoutStarted(email);
  } catch (err) { setCheckoutEmailStatus(err.message, false, true); }
  finally { button.disabled = false; }
}

let appliedDiscount = null; // { code, percentOff } | null
const HP_CHECKOUT_ATTEMPT_KEY = 'hp_checkout_attempt';
let currentCheckoutAttemptId = '';
let checkoutShippingTracked = false;
const checkoutTrackedMethods = new Set();
const checkoutTrackedErrors = new Set();

function newAnonymousId() {
  return window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function checkoutCartSignature() {
  return Object.entries(getCart())
    .filter(([, quantity]) => Number(quantity) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sku, quantity]) => `${sku}:${quantity}`)
    .join('|');
}

function checkoutAttemptId() {
  if (currentCheckoutAttemptId) return currentCheckoutAttemptId;
  const cartSignature = checkoutCartSignature();
  try {
    const stored = JSON.parse(sessionStorage.getItem(HP_CHECKOUT_ATTEMPT_KEY) || 'null');
    if (stored && stored.id && stored.cartSignature === cartSignature && Date.now() - Number(stored.startedAt || 0) < 30 * 60 * 1000) {
      currentCheckoutAttemptId = stored.id;
      return currentCheckoutAttemptId;
    }
  } catch {}
  currentCheckoutAttemptId = newAnonymousId();
  try {
    sessionStorage.setItem(HP_CHECKOUT_ATTEMPT_KEY, JSON.stringify({
      id: currentCheckoutAttemptId,
      cartSignature,
      startedAt: Date.now(),
    }));
  } catch {}
  return currentCheckoutAttemptId;
}

function finishCheckoutAttempt() {
  currentCheckoutAttemptId = '';
  checkoutShippingTracked = false;
  checkoutTrackedMethods.clear();
  checkoutTrackedErrors.clear();
  try { sessionStorage.removeItem(HP_CHECKOUT_ATTEMPT_KEY); } catch {}
}

function trackCheckoutEvent(type, details = {}) {
  hpTrack(type, { checkoutAttemptId: checkoutAttemptId(), ...details });
}

function trackPaymentMethod(paymentMethod) {
  if (!paymentMethod || checkoutTrackedMethods.has(paymentMethod)) return;
  checkoutTrackedMethods.add(paymentMethod);
  trackCheckoutEvent('payment_method_selected', { paymentMethod });
}

function trackShippingInfoAdded() {
  if (checkoutShippingTracked) return;
  checkoutShippingTracked = true;
  trackCheckoutEvent('shipping_info_added');
}

function trackCheckoutError(stage, reason, paymentMethod = '') {
  const key = `${stage}|${reason}|${paymentMethod}`;
  if (checkoutTrackedErrors.has(key)) return;
  checkoutTrackedErrors.add(key);
  trackCheckoutEvent('checkout_error', { stage, reason, paymentMethod });
}

function trackPaymentFailure(paymentMethod, reason) {
  trackCheckoutEvent('payment_failed', { paymentMethod, reason });
}

function renderCheckoutSummary() {
  const cart = getCart();
  const summaryEl = document.getElementById('modalOrderSummary');
  if (!summaryEl) return;

  const skus = Object.keys(cart).filter(s => cart[s] > 0);
  const subtotal = round2(cartSubtotal());
  const promoEligibleSubtotal = round2(cartPromoEligibleSubtotal());
  const shippingFee = selectedShippingFee();
  const referralCampaign = activeReferralCampaign();
  const cryptoChosen = typeof cryptoChoiceOpen !== 'undefined' && cryptoChoiceOpen;
  const extraCodePercent = referralCampaign && appliedDiscount ? 5 : 0;
  // Crypto orders get one flat discount that replaces codes and referral offers.
  const discountAmount = cryptoChosen ? 0 : (referralCampaign
    ? round2(promoEligibleSubtotal * (10 + extraCodePercent) / 100)
    : (appliedDiscount ? round2(promoEligibleSubtotal * appliedDiscount.percentOff / 100) : 0));
  const creditToggle = document.getElementById('applyStoreCredit');
  const availableCredit = hpAccountState.authenticated && hpAccountState.account
    ? Number(hpAccountState.account.creditBalance || 0)
    : 0;
  const storeCreditAmount = creditToggle && creditToggle.checked
    ? round2(Math.min(availableCredit, Math.max(0, subtotal - discountAmount)))
    : 0;
  const baseFeeRate = (window.siteFees && window.siteFees.orderFeeRate) || 0;
  const cryptoSelected = typeof cryptoChoiceOpen !== 'undefined' && cryptoChoiceOpen;
  const orderFeeRate = cryptoSelected ? 0 : baseFeeRate;
  // Crypto orders get a flat 15% off (never combined with codes or referral offers).
  const cryptoRate = cryptoSelected && !appliedDiscount
    ? ((window.siteFees && window.siteFees.altPaymentDiscountRate) || 0)
    : 0;
  const cryptoDiscount = round2(subtotal * cryptoRate);
  const feeBase = Math.max(0, subtotal - discountAmount - cryptoDiscount - storeCreditAmount + shippingFee);
  const orderFee = round2(feeBase * orderFeeRate);
  const waivedFee = round2(feeBase * baseFeeRate);
  const total = round2(feeBase + orderFee);

  const lines = skus.map(sku => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    if (!p) return '';
    const pricing = cartLinePricing(sku, cart);
    return `<div class="cart-row"><span>${escapeHTML(p.name)} ${escapeHTML(cleanVialSpec(p.spec))} x${cart[sku]}${pricing.savings ? ` · save $${pricing.savings.toFixed(2)}` : ''}</span><span>$${pricing.total.toFixed(2)}</span></div>`;
  }).join('');
  const promotion = bundlePromotionState(cart);
  const rewardLine = (promotion.unlocked && promotion.freeProduct
    ? `<div class="cart-row bundle-summary-line"><span>${escapeHTML(promotion.freeProduct.name)} ${escapeHTML(cleanVialSpec(promotion.freeProduct.spec))} x${promotion.freeQuantity}</span><strong>FREE</strong></div>`
    : '') + (appliedDiscount && appliedDiscount.gift && !(promotion.unlocked && promotion.freeSku === appliedDiscount.gift.sku)
    ? `<div class="cart-row bundle-summary-line code-gift-line"><span>${escapeHTML(appliedDiscount.gift.name)} ${escapeHTML(cleanVialSpec(appliedDiscount.gift.spec))} x${appliedDiscount.gift.quantity} · ${escapeHTML(appliedDiscount.code)} gift</span><strong>FREE</strong></div>`
    : '');

  const breakdown = [
    `<div class="cart-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>`,
    (referralCampaign && !cryptoSelected) ? `<div class="cart-row"><span>Referral link (10%)${appliedDiscount ? ` + ${escapeHTML(appliedDiscount.code)} (${extraCodePercent}%)` : ''}</span><span>-$${discountAmount.toFixed(2)}</span></div>` : (appliedDiscount ? `<div class="cart-row"><span>Discount (${escapeHTML(appliedDiscount.code)})</span><span>-$${discountAmount.toFixed(2)}</span></div>` : ''),
    cryptoDiscount ? `<div class="cart-row crypto-discount-line"><span>Crypto discount (${Math.round(cryptoRate * 100)}%)</span><span>-$${cryptoDiscount.toFixed(2)}</span></div>` : '',
    storeCreditAmount ? `<div class="cart-row account-credit-summary"><span>Store credit</span><span>-$${storeCreditAmount.toFixed(2)}</span></div>` : '',
    `<div class="cart-row"><span>${selectedShippingLabel()}</span><span>$${shippingFee.toFixed(2)}</span></div>`,
    baseFeeRate ? (cryptoSelected
      ? `<div class="cart-row fee-waived"><span>Processing fee <em>Waived with crypto</em></span><span><s>$${waivedFee.toFixed(2)}</s> $0.00</span></div>`
      : `<div class="cart-row"><span>Processing fee <em>Waived if you pay with crypto</em></span><span>$${orderFee.toFixed(2)}</span></div>`) : '',
    `<div class="order-summary-total cart-row"><span>Total</span><span>$${total.toFixed(2)}</span></div>`,
  ].join('');

  summaryEl.innerHTML = lines + rewardLine + '<div class="order-summary-divider" style="height:1px; background:var(--border-on-light); margin:10px 0;"></div>' + breakdown;
}

function checkoutPayloadFromForm() {
  const cart = getCart();
  const activeSkus = new Set((window.siteCatalog || []).map(p => p.sku));
  const items = Object.keys(cart)
    .filter(sku => cart[sku] > 0 && (!activeSkus.size || activeSkus.has(sku)))
    .map(sku => ({ sku, quantity: cart[sku] }));
  const analytics = analyticsContext();
  return {
    items,
    buyer: {
      name: document.getElementById('buyerName').value.trim(),
      email: document.getElementById('buyerEmail').value.trim(),
      address1: document.getElementById('buyerAddress1').value.trim(),
      address2: document.getElementById('buyerAddress2').value.trim(),
      city: document.getElementById('buyerCity').value.trim(),
      state: document.getElementById('buyerState').value.trim(),
      zip: document.getElementById('buyerZip').value.trim(),
      country: selectedCountryCode(),
    },
    certified: document.getElementById('checkoutCertify').checked,
    shippingMethod: selectedShippingMethod(),
    paymentPolicyAccepted: document.getElementById('paymentPolicyConfirm')?.checked === true,
    discountCode: appliedDiscount ? appliedDiscount.code : null,
    referralCampaign: activeReferralCampaign(),
    applyStoreCredit: document.getElementById('applyStoreCredit')?.checked === true,
    paymentMethod: null,
    analyticsVisitorId: analytics.visitorId,
    analyticsSessionId: analytics.sessionId,
    analyticsCheckoutAttemptId: checkoutAttemptId(),
  };
}

function validateCheckoutPayload(payload, msgEl) {
  const fail = (message, reason) => {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = message;
    trackCheckoutError('validation', reason, payload.paymentMethod);
    return false;
  };
  if (payload.items.length === 0) {
    return fail('Cart is empty.', 'empty_cart');
  }
  if (!payload.buyer.name || !payload.buyer.email || !payload.buyer.address1 || !payload.buyer.city || !payload.buyer.state || !payload.buyer.zip || !payload.buyer.country) {
    return fail('Name, email, destination country, and full shipping address are required before payment.', 'missing_shipping_fields');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.buyer.email)) {
    return fail('Enter a valid email address before payment.', 'invalid_email');
  }
  if (!/^[A-Z]{2}$/.test(payload.buyer.country)) {
    return fail('Select a valid destination country from the list.', 'invalid_country');
  }
  if (payload.shippingMethod === 'priority' && payload.buyer.country !== 'US') {
    return fail('Priority Mail is only available for U.S. addresses. Choose International shipping instead.', 'priority_country_mismatch');
  }
  if (payload.shippingMethod === 'domestic' && payload.buyer.country !== 'US') {
    return fail('Choose International shipping for destinations outside the U.S.', 'domestic_country_mismatch');
  }
  if (payload.shippingMethod === 'international' && payload.buyer.country === 'US') {
    return fail('International shipping is for destinations outside the U.S. Change the country or select U.S. shipping.', 'international_country_mismatch');
  }
  trackShippingInfoAdded();
  if (!payload.certified) {
    return fail('You must certify research/business use before payment.', 'research_certification_missing');
  }
  if (checkoutVerifiedEmail !== payload.buyer.email.toLowerCase()) {
    return fail('Verify your checkout email with the six-digit code before payment.', 'email_verification_missing');
  }
  if (!payload.paymentPolicyAccepted) {
    return fail('Confirm the exact-payment policy before payment.', 'payment_policy_missing');
  }
  msgEl.textContent = '';
  return true;
}

function clearCartAfterCheckout() {
  saveCart({});
  appliedDiscount = null;
  updateCartBadge();
  document.dispatchEvent(new CustomEvent('cart:updated'));
  document.getElementById('checkoutForm').reset();
  setCheckoutEmailStatus('Enter your email to receive a code.');
  if (shippingAddressAutocomplete) shippingAddressAutocomplete.value = '';
  setAddressValidationStatus('');
  finishCheckoutAttempt();
}

async function refreshCheckoutAccountStatus() {
  const container = document.getElementById('checkoutAccountStatus');
  if (!container) return;
  const state = await refreshAccountState();
  if (!state.authenticated || !state.account) {
    container.className = 'checkout-account-status guest';
    container.innerHTML = '<div><strong>Checkout as a guest</strong><span>Optional: <a href="/account.html?return=cart">sign in</a> to use store credit and view order history.</span></div>';
    renderCheckoutSummary();
    return;
  }
  const balance = Number(state.account.creditBalance || 0);
  container.className = 'checkout-account-status signed-in';
  container.innerHTML = `
    <div>
      <strong>Signed in as ${escapeHTML(state.account.name)}</strong>
      <span>${escapeHTML(state.account.email)}</span>
    </div>
    ${balance > 0 ? `<label class="store-credit-toggle"><input id="applyStoreCredit" type="checkbox"> Apply up to <strong>$${balance.toFixed(2)}</strong> store credit</label>` : '<span class="store-credit-empty">Approved referral credit will appear here.</span>'}
    <span class="member-crypto-note">${activeReferralCampaign() ? 'Referral link: 10% off card orders, and one valid code can add up to 5%. Crypto orders get a flat 15% off instead.' : 'Crypto orders get 15% off automatically.'}</span>`;
  const toggle = document.getElementById('applyStoreCredit');
  if (toggle) toggle.addEventListener('change', renderCheckoutSummary);
  const nameInput = document.getElementById('buyerName');
  const emailInput = document.getElementById('buyerEmail');
  if (nameInput && !nameInput.value) nameInput.value = state.account.name;
  if (emailInput && !emailInput.value) emailInput.value = state.account.email;
  refreshCheckoutEmailStatus();
  renderCheckoutSummary();
}

function openCheckoutModal() {
  appliedDiscount = null;
  lastCryptoOrder = null;
  cryptoChoiceOpen = false;
  const promoInput = document.getElementById('promoInput');
  const promoMsg = document.getElementById('promoMsg');
  const checkoutMsg = document.getElementById('checkoutMsg');
  const cryptoMsg = document.getElementById('cryptoMsg');
  const cryptoDetails = document.getElementById('cryptoPaymentDetails');
  if (promoInput) promoInput.value = '';
  if (promoMsg) promoMsg.textContent = activeReferralCampaign() ? 'Referral link applied: 10% off. One valid code adds up to 5% more. (Crypto orders get a flat 15% off instead.)' : '';
  if (checkoutMsg) checkoutMsg.textContent = '';
  if (cryptoMsg) cryptoMsg.textContent = '';
  const manualDetails = document.getElementById('manualPaymentDetails');
  const cryptoChoice = document.getElementById('cryptoChoiceDetails');
  if (manualDetails) manualDetails.style.display = 'none';
  if (cryptoChoice) cryptoChoice.style.display = 'none';
  if (cryptoDetails) cryptoDetails.style.display = 'none';
  const cryptoButton = document.getElementById('cryptoCheckoutBtn');
  if (cryptoButton) cryptoButton.querySelector('strong').innerHTML = 'Crypto <em>15% off</em>';
  updateShippingCountryNote();
  initShippingAddressAutocomplete();
  renderCheckoutSummary();
  refreshCheckoutAccountStatus();
  refreshCheckoutEmailStatus();
  renderCryptoPricePreview();
  document.body.classList.add('checkout-modal-open');
  document.getElementById('checkoutModal').style.display = 'flex';
  trackCheckoutEvent('checkout_start');

}

function closeCheckoutModal() {
  document.getElementById('checkoutModal').style.display = 'none';
  document.body.classList.remove('checkout-modal-open');
}

async function applyPromoCode() {
  const input = document.getElementById('promoInput');
  const msgEl = document.getElementById('promoMsg');
  const code = input.value.trim();
  if (!code) {
    appliedDiscount = null;
    msgEl.textContent = activeReferralCampaign() ? 'Referral link applied: 10% off. One valid code adds up to 5% more.' : '';
    renderCheckoutSummary();
    renderCryptoPricePreview();
    return;
  }
  try {
    const result = await api(`/api/discount-code?code=${encodeURIComponent(code)}`);
    if (result.valid) {
      appliedDiscount = { code: result.code, percentOff: result.percentOff, gift: result.gift || null };
      msgEl.style.color = 'var(--success)';
      const offer = bundlePromotionState(getCart());
      const giftAlreadyIncluded = result.gift && offer.unlocked && offer.freeSku === result.gift.sku;
      msgEl.textContent = !result.gift
        ? `${result.percentOff}% off applied.`
        : giftAlreadyIncluded
          ? `${result.percentOff}% off applied. Your free ${result.gift.name} ${cleanVialSpec(result.gift.spec)} is already included.`
          : `${result.percentOff}% off + a free ${result.gift.name} ${cleanVialSpec(result.gift.spec)} applied.`;
    } else {
      appliedDiscount = null;
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'Invalid code.';
      trackCheckoutError('promo', 'invalid_code');
    }
  } catch {
    appliedDiscount = null;
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Could not check that code, try again.';
    trackCheckoutError('promo', 'lookup_failed');
  }
  renderCheckoutSummary();
  renderCryptoPricePreview();
}

let lastCryptoOrder = null; // { id, email } | null
let cryptoChoiceOpen = false;

function renderCryptoPricePreview() {
  const previewEl = document.getElementById('cryptoPricePreview');
  if (!previewEl) return;
  if (appliedDiscount) {
    previewEl.textContent = 'The 15% crypto discount cannot be combined with a promo or referral code.';
    return;
  }
  const subtotal = round2(cartSubtotal());
  const rate = (window.siteFees && window.siteFees.altPaymentDiscountRate) || 0;
  const shippingFee = selectedShippingFee();
  const orderFeeRate = (window.siteFees && window.siteFees.orderFeeRate) || 0;
  const discount = round2(subtotal * rate);
  const feeBase = Math.max(0, subtotal - discount + shippingFee);
  const total = round2(feeBase); // crypto orders have no processing fee
  previewEl.textContent = rate ? `Crypto price: $${total.toFixed(2)} (saves $${discount.toFixed(2)} with 15% off and no processing fee)` : '';
}

function showManualPaymentShell(title, summary) {
  const details = document.getElementById('manualPaymentDetails');
  const titleEl = document.getElementById('manualPaymentTitle');
  const summaryEl = document.getElementById('manualPaymentSummary');
  if (details) details.style.display = 'block';
  if (titleEl) titleEl.textContent = title;
  if (summaryEl) summaryEl.innerHTML = summary;
}

async function submitCryptoCheckout() {
  const msgEl = document.getElementById('checkoutMsg');
  const btn = document.getElementById('cryptoCheckoutBtn');
  const choice = document.getElementById('cryptoChoiceDetails');
  trackPaymentMethod('crypto');

  if (appliedDiscount) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Crypto orders already get 15% off and cannot be combined with promo or referral codes. Remove the code or choose another payment method.';
    return;
  }

  if (!cryptoChoiceOpen) {
    cryptoChoiceOpen = true;
    renderCheckoutSummary();
    if (choice) choice.style.display = 'block';
    showManualPaymentShell('Crypto payment', 'Choose BTC or USDC, then submit the order to get the exact payment total and address. Your 15% crypto discount is applied automatically and replaces any code or referral offer.');
    btn.querySelector('strong').innerHTML = 'Submit Crypto Order <em>15% off</em>';
    return;
  }

  const asset = document.getElementById('cryptoAssetSelect').value;
  const payload = checkoutPayloadFromForm();
  payload.paymentMethod = 'crypto';
  payload.cryptoAsset = asset;

  if (!validateCheckoutPayload(payload, msgEl)) return;

  const buyerEmail = payload.buyer.email;
  btn.disabled = true;
  try {
    const result = await api('/api/checkout', { method: 'POST', body: payload });
    msgEl.style.color = 'var(--success)';
    msgEl.textContent = 'Order submitted. Please send the exact total shown below for manual verification.';
    lastCryptoOrder = { id: result.orderId, email: buyerEmail };

    showManualPaymentShell('Crypto payment instructions', `<strong>Order #${result.orderId}</strong><br>Exact total due: <strong>$${result.total.toFixed(2)}</strong><br><span class="hint">Unique matching cents: $${Number(result.paymentMatchAdjustment || 0).toFixed(2)}</span><br><span class="hint">If the amount sent is incorrect, we will contact you and pause fulfillment until the payment is resolved. Your refund rights remain in effect.</span>`);

    if (result.crypto) {
      document.getElementById('cryptoAddressText').textContent = result.crypto.address;
      document.getElementById('cryptoNetworkNote').textContent = `${result.crypto.network}. Reference: ${result.crypto.reference}`;
      document.getElementById('cryptoPaymentDetails').style.display = 'block';
    }
    clearCartAfterCheckout();
  } catch (err) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = err.message;
    focusAddressError(err);
    trackCheckoutError('order_creation', 'submission_failed', 'crypto');
  } finally {
    btn.disabled = false;
  }
}

async function confirmCryptoPayment() {
  const msgEl = document.getElementById('cryptoConfirmMsg');
  const btn = document.getElementById('cryptoConfirmBtn');
  const txid = document.getElementById('cryptoTxidInput').value.trim();

  if (!lastCryptoOrder) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Submit your order first.';
    return;
  }
  if (!txid) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Paste your transaction ID first.';
    return;
  }

  btn.disabled = true;
  try {
    const result = await api(`/api/orders/${lastCryptoOrder.id}/confirm-crypto`, {
      method: 'POST',
      body: { email: lastCryptoOrder.email, txid },
    });
    msgEl.style.color = 'var(--success)';
    msgEl.textContent = result.message;
  } catch (err) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = err.message;
    trackCheckoutError('payment_confirmation', 'reference_submission_failed', 'crypto');
  } finally {
    btn.disabled = false;
  }
}

async function initStripeSandboxCheckout() {
  const btn = document.getElementById('stripeSandboxCheckoutBtn');
  if (!btn) return;
  let stripeMode = null;
  try {
    const config = await api('/api/stripe/config');
    if (config.enabled && ['test', 'live'].includes(config.mode)) {
      stripeMode = config.mode;
      btn.hidden = false;
      btn.style.display = '';
      if (stripeMode === 'test') {
        document.getElementById('stripeCheckoutTitle').textContent = 'Card (Stripe test mode)';
        document.getElementById('stripeCheckoutDescription').textContent = 'Sandbox only. No real charge or fulfillment; available during local integration testing.';
      }
    }
  } catch (_) { /* Stripe is optional and remains hidden when unavailable. */ }
  btn.addEventListener('click', async () => {
    const msgEl = document.getElementById('checkoutMsg');
    const payload = checkoutPayloadFromForm();
    payload.paymentMethod = 'stripe';
    trackPaymentMethod('stripe');
    if (!validateCheckoutPayload(payload, msgEl)) return;
    btn.disabled = true;
    try {
      const result = await api('/api/stripe/create-checkout-session', { method: 'POST', body: payload });
      if (result.mode !== stripeMode || !/^https:\/\//.test(result.url || '')) throw new Error('Stripe checkout is unavailable.');
      window.location.assign(result.url);
    } catch (err) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = err.message;
      focusAddressError(err);
      btn.disabled = false;
    }
  });
}

function wireCheckout() {
  document.getElementById('buyerEmail')?.addEventListener('input', () => {
    setCheckoutEmailStatus('Verify this email before choosing a payment method.');
  });
  document.getElementById('buyerEmail')?.addEventListener('change', refreshCheckoutEmailStatus);
  document.getElementById('checkoutSendCodeBtn')?.addEventListener('click', sendCheckoutEmailCode);
  document.getElementById('checkoutVerifyCodeBtn')?.addEventListener('click', verifyCheckoutEmailCode);
  document.getElementById('checkoutBtn').addEventListener('click', () => {
    const cartMsg = document.getElementById('cartMsg');
    const skus = Object.keys(getCart()).filter(s => getCart()[s] > 0);
    if (skus.length === 0) {
      cartMsg.style.color = 'var(--danger)';
      cartMsg.textContent = 'Cart is empty.';
      return;
    }
    cartMsg.textContent = '';
    openCheckoutModal();
  });

  document.getElementById('checkoutCloseBtn').addEventListener('click', closeCheckoutModal);
  document.getElementById('checkoutModal').addEventListener('click', (e) => {
    if (e.target.id === 'checkoutModal') closeCheckoutModal();
  });


  document.querySelectorAll('input[name="shippingMethod"]').forEach(input => {
    input.addEventListener('change', () => {
      updateShippingCountryNote();
      renderCheckoutSummary();
      renderCryptoPricePreview();
    });
  });

  const buyerCountryInput = document.getElementById('buyerCountry');
  if (buyerCountryInput) buyerCountryInput.addEventListener('change', () => {
    updateShippingCountryNote();
    if (shippingAddressAutocomplete) shippingAddressAutocomplete.includedRegionCodes = [selectedCountryCode()];
  });

  ['buyerAddress1', 'buyerAddress2', 'buyerCity', 'buyerState', 'buyerZip'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => setAddressValidationStatus('We will verify this delivery address before creating the order.', 'pending'));
  });

  const promoApplyBtn = document.getElementById('promoApplyBtn');
  if (promoApplyBtn) {
    promoApplyBtn.addEventListener('click', applyPromoCode);
    document.getElementById('promoInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyPromoCode(); }
    });
  }

  initStripeSandboxCheckout();

  const cryptoBtn = document.getElementById('cryptoCheckoutBtn');
  if (cryptoBtn) cryptoBtn.addEventListener('click', submitCryptoCheckout);

  const cryptoConfirmBtn = document.getElementById('cryptoConfirmBtn');
  if (cryptoConfirmBtn) cryptoConfirmBtn.addEventListener('click', confirmCryptoPayment);

  const cryptoAssetSelect = document.getElementById('cryptoAssetSelect');
  if (cryptoAssetSelect) cryptoAssetSelect.addEventListener('change', renderCryptoPricePreview);

  document.getElementById('checkoutForm').addEventListener('submit', (e) => {
    e.preventDefault();
  });
}








// ---------- Support chat (messages go to the admin inbox on our server) ----------
const supportChat = { open: false, thread: null, account: null, pollTimer: null, sending: false };

function supportChatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderSupportChat() {
  const list = document.getElementById('snChatMessages');
  const idFields = document.getElementById('snChatIdentity');
  const dot = document.getElementById('snChatDot');
  if (!list) return;
  const messages = supportChat.thread ? supportChat.thread.messages : [];
  list.replaceChildren();
  if (!messages.length) {
    const intro = document.createElement('p');
    intro.className = 'sn-chat-empty';
    intro.textContent = 'Questions about an order, payment, or a product? Send us a message and our team will reply right here.';
    list.appendChild(intro);
  }
  messages.forEach(message => {
    const bubble = document.createElement('div');
    bubble.className = `sn-chat-bubble ${message.from === 'admin' ? 'from-team' : 'from-you'}`;
    const text = document.createElement('p');
    text.textContent = message.body;
    const meta = document.createElement('span');
    meta.textContent = `${message.from === 'admin' ? 'Snowy Support' : 'You'} · ${supportChatTime(message.at)}`;
    bubble.append(text, meta);
    list.appendChild(bubble);
  });
  list.scrollTop = list.scrollHeight;
  const needsIdentity = !supportChat.account && !supportChat.thread;
  if (idFields) idFields.hidden = !needsIdentity;
  const who = document.getElementById('snChatWho');
  if (who) {
    who.textContent = supportChat.account
      ? `Signed in as ${supportChat.account.email}`
      : (supportChat.thread ? `Replying as ${supportChat.thread.email}` : '');
  }
  if (dot) dot.hidden = !(supportChat.thread && supportChat.thread.customerUnread && !supportChat.open);
}

async function refreshSupportChat(markSeen = false) {
  try {
    const response = await fetch(`/api/support/thread${markSeen ? '?seen=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    supportChat.thread = data.thread;
    supportChat.account = data.account;
    renderSupportChat();
  } catch (_) {}
}

function setSupportChatOpen(open) {
  supportChat.open = open;
  const panel = document.getElementById('snChatPanel');
  const launcher = document.getElementById('snChatLauncher');
  if (!panel || !launcher) return;
  panel.hidden = !open;
  launcher.setAttribute('aria-expanded', String(open));
  clearInterval(supportChat.pollTimer);
  if (open) {
    refreshSupportChat(true);
    supportChat.pollTimer = setInterval(() => refreshSupportChat(true), 15000);
    const field = document.getElementById('snChatInput');
    if (field) setTimeout(() => field.focus(), 50);
  }
  renderSupportChat();
}

async function sendSupportChatMessage(event) {
  event.preventDefault();
  if (supportChat.sending) return;
  const input = document.getElementById('snChatInput');
  const status = document.getElementById('snChatStatus');
  const message = input.value.trim();
  if (!message) return;
  const payload = {
    message,
    name: (document.getElementById('snChatName') || {}).value || '',
    email: (document.getElementById('snChatEmail') || {}).value || '',
    website: (document.getElementById('snChatWebsite') || {}).value || '',
  };
  supportChat.sending = true;
  status.textContent = 'Sending…';
  try {
    const response = await fetch('/api/support/messages', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      status.textContent = data.error || 'Message not sent. Please try again.';
      return;
    }
    input.value = '';
    status.textContent = 'Sent. We’ll reply right here.';
    if (data.thread) supportChat.thread = data.thread;
    renderSupportChat();
  } catch (_) {
    status.textContent = 'Message not sent. Check your connection and try again.';
  } finally {
    supportChat.sending = false;
  }
}

function initSupportChat() {
  if (document.getElementById('snChatLauncher') || document.body.classList.contains('admin-page')) return;
  const root = document.createElement('div');
  root.className = 'sn-chat';
  if (document.getElementById('mobileAddToCartBtn')) root.classList.add('sn-chat-raised');
  root.innerHTML = `
    <section id="snChatPanel" class="sn-chat-panel" role="dialog" aria-label="Message Snowy Support" hidden>
      <header class="sn-chat-head">
        <div><strong>Snowy Support</strong><span>Messages go straight to our team.</span></div>
        <button type="button" class="sn-chat-close" id="snChatClose" aria-label="Close chat">×</button>
      </header>
      <div class="sn-chat-messages" id="snChatMessages" aria-live="polite"></div>
      <form class="sn-chat-form" id="snChatForm" autocomplete="on">
        <div class="sn-chat-identity" id="snChatIdentity" hidden>
          <input id="snChatName" type="text" maxlength="80" placeholder="Your name" autocomplete="name">
          <input id="snChatEmail" type="email" maxlength="254" placeholder="Your email" autocomplete="email">
        </div>
        <input id="snChatWebsite" type="text" tabindex="-1" autocomplete="off" class="sn-chat-trap" aria-hidden="true">
        <textarea id="snChatInput" rows="2" maxlength="2000" placeholder="Type your message…" required></textarea>
        <div class="sn-chat-actions"><span id="snChatWho" class="sn-chat-who"></span><button type="submit">Send</button></div>
        <p class="sn-chat-status" id="snChatStatus" role="status"></p>
      </form>
    </section>
    <button type="button" class="sn-chat-launcher" id="snChatLauncher" aria-controls="snChatPanel" aria-expanded="false">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z" fill="currentColor"/></svg>
      <span>Message us</span><i id="snChatDot" class="sn-chat-dot" hidden></i>
    </button>`;
  document.body.appendChild(root);
  document.getElementById('snChatLauncher').addEventListener('click', () => setSupportChatOpen(!supportChat.open));
  document.getElementById('snChatClose').addEventListener('click', () => setSupportChatOpen(false));
  document.getElementById('snChatForm').addEventListener('submit', sendSupportChatMessage);
  document.getElementById('snChatInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.getElementById('snChatForm').requestSubmit(); }
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && supportChat.open) setSupportChatOpen(false); });
  refreshSupportChat(false);
}

window.openSupportChat = () => setSupportChatOpen(true);
window.refreshSupportChat = refreshSupportChat;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSupportChat);
else initSupportChat();
