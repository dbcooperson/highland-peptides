let catalog = [];

function cardHTML(p) {
  return `
    <div class="card">
      <a class="card-link" href="/product/${encodeURIComponent(p.slug)}">
        <div class="card-media photo"></div>
        <div class="group">${p.group || p.category}</div>
        <h4>${p.name}</h4>
        <div class="spec">${p.spec}</div>
        <div class="price">$${p.price.toFixed(2)}</div>
      </a>
      <button data-sku="${p.sku}" class="addBtn">Add to Cart</button>
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

function renderBestSellers() {
  const grid = document.getElementById('bestSellersGrid');
  const bestSellers = catalog.filter(p => p.popular);
  grid.innerHTML = bestSellers.map(cardHTML).join('');
  wireAddButtons(grid);
}

function renderFilterChips() {
  const chipsEl = document.getElementById('filterChips');
  const groups = ['All', ...new Set(catalog.map(p => p.group || p.category))];
  chipsEl.innerHTML = groups.map(g =>
    `<button class="filter-chip ${g === activeFilter ? 'active' : ''}" data-group="${g}">${g}</button>`
  ).join('');
  chipsEl.querySelectorAll('.filter-chip').forEach(btn => {
    btn.onclick = () => {
      activeFilter = btn.dataset.group;
      renderFilterChips();
      renderCatalog();
    };
  });
}

function renderCatalog() {
  const grid = document.getElementById('catalogGrid');
  const items = activeFilter === 'All'
    ? catalog
    : catalog.filter(p => (p.group || p.category) === activeFilter);
  grid.innerHTML = items.map(cardHTML).join('');
  wireAddButtons(grid);
}

function searchResultHTML(p) {
  return `
    <a class="product-search-result" href="/product/${encodeURIComponent(p.slug)}">
      <div class="product-search-result-media photo"></div>
      <div class="product-search-result-copy">
        <span class="product-search-result-group">${p.group || p.category}</span>
        <strong>${p.name}</strong>
        <span>${p.spec}</span>
      </div>
      <span class="product-search-result-arrow" aria-hidden="true">&rsaquo;</span>
    </a>
  `;
}

function wireProductSearch() {
  const openButton = document.getElementById('openProductSearch');
  const closeButton = document.getElementById('closeProductSearch');
  const overlay = document.getElementById('productSearchOverlay');
  const input = document.getElementById('productSearchInput');
  const results = document.getElementById('productSearchResults');
  const status = document.getElementById('productSearchStatus');
  if (!openButton || !overlay || !input || !results || !status) return;

  const renderResults = () => {
    const query = input.value.trim().toLowerCase();
    const matches = query
      ? catalog.filter(p => [p.name, p.spec, p.sku, p.category, p.group]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(query)))
      : catalog.filter(p => p.popular).slice(0, 8);

    status.textContent = query
      ? `${matches.length} result${matches.length === 1 ? '' : 's'}`
      : 'Popular products';
    results.innerHTML = matches.length
      ? matches.slice(0, 24).map(searchResultHTML).join('')
      : '<div class="product-search-empty"><strong>No products found</strong><span>Try another compound, SKU, category, or specification.</span></div>';
  };

  const openSearch = () => {
    overlay.hidden = false;
    document.body.classList.add('search-open');
    input.value = '';
    renderResults();
    requestAnimationFrame(() => input.focus());
  };

  const closeSearch = () => {
    overlay.hidden = true;
    document.body.classList.remove('search-open');
    openButton.focus();
  };

  openButton.addEventListener('click', openSearch);
  closeButton.addEventListener('click', closeSearch);
  input.addEventListener('input', renderResults);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeSearch();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) closeSearch();
  });
}

async function init() {
  const catalogData = await api('/api/catalog');
  document.title = catalogData.siteName;
  catalog = catalogData.products;
  window.siteCatalog = catalog;
  window.siteFees = { packagingFee: catalogData.packagingFee, shippingFee: catalogData.shippingFee };
  const statEl = document.getElementById('statCompoundCount');
  if (statEl) statEl.textContent = `${catalog.length}+`;
  renderBestSellers();
  renderFilterChips();
  wireProductSearch();
  renderCatalog();
  updateCartBadge();
}

const heroCatalogBtn = document.getElementById('heroCatalogBtn');
if (heroCatalogBtn) {
  heroCatalogBtn.onclick = () => {
    document.getElementById('catalogSection').scrollIntoView({ behavior: 'smooth' });
  };
}

init();
