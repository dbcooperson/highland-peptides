const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highland-stripe-order-'));
process.env.ORDER_DB_PATH = path.join(tempDir, 'db.json');
delete require.cache[require.resolve('./db')];
const db = require('./db');

function pendingOrder() {
  return db.createOrder({
    buyer: { name: 'Test Researcher', email: 'researcher@example.com' },
    certifiedAt: new Date().toISOString(),
    items: [{ sku: 'TEST', name: 'Test research product', spec: '10 mg', quantity: 1, unit_price: 20 }],
    subtotal: 20, packagingFee: 0, shippingFee: 5, orderFee: 0,
    discountAmount: 0, total: 25, paymentProvider: 'stripe',
  });
}

test('signed-session order reconciliation matches ID, currency and exact amount once', () => {
  const order = pendingOrder();
  const sessionId = 'cs_test_reconciliation';
  assert.equal(db.markStripeOrderPaid(order.id, sessionId, 2500, 'usd'), null);
  assert.ok(db.setStripeCheckoutSessionId(order.id, sessionId));
  assert.equal(db.markStripeOrderPaid(order.id, 'cs_test_wrong', 2500, 'usd'), null);
  assert.equal(db.markStripeOrderPaid(order.id, sessionId, 2499, 'usd'), null);
  assert.equal(db.markStripeOrderPaid(order.id, sessionId, 2500, 'eur'), null);
  assert.equal(db.markStripeOrderPaid(order.id, sessionId, 2500, 'usd').newlyPaid, true);
  assert.equal(db.markStripeOrderPaid(order.id, sessionId, 2500, 'usd').newlyPaid, false);
  assert.equal(db.getOrderById(order.id).status, 'paid');
});

test('a cancelled order cannot be paid by a delayed Stripe event', () => {
  const order = pendingOrder();
  const sessionId = 'cs_test_cancelled';
  db.setStripeCheckoutSessionId(order.id, sessionId);
  db.updateOrderStatus(order.id, 'cancelled');
  assert.equal(db.markStripeOrderPaid(order.id, sessionId, 2500, 'usd').newlyPaid, false);
  assert.equal(db.getOrderById(order.id).status, 'cancelled');
});
