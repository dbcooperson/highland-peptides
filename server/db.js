// Simple JSON-file-backed store. No native dependencies, so it deploys anywhere
// Node runs (Render, Railway, a VPS, etc.) without a compile step.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { orders: [], nextOrderId: 1 };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(data) {
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

module.exports = { createOrder, getAllOrders, getOrderById, markOrderPaid, updateOrderStatus };
