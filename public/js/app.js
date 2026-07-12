let catalog = [];

function cardHTML(p) {
  return `
    <div class="card product-card">
      <a class="card-link" href="/product/${encodeURIComponent(p.slug)}">
        <div class="card-media photo">
          <span class="product-card-badge">RUO</span>
        </div>
        <div class="product-card-meta">
          <div class="group">${p.group || p.category}</div>
          <div class="product-card-spec">${p.spec.replace(' x1 vial', '')}</div>
        </div>
        <h4>${p.name}</h4>
        <div class="product-card-foot">
          <div>
            <div class="product-card-note">COA available</div>
            <div class="price">$${p.price.toFixed(2)}</div>
          </div>
          <span class="product-card-arrow" aria-hidden="true">&rsaquo;</span>
        </div>
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


