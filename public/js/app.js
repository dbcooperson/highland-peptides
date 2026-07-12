let catalog = [];

function cardHTML(p) {
  return `
    <div class="card">
      <a class="card-link" href="/product/${encodeURIComponent(p.slug)}">
        <div class="card-media photo">${vialPhotoLabelHTML(p.name, p.spec, { name: 10, spec: 8 })}</div>
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
let searchQuery = '';

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
  const filteredByGroup = activeFilter === 'All'
    ? catalog
    : catalog.filter(p => (p.group || p.category) === activeFilter);
  const query = searchQuery.trim().toLowerCase();
  const items = query
    ? filteredByGroup.filter(p => [p.name, p.spec, p.sku, p.category, p.group]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query)))
    : filteredByGroup;
  grid.innerHTML = items.map(cardHTML).join('');
  wireAddButtons(grid);

  const emptyEl = document.getElementById('catalogEmpty');
  const countEl = document.getElementById('searchResultCount');
  if (emptyEl) emptyEl.hidden = items.length !== 0;
  if (countEl) countEl.textContent = query ? `${items.length} result${items.length === 1 ? '' : 's'}` : '';
}

function wireCatalogSearch() {
  const input = document.getElementById('catalogSearch');
  if (!input) return;
  input.addEventListener('input', () => {
    searchQuery = input.value;
    renderCatalog();
  });
}

wireCart();

async function init() {
  const catalogData = await api('/api/catalog');
  document.title = catalogData.siteName;
  catalog = catalogData.products;
  window.siteCatalog = catalog;
  const statEl = document.getElementById('statCompoundCount');
  if (statEl) statEl.textContent = `${catalog.length}+`;
  renderBestSellers();
  renderFilterChips();
  wireCatalogSearch();
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
