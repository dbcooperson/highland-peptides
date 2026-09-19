async function promoApi(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

const loginPanel = document.getElementById('loginPanel');
const managerPanel = document.getElementById('managerPanel');
const logoutBtn = document.getElementById('logoutBtn');

function showManager(access = {}) {
  loginPanel.hidden = true;
  managerPanel.hidden = false;
  logoutBtn.hidden = false;
  loadCodes();
  const ogrePanel = document.getElementById('ogreOrdersPanel');
  const canViewApprovedOgreOrders = access.canViewApprovedOgreOrders === true;
  if (ogrePanel) ogrePanel.hidden = !canViewApprovedOgreOrders;
  if (canViewApprovedOgreOrders) loadApprovedOgreOrders();
}

function showLogin() {
  loginPanel.hidden = false;
  managerPanel.hidden = true;
  logoutBtn.hidden = true;
  const ogrePanel = document.getElementById('ogreOrdersPanel');
  if (ogrePanel) ogrePanel.hidden = true;
}

async function loadCodes() {
  const list = document.getElementById('codeList');
  try {
    const { codes } = await promoApi('/api/promo-manager/codes');
    list.innerHTML = codes.length
      ? codes.map(item => `<p><strong>${escapeHtml(item.code)}</strong> — 15% off <span class="hint">${new Date(item.createdAt).toLocaleString()}</span></p>`).join('')
      : '<p class="hint">No codes created yet.</p>';
  } catch (err) {
    list.textContent = err.message;
  }
}

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = String(value || '');
  return element.innerHTML;
}

async function loadApprovedOgreOrders() {
  const list = document.getElementById('ogreOrderList');
  if (!list) return;
  try {
    const { orders } = await promoApi('/api/promo-manager/ogre-orders');
    list.innerHTML = orders.length
      ? orders.map(order => `<article class="promo-approved-order">
          <p><strong>HP-${escapeHtml(order.orderId)}</strong> · ${escapeHtml(order.customerName)} · <a href="mailto:${encodeURIComponent(order.customerEmail)}">${escapeHtml(order.customerEmail)}</a></p>
          <p>${escapeHtml(new Date(order.createdAt).toLocaleString())} · ${escapeHtml(String(order.status || '').replaceAll('_', ' '))} · <strong>$${Number(order.total || 0).toFixed(2)}</strong></p>
          <p class="hint">${(order.items || []).map(item => `${escapeHtml(item.quantity)}× ${escapeHtml(item.name)} ${escapeHtml(item.spec)}`).join(' · ')}</p>
        </article>`).join('')
      : '<p class="hint">No OGRE orders have been approved for you yet.</p>';
  } catch (err) {
    list.textContent = err.message;
  }
}

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('loginMessage');
  message.textContent = '';
  try {
    const access = await promoApi('/api/promo-manager/login', {
      method: 'POST',
      body: { username: document.getElementById('username').value, password: document.getElementById('password').value },
    });
    document.getElementById('password').value = '';
    showManager(access);
  } catch (err) {
    message.textContent = err.message;
  }
});

document.getElementById('codeForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = document.getElementById('promoCode');
  const message = document.getElementById('codeMessage');
  message.textContent = '';
  try {
    const created = await promoApi('/api/promo-manager/codes', { method: 'POST', body: { code: input.value } });
    message.textContent = `${created.code} is active for 15% off.`;
    input.value = '';
    await loadCodes();
  } catch (err) {
    message.textContent = err.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  await promoApi('/api/promo-manager/logout', { method: 'POST' });
  showLogin();
});

promoApi('/api/promo-manager/session')
  .then(session => session.authenticated ? showManager(session) : showLogin())
  .catch(showLogin);
