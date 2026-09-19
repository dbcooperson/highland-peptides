const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highland-pirate-export-'));
process.env.ORDER_DB_PATH = path.join(tempDir, 'db.json');
delete require.cache[require.resolve('./db')];
const db = require('./db');

function createTestOrder() {
  return db.createOrder({
    buyer: { name: 'Export Test', email: 'export@example.com' },
    certifiedAt: new Date().toISOString(),
    items: [{ sku: 'TEST', name: 'Test Product', spec: '10mg', quantity: 1, unit_price: 10 }],
    subtotal: 10,
    packagingFee: 0,
    shippingFee: 0,
    shippingMethod: 'domestic',
    orderFee: 0,
    orderFeeRate: 0,
    discountAmount: 0,
    total: 10,
    paymentProvider: 'manual_paypal',
  });
}

test('Pirate Ship export state survives status changes and resets only through explicit requeue', () => {
  const created = createTestOrder();
  assert.equal(created.pirate_ship_exported_at, null);

  db.updateOrderStatus(created.id, 'pending_tracking');
  const exportedAt = '2026-09-14T12:34:56.000Z';
  db.markPirateShipOrdersExported([created.id], exportedAt);
  assert.equal(db.getOrderById(created.id).pirate_ship_exported_at, exportedAt);

  db.updateOrderStatus(created.id, 'pending_tracking');
  assert.equal(db.getOrderById(created.id).pirate_ship_exported_at, exportedAt);

  db.updateOrderStatus(created.id, 'paid');
  db.updateOrderStatus(created.id, 'pending_tracking');
  assert.equal(db.getOrderById(created.id).pirate_ship_exported_at, exportedAt);

  db.requeuePirateShipOrders([created.id], '2026-09-15T09:00:00.000Z');
  assert.equal(db.getOrderById(created.id).pirate_ship_exported_at, null);
  assert.equal(db.getOrderById(created.id).pirate_ship_requeued_at, '2026-09-15T09:00:00.000Z');
});

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
