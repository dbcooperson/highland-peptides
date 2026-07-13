const pathMatch = window.location.pathname.match(/^\/product\/([^/]+)$/);
const slug = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
const sku = new URLSearchParams(window.location.search).get('sku');
let selectedSku = sku;
let family = null;

function variantButtonsHTML() {
  return family.variants.map(v => `
    <button class="variant-btn ${v.sku === selectedSku ? 'active' : ''}" data-sku="${v.sku}">
      <span class="variant-size">${v.spec.replace(' x1 vial', '')}</span>
      <span class="variant-price">$${v.price.toFixed(2)}</span>
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
      <div class="product-media photo">${vialLabelHTML(family.name, selected.spec, 'detail-vial-label')}</div>
      <div class="product-info">
        <div class="product-kicker-row">
          <div class="group">${family.group || family.category}</div>
          <span class="ruo-pill">Research Use Only</span>
        </div>
        <div class="product-proof-pills" aria-label="Product quality highlights">
          <span>99%+ Purity</span>
          <span>COA Available</span>
          <span>Research Grade</span>
        </div>
        <h1 class="product-title">${family.name}</h1>
        <p class="hint product-description">${family.description}</p>
        <div class="product-trust-grid">
          <div><strong>Purity</strong><span>99%+ research grade</span></div>
          <div><strong>COA</strong><span>Available on request</span></div>
          <div><strong>Ships</strong><span>From California</span></div>
          <div><strong>Use</strong><span>Laboratory research only</span></div>
        </div>

        <div class="size-label">Choose vial size</div>
        <div class="variant-chips" id="variantChips">${variantButtonsHTML()}</div>

        <div class="price-block">
          <span class="price-amount">$${selected.price.toFixed(2)}</span>
          <span class="price-unit">per vial</span>
        </div>

        <div class="purchase-row">
          <div class="qty-stepper">
            <button type="button" class="qty-btn" id="qtyDown" aria-label="Decrease quantity">&minus;</button>
            <input type="number" id="qtyInput" value="1" min="1">
            <button type="button" class="qty-btn" id="qtyUp" aria-label="Increase quantity">+</button>
          </div>
          <button id="addToCartBtn" class="add-to-cart-btn">Add to Cart</button>
        </div>
        <p class="product-use-note">99%+ purity research compound. Not for human or veterinary use, consumption, injection, or administration.</p>
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
    updateCartBadge();
    const msg = document.getElementById('addMsg');
    msg.textContent = 'Added to cart.';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  };
}

async function init() {
  if (!slug && !sku) {
    document.getElementById('productContent').innerHTML = '<p class="hint">Product not found.</p>';
    return;
  }
  const query = slug ? `slug=${encodeURIComponent(slug)}` : `sku=${encodeURIComponent(sku)}`;
  const [catalogData, productData] = await Promise.all([
    api('/api/catalog'),
    api(`/api/product?${query}`),
  ]);
  window.siteCatalog = catalogData.products;
  window.siteFees = { packagingFee: catalogData.packagingFee, shippingFee: catalogData.shippingFee };
  family = productData;
  selectedSku = sku || family.variants[0].sku;
  renderProduct();
  updateCartBadge();
}

init().catch(() => {
  document.getElementById('productContent').innerHTML = '<p class="hint">Product not found.</p>';
});


