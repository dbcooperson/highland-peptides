const sku = new URLSearchParams(window.location.search).get('sku');
let selectedSku = sku;
let family = null;

function variantButtonsHTML() {
  return family.variants.map(v => `
    <button class="variant-btn ${v.sku === selectedSku ? 'active' : ''}" data-sku="${v.sku}">
      ${v.spec.replace(' x1 vial', '')} &middot; $${v.price.toFixed(2)}
    </button>
  `).join('');
}

function renderProduct() {
  const selected = family.variants.find(v => v.sku === selectedSku) || family.variants[0];
  document.title = `${family.name} - Highland Peptides`;
  document.getElementById('breadcrumb').innerHTML =
    `<a href="/index.html#catalogSection" style="color:inherit;">Shop</a> / ${family.group || family.category} / ${family.name}`;

  document.getElementById('productContent').innerHTML = `
    <div class="product-layout">
      <div class="product-media photo">
        <div class="vial-photo-label">
          <div class="vp-name">${family.name}</div>
          <div class="vp-spec">${selected.spec}</div>
        </div>
      </div>
      <div class="product-info">
        <div class="group">${family.group || family.category}</div>
        <h1 style="margin:4px 0 10px; font-size:26px; letter-spacing:-0.01em;">${family.name}</h1>
        <p class="hint" style="font-size:14px; line-height:1.6; margin-bottom:20px;">${family.description}</p>

        <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted-on-light); margin-bottom:8px;">Choose Size</div>
        <div class="variant-chips" id="variantChips" style="margin-bottom:20px;">${variantButtonsHTML()}</div>

        <div class="price" style="font-size:24px; margin-bottom:16px;">$${selected.price.toFixed(2)}</div>

        <div style="display:flex; gap:10px; align-items:center; margin-bottom:6px;">
          <div class="qty-stepper">
            <button type="button" class="qty-btn" id="qtyDown" aria-label="Decrease quantity">&minus;</button>
            <input type="number" id="qtyInput" value="1" min="1">
            <button type="button" class="qty-btn" id="qtyUp" aria-label="Increase quantity">+</button>
          </div>
          <button id="addToCartBtn" style="flex:1;">Add to Cart</button>
        </div>
        <p class="form-msg" id="addMsg" style="color:var(--success);"></p>
      </div>
    </div>
  `;

  document.querySelectorAll('.variant-btn').forEach(btn => {
    btn.onclick = () => {
      selectedSku = btn.dataset.sku;
      renderProduct();
    };
  });

  const qtyInput = document.getElementById('qtyInput');
  document.getElementById('qtyDown').onclick = () => {
    qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
  };
  document.getElementById('qtyUp').onclick = () => {
    qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
  };

  document.getElementById('addToCartBtn').onclick = () => {
    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    addToCart(selectedSku, qty);
    renderCart();
    const msg = document.getElementById('addMsg');
    msg.textContent = 'Added to cart.';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  };
}

wireCart();

async function init() {
  if (!sku) {
    document.getElementById('productContent').innerHTML = '<p class="hint">Product not found.</p>';
    return;
  }
  const [catalogData, productData] = await Promise.all([
    api('/api/catalog'),
    api(`/api/product?sku=${encodeURIComponent(sku)}`),
  ]);
  window.siteCatalog = catalogData.products;
  family = productData;
  renderProduct();
  renderCart();
}

init().catch(() => {
  document.getElementById('productContent').innerHTML = '<p class="hint">Product not found.</p>';
});
