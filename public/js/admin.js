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
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

async function loadOrders() {
  const { orders } = await api('/api/admin/orders');
  const panel = document.getElementById('ordersPanel');
  if (panel && !panel.querySelector('.admin-summary-grid')) panel.insertAdjacentHTML('afterbegin', summaryHTML(orders));

  document.getElementById('ordersTable').innerHTML = `
    <tr>${['Order','Buyer','Contact','Ship To','Items','Code savings','Spend + profit','Status','Created','Actions'].map(th).join('')}</tr>
    ${orders.map(o => `
      <tr>
        ${td('#' + o.id + '<br>' + statusBadge(o.status))}
        ${td(escapeHtml(o.buyer.name))}
        ${td(`<button class="admin-copy-btn" data-copy="${escapeHtml(o.buyer.email)}">Copy email</button><br><a href="mailto:${escapeHtml(o.buyer.email)}">${escapeHtml(o.buyer.email)}</a>`)}
        ${td(escapeHtml(`${o.buyer.address1}${o.buyer.address2 ? ', ' + o.buyer.address2 : ''}, ${o.buyer.city}, ${o.buyer.state} ${o.buyer.zip}`))}
        ${td(orderItemsHTML(o))}
        ${td(discountHTML(o))}
        ${td(orderTotalHTML(o))}
        ${td(`<select data-id="${o.id}" class="statusSelect">
          ${['pending_payment','paid','fulfilled','cancelled'].map(s => `<option value="${s}" ${s===o.status?'selected':''}>${s.replace('_', ' ')}</option>`).join('')}
        </select>`)}
        ${td(new Date(o.created_at).toLocaleString())}
        ${td(`<a href="/api/admin/orders/${o.id}/packing-slip.pdf" target="_blank">Packing Slip</a><br>
               <a href="/api/admin/orders/${o.id}/contents-label.pdf" target="_blank">4x6 Label</a>`)}
      </tr>
    `).join('') || `<tr>${td('No orders yet.')}</tr>`}
  `;

  document.querySelectorAll('.statusSelect').forEach(sel => {
    sel.onchange = async () => {
      await api(`/api/admin/orders/${sel.dataset.id}/status`, { method: 'POST', body: { status: sel.value } });
      location.reload();
    };
  });
  document.querySelectorAll('.admin-copy-btn').forEach(btn => {
    btn.onclick = async () => {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy email'; }, 1200);
    };
  });
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
  } catch (err) {
    document.getElementById('adminLoginMsg').textContent = err.message;
  }
});

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});


