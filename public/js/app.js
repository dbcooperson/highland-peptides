let catalog = [];

function cardHTML(p) {
  return `
    <div class="card">
      <a class="card-link" href="/product.html?sku=${encodeURIComponent(p.sku)}">
        <div class="card-media">${vialLabelSVG(p)}</div>
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
      renderCart();
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

wireCart();

async function init() {
  const catalogData = await api('/api/catalog');
  document.getElementById('siteName').textContent = catalogData.siteName;
  document.title = catalogData.siteName;
  catalog = catalogData.products;
  window.siteCatalog = catalog;
  const statEl = document.getElementById('statCompoundCount');
  if (statEl) statEl.textContent = `${catalog.length}+`;
  renderBestSellers();
  renderFilterChips();
  renderCatalog();
  renderCart();
}

const heroCatalogBtn = document.getElementById('heroCatalogBtn');
if (heroCatalogBtn) {
  heroCatalogBtn.onclick = () => {
    document.getElementById('catalogSection').scrollIntoView({ behavior: 'smooth' });
  };
}

init();
