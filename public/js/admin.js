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

function td(text) { return `<td style="padding:6px; border-bottom:1px solid #2a3948; font-size:13px; vertical-align:top;">${text}</td>`; }

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function orderItemsHTML(order) {
  return (order.items || [])
    .map(it => `${it.quantity}x ${escapeHtml(it.name)} (${escapeHtml(it.spec)})`)
    .join('<br>');
}

function discountHTML(order) {
  if (!order.discount_code) return 'None';
  return `${escapeHtml(order.discount_code)} (-$${(order.discount_amount || 0).toFixed(2)})`;
}

async function loadOrders() {
  const { orders } = await api('/api/admin/orders');
  document.getElementById('ordersTable').innerHTML = `
    <tr>${['Order #','Buyer','Email','Ship To','Items','Discount','Total','Status','Created','Actions'].map(h => `<th style="text-align:left; padding:6px; border-bottom:1px solid #2a3948;">${h}</th>`).join('')}</tr>
    ${orders.map(o => `
      <tr>
        ${td('#' + o.id)}
        ${td(escapeHtml(o.buyer.name))}
        ${td(escapeHtml(o.buyer.email))}
        ${td(escapeHtml(`${o.buyer.address1}, ${o.buyer.city}, ${o.buyer.state} ${o.buyer.zip}`))}
        ${td(orderItemsHTML(o))}
        ${td(discountHTML(o))}
        ${td('$' + o.total.toFixed(2))}
        ${td(`<select data-id="${o.id}" class="statusSelect">
          ${['pending_payment','paid','fulfilled','cancelled'].map(s => `<option value="${s}" ${s===o.status?'selected':''}>${s}</option>`).join('')}
        </select>`)}
        ${td(o.created_at)}
        ${td(`<a href="/api/admin/orders/${o.id}/packing-slip.pdf" target="_blank">Packing Slip</a> |
               <a href="/api/admin/orders/${o.id}/contents-label.pdf" target="_blank">4x6 Label</a>`)}
      </tr>
    `).join('') || `<tr>${td('No orders yet.')}</tr>`}
  `;

  document.querySelectorAll('.statusSelect').forEach(sel => {
    sel.onchange = async () => {
      await api(`/api/admin/orders/${sel.dataset.id}/status`, { method: 'POST', body: { status: sel.value } });
      loadOrders();
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
