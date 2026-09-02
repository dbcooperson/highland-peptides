const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8');
const accountSource = fs.readFileSync(path.join(root, 'public', 'js', 'account.js'), 'utf8');

test('fulfillment workflow recognizes pending tracking as a confirmed order state', () => {
  assert.match(indexSource, /new Set\(\['paid', 'pending_tracking', 'fulfilled'\]\)/);
  assert.match(indexSource, /\['pending_payment', 'paid', 'pending_tracking', 'fulfilled', 'cancelled'\]/);
  assert.match(adminSource, /\['pending_payment','paid','pending_tracking','fulfilled','cancelled'\]/);
  assert.match(indexSource, /dispatchPendingTrackingAddress/);
  assert.match(indexSource, /claimFulfillmentDiscordPost/);
  assert.match(adminSource, /copy-ready address is in Discord/);
});

test('tracking cannot be emailed twice and fulfills only an awaiting order', () => {
  assert.match(indexSource, /\['paid', 'pending_tracking'\]\.includes\(order\.status\)/);
  assert.match(indexSource, /order\.tracking_sent_at \|\| order\.tracking_number/);
  assert.match(indexSource, /Tracking has already been sent for this order/);
});

test('customer accounts receive status and tracking details', () => {
  assert.match(accountSource, /item\.trackingNumber/);
  assert.match(accountSource, /account-tracking-link/);
  assert.match(accountSource, /item\.trackingUrl/);
});
