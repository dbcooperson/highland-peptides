const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'snowy-lifecycle-'));
process.env.BUSINESS_MAILING_ADDRESS = '123 Test St, Box 4, Los Angeles, CA 90001';
const lifecycle = require('./lifecycle');
const config = require('./config');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = Date.parse('2026-12-20T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
const item = (sku, quantity = 1, unit_price = 20) => ({ sku, quantity, unit_price });
const never = () => false;

test('cart links round-trip, reject tampering, and drop unknown SKUs', () => {
  const token = lifecycle.cartToken([item('BC10', 2), item('NOPE', 1), item('MS40', 1)], now);
  assert.deepEqual(lifecycle.readCartToken(token, now), { BC10: 2, MS40: 1 });
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ i: [['BC10', 99]], x: now + DAY })).toString('base64url');
  assert.equal(lifecycle.readCartToken(`${forged}.${sig}`, now), null);
  assert.equal(lifecycle.readCartToken(token, now + 61 * DAY), null, 'expires');
  assert.ok(payload);
});

test('unpaid card order gets one abandoned email after the delay, not before, not if they paid later', () => {
  const order = { id: 1, status: 'pending_payment', payment_provider: 'stripe', lifecycle_emails: true, created_at: iso(now - 2 * HOUR), buyer: { email: 'a@x.com' }, items: [item('BC10')] };
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [order], checkoutStarts: [], isSuppressed: never, nowMs: now }).abandoned.length, 1);
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [{ ...order, created_at: iso(now - 10 * 60 * 1000) }], checkoutStarts: [], isSuppressed: never, nowMs: now }).abandoned.length, 0);
  const paidLater = { id: 2, status: 'paid', created_at: iso(now - HOUR), paid_at: iso(now - HOUR), buyer: { email: 'A@x.com' }, items: [item('BC10')] };
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [order, paidLater], checkoutStarts: [], isSuppressed: never, nowMs: now }).abandoned.length, 0);
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [{ ...order, abandoned_email_sent_at: iso(now) }], checkoutStarts: [], isSuppressed: never, nowMs: now }).abandoned.length, 0);
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [order], checkoutStarts: [], isSuppressed: () => true, nowMs: now }).abandoned.length, 0, 'unsubscribed');
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [{ ...order, lifecycle_emails: undefined }], checkoutStarts: [], isSuppressed: never, nowMs: now }).abandoned.length, 0, 'old orders never emailed');
});

test('verified checkout with no order gets one email; one email per person per scan', () => {
  const start = { email: 'b@x.com', created_at: iso(now - 3 * HOUR), updated_at: iso(now - 2 * HOUR), items: [{ sku: 'MS40', quantity: 1 }] };
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [], checkoutStarts: [start], isSuppressed: never, nowMs: now }).abandoned.length, 1);
  const placed = { id: 3, status: 'pending_payment', payment_provider: 'crypto', created_at: iso(now - 2.5 * HOUR), buyer: { email: 'b@x.com' }, items: [item('MS40')] };
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [placed], checkoutStarts: [start], isSuppressed: never, nowMs: now }).abandoned.length, 0, 'they placed an order');
});

test('reorder reminder fires once after the reminder age and only if nothing newer', () => {
  const paidAt = now - (config.REORDER_REMINDER_DAYS + 1) * DAY;
  const order = { id: 4, status: 'fulfilled', lifecycle_emails: true, created_at: iso(paidAt), paid_at: iso(paidAt), buyer: { email: 'c@x.com' }, items: [item('BC10', 2), item('WA10', 1, 0)] };
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [order], checkoutStarts: [], isSuppressed: never, nowMs: now }).reorders.length, 1);
  const tooSoon = { ...order, paid_at: iso(now - 5 * DAY), created_at: iso(now - 5 * DAY) };
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [tooSoon], checkoutStarts: [], isSuppressed: never, nowMs: now }).reorders.length, 0);
  const newer = { id: 5, status: 'pending_payment', created_at: iso(now - DAY), buyer: { email: 'c@x.com' }, items: [item('BC10')] };
  assert.equal(lifecycle.dueLifecycleEmails({ orders: [order, newer], checkoutStarts: [], isSuppressed: never, nowMs: now }).reorders.length, 0);
});

test('emails carry the postal address, unsubscribe link, and only paid items in the reorder link', () => {
  const message = lifecycle.reorderEmail({ id: 9, buyer: { email: 'c@x.com' }, items: [item('BC10', 2), item('WA10', 1, 0)] });
  assert.match(message.html, /123 Test St/);
  assert.match(message.html, /api\/email\/unsubscribe\?e=c%40x\.com&amp;t=|api\/email\/unsubscribe\?e=c%40x\.com&t=/);
  const token = decodeURIComponent(message.text.match(/restore=([^\s]+)/)[1]);
  assert.deepEqual(lifecycle.readCartToken(token), { BC10: 2 });
});

test('scan sends nothing and claims nothing when the postal address is missing', async () => {
  const saved = config.BUSINESS_MAILING_ADDRESS;
  config.BUSINESS_MAILING_ADDRESS = '';
  let sent = 0;
  const result = await lifecycle.runLifecycleScan({ db: { getAllOrders: () => { throw new Error('should not read'); } }, send: async () => { sent += 1; return true; } });
  assert.equal(result.sent, 0);
  assert.equal(sent, 0);
  config.BUSINESS_MAILING_ADDRESS = saved;
});
