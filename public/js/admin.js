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

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function orderItemsHTML(order) {
  return (order.items || [])
    .map(it => `<div class="admin-item-line"><strong>${it.quantity}x ${escapeHtml(it.name)}</strong><span>${escapeHtml(it.spec)} | ${escapeHtml(it.sku || '')}</span></div>`)
    .join('');
}

function discountHTML(order) {
  if (!order.discount_code) return '<span class="admin-muted">None</span>';
  return `${escapeHtml(order.discount_code)} (-$${(order.discount_amount || 0).toFixed(2)})`;
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

async function loadOrders() {
  const { orders } = await api('/api/admin/orders');
  const panel = document.getElementById('ordersPanel');
  if (panel) panel.insertAdjacentHTML('afterbegin', summaryHTML(orders));

  document.getElementById('ordersTable').innerHTML = `
    <tr>${['Order','Buyer','Contact','Ship To','Items','Discount','Total','Status','Created','Actions'].map(th).join('')}</tr>
    ${orders.map(o => `
      <tr>
        ${td('#' + o.id + '<br>' + statusBadge(o.status))}
        ${td(escapeHtml(o.buyer.name))}
        ${td(`<button class="admin-copy-btn" data-copy="${escapeHtml(o.buyer.email)}">Copy email</button><br><a href="mailto:${escapeHtml(o.buyer.email)}">${escapeHtml(o.buyer.email)}</a>`)}
        ${td(escapeHtml(`${o.buyer.address1}${o.buyer.address2 ? ', ' + o.buyer.address2 : ''}, ${o.buyer.city}, ${o.buyer.state} ${o.buyer.zip}`))}
        ${td(orderItemsHTML(o))}
        ${td(discountHTML(o))}
        ${td('$' + o.total.toFixed(2))}
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
    loadOrders();
  } catch (err) {
    document.getElementById('adminLoginMsg').textContent = err.message;
  }
});

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  location.reload();
});
