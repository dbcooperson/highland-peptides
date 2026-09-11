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

function showManager() {
  loginPanel.hidden = true;
  managerPanel.hidden = false;
  logoutBtn.hidden = false;
  loadCodes();
}

function showLogin() {
  loginPanel.hidden = false;
  managerPanel.hidden = true;
  logoutBtn.hidden = true;
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

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('loginMessage');
  message.textContent = '';
  try {
    await promoApi('/api/promo-manager/login', {
      method: 'POST',
      body: { username: document.getElementById('username').value, password: document.getElementById('password').value },
    });
    document.getElementById('password').value = '';
    showManager();
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
  .then(session => session.authenticated ? showManager() : showLogin())
  .catch(showLogin);
