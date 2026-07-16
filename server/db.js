// Simple JSON-file-backed order store.
//
// IMPORTANT FOR RENDER:
// Orders must live on a persistent disk, not inside the deployed repo folder.
// On Render, mount a Persistent Disk at /var/data and this app will store orders
// at /var/data/db.json by default. You can override with ORDER_DB_PATH or DATA_DIR.

const fs = require('fs');
const path = require('path');

const LEGACY_DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function defaultDbPath() {
  if (process.env.ORDER_DB_PATH) return process.env.ORDER_DB_PATH;
  if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, 'db.json');
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return '/var/data/db.json';
  return LEGACY_DB_PATH;
}

const DB_PATH = defaultDbPath();

function ensureDbDirectory() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function migrateLegacyDbIfNeeded() {
  ensureDbDirectory();
  if (DB_PATH === LEGACY_DB_PATH) return;
  if (fs.existsSync(DB_PATH)) return;
  if (fs.existsSync(LEGACY_DB_PATH)) {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  }
}

function initialData() {
  return { orders: [], nextOrderId: 1 };
}

function load() {
  migrateLegacyDbIfNeeded();
  if (!fs.existsSync(DB_PATH)) {
    const initial = initialData();
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(data) {
  ensureDbDirectory();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ---------- Orders (guest checkout, no accounts) ----------
function createOrder({ buyer, certifiedAt, items, subtotal, packagingFee, shippingFee, orderFee, orderFeeRate, discountCode, discountAmount, total, paymentProvider }) {
  const data = load();
  const order = {
    id: data.nextOrderId++,
    status: 'pending_payment',
    payment_provider: paymentProvider || 'manual',
    payment_reference: null,
    paypal_order_id: null,
    paid_at: null,
    buyer,
    certified_at: certifiedAt,
    items,
    subtotal,
    packaging_fee: packagingFee,
    shipping_fee: shippingFee,
    order_fee: orderFee || 0,
    order_fee_rate: orderFeeRate || 0,
    discount_code: discountCode || null,
    discount_amount: discountAmount || 0,
    total,
    created_at: new Date().toISOString(),
  };
  data.orders.push(order);
  save(data);
  return order;
}

function getAllOrders() {
  const data = load();
  return [...data.orders].sort((a, b) => b.id - a.id);
}

function getOrderById(id) {
  const data = load();
  return data.orders.find(o => o.id === Number(id)) || null;
}

function setPayPalOrderId(id, paypalOrderId) {
  const data = load();
  const order = data.orders.find(o => o.id === Number(id));
  if (!order) return null;
  order.paypal_order_id = paypalOrderId || null;
  save(data);
  return order;
}

function markOrderPaid(id, paymentReference) {
  const data = load();
  const order = data.orders.find(o => o.id === Number(id));
  if (!order) return null;
  order.status = 'paid';
  order.payment_reference = paymentReference || order.payment_reference || null;
  order.paid_at = new Date().toISOString();
  save(data);
  return order;
}

function updateOrderStatus(id, status) {
  const data = load();
  const order = data.orders.find(o => o.id === Number(id));
  if (!order) return null;
  order.status = status;
  save(data);
  return order;
}

function markOrderBackupSent(id, channels = [], errors = []) {
  const data = load();
  const order = data.orders.find(o => o.id === Number(id));
  if (!order) return null;
  order.backup_sent_at = new Date().toISOString();
  order.backup_channels = channels;
  order.backup_errors = errors;
  save(data);
  return order;
}

function getStorageInfo() {
  return {
    dbPath: DB_PATH,
    legacyDbPath: LEGACY_DB_PATH,
    usingPersistentRenderPath: DB_PATH.replace(/\\/g, '/').startsWith('/var/data/'),
    exists: fs.existsSync(DB_PATH),
  };
}

module.exports = { createOrder, getAllOrders, getOrderById, setPayPalOrderId, markOrderPaid, updateOrderStatus, markOrderBackupSent, getStorageInfo };
