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
    };
  });
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
      ${td(isReferral ? `<strong>Order HP-${item.orderId}</strong><br><span class="admin-muted">${escapeHtml(item.customerName || '')}</span>` : `<strong>TikTok #${item.id}</strong><br><span class="admin-muted">${escapeHtml(new Date(item.created_at).toLocaleString())}</span>`)}
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
  return `
    <div class="admin-total-breakdown admin-money-breakdown">
      <div><span>Before code</span><strong>${money(beforeDiscountTotal)}</strong></div>
      ${saved > 0 ? `<div class="admin-savings"><span>Code saved</span><strong>-${money(saved)}</strong></div>` : '<div><span>Code saved</span><strong>$0.00</strong></div>'}
      <div class="admin-final-total"><span>Customer spent</span><strong>${money(totalSpent)}</strong></div>
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
  if (provider === 'paypal') {
    return `<span class="admin-payment admin-payment-paypal">PayPal checkout</span>${order.paypal_order_id ? `<br><span class="admin-muted">${escapeHtml(order.paypal_order_id)}</span>` : ''}`;
  }
  if (provider === 'manual_paypal') {
    return `<span class="admin-payment admin-payment-paypal">PayPal manual</span><br><span class="admin-muted">Match exact total</span>`;
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
  const duplicateTxidOrders = orders.filter(o => o.payment_reference_duplicate).length;
  const pending = orders.filter(o => o.status === 'pending_payment').length;
  const fulfilled = orders.filter(o => o.status === 'fulfilled').length;
  const revenue = orders.filter(o => ['paid','fulfilled'].includes(o.status)).reduce((sum, o) => sum + (o.total || 0), 0);
  return `
    <div class="admin-summary-grid">
      <div><span>Total orders</span><strong>${orders.length}</strong></div>
      <div><span>Paid</span><strong>${paid}</strong></div>
      <div><span>Pending</span><strong>${pending}</strong></div>
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

function buildHighlandLabel({ name, dosage, lot, expiry, storage, design = 'vial-current' }) {
  const label = document.createElement('div');
  label.className = `highland-print-label label-design-${design}`;

  const identity = document.createElement('div');
  identity.className = 'highland-label-identity';
  const mark = document.createElement('img');
  mark.className = 'highland-label-mark';
  mark.src = '/images/branding/highland-hp-ridge-mark-v1.png';
  mark.alt = '';
  mark.setAttribute('aria-hidden', 'true');
  const brand = document.createElement('span');
  brand.className = 'highland-label-brand';
  brand.innerHTML = '<strong>HIGHLAND</strong><small>PEPTIDES</small>';
  identity.append(mark, brand);

  const divider = document.createElement('span');
  divider.className = 'highland-label-divider';
  divider.setAttribute('aria-hidden', 'true');

  const compound = document.createElement('strong');
  compound.className = `highland-label-compound ${labelTextSizeClass(name)}`;
  compound.textContent = String(name || '').trim().toUpperCase();

  const accent = document.createElement('span');
  accent.className = 'highland-label-accent';
  accent.setAttribute('aria-hidden', 'true');

  const dose = document.createElement('strong');
  dose.className = 'highland-label-dose';
  dose.textContent = String(dosage || '').trim().toUpperCase();

  const storageSide = document.createElement('div');
  storageSide.className = 'highland-label-side highland-label-side-storage';
  const storageTitle = document.createElement('span');
  storageTitle.textContent = 'STORE AT';
  const storageValue = document.createElement('span');
  storageValue.textContent = String(storage || '').trim().toUpperCase();
  storageSide.append(storageTitle, storageValue);

  const batchSide = document.createElement('div');
  batchSide.className = 'highland-label-side highland-label-side-batch';
  const lotValue = document.createElement('span');
  lotValue.textContent = `LOT ${String(lot || '').trim().toUpperCase()}`;
  const expiryValue = document.createElement('span');
  expiryValue.textContent = `EXP ${String(expiry || '').trim().toUpperCase()}`;
  batchSide.append(lotValue, expiryValue);

  const footer = document.createElement('div');
  footer.className = 'highland-label-footer';
  const purity = document.createElement('span');
  purity.textContent = '99% PURITY';
  const footerDot = document.createElement('i');
  footerDot.className = 'highland-label-footer-dot';
  footerDot.setAttribute('aria-hidden', 'true');
  const ruo = document.createElement('span');
  ruo.textContent = 'RESEARCH USE ONLY';
  footer.append(purity, footerDot, ruo);

  label.append(identity, divider, compound, accent, dose, storageSide, batchSide, footer);
  return label;
}

function getLabelMakerValues() {
  const name = document.getElementById('labelProductName')?.value.trim() || '';
  const dosage = document.getElementById('labelDosage')?.value.trim() || '';
  const lot = document.getElementById('labelLotNumber')?.value.trim() || '';
  const expiry = document.getElementById('labelExpiryDate')?.value.trim() || '';
  const storage = document.getElementById('labelStorage')?.value.trim() || '';
  const design = document.querySelector('[name="labelDesign"]')?.value || 'vial-current';
  const start = Math.max(1, Math.min(48, Number(document.getElementById('labelStartPosition')?.value || 1)));
  const requested = Math.max(1, Math.min(48, Number(document.getElementById('labelQuantity')?.value || 1)));
  const quantity = Math.min(requested, 49 - start);
  return { name, dosage, lot, expiry, storage, design, start, quantity };
}

function renderLabelMaker() {
  const values = getLabelMakerValues();
  const preview = document.getElementById('labelLivePreview');
  if (!preview) return;
  preview.replaceChildren(buildHighlandLabel(values));
  const quantityInput = document.getElementById('labelQuantity');
  if (quantityInput) quantityInput.max = String(49 - values.start);
  const message = document.getElementById('labelMakerMessage');
  if (message) message.textContent = values.quantity < Number(quantityInput?.value || 1)
    ? `This starting position leaves room for ${values.quantity} labels on the sheet.`
    : '';
}

function buildLabelPrintSheet(values) {
  const portal = document.getElementById('labelPrintPortal');
  if (!portal) return;
  portal.replaceChildren();
  for (let position = 1; position <= 48; position += 1) {
    const cell = document.createElement('div');
    cell.className = 'label-print-cell';
    const shouldPrint = position >= values.start && position < values.start + values.quantity;
    if (shouldPrint) cell.appendChild(buildHighlandLabel(values));
    portal.appendChild(cell);
  }
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
  form.querySelectorAll('input').forEach(input => input.addEventListener('input', renderLabelMaker));
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
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = getLabelMakerValues();
    if (!values.name || !values.dosage) return;
    buildLabelPrintSheet(values);
    document.body.classList.add('label-printing');
    const cleanup = () => document.body.classList.remove('label-printing');
    window.addEventListener('afterprint', cleanup, { once: true });
    const printPortal = document.getElementById('labelPrintPortal');
    if (printPortal) void printPortal.offsetHeight;
    try {
      window.print();
      window.setTimeout(cleanup, 30000);
    } catch {
      cleanup();
      const message = document.getElementById('labelMakerMessage');
      if (message) message.textContent = 'Printer options could not open. In Safari, tap Share and then Print.';
    }
  });
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
      <div><span>Visitor CVR</span><strong>${percent(data.rates && data.rates.visitorToOrder)}</strong><em>visitor to order</em></div>
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
    ['Orders created', totals.ordersCreated || 0],
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
    `).join('') || `<tr>${td('No paid or fulfilled orders yet.')}</tr>`}
  `;
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
  if (provider.includes('paypal')) return 'paypal_any';
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
  return `
    <div class="admin-fulfillment-box">
      ${order.status === 'pending_payment' ? `
        <button type="button" class="admin-send-reminder" data-id="${order.id}">Send payment reminder</button>
        ${reminderStatus}
      ` : ''}
      ${['paid', 'fulfilled'].includes(order.status) ? `
        <label>Carrier
          <select class="admin-tracking-carrier" data-id="${order.id}">
            ${['USPS','UPS','FedEx','DHL','Canada Post','Royal Mail','Australia Post','Other'].map(carrier => `<option value="${carrier}" ${carrier === order.tracking_carrier ? 'selected' : ''}>${carrier}</option>`).join('')}
          </select>
        </label>
        <label>Tracking number
          <input class="admin-tracking-number" data-id="${order.id}" value="${escapeHtml(order.tracking_number || '')}" placeholder="Paste tracking ID">
        </label>
        <button type="button" class="admin-send-tracking" data-id="${order.id}">Send tracking email</button>
        ${trackingStatus}
      ` : ''}
    </div>
  `;
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
          ${['pending_payment','paid','fulfilled','cancelled'].map(s => `<option value="${s}" ${s===o.status?'selected':''}>${s.replace('_', ' ')}</option>`).join('')}
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
      if (!window.confirm('Send a payment reminder from the configured Highland customer email to this buyer?')) return;
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
      if (!trackingNumber) return window.alert('Paste a tracking number first.');
      if (!window.confirm(`Email ${carrier} tracking ${trackingNumber} to this buyer and mark the order fulfilled?`)) return;
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        await api(`/api/admin/orders/${id}/tracking`, { method: 'POST', body: { carrier, trackingNumber } });
        await loadOrders();
        loadProfit();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Send tracking email';
        window.alert(err.message || 'Could not send tracking email.');
      }
    };
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
  const searchInput = document.getElementById('adminOrderSearch');
  const statusFilter = document.getElementById('adminStatusFilter');
  const paymentFilter = document.getElementById('adminPaymentFilter');
  if (searchInput) searchInput.oninput = renderOrdersTable;
  if (statusFilter) statusFilter.onchange = renderOrdersTable;
  if (paymentFilter) paymentFilter.onchange = renderOrdersTable;
}
document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: document.getElementById('adminPassword').value } });
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminPanels').style.display = 'block';
    document.getElementById('adminLogoutBtn').style.display = 'inline-block';
    initAdminTabs();
    loadStorageInfo();
    loadOrders();
    loadProfit();
    loadLaunchChecks();
    initLabelMaker();
  } catch (err) {
    document.getElementById('adminLoginMsg').textContent = err.message;
  }
});

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('analyticsRange')?.addEventListener('change', loadAnalytics);
document.getElementById('refreshReferralsButton')?.addEventListener('click', loadReferrals);









