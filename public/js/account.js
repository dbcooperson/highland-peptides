const authShell = document.getElementById('accountAuth');
const dashboardShell = document.getElementById('accountDashboard');

function accountMessage(element, text, type = '') {
  if (!element) return;
  element.textContent = text || '';
  element.classList.toggle('success', type === 'success');
  element.classList.toggle('error', type === 'error');
}

function setAuthView(view) {
  document.querySelectorAll('[data-auth-view]').forEach(button => button.classList.toggle('active', button.dataset.authView === view));
  document.querySelectorAll('[data-auth-panel]').forEach(panel => { panel.hidden = panel.dataset.authPanel !== view; });
  document.getElementById('accountResetForm').hidden = true;
}

function money(value) {
  return '$' + Number(value || 0).toFixed(2);
}

function safeDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function renderActivity(container, items, renderer, emptyText) {
  container.innerHTML = items.length ? items.map(renderer).join('') : `<div class="account-empty-state">${escapeHTML(emptyText)}</div>`;
}

function renderDashboard(data) {
  const { account, stats, orders, payouts } = data;
  document.getElementById('accountWelcome').textContent = `Welcome, ${account.name.split(/\s+/)[0]}`;
  document.getElementById('accountEmail').textContent = account.email;
  document.getElementById('creditBalance').textContent = money(stats.creditBalance);
  document.getElementById('referralCustomers').textContent = `${stats.uniqueCustomers} / ${stats.minCustomers}`;
  document.getElementById('referralSpend').textContent = `${money(stats.totalSpend)} / ${money(stats.minSpend)}`;

  const codeEmpty = document.getElementById('referralCodeEmpty');
  const codeReady = document.getElementById('referralCodeReady');
  codeEmpty.hidden = Boolean(account.referralCode);
  codeReady.hidden = !account.referralCode;
  if (account.referralCode) document.getElementById('referralCodeText').textContent = account.referralCode;

  const customerPercent = Math.min(100, stats.uniqueCustomers / stats.minCustomers * 100);
  const spendPercent = Math.min(100, stats.totalSpend / stats.minSpend * 100);
  document.getElementById('customerProgressLabel').textContent = `${stats.uniqueCustomers} of ${stats.minCustomers}`;
  document.getElementById('spendProgressLabel').textContent = `${money(stats.totalSpend)} of ${money(stats.minSpend)}`;
  document.getElementById('customerProgressBar').style.width = `${customerPercent}%`;
  document.getElementById('spendProgressBar').style.width = `${spendPercent}%`;

  const openPayout = payouts.find(item => ['pending', 'approved'].includes(item.status));
  const payoutButton = document.getElementById('payoutRequestButton');
  const payoutMessage = document.getElementById('payoutMessage');
  if (openPayout) {
    document.getElementById('payoutTitle').textContent = 'Payout request under review';
    payoutButton.disabled = true;
    payoutButton.textContent = `${money(openPayout.amount)} · ${statusLabel(openPayout.status)}`;
    payoutMessage.textContent = 'Support will review and coordinate the payout using your verified account email.';
  } else if (stats.payoutEligible) {
    document.getElementById('payoutTitle').textContent = 'Cash-out is unlocked';
    payoutButton.disabled = stats.creditBalance <= 0;
    payoutButton.textContent = stats.creditBalance > 0 ? `Request ${money(stats.creditBalance)} payout` : 'No available balance';
    payoutMessage.textContent = 'Requests are manually reviewed. Your full available store-credit balance will be reserved while the request is reviewed.';
  } else {
    document.getElementById('payoutTitle').textContent = 'Build toward payout eligibility';
    payoutButton.disabled = true;
    payoutButton.textContent = 'Request cash payout';
    payoutMessage.textContent = 'Store credit remains available at checkout before cash-out eligibility.';
  }

  renderActivity(document.getElementById('referralActivity'), stats.recentReferrals || [], item => `
    <div class="account-activity-row"><div><strong>${escapeHTML(item.customer)}</strong><span>Order HP-${item.orderId} · ${safeDate(item.paidAt)}</span></div><div><strong>+${money(item.creditEarned)}</strong><span>${money(item.productSpend)} spend</span></div></div>`, 'Paid referral activity will appear here.');
  renderActivity(document.getElementById('accountOrders'), orders || [], item => `
    <div class="account-activity-row"><div><strong>Order HP-${item.id}</strong><span>${item.itemCount} item${item.itemCount === 1 ? '' : 's'} · ${safeDate(item.createdAt)}</span></div><div><strong>${money(item.total)}</strong><span class="account-order-status">${escapeHTML(statusLabel(item.status))}</span></div></div>`, 'Orders using this verified email will appear here.');
}

async function loadDashboard() {
  const state = await refreshAccountState();
  if (!state.authenticated) {
    authShell.hidden = false;
    dashboardShell.hidden = true;
    return;
  }
  const data = await api('/api/account/dashboard');
  authShell.hidden = true;
  dashboardShell.hidden = false;
  renderDashboard(data);
}

document.querySelectorAll('[data-auth-view]').forEach(button => {
  button.addEventListener('click', () => setAuthView(button.dataset.authView));
});

document.getElementById('accountLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('loginMessage');
  accountMessage(message, 'Signing in…');
  try {
    await api('/api/account/login', { method: 'POST', body: { email: document.getElementById('loginEmail').value, password: document.getElementById('loginPassword').value } });
    if (new URLSearchParams(location.search).get('return') === 'cart') {
      location.href = '/cart.html';
      return;
    }
    await loadDashboard();
  } catch (err) {
    accountMessage(message, err.message, 'error');
  }
});

document.getElementById('accountRegisterForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('registerMessage');
  accountMessage(message, 'Creating your account…');
  try {
    const result = await api('/api/account/register', { method: 'POST', body: { name: document.getElementById('registerName').value, email: document.getElementById('registerEmail').value, password: document.getElementById('registerPassword').value } });
    accountMessage(message, result.message, 'success');
  } catch (err) {
    accountMessage(message, err.message, 'error');
  }
});

document.getElementById('resendVerificationButton').addEventListener('click', async () => {
  const email = document.getElementById('registerEmail').value.trim();
  const message = document.getElementById('registerMessage');
  if (!email) return accountMessage(message, 'Enter your email first.', 'error');
  try {
    const result = await api('/api/account/resend-verification', { method: 'POST', body: { email } });
    accountMessage(message, result.message, 'success');
  } catch (err) {
    accountMessage(message, err.message, 'error');
  }
});

document.getElementById('forgotPasswordButton').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const message = document.getElementById('loginMessage');
  if (!email) return accountMessage(message, 'Enter your email first.', 'error');
  try {
    const result = await api('/api/account/forgot-password', { method: 'POST', body: { email } });
    accountMessage(message, result.message, 'success');
  } catch (err) {
    accountMessage(message, err.message, 'error');
  }
});

document.getElementById('accountResetForm').addEventListener('submit', async event => {
  event.preventDefault();
  const token = new URLSearchParams(location.search).get('reset');
  const message = document.getElementById('resetMessage');
  try {
    const result = await api('/api/account/reset-password', { method: 'POST', body: { token, password: document.getElementById('resetPassword').value } });
    accountMessage(message, result.message, 'success');
    setTimeout(() => { history.replaceState({}, '', '/account.html'); setAuthView('login'); }, 1000);
  } catch (err) {
    accountMessage(message, err.message, 'error');
  }
});

document.getElementById('referralCodeForm').addEventListener('submit', async event => {
  event.preventDefault();
  const message = document.getElementById('referralCodeMessage');
  try {
    await api('/api/account/referral-code', { method: 'POST', body: { code: document.getElementById('referralCodeInput').value } });
    accountMessage(message, 'Your referral code is active.', 'success');
    await loadDashboard();
  } catch (err) {
    accountMessage(message, err.message, 'error');
  }
});

document.getElementById('copyReferralCode').addEventListener('click', async () => {
  const code = document.getElementById('referralCodeText').textContent;
  try {
    await navigator.clipboard.writeText(code);
    document.getElementById('copyReferralCode').textContent = 'Copied';
    setTimeout(() => { document.getElementById('copyReferralCode').textContent = 'Copy'; }, 1200);
  } catch {
    document.getElementById('referralCodeMessage').textContent = `Code: ${code}`;
  }
});

document.getElementById('payoutRequestButton').addEventListener('click', async () => {
  const button = document.getElementById('payoutRequestButton');
  const message = document.getElementById('payoutMessage');
  button.disabled = true;
  try {
    await api('/api/account/payout-request', { method: 'POST' });
    message.textContent = 'Payout request submitted for manual review.';
    await loadDashboard();
  } catch (err) {
    message.textContent = err.message;
    button.disabled = false;
  }
});

document.getElementById('accountLogoutButton').addEventListener('click', async () => {
  await api('/api/account/logout', { method: 'POST' });
  location.href = '/account.html';
});

(async function initAccountPage() {
  const params = new URLSearchParams(location.search);
  if (params.get('reset')) {
    authShell.hidden = false;
    dashboardShell.hidden = true;
    document.querySelectorAll('[data-auth-panel]').forEach(panel => { panel.hidden = true; });
    document.getElementById('accountResetForm').hidden = false;
    return;
  }
  if (params.get('verified') === '1') {
    setAuthView('login');
    accountMessage(document.getElementById('loginMessage'), 'Email verified. Sign in to continue.', 'success');
  } else if (params.get('verification') === 'invalid') {
    setAuthView('register');
    accountMessage(document.getElementById('registerMessage'), 'That verification link is invalid or expired. Request a new one below.', 'error');
  }
  try {
    await loadDashboard();
  } catch (err) {
    authShell.hidden = false;
    dashboardShell.hidden = true;
    accountMessage(document.getElementById('loginMessage'), err.message, 'error');
  }
})();
