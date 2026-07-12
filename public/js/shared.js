// Shared helpers used by both the catalog page (app.js) and product detail page (product.js).

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

function cartItemCount(cart) {
  return Object.values(cart).reduce((sum, q) => sum + q, 0);
}

// ---------- Vial photo label overlay (name/spec text on top of the vial photo) ----------

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The label's blank space is narrow, so long compound names need to shrink
// to avoid overflowing off the vial. `base` is the normal font-size in px.
function vpFontSize(name, base) {
  const len = name.length;
  if (len <= 14) return base;
  if (len <= 24) return Math.round(base * 0.82);
  if (len <= 36) return Math.round(base * 0.68);
  return Math.round(base * 0.56);
}

// baseSizes: { name, spec } font-size in px for the normal (short-name) case.
function vialPhotoLabelHTML(name, spec, baseSizes) {
  const nameSize = vpFontSize(name, baseSizes.name);
  const specSize = vpFontSize(name, baseSizes.spec);
  return `
    <div class="vial-photo-label">
      <div class="vp-name" style="font-size:${nameSize}px;">${escapeHtml(name)}</div>
      <div class="vp-spec" style="font-size:${specSize}px;">${escapeHtml(spec)}</div>
    </div>
  `;
}

// ---------- Cart modal + checkout modal (identical markup/IDs on every shoppable page) ----------
// Pages set `window.siteCatalog` (full product list with name/price) before calling wireCart().

function renderCart() {
  const cart = getCart();
  const itemsEl = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  const cartCount = document.getElementById('cartCount');
  const skus = Object.keys(cart).filter(s => cart[s] > 0);

  if (cartCount) {
    const count = cartItemCount(cart);
    cartCount.textContent = count;
    cartCount.setAttribute('aria-label', `${count} item${count === 1 ? '' : 's'}`);
  }

  if (skus.length === 0) {
    itemsEl.innerHTML = '<p class="hint">Cart is empty.</p>';
    totalEl.textContent = '';
    return;
  }
  let subtotal = 0;
  itemsEl.innerHTML = skus.map(sku => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    if (!p) return '';
    const lineTotal = p.price * cart[sku];
    subtotal += lineTotal;
    return `<div class="cart-row"><span>${p.name} x${cart[sku]}</span><span class="cart-row-right">$${lineTotal.toFixed(2)}<button type="button" class="cart-remove-btn" data-sku="${sku}" aria-label="Remove ${p.name} from cart">&times;</button></span></div>`;
  }).join('');
  totalEl.textContent = `Subtotal: $${subtotal.toFixed(2)} (+ packaging fee at checkout)`;

  itemsEl.querySelectorAll('.cart-remove-btn').forEach(btn => {
    btn.onclick = () => {
      removeFromCart(btn.dataset.sku);
      renderCart();
    };
  });
}

function cartSubtotal() {
  const cart = getCart();
  return Object.keys(cart).filter(s => cart[s] > 0).reduce((sum, sku) => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    return p ? sum + p.price * cart[sku] : sum;
  }, 0);
}

function openCheckoutModal() {
  const cart = getCart();
  const summaryEl = document.getElementById('modalOrderSummary');
  const skus = Object.keys(cart).filter(s => cart[s] > 0);
  const subtotal = cartSubtotal();
  summaryEl.innerHTML = skus.map(sku => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    if (!p) return '';
    return `<div class="cart-row"><span>${p.name} x${cart[sku]}</span><span>$${(p.price * cart[sku]).toFixed(2)}</span></div>`;
  }).join('') + `<div class="order-summary-total cart-row"><span>Total (+ packaging fee)</span><span>$${subtotal.toFixed(2)}+</span></div>`;

  closeCartModal();
  document.getElementById('checkoutModal').style.display = 'flex';
}

function closeCheckoutModal() {
  document.getElementById('checkoutModal').style.display = 'none';
}

function openCartModal() {
  renderCart();
  document.getElementById('cartModal').style.display = 'flex';
}

function closeCartModal() {
  document.getElementById('cartModal').style.display = 'none';
}

function wireCart() {
  const cartNavBtn = document.getElementById('cartNavBtn');
  if (cartNavBtn) cartNavBtn.addEventListener('click', openCartModal);

  document.getElementById('cartCloseBtn').addEventListener('click', closeCartModal);
  document.getElementById('cartModal').addEventListener('click', (e) => {
    if (e.target.id === 'cartModal') closeCartModal();
  });

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
      const result = await api('/api/checkout', { method: 'POST', body: { items, buyer, certified } });
      msgEl.style.color = 'var(--success)';
      msgEl.textContent = `${result.message} (Order #${result.orderId}, total $${result.total.toFixed(2)})`;
      saveCart({});
      renderCart();
      document.getElementById('checkoutForm').reset();
      setTimeout(closeCheckoutModal, 2500);
    } catch (err) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = err.message;
    }
  });
}
