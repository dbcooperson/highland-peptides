function sadFaceSVG() {
  return `<svg class="cart-empty-face" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="50" cy="46" r="34" fill="none" stroke="currentColor" stroke-width="3"/>
    <circle cx="38" cy="40" r="3.2" fill="currentColor"/>
    <circle cx="62" cy="40" r="3.2" fill="currentColor"/>
    <path d="M36,62 Q50,52 64,62" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <path d="M62,48 C62,48 68,58 68,64 A5,6 0 1 1 58,64 C58,58 62,48 62,48 Z" fill="currentColor" opacity="0.85"/>
  </svg>`;
}

function cartLineHTML(sku, qty, p) {
  const lineTotal = p.price * qty;
  return `
    <div class="cart-line">
      <div class="cart-line-info">
        <strong>${p.name}</strong>
        <span>${p.spec}</span>
      </div>
      <div class="cart-line-qty">
        <button type="button" class="qty-btn cart-qty-down" data-sku="${sku}" aria-label="Decrease quantity">&minus;</button>
        <span class="cart-line-qty-num">${qty}</span>
        <button type="button" class="qty-btn cart-qty-up" data-sku="${sku}" aria-label="Increase quantity">+</button>
      </div>
      <div class="cart-line-price">$${lineTotal.toFixed(2)}</div>
      <button type="button" class="cart-remove-btn" data-sku="${sku}" aria-label="Remove ${p.name} from cart">&times;</button>
    </div>
  `;
}

function renderCartPage() {
  const cart = getCart();
  const skus = Object.keys(cart).filter(s => cart[s] > 0);
  const itemsEl = document.getElementById('cartItemsPage');
  const totalEl = document.getElementById('cartTotalPage');
  const checkoutBtn = document.getElementById('checkoutBtn');
  updateCartBadge();

  if (skus.length === 0) {
    itemsEl.innerHTML = `
      <div class="cart-empty-state">
        ${sadFaceSVG()}
        <p>Your cart is empty.</p>
        <a href="/index.html#catalogSection" class="cart-empty-cta">Browse the Catalog</a>
      </div>
    `;
    totalEl.textContent = '';
    checkoutBtn.style.display = 'none';
    return;
  }

  checkoutBtn.style.display = 'block';
  let subtotal = 0;
  itemsEl.innerHTML = skus.map(sku => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    if (!p) return '';
    subtotal += p.price * cart[sku];
    return cartLineHTML(sku, cart[sku], p);
  }).join('');
  totalEl.textContent = `Subtotal: $${subtotal.toFixed(2)} (+ packaging fee at checkout)`;

  itemsEl.querySelectorAll('.cart-qty-down').forEach(btn => {
    btn.onclick = () => {
      const cur = getCart()[btn.dataset.sku] || 0;
      setCartQty(btn.dataset.sku, cur - 1);
      renderCartPage();
    };
  });
  itemsEl.querySelectorAll('.cart-qty-up').forEach(btn => {
    btn.onclick = () => {
      const cur = getCart()[btn.dataset.sku] || 0;
      setCartQty(btn.dataset.sku, cur + 1);
      renderCartPage();
    };
  });
  itemsEl.querySelectorAll('.cart-remove-btn').forEach(btn => {
    btn.onclick = () => {
      removeFromCart(btn.dataset.sku);
      renderCartPage();
    };
  });
}

document.addEventListener('cart:updated', renderCartPage);
wireCheckout();

async function init() {
  const catalogData = await api('/api/catalog');
  window.siteCatalog = catalogData.products;
  renderCartPage();
}

init();
