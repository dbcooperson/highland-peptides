let currentAccount = null;
let catalog = [];
const cart = {}; // sku -> qty

// ---------- Entry gate (age + RUO confirmation, shown before anything else) ----------
function initEntryGate() {
  const gate = document.getElementById('entryGate');
  const alreadyAgreed = localStorage.getItem('ruo_gate_agreed') === 'yes';
  gate.style.display = alreadyAgreed ? 'none' : 'flex';

  document.getElementById('entryAgreeBtn').onclick = () => {
    localStorage.setItem('ruo_gate_agreed', 'yes');
    gate.style.display = 'none';
  };
  document.getElementById('entryExitBtn').onclick = () => {
    window.location.href = 'https://www.google.com';
  };
}
initEntryGate();

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (currentAccount) {
    const pill = currentAccount.status === 'approved'
      ? '<span class="status-pill status-approved">Approved</span>'
      : `<span class="status-pill">${currentAccount.status}</span>`;
    el.innerHTML = `${currentAccount.company_name} ${pill} <button id="logoutBtn">Log Out</button>`;
    document.getElementById('logoutBtn').onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      currentAccount = null;
      init();
    };
  } else {
    el.innerHTML = '';
  }
}

function renderGateAndCatalogVisibility() {
  const gate = document.getElementById('gate');
  const pendingNotice = document.getElementById('pendingNotice');
  const cartPanel = document.getElementById('cartPanel');

  if (!currentAccount) {
    gate.style.display = 'block';
    pendingNotice.style.display = 'none';
    cartPanel.style.display = 'none';
  } else if (currentAccount.status !== 'approved') {
    gate.style.display = 'none';
    pendingNotice.style.display = 'block';
    document.getElementById('pendingCompany').textContent = currentAccount.company_name;
    cartPanel.style.display = 'none';
  } else {
    gate.style.display = 'none';
    pendingNotice.style.display = 'none';
    cartPanel.style.display = 'block';
  }
  renderCatalog();
}

function renderCatalog() {
  const grid = document.getElementById('catalogGrid');
  const canBuy = currentAccount && currentAccount.status === 'approved';
  grid.innerHTML = catalog.map(p => `
    <div class="card">
      <h4>${p.name}</h4>
      <div class="spec">${p.spec}</div>
      <div class="price">$${p.price.toFixed(2)}</div>
      <button ${canBuy ? '' : 'disabled'} data-sku="${p.sku}" class="addBtn">
        ${canBuy ? 'Add to Cart' : 'Approved account required'}
      </button>
    </div>
  `).join('');
  if (canBuy) {
    document.querySelectorAll('.addBtn').forEach(btn => {
      btn.onclick = () => {
        const sku = btn.dataset.sku;
        cart[sku] = (cart[sku] || 0) + 1;
        renderCart();
      };
    });
  }
}

function renderCart() {
  const itemsEl = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  const skus = Object.keys(cart).filter(s => cart[s] > 0);
  if (skus.length === 0) {
    itemsEl.innerHTML = '<p class="hint">Cart is empty.</p>';
    totalEl.textContent = '';
    return;
  }
  let subtotal = 0;
  itemsEl.innerHTML = skus.map(sku => {
    const p = catalog.find(x => x.sku === sku);
    const lineTotal = p.price * cart[sku];
    subtotal += lineTotal;
    return `<div class="cart-row"><span>${p.name} x${cart[sku]}</span><span>$${lineTotal.toFixed(2)}</span></div>`;
  }).join('');
  totalEl.textContent = `Subtotal: $${subtotal.toFixed(2)} (+ packaging fee at checkout)`;
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('tab-btn')) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    const tab = e.target.dataset.tab;
    document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('signupForm').style.display = tab === 'signup' ? 'block' : 'none';
  }
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  try {
    await api('/api/login', { method: 'POST', body: { email, password } });
    await loadMe();
  } catch (err) {
    document.getElementById('loginMsg').textContent = err.message;
  }
});

document.getElementById('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const companyName = document.getElementById('suCompany').value;
  const contactName = document.getElementById('suContact').value;
  const email = document.getElementById('suEmail').value;
  const password = document.getElementById('suPassword').value;
  const agreedToTerms = document.getElementById('suAgree').checked;
  if (!agreedToTerms) {
    document.getElementById('signupMsg').style.color = '#ff6b6b';
    document.getElementById('signupMsg').textContent = 'You must agree to the Research Use Only Terms to create an account.';
    return;
  }
  try {
    const result = await api('/api/signup', { method: 'POST', body: { companyName, contactName, email, password, agreedToTerms } });
    document.getElementById('signupMsg').style.color = '#7fe0a3';
    document.getElementById('signupMsg').textContent = result.message;
  } catch (err) {
    document.getElementById('signupMsg').style.color = '#ff6b6b';
    document.getElementById('signupMsg').textContent = err.message;
  }
});

document.getElementById('checkoutBtn').addEventListener('click', async () => {
  const items = Object.keys(cart).filter(s => cart[s] > 0).map(sku => ({ sku, quantity: cart[sku] }));
  if (items.length === 0) {
    document.getElementById('checkoutMsg').textContent = 'Cart is empty.';
    return;
  }
  try {
    const result = await api('/api/checkout', { method: 'POST', body: { items } });
    document.getElementById('checkoutMsg').style.color = '#7fe0a3';
    document.getElementById('checkoutMsg').textContent = `${result.message} (Order #${result.orderId}, total $${result.total.toFixed(2)})`;
    Object.keys(cart).forEach(k => delete cart[k]);
    renderCart();
  } catch (err) {
    document.getElementById('checkoutMsg').style.color = '#ff6b6b';
    document.getElementById('checkoutMsg').textContent = err.message;
  }
});

async function loadMe() {
  const data = await api('/api/me');
  currentAccount = data.loggedIn ? data.account : null;
  renderAuthArea();
  renderGateAndCatalogVisibility();
}

async function init() {
  const catalogData = await api('/api/catalog');
  document.getElementById('siteName').textContent = catalogData.siteName;
  document.title = catalogData.siteName;
  catalog = catalogData.products;
  await loadMe();
}

init();
