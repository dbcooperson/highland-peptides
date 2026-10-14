const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDelayNoticeRecipients } = require('./shipping-delay');

test('groups eligible unshipped orders by normalized customer email', () => {
  const recipients = buildDelayNoticeRecipients([
    { id: 1, status: 'paid', created_at: '2026-09-17T01:00:00Z', buyer: { name: 'Alex', email: ' ALEX@example.com ' } },
    { id: 2, status: 'pending_tracking', created_at: '2026-09-18T01:00:00Z', buyer: { name: 'Alex R', email: 'alex@example.com' } },
    { id: 3, status: 'fulfilled', created_at: '2026-09-19T01:00:00Z', buyer: { name: 'Done', email: 'done@example.com' } },
    { id: 4, status: 'paid', created_at: '2026-09-15T01:00:00Z', buyer: { name: 'Old', email: 'old@example.com' } },
  ]);
  assert.equal(recipients.length, 1);
  assert.deepEqual(recipients[0].orderIds, [1, 2]);
  assert.equal(recipients[0].name, 'Alex R');
});

test('excludes orders that already received the notice', () => {
  const recipients = buildDelayNoticeRecipients([
    { id: 5, status: 'paid', created_at: '2026-09-20T01:00:00Z', shipping_delay_notice_sent_at: '2026-10-01T00:00:00Z', buyer: { name: 'Sent', email: 'sent@example.com' } },
  ]);
  assert.deepEqual(recipients, []);
});
