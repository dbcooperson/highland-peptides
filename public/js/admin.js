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

function td(text) { return `<td class="admin-td">${text}</td>`; }
function th(text) { return `<th class="admin-th">${text}</th>`; }
function money(value) { return '$' + Number(value || 0).toFixed(2); }

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mailtoHref(email) {
  return 'mailto:' + encodeURIComponent(String(email || '').trim());
}

function initAdminTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.admin-tab-panel').forEach(panel => {
        panel.hidden = panel.dataset.adminPanel !== tab.dataset.adminTab;
      });
      if (tab.dataset.adminTab === 'analytics') loadAnalytics();
      if (tab.dataset.adminTab === 'referrals') loadReferrals();
      if (tab.dataset.adminTab === 'labels') loadOrders();
      if (tab.dataset.adminTab === 'security') loadSecurityLog();
      if (tab.dataset.adminTab === 'messages') loadSupportThreads();
      if (tab.dataset.adminTab === 'giveaway') loadGiveaway();
    };
  });
}

function showAdminDashboard() {
  document.getElementById('adminLogin').style.display = 'none';
  document.getElementById('adminPanels').style.display = 'block';
  document.getElementById('adminLogoutBtn').style.display = 'inline-block';
  initAdminTabs();
  startSupportUnreadPolling();
  loadStorageInfo();
  loadOrders();
  loadProfit();
  loadUnitEconomics();
  loadLaunchChecks();
  initLabelMaker();
}

function referralAdminSummaryHTML(accounts, payouts, rewards = [], social = []) {
  const verified = accounts.filter(account => account.verifiedAt).length;
  const activeCodes = accounts.filter(account => account.referralCode).length;
  const totalCredit = accounts.reduce((sum, account) => sum + Number(account.creditBalance || 0), 0);
  const pendingPayouts = payouts.filter(request => ['pending', 'approved'].includes(request.status));
  const pendingRewards = rewards.filter(item => item.status === 'pending_review').length;
  const pendingSocial = social.filter(item => item.status === 'pending_review').length;
  return `<div class="admin-summary-grid">
    <div><span>Total accounts</span><strong>${accounts.length}</strong></div>
    <div><span>Verified</span><strong>${verified}</strong></div>
    <div><span>Active codes</span><strong>${activeCodes}</strong></div>
    <div><span>Store credit</span><strong>${money(totalCredit)}</strong></div>
    <div><span>Payouts to review</span><strong>${pendingPayouts.length}</strong></div>
    <div><span>Credits to review</span><strong>${pendingRewards + pendingSocial}</strong></div>
  </div>`;
}

function reviewQueueHTML(tableId, rows, kind) {
  const table = document.getElementById(tableId);
  const isReferral = kind === 'referral';
  table.innerHTML = `<tr>${['Item','Account','Evidence','Credit','Status','Review note','Action'].map(th).join('')}</tr>` + (rows.length ? rows.map(item => `
    <tr>
      ${td(isReferral ? `<strong>Order SR-${item.orderId}</strong><br><span class="admin-muted">${escapeHtml(item.customerName || '')}</span>` : `<strong>TikTok #${item.id}</strong><br><span class="admin-muted">${escapeHtml(new Date(item.created_at).toLocaleString())}</span>`)}
      ${td(`<strong>${escapeHtml(item.accountName)}</strong><br><a href="${mailtoHref(item.accountEmail)}">${escapeHtml(item.accountEmail)}</a>`)}
      ${td(isReferral ? `${money(item.productSpend)} paid merchandise<br><span class="admin-muted">${escapeHtml(item.referralCode || '')}</span>` : `<a href="${escapeHtml(item.video_url)}" target="_blank" rel="noopener">Open TikTok video</a>`)}
      ${td(`<strong>${money(isReferral ? item.amount : item.creditAmount)}</strong>`)}
      ${td(statusBadge(item.status))}
      ${td(`<input class="payout-note-input" data-review-note="${isReferral ? item.orderId : item.id}" type="text" maxlength="500" value="${escapeHtml(item.adminNote || item.admin_note || '')}" placeholder="Internal review note">`)}
      ${td(item.status === 'pending_review' ? `<div class="payout-actions"><button type="button" data-review-id="${isReferral ? item.orderId : item.id}" data-review-status="approved">Approve</button><button type="button" data-review-id="${isReferral ? item.orderId : item.id}" data-review-status="rejected">Reject</button></div>` : '<span class="admin-muted">Complete</span>')}
    </tr>`).join('') : `<tr>${td(`No ${isReferral ? 'referral credits' : 'TikTok submissions'} yet.`)}</tr>`);
  table.querySelectorAll('[data-review-id]').forEach(button => {
    button.onclick = async () => {
      const id = button.dataset.reviewId;
      const status = button.dataset.reviewStatus;
      if (!confirm(`${status === 'approved' ? 'Approve' : 'Reject'} this ${isReferral ? 'referral credit' : 'TikTok credit'}?`)) return;
      const note = table.querySelector(`[data-review-note="${id}"]`)?.value || '';
      const path = isReferral ? `/api/admin/referral-rewards/${id}/status` : `/api/admin/tiktok-submissions/${id}/status`;
      try {
        await api(path, { method: 'POST', body: { status, note } });
        await loadReferrals();
      } catch (err) {
        document.getElementById('referralAdminMessage').textContent = err.message;
      }
    };
  });
}

function referralAccountsHTML(accounts) {
  const table = document.getElementById('referralAccountsTable');
  table.innerHTML = `<tr>${['Account','Code','Paid customers','Referral spend','Available credit','Payout status','Created'].map(th).join('')}</tr>` + (accounts.length ? accounts.map(account => `
    <tr>
      ${td(`<strong>${escapeHtml(account.name)}</strong><br><a href="${mailtoHref(account.email)}">${escapeHtml(account.email)}</a><br><span class="admin-muted">${account.verifiedAt ? 'Verified' : 'Unverified'}</span>`)}
      ${td(account.referralCode ? `<strong>${escapeHtml(account.referralCode)}</strong><br><span class="admin-muted">10% customer / 10% credit</span>` : '<span class="admin-muted">Not created</span>')}
      ${td(`<strong>${account.uniqueCustomers}</strong> / ${account.minCustomers}`)}
      ${td(`<strong>${money(account.totalSpend)}</strong> / ${money(account.minSpend)}`)}
      ${td(`<strong>${money(account.creditBalance)}</strong>${account.payoutReserved ? `<br><span class="admin-muted">${money(account.payoutReserved)} reserved</span>` : ''}`)}
      ${td(account.payoutEligible ? '<span class="admin-status admin-status-paid">Eligible</span>' : '<span class="admin-muted">Building</span>')}
      ${td(escapeHtml(new Date(account.createdAt).toLocaleDateString()))}
    </tr>`).join('') : `<tr>${td('No customer accounts yet.')}</tr>`);
}

function payoutRequestsHTML(requests) {
  const table = document.getElementById('payoutRequestsTable');
  table.innerHTML = `<tr>${['Request','Account','Amount','Status','Review note','Created','Action'].map(th).join('')}</tr>` + (requests.length ? requests.map(request => `
    <tr>
      ${td(`<strong>#${request.id}</strong><br><span class="admin-muted">${escapeHtml(request.referralCode || 'No code')}</span>`)}
      ${td(`<strong>${escapeHtml(request.accountName)}</strong><br><a href="${mailtoHref(request.accountEmail)}">${escapeHtml(request.accountEmail)}</a>`)}
      ${td(`<strong>${money(request.amount)}</strong>`)}
      ${td(statusBadge(request.status))}
      ${td(`<input class="payout-note-input" data-payout-note="${request.id}" type="text" maxlength="500" value="${escapeHtml(request.admin_note || '')}" placeholder="Internal review note">`)}
      ${td(escapeHtml(new Date(request.created_at).toLocaleString()))}
      ${td(['paid','rejected'].includes(request.status) ? '<span class="admin-muted">Complete</span>' : `<div class="payout-actions"><button type="button" data-payout-id="${request.id}" data-payout-status="approved">Approve</button><button type="button" data-payout-id="${request.id}" data-payout-status="paid">Mark paid</button><button type="button" data-payout-id="${request.id}" data-payout-status="rejected">Reject</button></div>`)}
    </tr>`).join('') : `<tr>${td('No payout requests yet.')}</tr>`);

  table.querySelectorAll('[data-payout-id]').forEach(button => {
    button.onclick = async () => {
      const id = button.dataset.payoutId;
      const status = button.dataset.payoutStatus;
      if (!confirm(`${status === 'paid' ? 'Mark' : status} payout request #${id}?`)) return;
      const note = table.querySelector(`[data-payout-note="${id}"]`)?.value || '';
      try {
        await api(`/api/admin/payouts/${id}/status`, { method: 'POST', body: { status, note } });
        await loadReferrals();
      } catch (err) {
        document.getElementById('referralAdminMessage').textContent = err.message;
      }
    };
  });
}

async function loadReferrals() {
  try {
    const data = await api('/api/admin/referrals');
    document.getElementById('referralAdminSummary').innerHTML = referralAdminSummaryHTML(data.accounts, data.payouts, data.referralRewards, data.socialSubmissions);
    reviewQueueHTML('referralRewardsTable', data.referralRewards || [], 'referral');
    reviewQueueHTML('socialCreditTable', data.socialSubmissions || [], 'social');
    referralAccountsHTML(data.accounts);
    payoutRequestsHTML(data.payouts);
    document.getElementById('referralAdminMessage').textContent = '';
  } catch (err) {
    document.getElementById('referralAdminMessage').textContent = err.message;
  }
}

function orderItemsHTML(order) {
  return (order.items || [])
    .map(it => `<div class="admin-item-line"><strong>${it.quantity}x ${escapeHtml(it.name)}</strong><span>${escapeHtml(it.spec)} | ${escapeHtml(it.sku || '')}</span></div>`)
    .join('');
}

function discountHTML(order) {
  const code = order.discount_code ? escapeHtml(order.discount_code) : null;
  const saved = Number(order.discount_amount || 0);
  if (!code || saved <= 0) return '<span class="admin-muted">No code used</span>';
  return '<strong>' + code + '</strong><br><span class="admin-savings">Saved ' + money(saved) + '</span>';
}


function orderTotalHTML(order) {
  const financials = order.financials || {};
  const subtotal = Number(order.subtotal || 0);
  const saved = Number(order.discount_amount || 0);
  const shipping = Number(order.shipping_fee || 0);
  const processing = Number(order.order_fee || 0);
  const beforeDiscountTotal = Number(financials.beforeCodeTotal || (subtotal + shipping + processing));
  const totalSpent = Number(financials.totalSpent || order.total || 0);
  const cogs = Number(financials.cogs || 0);
  const productRevenue = Number(financials.productRevenueAfterDiscount || Math.max(0, subtotal - saved));
  const storeCreditUsed = Number(financials.storeCreditUsed ?? order.store_credit_amount ?? 0);
  const referralReward = Number(financials.referralReward ?? (Number(order.referral_credit_cents || 0) / 100));
  const grossProfit = Number(financials.grossProfit ?? (productRevenue - cogs));
  const grossMargin = Number(financials.grossMargin || 0);
  const isInternationalShipping = String(order.shipping_method || '').toLowerCase() === 'international';
  const internationalShippingLabel = order.status === 'pending_payment'
    ? 'International shipping included'
    : 'International shipping paid';
  return `
    <div class="admin-total-breakdown admin-money-breakdown">
      <div><span>Before code</span><strong>${money(beforeDiscountTotal)}</strong></div>
      ${saved > 0 ? `<div class="admin-savings"><span>Code saved</span><strong>-${money(saved)}</strong></div>` : '<div><span>Code saved</span><strong>$0.00</strong></div>'}
      <div class="admin-final-total"><span>Customer spent</span><strong>${money(totalSpent)}</strong></div>
      ${isInternationalShipping ? `<div class="admin-international-shipping"><span>${internationalShippingLabel}</span><strong>${money(shipping)}</strong></div>` : ''}
      ${String(order.shipping_method || '') === 'priority' ? `<div class="admin-international-shipping"><span>Priority Mail paid — buy a Priority label</span><strong>${money(shipping)}</strong></div>` : ''}
      ${storeCreditUsed > 0 ? `<div><span>Store credit used</span><strong>${money(storeCreditUsed)}</strong></div>` : ''}
      <div><span>Product revenue</span><strong>${money(productRevenue)}</strong></div>
      <div><span>COGS</span><strong>${money(cogs)}</strong></div>
      ${referralReward > 0 ? `<div><span>Referral reward</span><strong>-${money(referralReward)}</strong></div>` : ''}
      <div class="admin-profit-line"><span>Profit after rewards</span><strong>${money(grossProfit)}</strong></div>
      <div><span>Margin</span><strong>${grossMargin}%</strong></div>
    </div>
  `;
}

function statusBadge(status) {
  return `<span class="admin-status admin-status-${escapeHtml(status)}">${escapeHtml(status).replace('_', ' ')}</span>`;
}

function duplicateTxidWarningHTML(order) {
  if (!order.payment_reference_duplicate) return '';
  const ids = (order.payment_reference_duplicate_order_ids || []).map(id => '#' + escapeHtml(id)).join(', ');
  return '<br><span class="admin-duplicate-txid">Duplicate TXID ' + (ids ? '(' + ids + ')' : '') + '</span>';
}

function paymentHTML(order) {
  const provider = order.payment_provider || 'manual';
  if (provider === 'paypal' || provider === 'manual_paypal') {
    return `<span class="admin-payment">Legacy payment</span>`;
  }

  if (provider === 'zelle') {
    return `<span class="admin-payment admin-payment-manual">Zelle (legacy)</span><br><span class="admin-muted">Match exact total</span>`;
  }
  if (provider === 'crypto') {
    const asset = escapeHtml(order.crypto_asset || 'BTC');
    const rawTxid = String(order.payment_reference || '');
    const txid = rawTxid
      ? `<br><span class="admin-muted admin-payment-ref" title="${escapeHtml(rawTxid)}">TXID: ${escapeHtml(rawTxid)}</span>`
      : '<br><span class="admin-muted">Waiting on TXID</span>';
    return `<span class="admin-payment admin-payment-crypto">Crypto (${asset})</span>${txid}${duplicateTxidWarningHTML(order)}`;
  }
  return '<span class="admin-payment admin-payment-manual">Manual invoice</span><br><span class="admin-muted">Needs payment link sent</span>';
}

function summaryHTML(orders) {
  const paid = orders.filter(o => o.status === 'paid').length;
  const pendingTracking = orders.filter(o => o.status === 'pending_tracking').length;
  const duplicateTxidOrders = orders.filter(o => o.payment_reference_duplicate).length;
  const pending = orders.filter(o => o.status === 'pending_payment').length;
  const fulfilled = orders.filter(o => o.status === 'fulfilled').length;
  const revenue = orders.filter(o => ['paid','pending_tracking','fulfilled'].includes(o.status)).reduce((sum, o) => sum + (o.total || 0), 0);
  return `
    <div class="admin-summary-grid">
      <div><span>Total orders</span><strong>${orders.length}</strong></div>
      <div><span>Paid</span><strong>${paid}</strong></div>
      <div><span>Pending payment</span><strong>${pending}</strong></div>
      <div><span>Pending tracking</span><strong>${pendingTracking}</strong></div>
      <div><span>Fulfilled</span><strong>${fulfilled}</strong></div>
      <div><span>Paid revenue</span><strong>$${revenue.toFixed(2)}</strong></div>
      <div class="${duplicateTxidOrders ? 'admin-summary-alert' : ''}"><span>Duplicate TXIDs</span><strong>${duplicateTxidOrders}</strong></div>
    </div>
  `;
}

function profitSummaryHTML(totals) {
  return `
    <div class="admin-summary-grid profit-summary-grid">
      <div><span>Orders counted</span><strong>${totals.orderCount}</strong></div>
      <div><span>Vials sold</span><strong>${totals.vialCount}</strong></div>
      <div><span>Product revenue</span><strong>${money(totals.productRevenue)}</strong></div>
      <div><span>COGS</span><strong>${money(totals.cogs)}</strong></div>
      <div><span>Referral rewards</span><strong>${money(totals.referralRewards)}</strong></div>
      <div><span>Gross profit</span><strong>${money(totals.grossProfit)}</strong></div>
      <div><span>Gross margin</span><strong>${totals.grossMargin}%</strong></div>
      <div><span>Discounts</span><strong>${money(totals.discounts)}</strong></div>
      <div><span>Shipping collected</span><strong>${money(totals.shippingCollected)}</strong></div>
      <div><span>Processing collected</span><strong>${money(totals.processingCollected)}</strong></div>
      <div><span>Total collected</span><strong>${money(totals.totalCollected)}</strong></div>
    </div>
  `;
}

function launchChecksHTML(checks) {
  return `
    <div class="launch-check-grid">
      ${(checks || []).map(check => `
        <article class="launch-check-card ${check.ok ? 'ok' : 'warn'}">
          <span>${check.ok ? 'Ready' : 'Needs check'}</span>
          <strong>${escapeHtml(check.label)}</strong>
          <p>${escapeHtml(check.detail)}</p>
        </article>
      `).join('')}
    </div>
  `;
}

function priceAuditHTML(audit) {
  if (!audit || !audit.issueCount) {
    return '<div class="admin-launch-note admin-launch-ok"><strong>Catalog price audit passed.</strong><span>No higher-strength vial is priced the same as or below the previous strength.</span></div>';
  }
  return `
    <div class="admin-launch-note admin-launch-warn">
      <strong>${audit.issueCount} catalog price issue(s)</strong>
      <span>Review these before pushing the catalog live.</span>
    </div>
    <table style="width:100%; border-collapse: collapse; margin-top: 12px;">
      <tr>${['Product','Previous','Current','Issue'].map(th).join('')}</tr>
      ${audit.issues.map(issue => `
        <tr>
          ${td(escapeHtml(issue.name))}
          ${td(escapeHtml(`${issue.previous.sku} ${issue.previous.spec} $${issue.previous.price}`))}
          ${td(escapeHtml(`${issue.current.sku} ${issue.current.spec} $${issue.current.price}`))}
          ${td(escapeHtml(issue.type))}
        </tr>
      `).join('')}
    </table>
  `;
}

function percent(value) {
  return value == null ? 'Collecting data' : `${Number(value).toFixed(1)}%`;
}

function labelTextSizeClass(name) {
  const length = String(name || '').trim().length;
  if (length > 30) return 'label-name-xxlong';
  if (length > 22) return 'label-name-xlong';
  if (length > 15) return 'label-name-long';
  if (length > 10) return 'label-name-medium';
  return 'label-name-short';
}

function labelKNameLines(name) {
  const clean = String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (clean.length <= 10 || !clean.includes(' ')) return [clean];
  const words = clean.split(' ');
  let best = [clean];
  let bestLongest = clean.length;
  for (let i = 1; i < words.length; i += 1) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const longest = Math.max(lines[0].length, lines[1].length);
    if (longest < bestLongest) { best = lines; bestLongest = longest; }
  }
  return best;
}

// Character widths (in em) measured from the label fonts, so long names are
// sized to fit their column exactly instead of guessing.
const LABEL_K_NAME_WIDTHS = {"A":0.508,"B":0.477,"C":0.47,"D":0.48,"E":0.441,"F":0.427,"G":0.473,"H":0.483,"I":0.235,"J":0.462,"K":0.505,"L":0.437,"M":0.558,"N":0.522,"O":0.479,"P":0.474,"Q":0.467,"R":0.481,"S":0.454,"T":0.485,"U":0.48,"V":0.506,"W":0.707,"X":0.49,"Y":0.492,"Z":0.419,"0":0.456,"1":0.294,"2":0.451,"3":0.446,"4":0.508,"5":0.45,"6":0.451,"7":0.422,"8":0.446,"9":0.446," ":0.2,"-":0.337,"+":0.437,"/":0.444,"(":0.343,")":0.343,".":0.235,",":0.223,"%":0.761,"·":0.235,"#":0.626,"&":0.624,"'":0.188};
const LABEL_K_DOSE_WIDTHS = {"A":0.634,"B":0.664,"C":0.644,"D":0.666,"E":0.554,"F":0.534,"G":0.662,"H":0.656,"I":0.264,"J":0.61,"K":0.626,"L":0.542,"M":0.882,"N":0.67,"O":0.676,"P":0.604,"Q":0.676,"R":0.632,"S":0.606,"T":0.588,"U":0.672,"V":0.618,"W":0.898,"X":0.644,"Y":0.624,"Z":0.576,"0":0.648,"1":0.452,"2":0.594,"3":0.608,"4":0.636,"5":0.6,"6":0.618,"7":0.554,"8":0.6,"9":0.618," ":0.254,"-":0.432,"+":0.62,"/":0.388,"(":0.398,")":0.39,".":0.298,",":0.294,"%":0.758,"·":0.218,"#":0.636,"&":0.591,"'":0.294};
function labelKTextWidthEm(text, widths, fallback, letterSpacing = 0) {
  return Array.from(String(text || '')).reduce((sum, ch) => sum + (widths[ch] ?? fallback) + letterSpacing, 0);
}

const LABEL_K_TAIL_SVG = '<svg viewBox="0 0 672 288" width="672" height="288" aria-hidden="true">'
  + '<path d="M-12 270 C110 262 230 262 318 252 C352 248 376 242 388 232" fill="none" stroke="#ffffff" stroke-width="13" stroke-linecap="round"></path>'
  + '<path d="M-12 270 C110 262 230 262 318 252 C352 248 376 242 388 232" fill="none" stroke="#0a0a0a" stroke-width="7" stroke-linecap="round"></path>'
  + '<g fill="none" stroke="#ffffff" stroke-width="1.6"><circle cx="70" cy="264" r="2"></circle><circle cx="170" cy="261" r="2.2"></circle><circle cx="262" cy="259" r="2"></circle><circle cx="340" cy="250" r="2"></circle></g>'
  + '<circle cx="388" cy="232" r="4.2" fill="#38bdf8"></circle></svg>';

// Label K: the design shown on the Snowy Research vial photos. Drawn at 4x
// (672 x 288) and scaled to the 1.75 x 0.75 in label so it prints sharp.
function buildVialLabel({ name, dosage, lot, expiry, storage, design = 'label-k' }) {
  const label = document.createElement('div');
  label.className = `snowy-print-label label-design-${design}`;

  const art = document.createElement('div');
  art.className = 'label-k-art';

  const print = document.createElement('div');
  print.className = 'label-k-print';
  print.setAttribute('aria-hidden', 'true');

  const tail = document.createElement('div');
  tail.className = 'label-k-tail';
  tail.innerHTML = LABEL_K_TAIL_SVG;

  const main = document.createElement('div');
  main.className = 'label-k-main';

  const lines = labelKNameLines(name);
  const widestEm = Math.max(1.6, ...lines.map(line => labelKTextWidthEm(line, LABEL_K_NAME_WIDTHS, 0.62, 0.01)));
  const compound = document.createElement('strong');
  compound.className = 'label-k-name';
  compound.style.fontSize = `${Math.min(56, Math.floor(152 / widestEm))}px`;
  lines.forEach(line => {
    const lineEl = document.createElement('span');
    lineEl.textContent = line;
    compound.appendChild(lineEl);
  });

  const doseText = String(dosage || '').trim().toUpperCase();
  const dose = document.createElement('strong');
  dose.className = 'label-k-dose';
  dose.style.fontSize = `${Math.max(9, Math.min(20, Math.floor(122 / Math.max(0.5, labelKTextWidthEm(doseText, LABEL_K_DOSE_WIDTHS, 0.62)))))}px`;
  dose.textContent = doseText;

  const ruoBlock = document.createElement('div');
  ruoBlock.className = 'label-k-ruo';
  const ruo = document.createElement('span');
  ruo.textContent = 'RESEARCH USE ONLY';
  const purity = document.createElement('span');
  purity.textContent = 'PURITY 99%';
  ruoBlock.append(ruo, purity);
  main.append(compound, dose, ruoBlock);

  const brand = document.createElement('div');
  brand.className = 'label-k-brand';
  brand.textContent = 'SNOWY';
  const brandSub = document.createElement('div');
  brandSub.className = 'label-k-brand-sub';
  brandSub.textContent = 'RESEARCH';

  const side = document.createElement('div');
  side.className = 'label-k-side';
  const storageBox = document.createElement('div');
  storageBox.className = 'label-k-storage';
  const storageTitle = document.createElement('span');
  storageTitle.textContent = 'STORE AT';
  const storageValue = document.createElement('strong');
  storageValue.textContent = String(storage || '').trim().toUpperCase();
  storageBox.append(storageTitle, storageValue);

  const batch = document.createElement('div');
  batch.className = 'label-k-batch';
  const lotRow = document.createElement('span');
  const lotKey = document.createElement('em');
  lotKey.textContent = 'LOT';
  const lotValue = document.createElement('b');
  lotValue.textContent = String(lot || '').trim().toUpperCase();
  lotRow.append(lotKey, lotValue);
  const expRow = document.createElement('span');
  const expKey = document.createElement('em');
  expKey.textContent = 'EXP';
  const expValue = document.createElement('b');
  expValue.textContent = String(expiry || '').trim().toUpperCase();
  expRow.append(expKey, expValue);
  batch.append(lotRow, expRow);

  const warning = document.createElement('span');
  warning.className = 'label-k-warning';
  warning.textContent = 'Not for human or veterinary consumption.';
  side.append(storageBox, batch, warning);

  art.append(print, tail, main, brand, brandSub, side);
  label.appendChild(art);
  return label;
}

const LABEL_NEXT_POSITION_KEY = 'snowy-label-next-position-v1';
const LABEL_CALIBRATION_KEY = 'snowy-label-calibration-v1';
const LABEL_SHEET_GEOMETRY_MM = Object.freeze({
  marginX: 6.35,
  marginY: 6.35,
  pitchX: 52.9082,
  pitchY: 22.5044,
});

function labelPositionFromRowAndColumn(row, column) {
  return ((row - 1) * 4) + column;
}

function labelRowAndColumnFromPosition(position) {
  const safePosition = Math.max(1, Math.min(48, Number(position) || 1));
  return {
    row: Math.floor((safePosition - 1) / 4) + 1,
    column: ((safePosition - 1) % 4) + 1,
  };
}

function setLabelSheetPosition(position) {
  const { row, column } = labelRowAndColumnFromPosition(position);
  const rowInput = document.getElementById('labelSheetRow');
  const columnInput = document.getElementById('labelSheetColumn');
  if (rowInput) rowInput.value = String(row);
  if (columnInput) columnInput.value = String(column);
  renderLabelMaker();
}

function getLabelMakerValues() {
  const name = document.getElementById('labelProductName')?.value.trim() || '';
  const dosage = document.getElementById('labelDosage')?.value.trim() || '';
  const lot = document.getElementById('labelLotNumber')?.value.trim() || '';
  const expiry = document.getElementById('labelExpiryDate')?.value.trim() || '';
  const storage = document.getElementById('labelStorage')?.value.trim() || '';
  const offsetX = Math.max(-10, Math.min(10, Number(document.getElementById('labelOffsetX')?.value || 0)));
  const offsetY = Math.max(-10, Math.min(10, Number(document.getElementById('labelOffsetY')?.value || 0)));
  const pitchX = Math.max(-3, Math.min(3, Number(document.getElementById('labelPitchX')?.value || 0)));
  const pitchY = Math.max(-3, Math.min(3, Number(document.getElementById('labelPitchY')?.value || 0)));
  const design = document.querySelector('[name="labelDesign"]')?.value || 'label-k';
  const row = Math.max(1, Math.min(12, Number(document.getElementById('labelSheetRow')?.value || 1)));
  const column = Math.max(1, Math.min(4, Number(document.getElementById('labelSheetColumn')?.value || 1)));
  const start = labelPositionFromRowAndColumn(row, column);
  const requested = Math.max(1, Math.min(48, Number(document.getElementById('labelQuantity')?.value || 1)));
  const quantity = Math.min(requested, 49 - start);
  return { name, dosage, lot, expiry, storage, offsetX, offsetY, pitchX, pitchY, design, row, column, start, quantity };
}

function positionLabelPrintCell(cell, position, values) {
  const rowIndex = Math.floor((position - 1) / 4);
  const columnIndex = (position - 1) % 4;
  const left = LABEL_SHEET_GEOMETRY_MM.marginX + (columnIndex * (LABEL_SHEET_GEOMETRY_MM.pitchX + values.pitchX));
  const top = LABEL_SHEET_GEOMETRY_MM.marginY + (rowIndex * (LABEL_SHEET_GEOMETRY_MM.pitchY + values.pitchY));
  cell.style.left = `${left.toFixed(4)}mm`;
  cell.style.top = `${top.toFixed(4)}mm`;
}

function renderLabelMaker() {
  const values = getLabelMakerValues();
  const preview = document.getElementById('labelLivePreview');
  if (!preview) return;
  preview.replaceChildren(buildVialLabel(values));
  const quantityInput = document.getElementById('labelQuantity');
  if (quantityInput) quantityInput.max = String(49 - values.start);
  const message = document.getElementById('labelMakerMessage');
  if (message) message.textContent = values.quantity < Number(quantityInput?.value || 1)
    ? `Row ${values.row}, label ${values.column} leaves room for ${values.quantity} labels on this sheet.`
    : `Next print starts at row ${values.row}, label ${values.column}.`;
  updatePaidLabelQueuePosition(values);
}

function buildLabelPrintSheet(values) {
  const portal = document.getElementById('labelPrintPortal');
  if (!portal) return;
  portal.replaceChildren();
  const labels = Array.isArray(values.labels) && values.labels.length
    ? values.labels
    : Array.from({ length: values.quantity }, () => values);
  for (let position = 1; position <= 48; position += 1) {
    const cell = document.createElement('div');
    cell.className = 'label-print-cell';
    positionLabelPrintCell(cell, position, values);
    const labelIndex = position - values.start;
    const shouldPrint = labelIndex >= 0 && labelIndex < labels.length;
    if (shouldPrint) cell.appendChild(buildVialLabel(labels[labelIndex]));
    portal.appendChild(cell);
  }
}

function openLabelPrintWindow(values, preparedWindow = null) {
  const printWindow = preparedWindow || window.open('', '_blank');
  const message = document.getElementById('labelMakerMessage');
  if (!printWindow) {
    if (message) message.textContent = 'Safari blocked the print sheet. Allow pop-ups for this site, then tap Print labels again.';
    return;
  }

  buildLabelPrintSheet(values);
  const portal = document.getElementById('labelPrintPortal');
  if (!portal) {
    printWindow.close();
    return;
  }

  printWindow.document.open();
  const nextPosition = values.start + values.quantity <= 48 ? values.start + values.quantity : 1;
  const nextSlot = labelRowAndColumnFromPosition(nextPosition);
  const printedOrderId = Number.isInteger(Number(values.orderId)) ? Number(values.orderId) : null;
  printWindow.document.write(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Snowy Label Print Sheet</title>
  <link rel="stylesheet" href="/css/style.css?v=label-k-20261112">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: #e9e6de; color: #171a18; font-family: Arial, Helvetica, sans-serif; }
    .label-sheet-toolbar { position: sticky; z-index: 20; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 18px; background: #153e31; color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.22); }
    .label-sheet-toolbar strong { font-size: 14px; }
    .label-sheet-toolbar span { display: block; margin-top: 2px; color: rgba(255,255,255,.68); font-size: 10px; }
    .label-sheet-toolbar button { min-height: 42px; padding: 0 22px; border: 0; border-radius: 999px; background: #fff; color: #153e31; font: 900 13px/1 Arial, sans-serif; cursor: pointer; }
    #labelPrintPortal { box-sizing: border-box; position: relative; left: ${values.offsetX}mm; top: ${values.offsetY}mm; display: block !important; width: 8.5in; height: 11in; margin: 18px auto; padding: 0; background: #fff; box-shadow: 0 18px 55px rgba(0,0,0,.2); }
    .label-print-cell { position: absolute; width: 1.75in; height: .75in; overflow: hidden; }
    @media (max-width: 850px) {
      .label-sheet-toolbar { align-items: stretch; flex-direction: column; }
      .label-sheet-toolbar button { width: 100%; }
      #labelPrintPortal { margin: 12px 0; transform: scale(.48); transform-origin: top left; }
    }
    @media print {
      @page { size: Letter portrait; margin: 0; }
      html, body { width: 8.5in !important; height: 11in !important; background: #fff !important; }
      .label-sheet-toolbar { display: none !important; }
      #labelPrintPortal { display: block !important; margin: 0 !important; transform: none !important; box-shadow: none !important; }
    }
  </style>
</head>
<body>
  <header class="label-sheet-toolbar">
    <div><strong>${values.orderId ? `Order #${escapeHtml(values.orderId)} · ` : ''}Row ${values.row}, label ${values.column} · ${values.quantity} label${values.quantity === 1 ? '' : 's'}</strong><span>Copies 1 · Page 1 only · Letter · 100% · page correction ${values.offsetX}/${values.offsetY} mm · spacing ${values.pitchX}/${values.pitchY} mm</span></div>
    <button id="printSheetButton" type="button">Print labels</button>
  </header>
  ${portal.outerHTML}
  <script>
    const printedOrderId = ${printedOrderId === null ? 'null' : printedOrderId};
    let completionSent = false;
    function notifyPrintComplete() {
      if (completionSent || printedOrderId === null) return;
      completionSent = true;
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'snowy-order-labels-printed', orderId: printedOrderId }, window.location.origin);
      }
    }
    window.addEventListener('afterprint', notifyPrintComplete);
    document.getElementById('printSheetButton').addEventListener('click', function () {
      try {
        localStorage.setItem('${LABEL_NEXT_POSITION_KEY}', '${nextPosition}');
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'snowy-label-position-used', nextPosition: ${nextPosition} }, window.location.origin);
        }
      } catch (_) {}
      window.print();
      window.setTimeout(notifyPrintComplete, 750);
    });
    async function startOrderPrint() {
      if (printedOrderId === null) return;
      try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all(Array.from(document.images).map(function (img) {
          return img.complete ? Promise.resolve() : new Promise(function (resolve) {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        }));
      } catch (_) {}
      document.getElementById('printSheetButton').click();
    }
    window.setTimeout(startOrderPrint, 250);
  <\/script>
</body>
</html>`);
  printWindow.document.close();
  if (message) message.textContent = `${values.orderId ? `Order #${values.orderId}: ` : ''}${values.quantity} label${values.quantity === 1 ? '' : 's'} prepared at row ${values.row}, label ${values.column}. After printing, the picker advances to row ${nextSlot.row}, label ${nextSlot.column}.`;
}

let labelCatalogProducts = [];

function labelProductSearchText(product) {
  return [product.name, product.labelName, product.labelDose, product.sku]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function selectedLabelProductDisplay() {
  const select = document.getElementById('labelCatalogProduct');
  const option = select?.selectedOptions?.[0];
  if (!option?.value) return '';
  return `${option.dataset.productName || option.dataset.labelName || ''} — ${option.dataset.labelDose || ''}`.trim();
}

function renderLabelProductResults(query = '') {
  const results = document.getElementById('labelProductResults');
  const search = document.getElementById('labelProductSearch');
  if (!results || !search) return;
  const normalized = String(query || '').trim().toLowerCase();
  const matches = labelCatalogProducts
    .filter(product => !normalized || labelProductSearchText(product).includes(normalized))
    .slice(0, 10);

  results.replaceChildren();
  matches.forEach(product => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'label-product-result';
    button.dataset.sku = product.sku;
    button.setAttribute('role', 'option');
    const name = document.createElement('strong');
    name.textContent = product.name;
    const details = document.createElement('span');
    details.textContent = `${product.labelDose} · ${product.sku}`;
    button.append(name, details);
    results.appendChild(button);
  });

  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'label-product-results-empty';
    empty.textContent = 'No matching products. Try a shorter search.';
    results.appendChild(empty);
  }
  results.hidden = false;
  search.setAttribute('aria-expanded', 'true');
}

function closeLabelProductResults() {
  const results = document.getElementById('labelProductResults');
  const search = document.getElementById('labelProductSearch');
  if (results) results.hidden = true;
  if (search) search.setAttribute('aria-expanded', 'false');
}

function selectLabelCatalogProduct(sku) {
  const select = document.getElementById('labelCatalogProduct');
  const search = document.getElementById('labelProductSearch');
  const clear = document.getElementById('labelProductSearchClear');
  if (!select || !sku) return;
  select.value = sku;
  applyCatalogLabelSelection();
  if (search) search.value = selectedLabelProductDisplay();
  if (clear) clear.hidden = !search?.value;
  closeLabelProductResults();
}

function applyCatalogLabelSelection() {
  const select = document.getElementById('labelCatalogProduct');
  const option = select?.selectedOptions?.[0];
  if (!option?.value) return;
  const nameInput = document.getElementById('labelProductName');
  const doseInput = document.getElementById('labelDosage');
  if (nameInput) nameInput.value = option.dataset.labelName || '';
  if (doseInput) doseInput.value = option.dataset.labelDose || '';
  renderLabelMaker();
}

async function loadLabelCatalogProducts() {
  const select = document.getElementById('labelCatalogProduct');
  if (!select || select.dataset.loaded) return;
  try {
    const catalogData = await api('/api/catalog');
    const products = (catalogData.products || []).filter(product => product.sku && product.labelName && product.labelDose);
    labelCatalogProducts = products;
    const options = products.map(product => {
      const option = document.createElement('option');
      option.value = product.sku;
      option.dataset.productName = product.name;
      option.dataset.labelName = product.labelName;
      option.dataset.labelDose = product.labelDose;
      option.textContent = `${product.name} — ${product.labelDose} · ${product.sku}`;
      return option;
    });
    select.replaceChildren(...options);
    const defaultProduct = products.find(product => product.sku === 'RT20') || products[0];
    if (defaultProduct) select.value = defaultProduct.sku;
    select.dataset.loaded = 'true';
    applyCatalogLabelSelection();
    const search = document.getElementById('labelProductSearch');
    const clear = document.getElementById('labelProductSearchClear');
    if (search) search.value = selectedLabelProductDisplay();
    if (clear) clear.hidden = !search?.value;
  } catch {
    labelCatalogProducts = [];
    const option = document.createElement('option');
    option.value = 'manual';
    option.textContent = 'Catalog unavailable — enter label text manually';
    select.replaceChildren(option);
  }
}

function initLabelMaker() {
  const form = document.getElementById('labelMakerForm');
  if (!form || form.dataset.initialized) return;
  form.dataset.initialized = 'true';
  try {
    const savedHiddenOrderIds = JSON.parse(localStorage.getItem(LABEL_HIDDEN_ORDERS_KEY) || '[]');
    if (Array.isArray(savedHiddenOrderIds)) savedHiddenOrderIds.forEach(id => hiddenPaidLabelOrderIds.add(String(id)));
  } catch (_) {}
  try {
    const savedCalibration = JSON.parse(localStorage.getItem(LABEL_CALIBRATION_KEY) || '{}');
    ['labelOffsetX', 'labelOffsetY', 'labelPitchX', 'labelPitchY'].forEach(id => {
      const control = document.getElementById(id);
      if (control && Number.isFinite(Number(savedCalibration[id]))) control.value = String(savedCalibration[id]);
    });
  } catch (_) {}
  form.querySelectorAll('input, select').forEach(control => control.addEventListener('input', () => {
    if (['labelOffsetX', 'labelOffsetY', 'labelPitchX', 'labelPitchY'].includes(control.id)) {
      try {
        localStorage.setItem(LABEL_CALIBRATION_KEY, JSON.stringify({
          labelOffsetX: document.getElementById('labelOffsetX')?.value || 0,
          labelOffsetY: document.getElementById('labelOffsetY')?.value || 0,
          labelPitchX: document.getElementById('labelPitchX')?.value || 0,
          labelPitchY: document.getElementById('labelPitchY')?.value || 0,
        }));
      } catch (_) {}
    }
    renderLabelMaker();
  }));
  document.getElementById('labelCatalogProduct')?.addEventListener('change', applyCatalogLabelSelection);
  const productSearch = document.getElementById('labelProductSearch');
  const productResults = document.getElementById('labelProductResults');
  const productSearchClear = document.getElementById('labelProductSearchClear');
  productSearch?.addEventListener('input', () => {
    if (productSearchClear) productSearchClear.hidden = !productSearch.value;
    renderLabelProductResults(productSearch.value);
  });
  productSearch?.addEventListener('focus', () => {
    productSearch.select();
    renderLabelProductResults('');
  });
  productSearch?.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeLabelProductResults();
    if (event.key === 'Enter') {
      const firstMatch = productResults?.querySelector('.label-product-result');
      if (firstMatch) {
        event.preventDefault();
        selectLabelCatalogProduct(firstMatch.dataset.sku);
      }
    }
  });
  productResults?.addEventListener('click', event => {
    const result = event.target.closest('.label-product-result');
    if (result?.dataset.sku) selectLabelCatalogProduct(result.dataset.sku);
  });
  productSearchClear?.addEventListener('click', () => {
    if (!productSearch) return;
    productSearch.value = '';
    productSearchClear.hidden = true;
    productSearch.focus();
    renderLabelProductResults('');
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.label-product-picker')) closeLabelProductResults();
  });
  document.getElementById('refreshPaidLabelOrders')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Refreshing…';
    try {
      await loadOrders();
    } catch (err) {
      window.alert(err.message || 'Could not refresh paid orders.');
    } finally {
      button.disabled = false;
      button.textContent = 'Refresh orders';
    }
  });
  document.getElementById('exportPirateShipCsv')?.addEventListener('click', exportPirateShipCsv);
  document.getElementById('pirateShipRequeueForm')?.addEventListener('submit', requeuePirateShipOrders);
  document.getElementById('restoreRemovedLabelOrders')?.addEventListener('click', restoreRemovedLabelOrders);
  window.addEventListener('message', async event => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === 'snowy-label-position-used') {
      try {
        localStorage.setItem(LABEL_NEXT_POSITION_KEY, String(event.data.nextPosition));
      } catch (_) {}
      setLabelSheetPosition(event.data.nextPosition);
      return;
    }
    if (event.data?.type !== 'snowy-order-labels-printed') return;
    const order = adminOrdersCache.find(item => String(item.id) === String(event.data.orderId));
    if (!order || order.status !== 'paid') return;
    printedPaidOrderIds.add(String(order.id));
    renderPaidOrderLabelQueue();
    const message = document.getElementById('labelMakerMessage');
    if (message) {
      message.style.color = 'var(--success)';
      message.textContent = `${paidOrderBuyerDisplayName(order)} stays Paid. Check the printed labels, then use the separate Pending tracking button when you are ready.`;
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = getLabelMakerValues();
    if (!values.name || !values.dosage) return;
    openLabelPrintWindow(values);
  });
  try {
    setLabelSheetPosition(localStorage.getItem(LABEL_NEXT_POSITION_KEY) || 1);
  } catch (_) {
    setLabelSheetPosition(1);
  }
  loadLabelCatalogProducts();
  renderLabelMaker();
}

function analyticsSummaryHTML(data) {
  const totals = data.totals || {};
  const sales = data.sales || {};
  return `
    <div class="admin-summary-grid analytics-summary-grid">
      <div><span>Impressions</span><strong>${Number(totals.pageViews || 0).toLocaleString()}</strong><em>page views</em></div>
      <div><span>Unique visitors</span><strong>${Number(totals.uniqueVisitors || 0).toLocaleString()}</strong><em>anonymous devices</em></div>
      <div><span>Paid visitor CVR</span><strong>${percent(data.rates && data.rates.visitorToPaid)}</strong><em>visitor to paid order</em></div>
      <div><span>Orders created</span><strong>${Number(totals.ordersCreated || 0).toLocaleString()}</strong><em>tracked funnel</em></div>
      <div><span>Paid orders</span><strong>${Number(sales.paidOrders || 0).toLocaleString()}</strong><em>selected date range</em></div>
      <div><span>Paid revenue</span><strong>${money(sales.paidRevenue)}</strong><em>AOV ${money(sales.averageOrderValue)}</em></div>
    </div>
  `;
}

function analyticsChartHTML(daily) {
  const values = Array.isArray(daily) ? daily : [];
  const max = Math.max(1, ...values.map(day => Number(day.pageViews || 0)));
  return values.map((day, index) => {
    const height = Math.max(day.pageViews ? 5 : 1, Math.round((Number(day.pageViews || 0) / max) * 100));
    const showLabel = values.length <= 31 || index % Math.ceil(values.length / 16) === 0;
    const date = new Date(`${day.date}T00:00:00Z`);
    const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `<div class="analytics-bar-column" title="${escapeHtml(label)}: ${day.pageViews} page views, ${day.visitors} visitors">
      <span class="analytics-bar-value">${day.pageViews || ''}</span>
      <i style="height:${height}%"></i>
      <small>${showLabel ? escapeHtml(label) : ''}</small>
    </div>`;
  }).join('');
}

function analyticsFunnelHTML(data) {
  const totals = data.totals || {};
  const stages = [
    ['Page views', totals.pageViews || 0],
    ['Product views', totals.productViews || 0],
    ['Added to cart', totals.addToCarts || 0],
    ['Checkout opened', totals.checkoutStarts || 0],
    ['Shipping completed', totals.shippingInfoAdded || 0],
    ['Payment selected', totals.paymentMethodsSelected || 0],
    ['Orders created', totals.ordersCreated || 0],
    ['Payments confirmed', totals.paymentsConfirmed || 0],
  ];
  const base = Math.max(1, Number(stages[0][1] || 0));
  return `<div class="analytics-funnel">${stages.map(([label, value], index) => {
    const width = Math.max(value ? 16 : 4, Math.round((Number(value) / base) * 100));
    const previous = index ? Number(stages[index - 1][1] || 0) : 0;
    const stepRate = index && previous ? Math.round((Number(value) / previous) * 1000) / 10 : null;
    return `<div class="analytics-funnel-row">
      <div><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString()}</strong>${index ? `<em>${stepRate == null ? '—' : stepRate + '%'} from prior step</em>` : ''}</div>
      <i><b style="width:${Math.min(100, width)}%"></b></i>
    </div>`;
  }).join('')}</div>`;
}

function analyticsInsightsHTML(data) {
  const totals = data.totals || {};
  const rates = data.rates || {};
  const insights = [];
  if (!totals.pageViews) {
    insights.push(['Baseline is starting now', 'The site did not previously record impressions. Let this run for 7–14 days before making major conversion decisions.']);
  } else {
    if (Number(totals.checkoutErrors || 0) || Number(totals.paymentFailures || 0)) {
      insights.push(['Resolve measured checkout failures', `${Number(totals.checkoutErrors || 0)} checkout errors and ${Number(totals.paymentFailures || 0)} payment failures were recorded in this range. Start with the most frequent categorized failure before changing checkout design.`]);
    }
    if (rates.productToCart == null || rates.productToCart < 8) {
      insights.push(['Strengthen product-to-cart intent', 'Use the best-selling strength as the default, keep price and purity proof above the fold, and add one clear Add to Cart action per card.']);
    }
    if (rates.checkoutToOrder == null || rates.checkoutToOrder < 45) {
      insights.push(['Reduce checkout abandonment', 'Keep the form short, show the final delivered total earlier, and make payment instructions visible before the customer submits.']);
    }
    if (rates.visitorToOrder == null || rates.visitorToOrder < 2) {
      insights.push(['Make the first visit more decisive', 'Lead with your three actual best sellers, real batch testing, shipping timing, and a simple first-order path on mobile.']);
    }
    if (rates.orderToPaid != null && rates.orderToPaid < 70) {
      insights.push(['Close more pending orders', 'A high pending-payment rate usually means the payment handoff needs clearer exact-total, order-number, and confirmation instructions.']);
    }
    const leader = (data.topProducts || [])[0];
    if (leader) {
      insights.push([`${leader.name} is drawing the most product interest`, `${leader.views} views and ${leader.adds} cart adds. Keep it prominent and use it as the anchor for related-product suggestions.`]);
    }
  }
  return insights.slice(0, 4).map(([title, copy], index) => `
    <article><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></div></article>
  `).join('');
}

function analyticsProductsHTML(products) {
  const rows = (products || []).map(product => `
    <tr>${td(`<strong>${escapeHtml(product.name)}</strong><br><span class="admin-muted">${escapeHtml(product.sku)}</span>`)}${td(product.views)}${td(product.adds)}${td(`${product.addRate}%`)}</tr>
  `).join('');
  return `<tr>${['Product','Views','Cart adds','Add rate'].map(th).join('')}</tr>${rows || `<tr>${td('Product activity will appear after tracking begins.')}</tr>`}`;
}

function analyticsSalesHTML(products) {
  const rows = (products || []).map((product, index) => `
    <tr>${td(`<strong>${index + 1}. ${escapeHtml(product.name)}</strong><br><span class="admin-muted">${escapeHtml(product.spec)}${product.sku ? ` · ${escapeHtml(product.sku)}` : ''}</span>`)}${td(product.quantity)}${td(product.orderCount)}${td(money(product.revenue))}</tr>
  `).join('');
  return `<tr>${['Product','Vials sold','Orders','Gross sales'].map(th).join('')}</tr>${rows || `<tr>${td('Paid product sales will appear here.')}</tr>`}`;
}

function analyticsSourcesHTML(sources) {
  const rows = (sources || []).map(source => `<tr>${td(escapeHtml(source.name))}${td(Number(source.count).toLocaleString())}</tr>`).join('');
  return `<tr>${['Source','Page views'].map(th).join('')}</tr>${rows || `<tr>${td('Traffic sources will appear after tracking begins.')}</tr>`}`;
}

let analyticsLoading = false;
async function loadAnalytics() {
  if (analyticsLoading) return;
  analyticsLoading = true;
  const range = document.getElementById('analyticsRange')?.value || '30';
  try {
    const data = await api(`/api/admin/analytics?days=${encodeURIComponent(range)}`);
    document.getElementById('analyticsSummary').innerHTML = analyticsSummaryHTML(data);
    document.getElementById('analyticsDailyChart').innerHTML = analyticsChartHTML(data.daily);
    document.getElementById('analyticsFunnel').innerHTML = analyticsFunnelHTML(data);
    document.getElementById('analyticsInsights').innerHTML = analyticsInsightsHTML(data);
    document.getElementById('analyticsSalesTable').innerHTML = analyticsSalesHTML(data.sales && data.sales.topSoldProducts);
    document.getElementById('analyticsProductsTable').innerHTML = analyticsProductsHTML(data.topProducts);
    document.getElementById('analyticsSourcesTable').innerHTML = analyticsSourcesHTML(data.topSources);
    const started = new Date(data.trackingStartedAt);
    const storageNote = data.storage && !data.storage.persistent ? ' Local analytics storage is active; production should use the Render persistent disk.' : '';
    document.getElementById('analyticsTrackingNote').textContent = `Traffic tracking started ${started.toLocaleString()}.${storageNote}`;
  } catch (err) {
    document.getElementById('analyticsSummary').innerHTML = `<p class="form-msg">${escapeHtml(err.message)}</p>`;
  } finally {
    analyticsLoading = false;
  }
}

function securityTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function securityDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'No browser info';
  if (/curl|python|wget|go-http|okhttp|axios|node-fetch|httpclient|bot|scan/i.test(ua)) return 'Script / bot';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} · ${os}`;
}

async function loadSecurityLog() {
  const summaryEl = document.getElementById('securitySummary');
  const blockedEl = document.getElementById('securityBlocked');
  const table = document.getElementById('securityLogTable');
  if (!table) return;
  try {
    const data = await api('/api/admin/security/logins');
    const day = data.last24h || {};
    summaryEl.innerHTML = `
      <div class="admin-security-stats">
        <div><strong>${Number(day.failed || 0)}</strong><span>Failed, last 24h</span></div>
        <div><strong>${Number(day.blocked || 0)}</strong><span>Blocked by lockout</span></div>
        <div><strong>${Number(day.uniqueIps || 0)}</strong><span>IPs that failed</span></div>
        <div><strong>${Number(day.success || 0)}</strong><span>Successful sign-ins</span></div>
      </div>
      <p class="hint">Rules: ${data.rules.perIpLimit} wrong passwords in ${data.rules.windowMinutes} minutes locks that IP (each repeat lockout doubles, up to 24 hours). More than ${data.rules.siteLimit} failures site-wide in ${data.rules.windowMinutes} minutes pauses password sign-in for 15 minutes; devices you ticked "keep me signed in" on still get in.</p>
      ${data.sitePausedUntil ? `<p class="admin-security-alert">Password sign-in is paused until ${escapeHtml(securityTime(data.sitePausedUntil))}.</p>` : ''}`;
    blockedEl.innerHTML = data.blockedIps.length ? `
      <div class="admin-security-blocked">
        <strong>Currently locked out</strong>
        ${data.blockedIps.map(item => `
          <div class="admin-security-blocked-row">
            <code>${escapeHtml(item.ip)}</code>
            <span>until ${escapeHtml(securityTime(item.lockedUntil))} · lockout #${Number(item.lockCount || 1)}</span>
            <button type="button" class="admin-security-unblock" data-ip="${escapeHtml(item.ip)}">Unblock</button>
          </div>`).join('')}
      </div>` : '';
    table.innerHTML = `
      <tr>${['Time','Result','IP address','Location','Device','Cookies sent','Details'].map(th).join('')}</tr>
      ${data.attempts.map(entry => {
        const result = entry.result === 'success' ? 'Signed in' : entry.result === 'blocked' ? 'Blocked' : 'Wrong password';
        const details = [
          entry.lockedForMinutes ? `Locked ${entry.lockedForMinutes} min` : '',
          entry.reason === 'site_paused' ? 'Site-wide pause' : entry.reason === 'ip_locked' ? 'IP locked' : '',
          entry.forwardedFor && entry.forwardedFor !== entry.ip ? `Via ${entry.forwardedFor}` : '',
          entry.language ? `Lang ${entry.language.split(',')[0]}` : '',
          entry.referer ? `From ${entry.referer}` : '',
        ].filter(Boolean).join(' · ');
        const cookies = (entry.cookieNames || []).length
          ? `${escapeHtml(entry.cookieNames.join(', '))}${entry.sessionFingerprint ? `<br><span class="admin-muted">session #${escapeHtml(entry.sessionFingerprint)}</span>` : ''}`
          : '<span class="admin-muted">none</span>';
        return `<tr class="admin-security-row is-${escapeHtml(entry.result)}">
          ${td(escapeHtml(securityTime(entry.at)))}
          ${td(`<span class="admin-security-pill is-${escapeHtml(entry.result)}">${result}</span>`)}
          ${td(`<code>${escapeHtml(entry.ip)}</code>`)}
          ${td(escapeHtml(entry.country || '—'))}
          ${td(`${escapeHtml(securityDevice(entry.userAgent))}<br><span class="admin-muted" title="${escapeHtml(entry.userAgent)}">${escapeHtml(String(entry.userAgent || '').slice(0, 60))}</span>`)}
          ${td(cookies)}
          ${td(escapeHtml(details) || '<span class="admin-muted">—</span>')}
        </tr>`;
      }).join('') || `<tr>${td('No sign-in attempts recorded yet.')}</tr>`}`;
    blockedEl.querySelectorAll('.admin-security-unblock').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api('/api/admin/security/unblock', { method: 'POST', body: { ip: button.dataset.ip } });
          await loadSecurityLog();
        } catch (err) {
          button.disabled = false;
          window.alert(err.message || 'Could not unblock this IP.');
        }
      };
    });
  } catch (err) {
    summaryEl.innerHTML = `<p class="admin-security-alert">${escapeHtml(err.message || 'Could not load the sign-in log.')}</p>`;
  }
}

document.getElementById('refreshSecurityLog')?.addEventListener('click', loadSecurityLog);

async function loadLaunchChecks() {
  const data = await api('/api/admin/launch-checks');
  const checksEl = document.getElementById('launchChecks');
  const auditEl = document.getElementById('priceAuditDetails');
  if (checksEl) checksEl.innerHTML = launchChecksHTML(data.checks);
  if (auditEl) auditEl.innerHTML = priceAuditHTML(data.priceAudit);
}
async function loadProfit() {
  const { totals, lines } = await api('/api/admin/profit');
  document.getElementById('profitSummary').innerHTML = profitSummaryHTML(totals);
  document.getElementById('profitTable').innerHTML = `
    <tr>${['SKU','Product','Qty','Revenue','COGS','Referral reward','Gross profit','Margin','Order'].map(th).join('')}</tr>
    ${lines.map(line => `
      <tr>
        ${td(escapeHtml(line.sku))}
        ${td(`<strong>${escapeHtml(line.name)}</strong><br><span class="admin-muted">${escapeHtml(line.spec)}</span>`)}
        ${td(line.quantity)}
        ${td(money(line.revenue))}
        ${td(money(line.cogs) + `<br><span class="admin-muted">${money(line.unitCost)} ea</span>`)}
        ${td(line.referralReward ? '-' + money(line.referralReward) : '$0.00')}
        ${td(money(line.grossProfit))}
        ${td(`${line.margin}%`)}
        ${td('#' + line.orderId)}
      </tr>
    `).join('') || `<tr>${td('No confirmed orders yet.')}</tr>`}
  `;
}

// ---- Unit economics (admin only) -------------------------------------------
let unitEconData = null;
const UE_FIELDS = ['ueCart', 'ueDiscount', 'ueCostPct', 'ueLabel', 'ueStripe', 'ueOrders', 'ueAffiliate'];
const UE_STORAGE_KEY = 'snowy.unitEcon.v1';

function ueNum(id) {
  const el = document.getElementById(id);
  const value = Number(el && el.value);
  return Number.isFinite(value) ? value : 0;
}

function ueSave() {
  try {
    const saved = {};
    UE_FIELDS.forEach(id => { saved[id] = document.getElementById(id).value; });
    localStorage.setItem(UE_STORAGE_KEY, JSON.stringify(saved));
  } catch (_) { /* storage unavailable: inputs reset next visit */ }
}

function ueRestore() {
  try {
    const saved = JSON.parse(localStorage.getItem(UE_STORAGE_KEY) || 'null');
    if (!saved) return;
    UE_FIELDS.forEach(id => {
      if (saved[id] != null && saved[id] !== '') document.getElementById(id).value = saved[id];
    });
  } catch (_) { /* ignore */ }
}

// Profit from one order of `cart` dollars of product. Mirrors checkout: discount
// comes off the product subtotal, the customer pays flat shipping plus the
// processing fee, and the free reconstitution solution kicks in at the threshold.
function ueOrderProfit(cart, s) {
  const st = unitEconData.settings;
  const discount = cart * (s.discountPct / 100);
  const productRevenue = cart - discount;
  const productCost = cart * (s.costPct / 100);
  const tier = (st.freebieTiers || []).filter(t => cart >= t.minimumSubtotal).pop();
  const freebie = tier ? tier.cost : 0;
  const shippingNet = st.shippingFee - s.label;
  const customerFee = (productRevenue + st.shippingFee) * st.orderFeeRate;
  const chargeTotal = productRevenue + st.shippingFee + customerFee;
  const cardFee = chargeTotal * (s.stripePct / 100) + 0.30;
  const profit = productRevenue - productCost - freebie + shippingNet + customerFee - cardFee;
  return { profit, productRevenue, productCost, freebie, shippingNet, feeNet: customerFee - cardFee };
}

function renderUnitEcon() {
  if (!unitEconData) return;
  const s = {
    cart: ueNum('ueCart'),
    discountPct: ueNum('ueDiscount'),
    costPct: ueNum('ueCostPct'),
    label: ueNum('ueLabel'),
    stripePct: ueNum('ueStripe'),
    orders: Math.max(1, ueNum('ueOrders')),
    affiliatePct: ueNum('ueAffiliate'),
  };
  const first = ueOrderProfit(s.cart, s);
  // Repeat orders come from email/reorders, so assume full price on those.
  const repeat = ueOrderProfit(s.cart, { ...s, discountPct: 0 });
  const lifetime = first.profit + repeat.profit * (s.orders - 1);
  const affiliateCost = first.productRevenue * (s.affiliatePct / 100);
  const carts = [25, 50, 65, 90, 120, 150].map(c => ({ cart: c, profit: ueOrderProfit(c, s).profit }));
  const tone = v => (v >= 0 ? '' : ' style="color:#b3261e"');

  document.getElementById('unitEconSummary').innerHTML = `
    <div class="admin-summary-grid profit-summary-grid">
      <div><span>Profit on first order</span><strong${tone(first.profit)}>${money(first.profit)}</strong></div>
      <div><span>Break-even cost per new customer</span><strong>${money(Math.max(0, first.profit))}</strong></div>
      <div><span>Lifetime profit per customer</span><strong>${money(lifetime)}</strong></div>
      <div><span>Safe max cost per customer (if they reorder)</span><strong>${money(Math.max(0, lifetime * 0.5))}</strong></div>
      <div><span>Affiliate payout per sale</span><strong>${money(affiliateCost)}</strong></div>
      <div><span>Profit after affiliate payout</span><strong${tone(first.profit - affiliateCost)}>${money(first.profit - affiliateCost)}</strong></div>
    </div>
    <p class="admin-muted" style="margin-top:8px;">
      First order: ${money(first.productRevenue)} product revenue − ${money(first.productCost)} product cost
      − ${money(first.freebie)} free solution ${first.shippingNet >= 0 ? '+' : '−'} ${money(Math.abs(first.shippingNet))} shipping
      ${first.feeNet >= 0 ? '+' : '−'} ${money(Math.abs(first.feeNet))} fees.
      "Safe max" keeps half of lifetime profit as your cushion. Free solution tiers: ${(unitEconData.settings.freebieTiers || []).map(t => `${money(t.minimumSubtotal)}+ ${escapeHtml(t.sku)}`).join(', ')}.
    </p>
    <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
      <tr>${['Cart size', 'Profit per first order (= break-even ad cost)'].map(th).join('')}</tr>
      ${carts.map(r => `<tr>${td(money(r.cart))}${td(`<span${tone(r.profit)}>${money(r.profit)}</span>`)}</tr>`).join('')}
    </table>
  `;
}

async function loadUnitEconomics() {
  const summary = document.getElementById('unitEconSummary');
  if (!summary) return;
  try {
    unitEconData = await api('/api/admin/unit-economics');
  } catch (err) {
    summary.textContent = 'Could not load unit economics.';
    return;
  }
  const priced = unitEconData.products.filter(p => p.price > 0 && p.cost > 0);
  const avgCostPct = priced.length
    ? priced.reduce((sum, p) => sum + p.cost / p.price, 0) / priced.length * 100
    : 33;
  document.getElementById('ueCostPct').value = avgCostPct.toFixed(1);
  ueRestore();
  UE_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.ueBound) {
      el.dataset.ueBound = '1';
      el.addEventListener('input', () => { ueSave(); renderUnitEcon(); });
    }
  });
  const rows = [...unitEconData.products].sort((a, b) => a.margin - b.margin);
  document.getElementById('unitEconTable').innerHTML = `
    <tr>${['SKU', 'Product', 'Price', 'Your cost', 'Profit / vial', 'Margin'].map(th).join('')}</tr>
    ${rows.map(p => `
      <tr>
        ${td(escapeHtml(p.sku))}
        ${td(`<strong>${escapeHtml(p.name)}</strong><br><span class="admin-muted">${escapeHtml(p.spec)}</span>`)}
        ${td(money(p.price))}
        ${td(money(p.cost))}
        ${td(money(p.profit))}
        ${td(`${p.margin}%`)}
      </tr>
    `).join('')}
  `;
  renderUnitEcon();
}

// ---- Launch giveaway (admin) -----------------------------------------------
function giveawayDateText(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' }) + ' PT' : '—';
}

async function loadGiveaway() {
  const summary = document.getElementById('giveawaySummary');
  if (!summary) return;
  let data;
  try {
    data = await api('/api/admin/giveaway');
  } catch (err) {
    summary.textContent = err.message;
    return;
  }
  const statusText = {
    not_scheduled: 'Not scheduled. Set GIVEAWAY_START (for example 2026-11-20) in the host environment on launch day.',
    upcoming: 'Scheduled, not open yet',
    active: 'Open now',
    ended: 'Ended. Ready to draw winners.',
  }[data.status] || data.status;
  summary.innerHTML = `
    <div class="admin-summary-grid profit-summary-grid">
      <div><span>Status</span><strong>${escapeHtml(statusText)}</strong></div>
      <div><span>Starts</span><strong>${giveawayDateText(data.startsAt)}</strong></div>
      <div><span>Ends</span><strong>${giveawayDateText(data.endsAt ? new Date(new Date(data.endsAt).getTime() - 60000).toISOString() : null)}</strong></div>
      <div><span>People entered</span><strong>${data.entrantCount}</strong></div>
      <div><span>Total entries</span><strong>${data.totalEntries}</strong></div>
      <div><span>From purchases / free</span><strong>${data.purchaseEntries} / ${data.freeEntries}</strong></div>
    </div>`;

  const drawEl = document.getElementById('giveawayDraw');
  if (data.draw) {
    drawEl.innerHTML = `
      <p><strong>Winners drawn ${giveawayDateText(data.draw.drawn_at)}</strong> from ${data.draw.total_entries} entries (${data.draw.entrant_count} people). Email each winner, then award the prize.</p>
      <table style="width:100%; border-collapse: collapse;">
        <tr>${['Place', 'Prize', 'Winner', 'Entries', 'Orders', 'Status'].map(th).join('')}</tr>
        ${data.draw.winners.map(w => `<tr>
          ${td('#' + w.place)}
          ${td(escapeHtml(w.prize))}
          ${td(`<strong>${escapeHtml(w.name || '')}</strong><br><span class="admin-muted">${escapeHtml(w.email)}</span>`)}
          ${td(w.entries)}
          ${td(w.order_ids && w.order_ids.length ? w.order_ids.map(id => '#' + id).join(', ') : 'Free entry')}
          ${td(w.awarded_at
            ? `Done ${giveawayDateText(w.awarded_at)}`
            : `<button type="button" class="btn-small giveaway-award-btn" data-place="${w.place}">${w.credit_cents > 0 ? 'Add credit to account' : 'Mark shipped'}</button>`)}
        </tr>`).join('')}
      </table>
      <p class="form-msg" id="giveawayAwardMsg"></p>`;
    drawEl.querySelectorAll('.giveaway-award-btn').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api('/api/admin/giveaway/award', { method: 'POST', body: { place: Number(button.dataset.place) } });
          loadGiveaway();
        } catch (err) {
          document.getElementById('giveawayAwardMsg').textContent = err.message;
          button.disabled = false;
        }
      };
    });
  } else {
    const canDraw = data.status === 'ended' && data.totalEntries > 0;
    drawEl.innerHTML = `
      <button type="button" id="giveawayDrawBtn" class="btn-primary" ${canDraw ? '' : 'disabled'}>Draw 3 winners</button>
      <span class="admin-muted" style="margin-left:10px;">${canDraw ? 'Random, weighted by entries, one prize per person. Can only be done once.' : 'Available after the giveaway ends.'}</span>
      <p class="form-msg" id="giveawayDrawMsg"></p>`;
    const button = document.getElementById('giveawayDrawBtn');
    if (button && canDraw) {
      button.onclick = async () => {
        if (!window.confirm('Draw the 3 winners now? This is final and cannot be redone.')) return;
        button.disabled = true;
        try {
          await api('/api/admin/giveaway/draw', { method: 'POST' });
          loadGiveaway();
        } catch (err) {
          document.getElementById('giveawayDrawMsg').textContent = err.message;
          button.disabled = false;
        }
      };
    }
  }

  document.getElementById('giveawayEntrants').innerHTML = `
    <tr>${['Entrant', 'Purchase entries', 'Free entries', 'Total', 'Chance'].map(th).join('')}</tr>
    ${data.topEntrants.map(e => `<tr>
      ${td(`<strong>${escapeHtml(e.name || '')}</strong><br><span class="admin-muted">${escapeHtml(e.email)}</span>`)}
      ${td(e.purchaseEntries)}
      ${td(e.freeEntries)}
      ${td(e.entries)}
      ${td(data.totalEntries ? ((e.entries / data.totalEntries) * 100).toFixed(1) + '%' : '—')}
    </tr>`).join('') || `<tr>${td('No entries yet.')}</tr>`}`;
}

async function loadStorageInfo() {
  try {
    const info = await api('/api/admin/storage');
    const target = document.getElementById('adminStorageInfo');
    if (!target) return;
    target.innerHTML = info.usingPersistentRenderPath
      ? '<span class="admin-storage-ok">Order storage path: /var/data/db.json. Confirm Render Persistent Disk is mounted at /var/data.</span>'
      : '<span class="admin-storage-warn">Warning: order storage is not using /var/data. Add a Render Persistent Disk mounted at /var/data before relying on live orders.</span>';
  } catch {
    // Non-blocking: orders still load even if the storage check fails.
  }
}

async function deleteAdminOrder(link) {
  const label = link.dataset.label || `#${link.dataset.id}`;
  const ok = window.confirm(`Delete order ${label}? This permanently removes it from the admin panel and profit totals.`);
  if (!ok) return;
  link.style.pointerEvents = 'none';
  link.textContent = 'Deleting...';
  try {
    await api(`/api/admin/orders/${link.dataset.id}`, { method: 'DELETE' });
    await loadOrders();
    loadProfit();
    loadLaunchChecks();
  } catch (err) {
    link.style.pointerEvents = '';
    link.textContent = 'Delete order';
    window.alert(err.message || 'Could not delete order.');
  }
}

document.addEventListener('click', (event) => {
  const deleteLink = event.target && event.target.closest ? event.target.closest('.admin-delete-order') : null;
  if (!deleteLink) return;
  event.preventDefault();
  deleteAdminOrder(deleteLink);
});
let adminOrdersCache = [];
const PAID_LABEL_QUEUE_CUTOFF_MS = Date.parse('2026-08-29T00:00:00-07:00');
const LABEL_HIDDEN_ORDERS_KEY = 'snowy-label-hidden-orders-v1';
const printedPaidOrderIds = new Set();
const hiddenPaidLabelOrderIds = new Set();
let confirmingPendingTrackingOrderId = '';
let confirmingRemoveLabelOrderId = '';

function orderLabelCount(order) {
  return (order.items || []).reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
}

function isPaidLabelQueueOrder(order) {
  const paidAt = Date.parse(order.paid_at || order.created_at || '');
  return Number.isFinite(paidAt) && paidAt >= PAID_LABEL_QUEUE_CUTOFF_MS;
}

function updatePaidLabelQueuePosition(values = getLabelMakerValues()) {
  const target = document.getElementById('paidLabelNextPosition');
  if (target) target.textContent = `Next: row ${values.row}, label ${values.column}`;
}

function paidOrderLabelItemSummary(order) {
  return (order.items || []).map(item => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    return `${item.name || item.sku || 'Research product'}${item.spec ? ` ${item.spec}` : ''} ×${quantity}`;
  }).join(' · ');
}

function paidOrderBuyerDisplayName(order) {
  const buyer = order?.buyer || {};
  const fullName = String(buyer.name || [buyer.firstName, buyer.lastName].filter(Boolean).join(' ')).trim();
  if (fullName) return fullName;
  const email = String(buyer.email || '').trim();
  return email || `SR-${order?.id || 'order'}`;
}

function beginPendingTrackingConfirmation(button) {
  confirmingRemoveLabelOrderId = '';
  confirmingPendingTrackingOrderId = String(button.dataset.id || '');
  renderPaidOrderLabelQueue();
  document.querySelector(`.paid-label-confirm-pending[data-id="${CSS.escape(confirmingPendingTrackingOrderId)}"]`)?.focus();
}

function cancelPendingTrackingConfirmation() {
  confirmingPendingTrackingOrderId = '';
  renderPaidOrderLabelQueue();
}

function saveHiddenLabelOrderIds() {
  try {
    localStorage.setItem(LABEL_HIDDEN_ORDERS_KEY, JSON.stringify([...hiddenPaidLabelOrderIds]));
  } catch (_) {}
}

function beginRemoveLabelOrderConfirmation(button) {
  confirmingPendingTrackingOrderId = '';
  confirmingRemoveLabelOrderId = String(button.dataset.id || '');
  renderPaidOrderLabelQueue();
  document.querySelector(`.paid-label-confirm-remove[data-id="${CSS.escape(confirmingRemoveLabelOrderId)}"]`)?.focus();
}

function cancelRemoveLabelOrderConfirmation() {
  confirmingRemoveLabelOrderId = '';
  renderPaidOrderLabelQueue();
}

function confirmRemoveLabelOrder(button) {
  const order = adminOrdersCache.find(item => String(item.id) === String(button.dataset.id));
  if (!order) {
    confirmingRemoveLabelOrderId = '';
    return window.alert('That order is no longer available.');
  }
  const buyerName = paidOrderBuyerDisplayName(order);
  hiddenPaidLabelOrderIds.add(String(order.id));
  confirmingRemoveLabelOrderId = '';
  saveHiddenLabelOrderIds();
  renderPaidOrderLabelQueue();
  const message = document.getElementById('labelMakerMessage');
  if (message) {
    message.style.color = 'var(--success)';
    message.textContent = `SR-${order.id} · ${buyerName} was removed from the label maker. The paid order remains in Orders and profit totals.`;
  }
}

function restoreRemovedLabelOrders() {
  hiddenPaidLabelOrderIds.clear();
  confirmingRemoveLabelOrderId = '';
  saveHiddenLabelOrderIds();
  renderPaidOrderLabelQueue();
  const message = document.getElementById('labelMakerMessage');
  if (message) {
    message.style.color = 'var(--success)';
    message.textContent = 'Removed label-maker orders were restored.';
  }
}

async function confirmOrderPendingTracking(button) {
  const order = adminOrdersCache.find(item => String(item.id) === String(button.dataset.id));
  if (!order || order.status !== 'paid') {
    confirmingPendingTrackingOrderId = '';
    return window.alert('Only paid, unfulfilled orders can be moved to Pending tracking.');
  }
  button.disabled = true;
  button.textContent = 'Updating…';
  try {
    const result = await api(`/api/admin/orders/${order.id}/status`, { method: 'POST', body: { status: 'pending_tracking' } });
    printedPaidOrderIds.delete(String(order.id));
    confirmingPendingTrackingOrderId = '';
    const message = document.getElementById('labelMakerMessage');
    if (message) {
      {
        message.style.color = 'var(--success)';
        message.textContent = `${paidOrderBuyerDisplayName(order)} is now Pending tracking.`;
      }
    }
    await loadOrders();
    loadProfit();
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Yes, mark pending';
    window.alert(err.message || 'Could not move this order to Pending tracking.');
  }
}

function renderPaidOrderLabelQueue() {
  const queue = document.getElementById('paidLabelOrderQueue');
  if (!queue) return;
  const hiddenQueueOrders = adminOrdersCache.filter(order => order.status === 'paid'
    && orderLabelCount(order) > 0
    && isPaidLabelQueueOrder(order)
    && hiddenPaidLabelOrderIds.has(String(order.id)));
  const restoreButton = document.getElementById('restoreRemovedLabelOrders');
  if (restoreButton) {
    restoreButton.hidden = hiddenQueueOrders.length === 0;
    restoreButton.textContent = `Restore removed${hiddenQueueOrders.length ? ` (${hiddenQueueOrders.length})` : ''}`;
  }
  const paidOrders = adminOrdersCache
    .filter(order => order.status === 'paid'
      && orderLabelCount(order) > 0
      && isPaidLabelQueueOrder(order)
      && !hiddenPaidLabelOrderIds.has(String(order.id)))
    .sort((a, b) => new Date(b.paid_at || b.created_at || 0) - new Date(a.paid_at || a.created_at || 0));

  if (!paidOrders.length) {
    queue.innerHTML = '<div class="paid-label-order-empty"><strong>No paid orders waiting for labels</strong><span>Paid orders after August 28 appear in this label queue until they are moved to Pending tracking.</span></div>';
    updatePaidLabelQueuePosition();
    return;
  }

  queue.innerHTML = paidOrders.map(order => {
    const count = orderLabelCount(order);
    const orderId = String(order.id);
    const isPrinted = printedPaidOrderIds.has(orderId);
    const isConfirming = confirmingPendingTrackingOrderId === orderId;
    const isConfirmingRemove = confirmingRemoveLabelOrderId === orderId;
    const buyerName = paidOrderBuyerDisplayName(order);
    const buyerEmail = String(order.buyer?.email || '').trim();
    return `<article class="paid-label-order-card">
      <div class="paid-label-order-row">
        <button type="button" class="admin-print-order-labels paid-label-customer-button" data-id="${escapeHtml(order.id)}">
          <span class="paid-label-order-meta"><small>SR-${escapeHtml(order.id)}</small><strong>${escapeHtml(buyerName)}</strong>${buyerEmail ? `<em>${escapeHtml(buyerEmail)}</em>` : ''}</span>
          <span class="paid-label-order-summary">${escapeHtml(paidOrderLabelItemSummary(order))}</span>
          <span class="paid-label-order-count"><strong>${count}</strong> label${count === 1 ? '' : 's'} <i aria-hidden="true">→</i></span>
        </button>
        <div class="paid-label-order-actions">
          <button type="button" class="paid-label-pending-button${isPrinted ? ' is-ready' : ''}" data-id="${escapeHtml(order.id)}">${isPrinted ? 'Printed · mark pending' : 'Mark pending tracking'}</button>
          <button type="button" class="paid-label-remove-button" data-id="${escapeHtml(order.id)}" aria-label="Remove order SR-${escapeHtml(order.id)} from label maker">Remove</button>
        </div>
      </div>
      <div class="paid-label-inline-confirm" ${isConfirming ? '' : 'hidden'}>
        <strong>Move SR-${escapeHtml(order.id)} · ${escapeHtml(buyerName)} to Pending tracking?</strong>
        <span>This removes it from this paid-label list.</span>
        <div>
          <button type="button" class="paid-label-confirm-pending" data-id="${escapeHtml(order.id)}">Yes, mark pending</button>
          <button type="button" class="paid-label-cancel-pending">Cancel</button>
        </div>
      </div>
      <div class="paid-label-inline-confirm is-remove" ${isConfirmingRemove ? '' : 'hidden'}>
        <strong>Remove SR-${escapeHtml(order.id)} · ${escapeHtml(buyerName)} from the label maker?</strong>
        <span>The paid transaction stays in Orders and profit totals. You can restore this card later.</span>
        <div>
          <button type="button" class="paid-label-confirm-remove" data-id="${escapeHtml(order.id)}">Yes, remove</button>
          <button type="button" class="paid-label-cancel-remove">Cancel</button>
        </div>
      </div>
    </article>`;
  }).join('');

  queue.querySelectorAll('.admin-print-order-labels').forEach(button => {
    button.onclick = () => printAdminOrderLabels(button);
  });
  queue.querySelectorAll('.paid-label-pending-button').forEach(button => {
    button.onclick = () => beginPendingTrackingConfirmation(button);
  });
  queue.querySelectorAll('.paid-label-confirm-pending').forEach(button => {
    button.onclick = () => confirmOrderPendingTracking(button);
  });
  queue.querySelectorAll('.paid-label-cancel-pending').forEach(button => {
    button.onclick = cancelPendingTrackingConfirmation;
  });
  queue.querySelectorAll('.paid-label-remove-button').forEach(button => {
    button.onclick = () => beginRemoveLabelOrderConfirmation(button);
  });
  queue.querySelectorAll('.paid-label-confirm-remove').forEach(button => {
    button.onclick = () => confirmRemoveLabelOrder(button);
  });
  queue.querySelectorAll('.paid-label-cancel-remove').forEach(button => {
    button.onclick = cancelRemoveLabelOrderConfirmation;
  });
  updatePaidLabelQueuePosition();
}

function pirateShipQueueOrders() {
  return adminOrdersCache
    .filter(order => order.status === 'pending_tracking'
      && !order.tracking_number
      && Object.prototype.hasOwnProperty.call(order, 'pirate_ship_exported_at')
      && !order.pirate_ship_exported_at)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

function renderPirateShipCsvQueue() {
  const target = document.getElementById('pirateShipCsvQueue');
  const exportLink = document.getElementById('exportPirateShipCsv');
  if (!target || !exportLink) return;
  const orders = pirateShipQueueOrders();
  exportLink.classList.toggle('is-disabled', orders.length === 0);
  exportLink.setAttribute('aria-disabled', orders.length === 0 ? 'true' : 'false');
  exportLink.textContent = orders.length ? `Export new Pirate Ship CSV (${orders.length})` : 'No new Pirate Ship orders';
  const exported = adminOrdersCache.filter(order => order.pirate_ship_exported_at);
  const latestExportedAt = exported.reduce((latest, order) => {
    const value = String(order.pirate_ship_exported_at || '');
    return value > latest ? value : latest;
  }, '');
  const latestOrders = latestExportedAt
    ? exported.filter(order => String(order.pirate_ship_exported_at || '') === latestExportedAt)
      .sort((a, b) => Number(a.id) - Number(b.id))
    : [];
  const nextMarkup = orders.length
    ? `<strong>Next CSV (${orders.length})</strong><span>${orders.map(order => `SR-${escapeHtml(order.id)} · ${escapeHtml(paidOrderBuyerDisplayName(order))}`).join(' &nbsp;·&nbsp; ')}</span>`
    : '<strong>Next CSV is empty</strong><span>Previously exported orders will not be repeated.</span>';
  const lastMarkup = latestOrders.length
    ? `<strong>Last CSV (${latestOrders.length})</strong><span>${latestOrders.map(order => `SR-${escapeHtml(order.id)} · ${escapeHtml(paidOrderBuyerDisplayName(order))}`).join(' &nbsp;·&nbsp; ')}</span>`
    : '<strong>No prior CSV recorded</strong>';
  target.innerHTML = `<div>${nextMarkup}</div><div>${lastMarkup}</div>`;
}

async function requeuePirateShipOrders(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = document.getElementById('pirateShipRequeueIds');
  const button = form.querySelector('button[type="submit"]');
  const orderIds = [...new Set(String(input?.value || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isSafeInteger))];
  if (!orderIds.length) return window.alert('Enter at least one valid order number.');
  button.disabled = true;
  button.textContent = 'Requeueing…';
  try {
    const response = await fetch('/api/admin/pirate-ship/requeue', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not requeue those orders.');
    input.value = '';
    await loadOrders();
  } catch (err) {
    window.alert(err.message || 'Could not requeue those orders.');
  } finally {
    button.disabled = false;
    button.textContent = 'Requeue orders';
  }
}

async function exportPirateShipCsv(event) {
  event.preventDefault();
  const link = event.currentTarget;
  if (!pirateShipQueueOrders().length || link.getAttribute('aria-disabled') === 'true') return;
  const originalText = link.textContent;
  link.setAttribute('aria-disabled', 'true');
  link.textContent = 'Preparing CSV…';
  try {
    const response = await fetch('/api/admin/pirate-ship.csv', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 204) throw new Error('There are no new Pending tracking orders to export.');
    if (!response.ok) throw new Error('Could not export the Pirate Ship CSV.');
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="([^"]+)"/i)?.[1] || 'snowy-pirate-ship.csv';
    const url = URL.createObjectURL(blob);
    const download = document.createElement('a');
    download.href = url;
    download.download = filename;
    document.body.appendChild(download);
    download.click();
    download.remove();
    URL.revokeObjectURL(url);
    await loadOrders();
  } catch (err) {
    window.alert(err.message || 'Could not export the Pirate Ship CSV.');
    link.removeAttribute('aria-disabled');
    link.textContent = originalText;
  }
}

function orderSearchText(order) {
  const buyer = order.buyer || {};
  const itemText = (order.items || []).map(item => [item.name, item.spec, item.sku].join(' ')).join(' ');
  return [order.id, order.status, buyer.name, buyer.email, buyer.address1, buyer.address2, buyer.city, buyer.state, buyer.zip, itemText, order.discount_code, order.payment_reference, order.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function paymentProviderGroup(order) {
  const provider = String(order.payment_provider || 'manual').toLowerCase();
  if (provider.includes('crypto') || provider === 'btc' || provider === 'usdc') return 'crypto_any';
  return provider;
}

function filteredAdminOrders() {
  const query = (document.getElementById('adminOrderSearch')?.value || '').trim().toLowerCase();
  const status = document.getElementById('adminStatusFilter')?.value || 'all';
  const payment = document.getElementById('adminPaymentFilter')?.value || 'all';
  return adminOrdersCache.filter(order => {
    const statusMatch = status === 'all' || order.status === status;
    const provider = String(order.payment_provider || 'manual').toLowerCase();
    const paymentMatch = payment === 'all' || paymentProviderGroup(order) === payment || provider === payment;
    const queryMatch = !query || orderSearchText(order).includes(query);
    return statusMatch && paymentMatch && queryMatch;
  });
}

function adminNotesHTML(order) {
  return `
    <div class="admin-note-box">
      <label for="notes-${order.id}">Private notes</label>
      <textarea id="notes-${order.id}" data-id="${order.id}" class="admin-notes-input" rows="3">${escapeHtml(order.notes || '')}</textarea>
      <button type="button" class="admin-save-note" data-id="${order.id}">Save note</button>
    </div>
  `;
}

function adminFulfillmentHTML(order) {
  const reminders = Number(order.payment_reminder_count || 0);
  const reminderStatus = reminders
    ? `<span class="admin-muted">${reminders} reminder${reminders === 1 ? '' : 's'} sent</span>`
    : '<span class="admin-muted">No reminder sent</span>';
  const trackingStatus = order.tracking_number
    ? `<span class="admin-tracking-sent">Tracking sent: ${escapeHtml(order.tracking_carrier)} ${escapeHtml(order.tracking_number)}</span>`
    : '';
  const labelCount = orderLabelCount(order);
  return `
    <div class="admin-fulfillment-box">
      ${order.status === 'pending_payment' ? `
        <button type="button" class="admin-send-reminder" data-id="${order.id}">Send payment reminder</button>
        ${reminderStatus}
      ` : ''}
      ${order.status === 'paid' && labelCount ? `
        <button type="button" class="admin-print-order-labels" data-id="${order.id}">Print entire order · ${labelCount} label${labelCount === 1 ? '' : 's'}</button>
        <span class="admin-muted">Starts at the next saved sheet position.</span>
      ` : ''}
      ${['paid', 'pending_tracking'].includes(order.status) ? `
        <label>Carrier
          <select class="admin-tracking-carrier" data-id="${order.id}">
            ${['USPS','UPS','FedEx','DHL','Canada Post','Royal Mail','Australia Post','Other'].map(carrier => `<option value="${carrier}" ${carrier === order.tracking_carrier ? 'selected' : ''}>${carrier}</option>`).join('')}
          </select>
        </label>
        <label>Tracking number
          <input class="admin-tracking-number" data-id="${order.id}" value="${escapeHtml(order.tracking_number || '')}" placeholder="Paste tracking ID">
        </label>
        <label>Shipping service (optional)
          <input class="admin-tracking-service" data-id="${order.id}" value="${escapeHtml(order.tracking_service || '')}" placeholder="USPS Ground Advantage">
        </label>
        <label>Expected delivery (optional)
          <input class="admin-tracking-eta" data-id="${order.id}" value="${escapeHtml(order.tracking_estimated_delivery || '')}" placeholder="September 10, 2026">
        </label>
        <button type="button" class="admin-send-tracking" data-id="${order.id}">Send tracking email</button>
        ${trackingStatus}
      ` : ''}
    </div>
  `;
}

function fallbackOrderLabelDose(spec) {
  return String(spec || '')
    .replace(/\bx\s*\d+\s*vials?\b/gi, '')
    .replace(/(\d)\s*mg\s*\/\s*ml/gi, '$1 MG/ML')
    .replace(/(\d)\s*mg\b/gi, '$1 MG')
    .replace(/(\d)\s*ml\b/gi, '$1 ML')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function buildOrderLabelValues(order) {
  const base = getLabelMakerValues();
  const labels = [];
  (order.items || []).forEach(item => {
    const catalogProduct = labelCatalogProducts.find(product => String(product.sku) === String(item.sku));
    const quantity = Math.max(0, Math.min(48, Number(item.quantity) || 0));
    const labelValues = {
      ...base,
      name: catalogProduct?.labelName || item.name || 'RESEARCH PRODUCT',
      dosage: catalogProduct?.labelDose || fallbackOrderLabelDose(item.spec),
      // Every vial in an order is stamped with that order's number as its lot.
      lot: `SR-${order.id}`,
    };
    for (let count = 0; count < quantity; count += 1) labels.push({ ...labelValues });
  });
  return {
    ...base,
    orderId: order.id,
    labels,
    quantity: labels.length,
  };
}

async function printAdminOrderLabels(button) {
  const order = adminOrdersCache.find(item => String(item.id) === String(button.dataset.id));
  if (!order || order.status !== 'paid') return window.alert('Only paid, unfulfilled orders can print a full label set.');
  const printWindow = window.open('', '_blank');
  if (!printWindow) return window.alert('Safari blocked the print sheet. Allow pop-ups, then try again.');
  printWindow.document.write('<!doctype html><title>Preparing Snowy labels</title><p style="font:700 16px Arial;padding:24px">Preparing the complete order label sheet…</p>');
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Preparing labels…';
  try {
    await loadLabelCatalogProducts();
    const values = buildOrderLabelValues(order);
    if (!values.quantity) throw new Error('This order has no printable vial labels.');
    const available = 49 - values.start;
    if (values.quantity > available) {
      printWindow.close();
      const startSlot = labelRowAndColumnFromPosition(values.start);
      window.alert(`This order needs ${values.quantity} labels, but only ${available} positions remain after row ${startSlot.row}, label ${startSlot.column}. Start a fresh sheet at row 1, label 1, or print the order in two batches.`);
      return;
    }
    openLabelPrintWindow(values, printWindow);
  } catch (err) {
    if (!printWindow.closed) printWindow.close();
    window.alert(err.message || 'Could not prepare the order labels.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function renderOrdersTable() {
  const orders = filteredAdminOrders();
  document.getElementById('ordersTable').innerHTML = `
    <tr>${['Order','Buyer','Contact','Ship To','Items','Code savings','Payment','Spend + profit','Status','Created','Actions'].map(th).join('')}</tr>
    ${orders.map(o => `
      <tr>
        ${td('#' + o.id + '<br>' + statusBadge(o.status))}
        ${td(escapeHtml(o.buyer.name))}
        ${td(`<button class="admin-copy-btn" data-copy="${escapeHtml(o.buyer.email)}">Copy email</button><br><a href="${mailtoHref(o.buyer.email)}">${escapeHtml(o.buyer.email)}</a>`)}
        ${td(escapeHtml(`${o.buyer.address1}${o.buyer.address2 ? ', ' + o.buyer.address2 : ''}, ${o.buyer.city}, ${o.buyer.state} ${o.buyer.zip}`))}
        ${td(orderItemsHTML(o))}
        ${td(discountHTML(o))}
        ${td(paymentHTML(o))}
        ${td(orderTotalHTML(o))}
        ${td(`<select data-id="${o.id}" class="statusSelect">
          ${['pending_payment','paid','pending_tracking','fulfilled','cancelled'].map(s => `<option value="${s}" ${s===o.status?'selected':''}>${s.replace('_', ' ')}</option>`).join('')}
        </select>`)}
        ${td(new Date(o.created_at).toLocaleString())}
        ${td(`<a href="/api/admin/orders/${o.id}/packing-slip.pdf" target="_blank">Packing Slip</a><br>
               <a href="/api/admin/orders/${o.id}/contents-label.pdf" target="_blank">4x6 Label</a><br>
               <a href="#" class="admin-delete-order" data-id="${o.id}" data-label="#${o.id} ${escapeHtml(o.buyer.name)}">Delete order</a>
               ${adminFulfillmentHTML(o)}
               ${adminNotesHTML(o)}`)}
      </tr>
    `).join('') || `<tr>${td('No orders match your filter.')}</tr>`}
  `;

  document.querySelectorAll('.statusSelect').forEach(sel => {
    sel.onchange = async () => {
      const order = adminOrdersCache.find(o => String(o.id) === String(sel.dataset.id));
      if (order && order.status === 'pending_payment' && sel.value === 'paid') {
        const ok = window.confirm('This manually marks an unpaid/pending order as paid. Only do this if you verified payment outside the website.');
        if (!ok) { sel.value = order.status; return; }
      }
      await api(`/api/admin/orders/${sel.dataset.id}/status`, { method: 'POST', body: { status: sel.value } });
      await loadOrders();
      loadProfit();
      loadLaunchChecks();
    };
  });
  document.querySelectorAll('.admin-copy-btn').forEach(btn => {
    btn.onclick = async () => {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy email'; }, 1200);
    };
  });
  document.querySelectorAll('.admin-save-note').forEach(btn => {
    btn.onclick = async () => {
      const input = document.querySelector(`.admin-notes-input[data-id="${btn.dataset.id}"]`);
      await api(`/api/admin/orders/${btn.dataset.id}/notes`, { method: 'POST', body: { notes: input.value } });
      btn.textContent = 'Saved';
      setTimeout(() => { btn.textContent = 'Save note'; }, 1200);
    };
  });
  document.querySelectorAll('.admin-send-reminder').forEach(btn => {
    btn.onclick = async () => {
      if (!window.confirm('Send a payment reminder from the configured customer email to this buyer?')) return;
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        await api(`/api/admin/orders/${btn.dataset.id}/payment-reminder`, { method: 'POST' });
        await loadOrders();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Send payment reminder';
        window.alert(err.message || 'Could not send reminder.');
      }
    };
  });
  document.querySelectorAll('.admin-send-tracking').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const carrier = document.querySelector(`.admin-tracking-carrier[data-id="${id}"]`)?.value;
      const trackingNumber = document.querySelector(`.admin-tracking-number[data-id="${id}"]`)?.value.trim();
      const service = document.querySelector(`.admin-tracking-service[data-id="${id}"]`)?.value.trim();
      const estimatedDelivery = document.querySelector(`.admin-tracking-eta[data-id="${id}"]`)?.value.trim();
      if (!trackingNumber) return window.alert('Paste a tracking number first.');
      if (!window.confirm(`Email ${carrier} tracking ${trackingNumber} to this buyer and mark the order fulfilled?`)) return;
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        await api(`/api/admin/orders/${id}/tracking`, { method: 'POST', body: { carrier, trackingNumber, service, estimatedDelivery } });
        await loadOrders();
        loadProfit();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Send tracking email';
        window.alert(err.message || 'Could not send tracking email.');
      }
    };
  });
  document.querySelectorAll('.admin-print-order-labels').forEach(btn => {
    btn.onclick = () => printAdminOrderLabels(btn);
  });

}

async function loadOrders() {
  const { orders } = await api('/api/admin/orders');
  adminOrdersCache = orders;
  const panel = document.getElementById('ordersPanel');
  const existingSummary = panel && panel.querySelector('.admin-summary-grid');
  if (existingSummary) existingSummary.remove();
  if (panel) panel.insertAdjacentHTML('afterbegin', summaryHTML(orders));
  renderOrdersTable();
  renderPaidOrderLabelQueue();
  renderPirateShipCsvQueue();
  const searchInput = document.getElementById('adminOrderSearch');
  const statusFilter = document.getElementById('adminStatusFilter');
  const paymentFilter = document.getElementById('adminPaymentFilter');
  if (searchInput) searchInput.oninput = renderOrdersTable;
  if (statusFilter) statusFilter.onchange = renderOrdersTable;
  if (paymentFilter) paymentFilter.onchange = renderOrdersTable;
}

document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const passwordInput = document.getElementById('adminPassword');
  const message = document.getElementById('adminLoginMsg');
  const button = document.getElementById('adminLoginBtn');
  message.textContent = '';
  passwordInput.classList.remove('is-invalid');
  if (!passwordInput.value) {
    message.textContent = 'Enter the admin password.';
    passwordInput.classList.add('is-invalid');
    passwordInput.focus();
    return;
  }
  button.disabled = true;
  button.textContent = 'Signing in…';
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: {
        password: passwordInput.value,
        rememberDevice: document.getElementById('adminRememberDevice').checked,
      },
    });
    passwordInput.value = '';
    showAdminDashboard();
  } catch (err) {
    message.textContent = err.message || 'Could not sign in. Try again.';
    passwordInput.classList.add('is-invalid');
    passwordInput.select();
    passwordInput.focus();
  } finally {
    button.disabled = false;
    button.textContent = 'Log in';
  }
});

document.getElementById('adminShowPassword')?.addEventListener('click', event => {
  const toggle = event.currentTarget;
  const input = document.getElementById('adminPassword');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  toggle.textContent = show ? 'Hide' : 'Show';
  toggle.setAttribute('aria-pressed', String(show));
  toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  input.focus();
});

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('analyticsRange')?.addEventListener('change', loadAnalytics);
document.getElementById('refreshReferralsButton')?.addEventListener('click', loadReferrals);

api('/api/admin/session')
  .then(session => {
    if (session.authenticated) showAdminDashboard();
  })
  .catch(() => {})
  .finally(() => {
    document.body.classList.remove('admin-checking');
    const login = document.getElementById('adminLogin');
    if (login && login.style.display !== 'none') document.getElementById('adminPassword')?.focus();
  });











// ---------- Support inbox ----------
let supportSelectedThreadId = null;
let supportUnreadTimer = null;

function supportFormatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function refreshSupportUnreadBadge() {
  const badge = document.getElementById('supportUnreadBadge');
  if (!badge) return;
  try {
    const data = await api('/api/admin/support/unread');
    badge.textContent = data.unread ? String(data.unread) : '';
    badge.hidden = !data.unread;
  } catch (_) {}
}

function startSupportUnreadPolling() {
  refreshSupportUnreadBadge();
  clearInterval(supportUnreadTimer);
  supportUnreadTimer = setInterval(() => {
    refreshSupportUnreadBadge();
    const panel = document.getElementById('messagesPanel');
    if (panel && !panel.hidden) loadSupportThreads(true);
  }, 30000);
}

async function loadSupportThreads(quiet = false) {
  const list = document.getElementById('supportThreadList');
  if (!list) return;
  try {
    const data = await api('/api/admin/support/threads');
    list.replaceChildren();
    if (!data.threads.length) {
      const empty = document.createElement('p');
      empty.className = 'admin-muted';
      empty.textContent = 'No messages yet. They will show up here when customers use the chat or the Support page.';
      list.appendChild(empty);
    }
    data.threads.forEach(thread => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `support-thread-item${thread.id === supportSelectedThreadId ? ' active' : ''}${thread.adminUnread ? ' unread' : ''}${thread.status === 'closed' ? ' closed' : ''}`;
      const top = document.createElement('span');
      top.className = 'support-thread-top';
      const who = document.createElement('strong');
      who.textContent = thread.name || thread.email;
      const when = document.createElement('em');
      when.textContent = supportFormatTime(thread.updatedAt);
      top.append(who, when);
      const email = document.createElement('span');
      email.className = 'support-thread-email';
      email.textContent = `${thread.email}${thread.accountId ? ' · account' : ' · guest'}${thread.status === 'closed' ? ' · closed' : ''}`;
      const preview = document.createElement('span');
      preview.className = 'support-thread-preview';
      preview.textContent = thread.lastMessage ? `${thread.lastMessage.from === 'admin' ? 'You: ' : ''}${thread.lastMessage.body}` : '';
      item.append(top, email, preview);
      if (thread.adminUnread) {
        const badge = document.createElement('i');
        badge.className = 'support-thread-unread';
        badge.textContent = String(thread.adminUnread);
        item.appendChild(badge);
      }
      item.addEventListener('click', () => openSupportThread(thread.id));
      list.appendChild(item);
    });
    refreshSupportUnreadBadge();
    if (quiet && supportSelectedThreadId) openSupportThread(supportSelectedThreadId, true);
  } catch (err) {
    if (!quiet) list.textContent = `Could not load messages: ${err.message}`;
  }
}

function renderSupportThread(thread) {
  const view = document.getElementById('supportThreadView');
  view.replaceChildren();
  const head = document.createElement('div');
  head.className = 'support-thread-head';
  const title = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = thread.name || thread.email;
  const meta = document.createElement('span');
  meta.textContent = `${thread.email}${thread.orderNumber ? ` · Order ${thread.orderNumber}` : ''}${thread.accountId ? ` · Account #${thread.accountId}` : ' · Guest'}`;
  title.append(name, meta);
  const statusBtn = document.createElement('button');
  statusBtn.type = 'button';
  statusBtn.textContent = thread.status === 'closed' ? 'Reopen' : 'Mark resolved';
  statusBtn.addEventListener('click', async () => {
    await api(`/api/admin/support/threads/${thread.id}/status`, { method: 'POST', body: { status: thread.status === 'closed' ? 'open' : 'closed' } });
    loadSupportThreads(true);
  });
  head.append(title, statusBtn);

  const messages = document.createElement('div');
  messages.className = 'support-thread-messages';
  thread.messages.forEach(message => {
    const bubble = document.createElement('div');
    bubble.className = `support-msg ${message.from === 'admin' ? 'from-admin' : 'from-customer'}`;
    const text = document.createElement('p');
    text.textContent = message.body;
    const at = document.createElement('span');
    at.textContent = `${message.from === 'admin' ? 'You' : (thread.name || 'Customer')} · ${supportFormatTime(message.at)}`;
    bubble.append(text, at);
    messages.appendChild(bubble);
  });

  const form = document.createElement('form');
  form.className = 'support-reply-form';
  const box = document.createElement('textarea');
  box.rows = 3;
  box.maxLength = 2000;
  box.placeholder = 'Write a reply. The customer sees it in their chat window.';
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Send reply';
  const note = document.createElement('span');
  note.className = 'support-reply-note';
  form.append(box, send, note);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const message = box.value.trim();
    if (!message) return;
    send.disabled = true;
    try {
      const data = await api(`/api/admin/support/threads/${thread.id}/reply`, { method: 'POST', body: { message } });
      renderSupportThread(data.thread);
      loadSupportThreads(false);
    } catch (err) {
      note.textContent = `Not sent: ${err.message}`;
      send.disabled = false;
    }
  });
  view.append(head, messages, form);
  messages.scrollTop = messages.scrollHeight;
}

async function openSupportThread(id, quiet = false) {
  const view = document.getElementById('supportThreadView');
  const draft = view.querySelector('textarea');
  if (quiet && draft && draft.value.trim()) return; // don't wipe a reply being typed
  supportSelectedThreadId = id;
  try {
    const data = await api(`/api/admin/support/threads/${id}`);
    renderSupportThread(data.thread);
    document.querySelectorAll('.support-thread-item').forEach(el => el.classList.remove('active'));
    if (!quiet) loadSupportThreads(true);
  } catch (err) {
    if (!quiet) view.textContent = `Could not open conversation: ${err.message}`;
  }
}

document.getElementById('refreshSupportThreads')?.addEventListener('click', () => loadSupportThreads(false));
