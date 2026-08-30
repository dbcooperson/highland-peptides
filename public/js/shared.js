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

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
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

function bundlePromotionConfig() {
  return window.sitePromotion || {
    qualifyingQuantity: 5,
    freeSku: 'WA10',
    freeQuantity: 1,
    label: 'Buy 5+ paid research products and receive a free Bac Water 10ml (Bac Water does not count)',
  };
}

function bundleQualifyingQuantity(cart = getCart()) {
  const promotion = bundlePromotionConfig();
  return Object.keys(cart).reduce((total, itemSku) => {
    const product = getCatalogProductBySku(itemSku);
    if (!product || product.sku === promotion.freeSku || product.category === 'Supplies' || product.group === 'Supplies') return total;
    return total + Number(cart[itemSku] || 0);
  }, 0);
}

function bundlePromotionState(cart = getCart()) {
  const promotion = bundlePromotionConfig();
  const qualifying = bundleQualifyingQuantity(cart);
  return {
    ...promotion,
    qualifying,
    remaining: Math.max(0, promotion.qualifyingQuantity - qualifying),
    unlocked: qualifying >= promotion.qualifyingQuantity,
    freeProduct: getCatalogProductBySku(promotion.freeSku),
  };
}

function bundlePromotionMessage(cart = getCart()) {
  const state = bundlePromotionState(cart);
  return state.unlocked
    ? '<strong>Free Bac Water 10ml unlocked</strong><span>It will be added automatically at checkout.</span>'
    : `<strong>Buy 5 research products, get Bac Water 10ml free</strong><span>Add ${state.remaining} more qualifying product${state.remaining === 1 ? '' : 's'}. Bac Water purchases do not count toward the five.</span>`;
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
  const subtotal = Object.keys(cart).reduce((sum, itemSku) => {
    const item = getCatalogProductBySku(itemSku);
    return item ? sum + item.price * cart[itemSku] : sum;
  }, 0);
  const count = cartItemCount(cart);
  const suggestionPool = (Array.isArray(window.siteCatalog) ? window.siteCatalog : [])
    .filter(item => item.sku !== sku);
  const bacWater = suggestionPool.find(item => item.sku === 'WA10');
  const suggestions = [
    ...(bacWater ? [bacWater] : []),
    ...suggestionPool.filter(item => item.sku !== 'WA10' && item.popular),
  ].slice(0, 2);

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
          <div class="cart-popup-suggestions-title">Suggested research products</div>
          <div class="cart-popup-suggestion-grid">
            ${suggestions.map(item => `
              <a href="/product/${encodeURIComponent(item.slug)}" class="cart-popup-suggestion">
                <span class="cart-popup-suggestion-media photo sku-mockup">${productMockupImageHTML(item)}</span>
                <span><strong>${escapeHTML(item.name)}</strong><em>${escapeHTML(cleanVialSpec(item.spec))} &bull; $${item.price.toFixed(2)}</em></span>
              </a>
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
  'Bacteriostatic Water': 'BAC WATER',
};

function productImageStyle(product) {
  if (!product || !product.image) return '';
  return ` style="--mockup-image:url('${escapeHTML(product.image)}')"`;
}

function productMockupImageHTML(product) {
  if (!product || !product.image) return '';
  const src = escapeHTML(product.image);
  const label = `${product.name || 'Product'} ${cleanVialSpec(product.spec || '')} research vial mockup`.trim();
  return `<img class="sku-mockup-img" src="${src}" alt="${escapeHTML(label)}" loading="lazy" decoding="async">`;
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
  'Retatrutide': ['reta', 'rt'],
  'Tirzepatide': ['tirz', 'tr'],
  'Semaglutide': ['sema', 'sem'],
  'Cagrilintide': ['cagri', 'cag'],
  'Cagrilintide + Semaglutide': ['cagri sema', 'cag sem', 'cagsem'],
  'CJC-1295 without DAC + Ipamorelin': ['cjc ipa', 'cjc ipamorelin', 'cjc w/o dac ipa', 'cjc no dac ipa'],
  'CJC-1295 without DAC': ['cjc no dac', 'cjc w/o dac'],
  'CJC-1295 with DAC': ['cjc dac'],
  'Bacteriostatic Water': ['bac water', 'bac', 'water'],
  'BPC-157': ['bpc'],
  'TB-500': ['tb500', 'tb'],
  'BPC-157 + TB-500 Blend': ['bpc tb', 'bpc tb500'],
  'BPC-157 + GHK-Cu + TB-500 Blend (Glow)': ['glow', 'glow blend'],
  'BPC-157 + GHK-Cu + TB-500 + KPV Blend (Klow)': ['klow', 'klow blend'],
  'GHK-Cu': ['ghk', 'ghk cu'],
  'MOTS-c': ['mots', 'motsc'],
  'NAD+': ['nad', 'nad plus'],
  'Melanotan II': ['mt2', 'mt-ii'],
  'Melanotan I': ['mt1', 'mt-i'],
};

function searchableValues(product) {
  return [
    product.name,
    product.spec,
    product.sku,
    product.category,
    product.group,
    product.description,
    ...(SEARCH_ALIASES[product.name] || []),
  ].filter(Boolean).map(value => String(value).toLowerCase());
}

// ---------- Shared product search (used by every public page) ----------
let productSearchCatalogPromise = null;

function productSearchResultHTML(p) {
  return `
    <a class="product-search-result" href="/product/${encodeURIComponent(p.slug)}">
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
      window.siteFees = { packagingFee: data.packagingFee, shippingFee: data.shippingFee, internationalShippingFee: data.internationalShippingFee || 35, shippingOptions: data.shippingOptions || [], orderFeeRate: data.orderFeeRate || 0, altPaymentDiscountRate: data.altPaymentDiscountRate || 0, accountCryptoDiscountRate: data.accountCryptoDiscountRate || 0 };
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
    <span class="account-kicker">Free Highland account</span>
    <h2 id="accountWelcomeTitle">A little more value, without slowing checkout.</h2>
    <p>Create a verified account to choose one personal referral code, get an extra <strong>5% off crypto orders</strong>, and submit a weekly TikTok video for a <strong>$5 store-credit review</strong>.</p>
    <div class="account-welcome-benefits"><span>One personal code</span><span>Member crypto savings</span><span>Weekly creator credit</span></div>
    <a class="account-welcome-cta" href="/account.html?view=register">Create my account</a>
    <button class="account-welcome-skip" type="button">Continue as guest</button>
    <small>Accounts are optional. Referral and creator credits are reviewed by Highland before being added.</small>
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
    return p ? sum + p.price * cart[sku] : sum;
  }, 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function selectedShippingMethod() {
  const checked = document.querySelector('input[name="shippingMethod"]:checked');
  return checked && checked.value === 'international' ? 'international' : 'domestic';
}

function selectedShippingFee() {
  const fees = window.siteFees || {};
  return selectedShippingMethod() === 'international'
    ? Number(fees.internationalShippingFee || 35)
    : Number(fees.shippingFee || 0);
}

function selectedShippingLabel() {
  return selectedShippingMethod() === 'international' ? 'International shipping' : 'U.S. shipping';
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
    : `U.S. shipping selected. Use International shipping for any destination outside the U.S.`;
}

// ---------- Checkout modal (lives on the cart page only) ----------

let appliedDiscount = null; // { code, percentOff } | null
let paypalConfigPromise = null;
let paypalButtonsRendered = false;
let pendingPayPalLocalOrderId = null;

function renderCheckoutSummary() {
  const cart = getCart();
  const summaryEl = document.getElementById('modalOrderSummary');
  if (!summaryEl) return;

  const skus = Object.keys(cart).filter(s => cart[s] > 0);
  const subtotal = round2(cartSubtotal());
  const shippingFee = selectedShippingFee();
  const discountAmount = appliedDiscount ? round2(subtotal * appliedDiscount.percentOff / 100) : 0;
  const creditToggle = document.getElementById('applyStoreCredit');
  const availableCredit = hpAccountState.authenticated && hpAccountState.account
    ? Number(hpAccountState.account.creditBalance || 0)
    : 0;
  const storeCreditAmount = creditToggle && creditToggle.checked
    ? round2(Math.min(availableCredit, Math.max(0, subtotal - discountAmount)))
    : 0;
  const orderFeeRate = (window.siteFees && window.siteFees.orderFeeRate) || 0;
  const feeBase = Math.max(0, subtotal - discountAmount - storeCreditAmount + shippingFee);
  const orderFee = round2(feeBase * orderFeeRate);
  const total = round2(feeBase + orderFee);

  const lines = skus.map(sku => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    if (!p) return '';
    return `<div class="cart-row"><span>${escapeHTML(p.name)} x${cart[sku]}</span><span>$${(p.price * cart[sku]).toFixed(2)}</span></div>`;
  }).join('');
  const promotion = bundlePromotionState(cart);
  const rewardLine = promotion.unlocked && promotion.freeProduct
    ? `<div class="cart-row bundle-summary-line"><span>${escapeHTML(promotion.freeProduct.name)} 10ml x${promotion.freeQuantity}</span><strong>FREE</strong></div>`
    : '';

  const breakdown = [
    `<div class="cart-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>`,
    appliedDiscount ? `<div class="cart-row"><span>Discount (${appliedDiscount.code})</span><span>-$${discountAmount.toFixed(2)}</span></div>` : '',
    storeCreditAmount ? `<div class="cart-row account-credit-summary"><span>Store credit</span><span>-$${storeCreditAmount.toFixed(2)}</span></div>` : '',
    `<div class="cart-row"><span>${selectedShippingLabel()}</span><span>$${shippingFee.toFixed(2)}</span></div>`,
    orderFeeRate ? `<div class="cart-row"><span>Processing fee</span><span>$${orderFee.toFixed(2)}</span></div>` : '',
    `<div class="order-summary-total cart-row"><span>Total</span><span>$${total.toFixed(2)}</span></div>`,
  ].join('');

  summaryEl.innerHTML = lines + rewardLine + '<div style="height:1px; background:var(--border-on-light); margin:10px 0;"></div>' + breakdown;
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
    applyStoreCredit: document.getElementById('applyStoreCredit')?.checked === true,
    paymentMethod: 'manual_paypal',
    analyticsVisitorId: analytics.visitorId,
    analyticsSessionId: analytics.sessionId,
  };
}

function validateCheckoutPayload(payload, msgEl) {
  if (payload.items.length === 0) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Cart is empty.';
    return false;
  }
  if (!payload.buyer.name || !payload.buyer.email || !payload.buyer.address1 || !payload.buyer.city || !payload.buyer.state || !payload.buyer.zip || !payload.buyer.country) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Name, email, destination country, and full shipping address are required before payment.';
    return false;
  }
  if (!/^[A-Z]{2}$/.test(payload.buyer.country)) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Select a valid destination country from the list.';
    return false;
  }
  if (payload.shippingMethod === 'domestic' && payload.buyer.country !== 'US') {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Choose International shipping for destinations outside the U.S.';
    return false;
  }
  if (payload.shippingMethod === 'international' && payload.buyer.country === 'US') {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'International shipping is for destinations outside the U.S. Change the country or select U.S. shipping.';
    return false;
  }
  if (!payload.certified) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'You must certify research/business use before payment.';
    return false;
  }
  if (!payload.paymentPolicyAccepted) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Confirm the exact-payment and 72-hour mismatch policy before payment.';
    return false;
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
    ${balance > 0 ? `<label class="store-credit-toggle"><input id="applyStoreCredit" type="checkbox"> Apply up to <strong>$${balance.toFixed(2)}</strong> store credit</label>` : '<span class="store-credit-empty">Approved referral and creator credit will appear here.</span>'}
    <span class="member-crypto-note">Verified member benefit: an extra 5% off crypto orders. It does not apply to PayPal.</span>`;
  const toggle = document.getElementById('applyStoreCredit');
  if (toggle) toggle.addEventListener('change', renderCheckoutSummary);
  const nameInput = document.getElementById('buyerName');
  const emailInput = document.getElementById('buyerEmail');
  if (nameInput && !nameInput.value) nameInput.value = state.account.name;
  if (emailInput && !emailInput.value) emailInput.value = state.account.email;
  renderCheckoutSummary();
}

function openCheckoutModal() {
  appliedDiscount = null;
  lastCryptoOrder = null;
  cryptoChoiceOpen = false;
  const promoInput = document.getElementById('promoInput');
  const promoMsg = document.getElementById('promoMsg');
  const checkoutMsg = document.getElementById('checkoutMsg');
  const paypalMsg = document.getElementById('paypalMsg');
  const cryptoMsg = document.getElementById('cryptoMsg');
  const cryptoDetails = document.getElementById('cryptoPaymentDetails');
  if (promoInput) promoInput.value = '';
  if (promoMsg) promoMsg.textContent = '';
  if (checkoutMsg) checkoutMsg.textContent = '';
  if (paypalMsg) paypalMsg.textContent = '';
  if (cryptoMsg) cryptoMsg.textContent = '';
  const manualDetails = document.getElementById('manualPaymentDetails');
  const paypalDetails = document.getElementById('paypalPaymentDetails');
  const cryptoChoice = document.getElementById('cryptoChoiceDetails');
  if (manualDetails) manualDetails.style.display = 'none';
  if (paypalDetails) paypalDetails.style.display = 'none';
  if (cryptoChoice) cryptoChoice.style.display = 'none';
  if (cryptoDetails) cryptoDetails.style.display = 'none';
  const cryptoButton = document.getElementById('cryptoCheckoutBtn');
  if (cryptoButton) cryptoButton.querySelector('strong').innerHTML = hpAccountState.authenticated ? 'Crypto <em>10% total savings</em>' : 'Crypto <em>5% off</em>';
  updateShippingCountryNote();
  renderCheckoutSummary();
  refreshCheckoutAccountStatus();
  renderCryptoPricePreview();
  document.body.classList.add('checkout-modal-open');
  document.getElementById('checkoutModal').style.display = 'flex';
  hpTrack('checkout_start');

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
    msgEl.textContent = '';
    renderCheckoutSummary();
    return;
  }
  try {
    const result = await api(`/api/discount-code?code=${encodeURIComponent(code)}`);
    if (result.valid) {
      appliedDiscount = { code: result.code, percentOff: result.percentOff };
      msgEl.style.color = 'var(--success)';
      msgEl.textContent = `${result.percentOff}% off applied.`;
    } else {
      appliedDiscount = null;
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'Invalid code.';
    }
  } catch {
    appliedDiscount = null;
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Could not check that code, try again.';
  }
  renderCheckoutSummary();
}

function getPayPalConfig() {
  if (!paypalConfigPromise) paypalConfigPromise = api('/api/paypal/config');
  return paypalConfigPromise;
}

function loadPayPalSdk(clientId, currency) {
  if (window.paypal) return Promise.resolve();
  const existing = document.querySelector('script[data-paypal-sdk="true"]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture`;
    script.dataset.paypalSdk = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load PayPal checkout.'));
    document.head.appendChild(script);
  });
}

async function initPayPalCheckout() {
  const paypalButtons = document.getElementById('paypalButtons');
  const paypalMsg = document.getElementById('paypalMsg');
  if (!paypalButtons || paypalButtonsRendered) return;

  try {
    const config = await getPayPalConfig();
    if (!config.enabled) {
      paypalButtons.innerHTML = '<div class="paypal-disabled">PayPal is ready in the code, but credentials still need to be added in Render before online payment can go live.</div>';
      return;
    }
    await loadPayPalSdk(config.clientId, config.currency || 'USD');
    if (!window.paypal) throw new Error('PayPal checkout did not load.');

    window.paypal.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'paypal' },
      onClick(data, actions) {
        const payload = checkoutPayloadFromForm();
        return validateCheckoutPayload(payload, paypalMsg) ? actions.resolve() : actions.reject();
      },
      async createOrder() {
        const payload = checkoutPayloadFromForm();
        const result = await api('/api/paypal/create-order', { method: 'POST', body: payload });
        pendingPayPalLocalOrderId = result.orderId;
        return result.paypalOrderId;
      },
      async onApprove(data) {
        const result = await api('/api/paypal/capture-order', {
          method: 'POST',
          body: { paypalOrderId: data.orderID, orderId: pendingPayPalLocalOrderId },
        });
        paypalMsg.style.color = 'var(--success)';
        paypalMsg.textContent = 'Payment confirmed. Redirecting to your order confirmation...';
        clearCartAfterCheckout();
        window.location.href = `/success.html?order=${encodeURIComponent(result.orderId)}`;
      },
      onCancel() {
        paypalMsg.style.color = 'var(--muted-on-light)';
        paypalMsg.textContent = 'PayPal checkout was cancelled.';
      },
      onError(err) {
        paypalMsg.style.color = 'var(--danger)';
        paypalMsg.textContent = err && err.message ? err.message : 'PayPal checkout failed. Please try again.';
      },
    }).render('#paypalButtons');
    paypalButtonsRendered = true;
  } catch (err) {
    paypalButtons.innerHTML = '<div class="paypal-disabled">PayPal could not load. Please refresh the page or contact support@highlandpeptides.com.</div>';
    if (paypalMsg) {
      paypalMsg.style.color = 'var(--danger)';
      paypalMsg.textContent = err.message || 'PayPal is unavailable right now.';
    }
  }
}

let lastCryptoOrder = null; // { id, email } | null
let cryptoChoiceOpen = false;

function renderCryptoPricePreview() {
  const previewEl = document.getElementById('cryptoPricePreview');
  if (!previewEl) return;
  if (appliedDiscount) {
    previewEl.textContent = 'Crypto discount cannot be combined with a promo code.';
    return;
  }
  const subtotal = round2(cartSubtotal());
  const rate = (window.siteFees && window.siteFees.altPaymentDiscountRate) || 0;
  const memberRate = hpAccountState.authenticated ? ((window.siteFees && window.siteFees.accountCryptoDiscountRate) || 0) : 0;
  const shippingFee = selectedShippingFee();
  const orderFeeRate = (window.siteFees && window.siteFees.orderFeeRate) || 0;
  const discount = round2(subtotal * (rate + memberRate));
  const feeBase = Math.max(0, subtotal - discount + shippingFee);
  const orderFee = round2(feeBase * orderFeeRate);
  const total = round2(feeBase + orderFee);
  previewEl.textContent = rate ? `Crypto price: $${total.toFixed(2)} (saves $${discount.toFixed(2)}${memberRate ? ' — includes your 5% member benefit' : ''})` : '';
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
  const paypalDetails = document.getElementById('paypalPaymentDetails');

  if (appliedDiscount) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Crypto discount cannot be combined with promo codes. Remove the promo code or choose PayPal.';
    return;
  }

  if (!cryptoChoiceOpen) {
    cryptoChoiceOpen = true;
    if (paypalDetails) paypalDetails.style.display = 'none';
    if (choice) choice.style.display = 'block';
    showManualPaymentShell('Crypto payment', 'Choose BTC or USDC, then submit the order to get the exact payment total and address. Crypto discount cannot be combined with promo codes.');
    btn.querySelector('strong').innerHTML = hpAccountState.authenticated ? 'Submit Crypto Order <em>10% total savings</em>' : 'Submit Crypto Order <em>5% off</em>';
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

    showManualPaymentShell('Crypto payment instructions', `<strong>Order #${result.orderId}</strong><br>Exact total due: <strong>$${result.total.toFixed(2)}</strong><br><span class="hint">Unique matching cents: $${Number(result.paymentMatchAdjustment || 0).toFixed(2)}</span><br><span class="hint">If the amount sent is incorrect, we will email you for confirmation. If no response is received within 72 hours, fulfillment will not proceed and the payment will not be refunded except where required by law.</span>`);

    if (result.crypto) {
      document.getElementById('cryptoAddressText').textContent = result.crypto.address;
      document.getElementById('cryptoNetworkNote').textContent = `${result.crypto.network}. Reference: ${result.crypto.reference}`;
      document.getElementById('cryptoPaymentDetails').style.display = 'block';
    }
    clearCartAfterCheckout();
  } catch (err) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = err.message;
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
  } finally {
    btn.disabled = false;
  }
}

async function submitManualPaypalCheckout() {
  const msgEl = document.getElementById('checkoutMsg');
  const btn = document.getElementById('manualPaypalCheckoutBtn');
  const payload = checkoutPayloadFromForm();
  payload.paymentMethod = 'manual_paypal';

  if (!validateCheckoutPayload(payload, msgEl)) return;

  btn.disabled = true;
  try {
    const result = await api('/api/checkout', { method: 'POST', body: payload });
    msgEl.style.color = 'var(--success)';
    msgEl.textContent = 'Order submitted. Send the exact amount shown below.';
    const paypalDetails = document.getElementById('paypalPaymentDetails');
    const cryptoChoice = document.getElementById('cryptoChoiceDetails');
    const cryptoDetails = document.getElementById('cryptoPaymentDetails');
    if (cryptoChoice) cryptoChoice.style.display = 'none';
    if (cryptoDetails) cryptoDetails.style.display = 'none';
    if (paypalDetails) paypalDetails.style.display = 'block';
    document.getElementById('paypalPaymentEmail').textContent = result.paypal ? result.paypal.email : 'at475756@gmail.com';
    showManualPaymentShell('PayPal payment instructions', `<strong>Order #${result.orderId}</strong><br>Exact total due: <strong>$${result.total.toFixed(2)}</strong><br>Send payment to: <strong>${result.paypal ? result.paypal.email : 'at475756@gmail.com'}</strong><br><span class="manual-payment-alert"><strong>Send with PayPal Friends and Family.</strong><br>Include <strong>Order #${result.orderId}</strong> in the PayPal note.</span><br><span class="hint">Please send the exact total shown. If the amount is incorrect, we will email you for confirmation. If no response is received within 72 hours, fulfillment will not proceed and the payment will not be refunded except where required by law. Confirmed orders ship the next business day.</span>`);
    clearCartAfterCheckout();
  } catch (err) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function wireCheckout() {
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
  if (buyerCountryInput) buyerCountryInput.addEventListener('change', updateShippingCountryNote);

  const promoApplyBtn = document.getElementById('promoApplyBtn');
  if (promoApplyBtn) {
    promoApplyBtn.addEventListener('click', applyPromoCode);
    document.getElementById('promoInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyPromoCode(); }
    });
  }

  const manualPaypalBtn = document.getElementById('manualPaypalCheckoutBtn');
  if (manualPaypalBtn) manualPaypalBtn.addEventListener('click', submitManualPaypalCheckout);

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







