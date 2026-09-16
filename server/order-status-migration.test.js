const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highland-order-status-migration-'));
process.env.ORDER_DB_PATH = path.join(tempDir, 'db.json');
fs.writeFileSync(process.env.ORDER_DB_PATH, JSON.stringify({
  orders: [
    { id: 291, status: 'paid', paid_at: '2026-09-10T00:00:00.000Z', pirate_ship_exported_at: 'old-export' },
    { id: 278, status: 'pending_tracking', paid_at: '2026-09-09T00:00:00.000Z', pirate_ship_exported_at: null },
  ],
  nextOrderId: 292,
}));
delete require.cache[require.resolve('./db')];
const db = require('./db');

test('selected order status migration runs once and queues newly pending orders', () => {
  const first = db.applyOrderStatusMigration('selected-orders', [291, 278, 999], 'pending_tracking');
  assert.equal(first.applied, true);
  assert.deepEqual(first.updatedOrderIds, [291, 278]);
  assert.deepEqual(first.missingOrderIds, [999]);
  assert.equal(db.getOrderById(291).status, 'pending_tracking');
  assert.equal(db.getOrderById(291).pirate_ship_exported_at, null);
  assert.equal(db.getOrderById(278).status, 'pending_tracking');

  const second = db.applyOrderStatusMigration('selected-orders', [291], 'paid');
  assert.deepEqual(second, { applied: false, updatedOrderIds: [], missingOrderIds: [] });
  assert.equal(db.getOrderById(291).status, 'pending_tracking');
});
