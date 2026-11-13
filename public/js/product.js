const pathMatch = window.location.pathname.match(/^\/product\/([^/]+)$/);
const slug = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
const sku = new URLSearchParams(window.location.search).get('sku');
let selectedSku = sku;
let family = null;
let lastTrackedSku = null;

function containerLabel(product, quantity = 1) {
  const singular = product.containerLabel || 'vial';
  return quantity === 1 ? singular : `${singular}s`;
}

function variantButtonsHTML() {
  return family.variants.map(v => `
    <button class="variant-btn ${v.sku === selectedSku ? 'active' : ''}" data-sku="${v.sku}">
      <span class="variant-size">${escapeHTML(cleanVialSpec(v.spec))}</span>
      <span class="variant-price">$${v.price.toFixed(2)}</span>
    </button>
  `).join('');
}

function quantityBundleOptionsHTML(selected) {
  const tiers = Object.entries(selected.quantityDiscounts || {})
    .map(([quantity, savings]) => ({ quantity: Number(quantity), savings: Number(savings) }))
    .filter(tier => tier.quantity > 1 && tier.savings > 0)
    .sort((a, b) => a.quantity - b.quantity);
  if (!tiers.length) return '';
  return `
    <div class="size-label bundle-size-label">Choose a bundle</div>
    <div class="quantity-bundle-options" aria-label="Quantity bundle options">
      <button type="button" class="quantity-bundle-btn active" data-qty="1">
        <strong>1 vial</strong><span>$${selected.price.toFixed(2)}</span>
      </button>
      ${tiers.map(tier => {
        const total = Math.max(0, selected.price * tier.quantity - tier.savings);
        return `<button type="button" class="quantity-bundle-btn" data-qty="${tier.quantity}"><strong>${tier.quantity} vials</strong><span>$${total.toFixed(2)} · save $${tier.savings.toFixed(2)}</span></button>`;
      }).join('')}
    </div>
  `;
}

function coaHTML(selected) {
  const record = family.coaBySku && family.coaBySku[selected.sku];
  const productName = family.name.toLowerCase() === 'mots-c' ? 'MOTS-C' : family.name;
  const linkTitle = `${productName} COA`;
  if (!record) return '';
  const details = [record.lot ? `Batch ${record.lot}` : '', record.purity ? `${record.purity} purity` : '', record.result || '', record.lab || ''].filter(Boolean).join(' · ');
  return `
    <a class="product-coa-card" href="${escapeHTML(record.file)}" target="_blank" rel="noopener">
      <span class="product-coa-mark" aria-hidden="true">COA</span>
      <span class="product-coa-copy">
        <strong>${escapeHTML(linkTitle)}</strong>
        <em>${record.testedAt ? `${escapeHTML(record.testedAt)} · ` : ''}${details ? escapeHTML(details) : 'View batch laboratory report'}</em>
      </span>
      <span class="product-coa-open" aria-hidden="true">&nearr;</span>
    </a>
  `;
}

function relatedHTML() {
  const catalog = Array.isArray(window.siteCatalog) ? window.siteCatalog : [];
  const bySlug = new Map();
  for (const item of catalog) {
    if (!item.slug || item.slug === family.slug) continue;
    if ((item.group || item.category) !== (family.group || family.category)) continue;
    const current = bySlug.get(item.slug);
    if (!current || Number(item.price) < Number(current.price)) bySlug.set(item.slug, item);
  }
  const picks = [...bySlug.values()].slice(0, 4);
  if (!picks.length) return '';
  return `
    <section class="sx-related" aria-label="Related compounds">
      <div class="sx-related-head"><span class="sx-eyebrow">More ${escapeHTML(family.group || 'compounds')}</span><a href="/index.html#catalogSection">View all &rarr;</a></div>
      <div class="sx-related-row">
        ${picks.map(item => `
          <a class="sx-related-card" href="/product/${encodeURIComponent(item.slug)}?sku=${encodeURIComponent(item.sku)}">
            <span class="sx-related-img">${productMockupImageHTML(item)}</span>
            <strong>${escapeHTML(item.name)}</strong>
            <em>from $${Number(item.price).toFixed(2)}</em>
          </a>`).join('')}
      </div>
    </section>`;
}

function renderProduct() {
  const selected = family.variants.find(v => v.sku === selectedSku) || family.variants[0];
  const coaRecord = family.coaBySku && family.coaBySku[selected.sku];
  const availabilityLabel = selected.availabilityLabel || 'Available to order';
  if (selected.sku !== lastTrackedSku && window.hpTrack) {
    window.hpTrack('product_view', {
      sku: selected.sku,
      productName: family.name,
    });
    lastTrackedSku = selected.sku;
  }
  document.title = `${family.name} - Snowy Research`;
  document.getElementById('breadcrumb').innerHTML =
    `<a href="/index.html#catalogSection" style="color:inherit;">Shop</a> / ${escapeHTML(family.group || family.category)} / ${escapeHTML(family.name)}`;

  const researchName = selected.compoundName || family.compoundName || '';
  const showResearchName = researchName && researchName.toLowerCase() !== String(family.name).toLowerCase();
  const sizeLabel = cleanVialSpec(selected.spec);
  const groupLabel = family.group || family.category || 'Research compound';
  const specRows = [
    ['Catalog no.', selected.sku],
    showResearchName ? ['Research name', researchName] : null,
    ['Category', groupLabel],
    ['Size', `${sizeLabel} · 1 ${containerLabel(selected)}`],
    ['Form', /water/i.test(family.name) ? 'Sterile liquid' : 'Lyophilized powder'],
    ['Lab report', coaRecord ? (coaRecord.purity ? `${coaRecord.purity} purity` : 'Available') : 'On request'],
    ['Intended use', 'Laboratory research only'],
  ].filter(Boolean);

  document.getElementById('productContent').innerHTML = `
    <article class="sx">
      <header class="sx-head">
        <div class="sx-head-meta">
          <span class="sx-catno">No. ${escapeHTML(selected.sku)}</span>
          <span>${escapeHTML(groupLabel)}</span>
          ${selected.salesBadge ? `<span class="sx-flag">${escapeHTML(selected.salesBadge)}</span>` : ''}
        </div>
        <h1 class="product-title sx-title">${escapeHTML(family.name)}</h1>
        ${showResearchName ? `<p class="sx-aka">Research name <strong>${escapeHTML(researchName)}</strong></p>` : ''}
      </header>

      <div class="sx-grid">
        <figure class="sx-stage">
          <div class="product-media photo sku-mockup">${productMockupImageHTML(selected)}</div>
          <figcaption class="sx-stage-tag">
            <strong>${escapeHTML(sizeLabel)}</strong>
            <span>per ${escapeHTML(containerLabel(selected))}</span>
          </figcaption>
          ${coaRecord && coaRecord.purity ? `<span class="sx-stage-purity">${escapeHTML(coaRecord.purity)}<small>tested purity</small></span>` : ''}
        </figure>

        <section class="sx-ticket" aria-label="Order ${escapeHTML(family.name)}">
          <div class="sx-ticket-top">
            <span class="sx-stock ${availabilityLabel === 'Low stock' ? 'limited' : ''}"><i aria-hidden="true"></i>${escapeHTML(availabilityLabel)}</span>
            <span class="sx-ruo">Research use only</span>
          </div>
          <div class="price-block sx-price">
            <span class="price-amount">$${selected.price.toFixed(2)}</span>
            <span class="price-unit">/ ${escapeHTML(containerLabel(selected))}</span>
          </div>

          <div class="size-label">Size</div>
          <div class="variant-chips sx-sizes" id="variantChips">${variantButtonsHTML()}</div>

          ${quantityBundleOptionsHTML(selected)}

          <div class="purchase-row">
            <div class="qty-stepper">
              <button type="button" class="qty-btn" id="qtyDown" aria-label="Decrease quantity">&minus;</button>
              <input type="number" id="qtyInput" value="1" min="1" aria-label="Quantity">
              <button type="button" class="qty-btn" id="qtyUp" aria-label="Increase quantity">+</button>
            </div>
            <button id="addToCartBtn" class="add-to-cart-btn">Add to order</button>
          </div>
          <p class="form-msg" id="addMsg"></p>

          <ul class="sx-perks">
            <li><b>Crypto</b><span>No processing fee at checkout</span></li>
            <li><b>30 days</b><span>Not delivered? Your order is free</span></li>
            <li><b>TIKTOK15</b><span>15% off + free recon solution</span></li>
          </ul>
        </section>
      </div>

      <section class="sx-sheet">
        <div class="sx-about">
          <span class="sx-eyebrow">About this compound</span>
          <p class="product-description">${escapeHTML(selected.description || family.description)}</p>
          ${coaHTML(selected)}
        </div>
        <dl class="sx-specs">
          ${specRows.map(([k, v]) => `<div><dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd></div>`).join('')}
        </dl>
      </section>

      <section class="sx-sets" data-bundle-section hidden>
        <div class="sx-related-head"><span class="sx-eyebrow">Often researched together · save up to 10%</span></div>
        <div id="productBundleGrid" class="sn-bundle-grid"></div>
      </section>
      ${relatedHTML()}
    </article>
    <div class="mobile-purchase-dock" aria-label="Mobile purchase controls">
      <div><span>${escapeHTML(family.name)} · ${escapeHTML(sizeLabel)}</span><strong>$${selected.price.toFixed(2)}</strong></div>
      <button type="button" id="mobileAddToCartBtn">Add to order</button>
    </div>
  `;

  renderBundleCards(
    document.getElementById('productBundleGrid'),
    siteBundleList().filter(bundle => family.variants.some(variant => bundle.skus.includes(variant.sku))).slice(0, 2)
  );

  document.querySelectorAll('.variant-btn').forEach(btn => {
    btn.onclick = () => {
      selectedSku = btn.dataset.sku;
      renderProduct();
    };
  });

  const qtyInput = document.getElementById('qtyInput');
  const syncBundleButtons = () => {
    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    document.querySelectorAll('.quantity-bundle-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.qty) === qty);
    });
  };
  document.getElementById('qtyDown').onclick = () => {
    qtyInput.value = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
    syncBundleButtons();
  };
  document.getElementById('qtyUp').onclick = () => {
    qtyInput.value = (parseInt(qtyInput.value, 10) || 1) + 1;
    syncBundleButtons();
  };
  qtyInput.oninput = syncBundleButtons;
  document.querySelectorAll('.quantity-bundle-btn').forEach(btn => {
    btn.onclick = () => {
      qtyInput.value = btn.dataset.qty;
      syncBundleButtons();
    };
  });

  const addSelectedToCart = () => {
    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    addToCart(selectedSku, qty);
    updateCartBadge();
    const msg = document.getElementById('addMsg');
    msg.textContent = 'Added to your order.';
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
  window.siteFees = { packagingFee: catalogData.packagingFee, shippingFee: catalogData.shippingFee, internationalShippingFee: catalogData.internationalShippingFee || 35, priorityShippingFee: catalogData.priorityShippingFee || 19.99, shippingOptions: catalogData.shippingOptions || [], orderFeeRate: catalogData.orderFeeRate || 0 };
  window.sitePromotion = catalogData.promotion || null;
  window.siteBundles = catalogData.bundles || [];
  family = productData;
  selectedSku = sku || family.variants[0].sku;
  renderProduct();
  updateCartBadge();
}

init().catch(() => {
  document.getElementById('productContent').innerHTML = '<p class="hint">Product not found.</p>';
});



