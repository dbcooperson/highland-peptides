// Shared helpers used by every page (catalog, product detail, cart).

// ---------- Entry gate (age + research-use certification, shown before anything else) ----------
function initEntryGate() {
  const gate = document.getElementById('entryGate');
  const alreadyAgreed = localStorage.getItem('ruo_gate_agreed') === 'yes';
  gate.style.display = alreadyAgreed ? 'none' : 'flex';

  document.getElementById('entryAgreeBtn').onclick = () => {
    localStorage.setItem('ruo_gate_agreed', 'yes');
    gate.style.display = 'none';
  };
  document.getElementById('entryExitBtn').onclick = () => {
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

function renderCheckoutSummary() {
  const cart = getCart();
  const summaryEl = document.getElementById('modalOrderSummary');
  const skus = Object.keys(cart).filter(s => cart[s] > 0);
  const subtotal = round2(cartSubtotal());
  const packagingFee = (window.siteFees && window.siteFees.packagingFee) || 0;
  const shippingFee = (window.siteFees && window.siteFees.shippingFee) || 0;
  const discountAmount = appliedDiscount ? round2(subtotal * appliedDiscount.percentOff / 100) : 0;
  const total = round2(subtotal - discountAmount + packagingFee + shippingFee);

  const lines = skus.map(sku => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    if (!p) return '';
    return `<div class="cart-row"><span>${p.name} x${cart[sku]}</span><span>$${(p.price * cart[sku]).toFixed(2)}</span></div>`;
  }).join('');

  const breakdown = [
    `<div class="cart-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>`,
    appliedDiscount ? `<div class="cart-row"><span>Discount (${appliedDiscount.code})</span><span>-$${discountAmount.toFixed(2)}</span></div>` : '',
    `<div class="cart-row"><span>Shipping</span><span>$${shippingFee.toFixed(2)}</span></div>`,
    `<div class="cart-row"><span>Packaging</span><span>$${packagingFee.toFixed(2)}</span></div>`,
    `<div class="order-summary-total cart-row"><span>Total</span><span>$${total.toFixed(2)}</span></div>`,
  ].join('');

  summaryEl.innerHTML = lines + '<div style="height:1px; background:var(--border-on-light); margin:10px 0;"></div>' + breakdown;
}

function openCheckoutModal() {
  appliedDiscount = null;
  const promoInput = document.getElementById('promoInput');
  const promoMsg = document.getElementById('promoMsg');
  if (promoInput) promoInput.value = '';
  if (promoMsg) promoMsg.textContent = '';
  renderCheckoutSummary();
  document.getElementById('checkoutModal').style.display = 'flex';
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

  document.getElementById('checkoutForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cart = getCart();
    const items = Object.keys(cart).filter(s => cart[s] > 0).map(sku => ({ sku, quantity: cart[sku] }));
    const msgEl = document.getElementById('checkoutMsg');

    if (items.length === 0) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'Cart is empty.';
      return;
    }

    const buyer = {
      name: document.getElementById('buyerName').value.trim(),
      email: document.getElementById('buyerEmail').value.trim(),
      address1: document.getElementById('buyerAddress1').value.trim(),
      address2: document.getElementById('buyerAddress2').value.trim(),
      city: document.getElementById('buyerCity').value.trim(),
      state: document.getElementById('buyerState').value.trim(),
      zip: document.getElementById('buyerZip').value.trim(),
    };
    const certified = document.getElementById('checkoutCertify').checked;

    if (!buyer.name || !buyer.email || !buyer.address1 || !buyer.city || !buyer.state || !buyer.zip) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'Name, email, and full shipping address are required.';
      return;
    }
    if (!certified) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'You must certify research/business use to place an order.';
      return;
    }

    try {
      const result = await api('/api/checkout', {
        method: 'POST',
        body: { items, buyer, certified, discountCode: appliedDiscount ? appliedDiscount.code : null },
      });
      msgEl.style.color = 'var(--success)';
      msgEl.textContent = `${result.message} (Order #${result.orderId}, total $${result.total.toFixed(2)})`;
      saveCart({});
      appliedDiscount = null;
      updateCartBadge();
      document.dispatchEvent(new CustomEvent('cart:updated'));
      document.getElementById('checkoutForm').reset();
      setTimeout(closeCheckoutModal, 2500);
    } catch (err) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = err.message;
    }
  });
}
