const DELAY_NOTICE_CUTOFF = '2026-09-17T00:00:00.000Z';
const DELAY_NOTICE_STATUSES = new Set(['paid', 'pending_tracking']);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function buildDelayNoticeRecipients(orders, cutoff = DELAY_NOTICE_CUTOFF) {
  const cutoffTime = new Date(cutoff).getTime();
  const grouped = new Map();
  (Array.isArray(orders) ? orders : []).forEach(order => {
    const createdTime = new Date(order && order.created_at).getTime();
    const email = normalizeEmail(order && order.buyer && order.buyer.email);
    if (!DELAY_NOTICE_STATUSES.has(String(order && order.status || ''))) return;
    if (!Number.isFinite(createdTime) || createdTime < cutoffTime) return;
    if (!email || !email.includes('@') || order.shipping_delay_notice_sent_at) return;

    const existing = grouped.get(email) || {
      email,
      name: String(order.buyer && order.buyer.name || '').trim() || 'there',
      orderIds: [],
      latestCreatedAt: order.created_at,
    };
    existing.orderIds.push(Number(order.id));
    if (createdTime >= new Date(existing.latestCreatedAt).getTime()) {
      existing.name = String(order.buyer && order.buyer.name || '').trim() || existing.name;
      existing.latestCreatedAt = order.created_at;
    }
    grouped.set(email, existing);
  });

  return [...grouped.values()]
    .map(recipient => ({ ...recipient, orderIds: recipient.orderIds.sort((a, b) => a - b) }))
    .sort((left, right) => new Date(right.latestCreatedAt) - new Date(left.latestCreatedAt));
}

module.exports = { DELAY_NOTICE_CUTOFF, buildDelayNoticeRecipients };
