const pathMatch = window.location.pathname.match(/^\/product\/([^/]+)$/);
const slug = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
const sku = new URLSearchParams(window.location.search).get('sku');
let selectedSku = sku;
let family = null;
let lastTrackedSku = null;

function variantButtonsHTML() {
  return family.variants.map(v => `
    <button class="variant-btn ${v.sku === selectedSku ? 'active' : ''}" data-sku="${v.sku}">
      <span class="variant-size">${escapeHTML(cleanVialSpec(v.spec))}</span>
      <span class="variant-price">$${v.price.toFixed(2)}</span>
    </button>
  `).join('');
}

function coaHTML(selected) {
  const record = family.coaBySku && family.coaBySku[selected.sku];
  if (!record) {
    const requestUrl = `/support.html?subject=COA%20request&product=${encodeURIComponent(`${family.name} ${cleanVialSpec(selected.spec)}`)}`;
    return `
      <a class="product-coa-cta secondary" href="${requestUrl}">
        <span>Current-lot documentation</span>
        <strong>Request COA for this vial</strong>
      </a>
    `;
  }
  const details = [record.lot ? `Lot ${record.lot}` : '', record.purity ? `${record.purity} purity` : '', record.result || '', record.lab || ''].filter(Boolean).join(' · ');
  const reportLabel = record.purity ? 'View Certificate of Analysis' : 'View Laboratory Report';
  return `
    <a class="product-coa-cta" href="${escapeHTML(record.file)}" target="_blank" rel="noopener">
      <span>Current-lot documentation${record.testedAt ? ` · ${escapeHTML(record.testedAt)}` : ''}</span>
      <strong>${reportLabel}</strong>
      ${details ? `<em>${escapeHTML(details)}</em>` : ''}
    </a>
  `;
}

function renderProduct() {
  const selected = family.variants.find(v => v.sku === selectedSku) || family.variants[0];
  const coaRecord = family.coaBySku && family.coaBySku[selected.sku];
  const purityProof = coaRecord
    ? (coaRecord.purity ? `${coaRecord.purity} reported purity` : 'Laboratory report available')
    : 'Current-lot documentation';
  const availabilityLabel = selected.availabilityLabel || 'Available to order';
  if (selected.sku !== lastTrackedSku && window.hpTrack) {
    window.hpTrack('product_view', {
      sku: selected.sku,
      productName: family.name,
    });
    lastTrackedSku = selected.sku;
  }
  document.title = `${family.name} - Highland Peptides`;
  document.getElementById('breadcrumb').innerHTML =
    `<a href="/index.html#catalogSection" style="color:inherit;">Shop</a> / ${escapeHTML(family.group || family.category)} / ${escapeHTML(family.name)}`;

  document.getElementById('productContent').innerHTML = `
    <div class="product-layout">
      <div class="product-media photo sku-mockup">${productMockupImageHTML(selected)}</div>
      <div class="product-info">
        <div class="product-kicker-row">
          <div class="group">${escapeHTML(family.group || family.category)}</div>
          <div class="product-kicker-badges">
            ${selected.salesBadge ? `<span class="sales-pill">${escapeHTML(selected.salesBadge)}</span>` : ''}
            <span class="ruo-pill">Research Use Only</span>
          </div>
        </div>
        <div class="product-proof-pills" aria-label="Product quality highlights">
          <span>${escapeHTML(purityProof)}</span>
          <span>${coaRecord ? 'Exact-strength lab report' : 'COA by current lot'}</span>
          <span>Fast U.S. fulfillment</span>
        </div>
        <h1 class="product-title">${escapeHTML(family.name)}</h1>
        <p class="hint product-description">${escapeHTML(family.description)}</p>
        <div class="product-availability ${availabilityLabel === 'Low stock' ? 'limited' : ''}"><span aria-hidden="true"></span> ${escapeHTML(availabilityLabel)} · current catalog lot</div>
        <div class="product-selected-card">
          <span>Selected vial</span>
          <strong>${escapeHTML(cleanVialSpec(selected.spec))}</strong>
        </div>
        <div class="product-trust-grid">
          <div><strong>Testing</strong><span>${escapeHTML(purityProof)}</span></div>
          <div><strong>COA</strong><span>${coaRecord ? 'View exact-strength report below' : 'Available by current lot'}</span></div>
          <div><strong>Ships</strong><span>Fast fulfillment from California</span></div>
          <div><strong>Expiry</strong><span>Good for the next 2 years</span></div>
        </div>
        ${coaHTML(selected)}

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
        <p class="product-use-note">Sold strictly for laboratory research use. Not for human or veterinary consumption, administration, diagnostic use, or injection.</p>
        <p class="form-msg" id="addMsg" style="color:var(--success);"></p>
      </div>
    </div>
    <div class="mobile-purchase-dock" aria-label="Mobile purchase controls">
      <div><span>${escapeHTML(family.name)} · ${escapeHTML(cleanVialSpec(selected.spec))}</span><strong>$${selected.price.toFixed(2)}</strong></div>
      <button type="button" id="mobileAddToCartBtn">Add to Cart</button>
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

  const addSelectedToCart = () => {
    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    addToCart(selectedSku, qty);
    updateCartBadge();
    const msg = document.getElementById('addMsg');
    msg.textContent = 'Added to cart.';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  };
  document.getElementById('addToCartBtn').onclick = addSelectedToCart;
  document.getElementById('mobileAddToCartBtn').onclick = addSelectedToCart;
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
  window.siteFees = { packagingFee: catalogData.packagingFee, shippingFee: catalogData.shippingFee, internationalShippingFee: catalogData.internationalShippingFee || 35, shippingOptions: catalogData.shippingOptions || [], orderFeeRate: catalogData.orderFeeRate || 0 };
  family = productData;
  selectedSku = sku || family.variants[0].sku;
  renderProduct();
  updateCartBadge();
}

init().catch(() => {
  document.getElementById('productContent').innerHTML = '<p class="hint">Product not found.</p>';
});



