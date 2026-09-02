let catalog = [];

function cardHTML(p) {
  const variantLabel = p._variantCount > 1 ? `<span class="product-card-variants">${p._variantCount} vial sizes</span>` : '';
  const proofNote = p.coa
    ? (p.coa.purity ? `${p.coa.purity} lab report` : 'Lab report available')
    : '';
  const badge = p.salesBadge || 'RUO';
  return `
    <div class="card product-card">
      <a class="card-link" href="/product/${encodeURIComponent(p.slug)}?sku=${encodeURIComponent(p.sku)}">
        <div class="card-media photo sku-mockup">
          ${productMockupImageHTML(p)}
          <span class="product-card-badge ${p.salesBadge ? 'sales-badge' : ''}">${escapeHTML(badge)}</span>
        </div>
        <div class="product-card-meta">
          <div class="group">${escapeHTML(p.group || p.category)}</div>
          <div class="product-card-spec">${escapeHTML(cleanVialSpec(p.spec))}${variantLabel}</div>
        </div>
        <h4>${escapeHTML(p.name)}</h4>
        <p class="product-card-description">${escapeHTML(p.description || 'Research-use compound for laboratory applications.')}</p>
        <div class="product-card-foot">
          <div>
            ${proofNote ? `<div class="product-card-note">${escapeHTML(proofNote)}</div>` : ''}
            <div class="product-card-availability ${p.availabilityLabel === 'Low stock' ? 'limited' : ''}">${escapeHTML(p.availabilityLabel || 'Available to order')}</div>
            <div class="price">$${p.price.toFixed(2)}</div>
          </div>
          <span class="product-card-arrow" aria-hidden="true">&rsaquo;</span>
        </div>
      </a>
      <button data-sku="${escapeHTML(p.sku)}" class="addBtn">Add to Cart</button>
    </div>
  `;
}

function wireAddButtons(container) {
  container.querySelectorAll('.addBtn').forEach(btn => {
    btn.onclick = () => {
      addToCart(btn.dataset.sku);
      updateCartBadge();
    };
  });
}

let activeFilter = 'All';
let activeSort = 'featured';
let catalogViewMode = 'families';

const BEST_SELLER_SKUS = ['MS40', 'RT20', 'CU100', 'CP10'];

function renderBestSellers() {
  const grid = document.getElementById('bestSellersGrid');
  if (!grid) return;

  const selected = BEST_SELLER_SKUS
    .map(sku => catalog.find(product => product.sku === sku))
    .filter(Boolean);
  const fallback = catalog
    .filter(product => product.popular && !BEST_SELLER_SKUS.includes(product.sku))
    .slice(0, Math.max(0, 4 - selected.length));
  const bestSellers = [...selected, ...fallback].slice(0, 4);

  grid.innerHTML = bestSellers.map(cardHTML).join('');
  wireAddButtons(grid);
}

function setActiveFilter(group) {
  activeFilter = group;
  renderFilterChips();
  renderCatalog();
}

function renderFilterChips() {
  const chipsEl = document.getElementById('filterChips');
  const groups = ['All', ...new Set(catalog.map(p => p.group || p.category))];
  chipsEl.innerHTML = groups.map(g =>
    `<button class="filter-chip ${g === activeFilter ? 'active' : ''}" data-group="${escapeHTML(g)}">${escapeHTML(g)}</button>`
  ).join('');
  chipsEl.querySelectorAll('.filter-chip').forEach(btn => {
    btn.onclick = () => setActiveFilter(btn.dataset.group);
  });
}

function renderCatalog() {
  const grid = document.getElementById('catalogGrid');
  let items = activeFilter === 'All'
    ? [...catalog]
    : catalog.filter(p => (p.group || p.category) === activeFilter);
  if (catalogViewMode === 'families') {
    const families = new Map();
    items.forEach(product => {
      const existing = families.get(product.slug);
      if (!existing) {
        families.set(product.slug, { ...product, _variantCount: 1 });
      } else {
        existing._variantCount += 1;
        if (product.popular && !existing.popular) {
          families.set(product.slug, { ...product, _variantCount: existing._variantCount });
        }
      }
    });
    items = [...families.values()];
  }
  if (activeSort === 'featured') items.sort((a, b) => a._catalogIndex - b._catalogIndex);
  if (activeSort === 'name') items.sort((a, b) => a.name.localeCompare(b.name) || a.price - b.price);
  if (activeSort === 'price-low') items.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
  if (activeSort === 'price-high') items.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name));
  grid.innerHTML = items.map(cardHTML).join('');
  wireAddButtons(grid);
  const empty = document.getElementById('catalogEmpty');
  if (empty) empty.hidden = items.length > 0;
}

async function init() {
  const catalogData = await api('/api/catalog');
  document.title = catalogData.siteName;
  catalog = catalogData.products.map((product, index) => ({ ...product, _catalogIndex: index }));
  window.siteCatalog = catalog;
  window.siteFees = { packagingFee: catalogData.packagingFee, shippingFee: catalogData.shippingFee, internationalShippingFee: catalogData.internationalShippingFee || 35, shippingOptions: catalogData.shippingOptions || [], orderFeeRate: catalogData.orderFeeRate || 0 };
  window.sitePromotion = catalogData.promotion || null;
  const statEl = document.getElementById('statCompoundCount');
  if (statEl) statEl.textContent = String(catalog.length);
  renderBestSellers();
  renderFilterChips();
  renderCatalog();
  updateCartBadge();

  const viewMode = document.getElementById('catalogViewMode');
  const sort = document.getElementById('catalogSort');
  if (viewMode) viewMode.onchange = () => {
    catalogViewMode = viewMode.value;
    renderCatalog();
  };
  if (sort) sort.onchange = () => {
    activeSort = sort.value;
    renderCatalog();
  };
}

function openSharedSearch() {
  const searchButton = document.getElementById('openProductSearch');
  if (searchButton) searchButton.click();
}

function scrollToCatalog() {
  document.getElementById('catalogSection').scrollIntoView({ behavior: 'smooth' });
}

const heroCatalogBtn = document.getElementById('heroCatalogBtn');
if (heroCatalogBtn) heroCatalogBtn.onclick = scrollToCatalog;

const heroSearchBtn = document.getElementById('heroSearchBtn');
if (heroSearchBtn) heroSearchBtn.onclick = openSharedSearch;

const catalogSearchShortcut = document.getElementById('catalogSearchShortcut');
if (catalogSearchShortcut) catalogSearchShortcut.onclick = openSharedSearch;

document.querySelectorAll('[data-group-jump]').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.dataset.groupJump;
    if (catalog.length) setActiveFilter(group);
    scrollToCatalog();
  });
});

init();





