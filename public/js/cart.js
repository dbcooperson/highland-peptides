function clearHighlandCart(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  try { localStorage.removeItem('hp_cart'); } catch (err) {}
  saveCart({});
  updateCartBadge();
  const msg = document.getElementById('cartMsg');
  if (msg) {
    msg.style.color = 'var(--success)';
    msg.textContent = 'Cart cleared.';
  }
  renderCartPage();
}
window.clearHighlandCart = clearHighlandCart;

document.addEventListener('click', (event) => {
  const clearBtn = event.target && event.target.closest ? event.target.closest('#clearCartBtn, #clearCartSummaryBtn') : null;
  if (clearBtn) clearHighlandCart(event);
}, true);
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
      <div class="cart-line-media photo sku-mockup" aria-hidden="true">${productMockupImageHTML(p)}</div>
      <div class="cart-line-info">
        <div class="cart-line-kicker">${escapeHTML(p.group || p.category || 'Research product')}</div>
        <strong>${escapeHTML(p.name)}</strong>
        <span>${escapeHTML(cleanVialSpec(p.spec))} x${qty} vial${qty === 1 ? '' : 's'}</span>
        <em>Guaranteed 99% purity</em>
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

function unavailableCartLineHTML(sku, qty) {
  return `
    <div class="cart-line cart-line-unavailable">
      <div class="cart-line-media photo" aria-hidden="true"></div>
      <div class="cart-line-info">
        <div class="cart-line-kicker">Unavailable item</div>
        <strong>${escapeHTML(sku)}</strong>
        <span>This product is no longer active on the website.</span>
        <em>Remove it from your cart to continue checkout.</em>
      </div>
      <div class="cart-line-qty" aria-label="Quantity">
        <span class="cart-line-qty-num">${qty}</span>
      </div>
      <div class="cart-line-price">$0.00</div>
      <button type="button" class="cart-remove-btn" data-sku="${escapeHTML(sku)}" aria-label="Remove unavailable item ${escapeHTML(sku)} from cart">&times;</button>
    </div>
  `;
}
function cartSummaryHTML(subtotal) {
  const shippingFee = (window.siteFees && window.siteFees.shippingFee) || 0;
  const orderFeeRate = (window.siteFees && window.siteFees.orderFeeRate) || 0;
  const feeBase = subtotal + shippingFee;
  const orderFee = Math.round(feeBase * orderFeeRate * 100) / 100;
  const estimatedTotal = feeBase + orderFee;
  return `
    <div class="cart-summary-trust"><span>Secure checkout</span><span>RUO certification required</span><span>Support: support@highlandpeptides.com</span></div>
    <div class="cart-summary-lines">
      <div><span>Subtotal</span><strong>$${subtotal.toFixed(2)}</strong></div>
      <div><span>U.S. shipping</span><strong>$${shippingFee.toFixed(2)}</strong></div>
      ${orderFeeRate ? `<div><span>Processing fee</span><strong>$${orderFee.toFixed(2)}</strong></div>` : ''}
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
  let unavailableCount = 0;
  itemsEl.innerHTML = skus.map(sku => {
    const p = window.siteCatalog.find(x => x.sku === sku);
    if (!p) {
      unavailableCount += 1;
      return unavailableCartLineHTML(sku, cart[sku]);
    }
    subtotal += p.price * cart[sku];
    return cartLineHTML(sku, cart[sku], p);
  }).join('');
  if (unavailableCount) {
    itemsEl.insertAdjacentHTML('afterbegin', `
      <div class="cart-cleanup-notice">
        <span>${unavailableCount} discontinued item${unavailableCount === 1 ? '' : 's'} in your cart.</span>
        <button type="button" id="removeUnavailableCartItems">Remove unavailable items</button>
      </div>
    `);
  }
  totalEl.innerHTML = cartSummaryHTML(subtotal);
  checkoutBtn.disabled = unavailableCount > 0;
  checkoutBtn.title = unavailableCount > 0 ? 'Remove unavailable items before checkout.' : '';
  if (!unavailableCount) {
    checkoutBtn.disabled = false;
    checkoutBtn.title = '';
  }

  document.getElementById('removeUnavailableCartItems')?.addEventListener('click', () => {
    const nextCart = getCart();
    Object.keys(nextCart).forEach(sku => {
      if (!window.siteCatalog.find(x => x.sku === sku)) delete nextCart[sku];
    });
    saveCart(nextCart);
    renderCartPage();
  });

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
  if (new URLSearchParams(window.location.search).get('clearCart') === '1') {
    clearHighlandCart();
    history.replaceState(null, '', '/cart.html');
  }
  const catalogData = await api('/api/catalog');
  window.siteCatalog = catalogData.products;
  window.siteFees = { packagingFee: catalogData.packagingFee, shippingFee: catalogData.shippingFee, internationalShippingFee: catalogData.internationalShippingFee || 35, shippingOptions: catalogData.shippingOptions || [], orderFeeRate: catalogData.orderFeeRate || 0, altPaymentDiscountRate: catalogData.altPaymentDiscountRate || 0 };
  const activeSkus = new Set(window.siteCatalog.map(p => p.sku));
  const currentCart = getCart();
  let prunedCart = false;
  Object.keys(currentCart).forEach(sku => {
    if (!activeSkus.has(sku)) {
      delete currentCart[sku];
      prunedCart = true;
    }
  });
  if (prunedCart) saveCart(currentCart);
  renderCartPage();
  if (new URLSearchParams(window.location.search).get('checkout') === '1') {
    setTimeout(() => document.getElementById('checkoutBtn')?.click(), 150);
  }
}

init();
