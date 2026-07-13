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
  const suggestions = (Array.isArray(window.siteCatalog) ? window.siteCatalog : [])
    .filter(item => item.sku !== sku && item.popular)
    .slice(0, 2);

  overlay.innerHTML = `
    <div class="cart-popup-card" role="dialog" aria-modal="true" aria-labelledby="cartPopupTitle">
      <button type="button" class="cart-popup-close" aria-label="Close">&times;</button>
      <div class="cart-popup-success"><span aria-hidden="true">ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“</span><strong id="cartPopupTitle">Product successfully added to your cart.</strong></div>
      <div class="cart-popup-product">
        <div class="cart-popup-media photo"></div>
        <div class="cart-popup-copy">
          <strong>${escapeHTML(product.name)}</strong>
          <span>${escapeHTML(cleanVialSpec(product.spec))} &bull; Qty ${qty}</span>
          <em>99%+ purity | COA available</em>
        </div>
        <div class="cart-popup-price">$${(product.price * qty).toFixed(2)}</div>
      </div>
      <div class="cart-popup-totals">
        <span>${count} item${count === 1 ? '' : 's'} in cart</span>
        <strong>Subtotal $${subtotal.toFixed(2)}</strong>
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
                <span class="cart-popup-suggestion-media photo"></span>
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

function vialDisplayName(name) {
  const cleanName = String(name || '').trim();
  return VIAL_LABEL_ALIASES[cleanName] || cleanName;
}
function vialLabelHTML(name, spec, className = '') {
  const productName = escapeHTML(vialDisplayName(name));
  const strength = escapeHTML(cleanVialSpec(spec));
  return `
    <div class="vial-label-overlay ${className}">
      <strong title="${productName}">${productName}</strong>
      <em>${strength}</em>
    </div>
  `;
}
// ---------- Shared product search (used by every public page) ----------
let productSearchCatalogPromise = null;

function productSearchResultHTML(p) {
  return `
    <a class="product-search-result" href="/product/${encodeURIComponent(p.slug)}">
      <div class="product-search-result-media photo"></div>
      <div class="product-search-result-copy">
        <span class="product-search-result-group">${p.group || p.category}</span>
        <strong>${p.name}</strong>
        <span>${p.spec}</span>
        <span class="product-search-result-proof">99%+ purity | COA available</span>
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
        <input id="productSearchInput" type="search" placeholder="Search compounds, categories, SKUs, or specifications" autocomplete="off">
      </div>
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
      window.siteFees = { packagingFee: data.packagingFee, shippingFee: data.shippingFee, orderFeeRate: data.orderFeeRate || 0 };
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

  const renderResults = async () => {
    const catalog = await getProductSearchCatalog();
    const query = input.value.trim().toLowerCase();
    const matches = query
      ? catalog.filter(p => [p.name, p.spec, p.sku, p.category, p.group, p.description]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(query)))
      : catalog.filter(p => p.popular).slice(0, 8);

    status.textContent = query
      ? `${matches.length} result${matches.length === 1 ? '' : 's'}`
      : 'Popular research products';
    results.innerHTML = matches.length
      ? matches.slice(0, 24).map(productSearchResultHTML).join('')
      : '<div class="product-search-empty"><strong>No products found</strong><span>Try another compound, SKU, category, or specification.</span></div>';
  };

  const openSearch = () => {
    overlay.hidden = false;
    document.body.classList.add('search-open');
    input.value = '';
    status.textContent = 'Loading products';
    results.innerHTML = '';
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

document.addEventListener('DOMContentLoaded', () => {
  initProductSearch();
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
  const shippingFee = (window.siteFees && window.siteFees.shippingFee) || 0;
  const discountAmount = appliedDiscount ? round2(subtotal * appliedDiscount.percentOff / 100) : 0;
  const orderFeeRate = (window.siteFees && window.siteFees.orderFeeRate) || 0;
  const feeBase = Math.max(0, subtotal - discountAmount + shippingFee);
  const orderFee = round2(feeBase * orderFeeRate);
  const total = round2(feeBase + orderFee);
  const feePercent = Math.round(orderFeeRate * 1000) / 10;

  const lines = skus.map(sku => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    if (!p) return '';
    return `<div class="cart-row"><span>${escapeHTML(p.name)} x${cart[sku]}</span><span>$${(p.price * cart[sku]).toFixed(2)}</span></div>`;
  }).join('');

  const breakdown = [
    `<div class="cart-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>`,
    appliedDiscount ? `<div class="cart-row"><span>Discount (${appliedDiscount.code})</span><span>-$${discountAmount.toFixed(2)}</span></div>` : '',
    `<div class="cart-row"><span>Shipping</span><span>$${shippingFee.toFixed(2)}</span></div>`,
    orderFeeRate ? `<div class="cart-row"><span>Taxes (${feePercent}%)</span><span>$${orderFee.toFixed(2)}</span></div>` : '',
    `<div class="order-summary-total cart-row"><span>Total</span><span>$${total.toFixed(2)}</span></div>`,
  ].join('');

  summaryEl.innerHTML = lines + '<div style="height:1px; background:var(--border-on-light); margin:10px 0;"></div>' + breakdown;
}

function checkoutPayloadFromForm() {
  const cart = getCart();
  const items = Object.keys(cart).filter(s => cart[s] > 0).map(sku => ({ sku, quantity: cart[sku] }));
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
      country: 'US',
    },
    certified: document.getElementById('checkoutCertify').checked,
    discountCode: appliedDiscount ? appliedDiscount.code : null,
    paymentMethod: 'paypal',
  };
}

function validateCheckoutPayload(payload, msgEl) {
  if (payload.items.length === 0) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Cart is empty.';
    return false;
  }
  if (!payload.buyer.name || !payload.buyer.email || !payload.buyer.address1 || !payload.buyer.city || !payload.buyer.state || !payload.buyer.zip) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Name, email, and full shipping address are required before payment.';
    return false;
  }
  if (!payload.certified) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'You must certify research/business use before payment.';
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

function openCheckoutModal() {
  appliedDiscount = null;
  const promoInput = document.getElementById('promoInput');
  const promoMsg = document.getElementById('promoMsg');
  const checkoutMsg = document.getElementById('checkoutMsg');
  const paypalMsg = document.getElementById('paypalMsg');
  if (promoInput) promoInput.value = '';
  if (promoMsg) promoMsg.textContent = '';
  if (checkoutMsg) checkoutMsg.textContent = '';
  if (paypalMsg) paypalMsg.textContent = '';
  renderCheckoutSummary();
  document.getElementById('checkoutModal').style.display = 'flex';
  initPayPalCheckout();
}

function closeCheckoutModal() {
  document.getElementById('checkoutModal').style.display = 'none';
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
        paypalMsg.textContent = `${result.message} Order #${result.orderId}.`;
        clearCartAfterCheckout();
        setTimeout(closeCheckoutModal, 2500);
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


  const promoApplyBtn = document.getElementById('promoApplyBtn');
  if (promoApplyBtn) {
    promoApplyBtn.addEventListener('click', applyPromoCode);
    document.getElementById('promoInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyPromoCode(); }
    });
  }

  document.getElementById('checkoutForm').addEventListener('submit', (e) => {
    e.preventDefault();
  });
}
