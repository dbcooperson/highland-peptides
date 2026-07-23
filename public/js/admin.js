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
    };
  });
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
  const grossProfit = Number(financials.grossProfit ?? (productRevenue - cogs));
  const grossMargin = Number(financials.grossMargin || 0);
  return `
    <div class="admin-total-breakdown admin-money-breakdown">
      <div><span>Before code</span><strong>${money(beforeDiscountTotal)}</strong></div>
      ${saved > 0 ? `<div class="admin-savings"><span>Code saved</span><strong>-${money(saved)}</strong></div>` : '<div><span>Code saved</span><strong>$0.00</strong></div>'}
      <div class="admin-final-total"><span>Customer spent</span><strong>${money(totalSpent)}</strong></div>
      <div><span>Product revenue</span><strong>${money(productRevenue)}</strong></div>
      <div><span>COGS</span><strong>${money(cogs)}</strong></div>
      <div class="admin-profit-line"><span>Profit after code</span><strong>${money(grossProfit)}</strong></div>
      <div><span>Margin</span><strong>${grossMargin}%</strong></div>
    </div>
  `;
}

function statusBadge(status) {
  return `<span class="admin-status admin-status-${escapeHtml(status)}">${escapeHtml(status).replace('_', ' ')}</span>`;
}

function paymentHTML(order) {
  const provider = order.payment_provider || 'manual';
  if (provider === 'paypal') {
    return `<span class="admin-payment admin-payment-paypal">PayPal</span>${order.paypal_order_id ? `<br><span class="admin-muted">${escapeHtml(order.paypal_order_id)}</span>` : ''}`;
  }
  if (provider === 'crypto') {
    const asset = escapeHtml(order.crypto_asset || 'BTC');
    const txid = order.payment_reference
      ? `<br><span class="admin-muted">TXID: ${escapeHtml(order.payment_reference)}</span>`
      : '<br><span class="admin-muted">Waiting on TXID</span>';
    return `<span class="admin-payment admin-payment-crypto">Crypto (${asset})</span>${txid}`;
  }
  return '<span class="admin-payment admin-payment-manual">Manual invoice</span><br><span class="admin-muted">Needs payment link sent</span>';
}

function summaryHTML(orders) {
  const paid = orders.filter(o => o.status === 'paid').length;
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
    <tr>${['SKU','Product','Qty','Revenue','COGS','Gross profit','Margin','Order'].map(th).join('')}</tr>
    ${lines.map(line => `
      <tr>
        ${td(escapeHtml(line.sku))}
        ${td(`<strong>${escapeHtml(line.name)}</strong><br><span class="admin-muted">${escapeHtml(line.spec)}</span>`)}
        ${td(line.quantity)}
        ${td(money(line.revenue))}
        ${td(money(line.cogs) + `<br><span class="admin-muted">${money(line.unitCost)} ea</span>`)}
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

let adminOrdersCache = [];

function orderSearchText(order) {
  const buyer = order.buyer || {};
  const itemText = (order.items || []).map(item => [item.name, item.spec, item.sku].join(' ')).join(' ');
  return [order.id, order.status, buyer.name, buyer.email, buyer.address1, buyer.address2, buyer.city, buyer.state, buyer.zip, itemText, order.discount_code, order.notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function filteredAdminOrders() {
  const query = (document.getElementById('adminOrderSearch')?.value || '').trim().toLowerCase();
  const status = document.getElementById('adminStatusFilter')?.value || 'all';
  return adminOrdersCache.filter(order => {
    const statusMatch = status === 'all' || order.status === status;
    const queryMatch = !query || orderSearchText(order).includes(query);
    return statusMatch && queryMatch;
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
               <a href="/api/admin/orders/${o.id}/contents-label.pdf" target="_blank">4x6 Label</a>
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
}

async function loadOrders() {
  const { orders } = await api('/api/admin/orders');
  adminOrdersCache = orders;
  const panel = document.getElementById('ordersPanel');
  const existingSummary = panel && panel.querySelector('.admin-summary-grid');
  if (existingSummary) existingSummary.remove();
  if (panel) panel.insertAdjacentHTML('afterbegin', summaryHTML(orders));
  renderOrdersTable();
  document.getElementById('adminOrderSearch')?.addEventListener('input', renderOrdersTable);
  document.getElementById('adminStatusFilter')?.addEventListener('change', renderOrdersTable);
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
  } catch (err) {
    document.getElementById('adminLoginMsg').textContent = err.message;
  }
});

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});




