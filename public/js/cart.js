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
      <div class="cart-line-media photo" aria-hidden="true"></div>
      <div class="cart-line-info">
        <div class="cart-line-kicker">${escapeHTML(p.group || p.category || 'Research product')}</div>
        <strong>${escapeHTML(p.name)}</strong>
        <span>${escapeHTML(cleanVialSpec(p.spec))} x${qty} vial${qty === 1 ? '' : 's'}</span>
        <em>99%+ purity | COA available</em>
      </div>
      <div class="cart-line-qty" aria-label="Quantity controls">
        <button type="button" class="qty-btn cart-qty-down" data-sku="${sku}" aria-label="Decrease quantity">&minus;</button>
        <span class="cart-line-qty-num">${qty}</span>
        <button type="button" class="qty-btn cart-qty-up" data-sku="${sku}" aria-label="Increase quantity">+</button>
      </div>
      <div class="cart-line-price">$${lineTotal.toFixed(2)}</div>
      <button type="button" class="cart-remove-btn" data-sku="${sku}" aria-label="Remove ${escapeHTML(p.name)} from cart">&times;</button>
    </div>
  `;
}

function cartSummaryHTML(subtotal) {
  const shippingFee = (window.siteFees && window.siteFees.shippingFee) || 0;
  const orderFeeRate = (window.siteFees && window.siteFees.orderFeeRate) || 0;
  const feeBase = subtotal + shippingFee;
  const orderFee = Math.round(feeBase * orderFeeRate * 100) / 100;
  const estimatedTotal = feeBase + orderFee;
  const feePercent = Math.round(orderFeeRate * 1000) / 10;
  return `
    <div class="cart-summary-lines">
      <div><span>Subtotal</span><strong>$${subtotal.toFixed(2)}</strong></div>
      <div><span>Shipping</span><strong>$${shippingFee.toFixed(2)}</strong></div>
      ${orderFeeRate ? `<div><span>Taxes (${feePercent}%)</span><strong>$${orderFee.toFixed(2)}</strong></div>` : ''}
      <div class="cart-summary-total"><span>Estimated total</span><strong>$${estimatedTotal.toFixed(2)}</strong></div>
    </div>
  `;
}
function renderCartPage() {
  const cart = getCart();
  const skus = Object.keys(cart).filter(s => cart[s] > 0);
  const itemsEl = document.getElementById('cartItemsPage');
  const totalEl = document.getElementById('cartTotalPage');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const itemSummary = document.getElementById('cartItemSummary');
  updateCartBadge();

  const itemCount = cartItemCount(cart);
  if (itemSummary) itemSummary.textContent = `${itemCount} item${itemCount === 1 ? '' : 's'}`;

  if (skus.length === 0) {
    itemsEl.innerHTML = `
      <div class="cart-empty-state">
        ${sadFaceSVG()}
        <p>Your cart is empty.</p>
        <a href="/index.html#catalogSection" class="cart-empty-cta">Browse the Catalog</a>
      </div>
    `;
    totalEl.innerHTML = `
      <div class="cart-summary-empty">
        <strong>No items yet</strong>
        <span>Add research products to see your estimated total.</span>
      </div>
    `;
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
  totalEl.innerHTML = cartSummaryHTML(subtotal);

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
  window.siteFees = { packagingFee: catalogData.packagingFee, shippingFee: catalogData.shippingFee, orderFeeRate: catalogData.orderFeeRate || 0 };
  renderCartPage();
  if (new URLSearchParams(window.location.search).get('checkout') === '1') {
    setTimeout(() => document.getElementById('checkoutBtn')?.click(), 150);
  }
}

init();