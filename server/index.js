const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./config');
const db = require('./db');
const { catalog, bySku } = require('./products');
const { requireAdmin } = require('./auth');
const { buildPackingSlip, buildContentsLabel } = require('./labels');

const app = express();
app.use(express.json());
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Public catalog ----------
app.get('/api/catalog', (req, res) => {
  res.json({ siteName: config.SITE_NAME, products: catalog });
});

// ---------- Checkout (guest, no account) ----------
app.post('/api/checkout', (req, res) => {
  const { items: rawItems, buyer, certified } = req.body || {};

  if (certified !== true) {
    return res.status(400).json({ error: 'You must certify research/business use to place an order.' });
  }
  if (!buyer || !buyer.name || !buyer.email || !buyer.address1 || !buyer.city || !buyer.state || !buyer.zip) {
    return res.status(400).json({ error: 'Name, email, and full shipping address are required.' });
  }

  const items = Array.isArray(rawItems) ? rawItems : [];
  if (items.length === 0) return res.status(400).json({ error: 'Cart is empty.' });

  let subtotal = 0;
  const resolved = [];
  for (const item of items) {
    const product = bySku[item.sku];
    const qty = parseInt(item.quantity, 10);
    if (!product || !qty || qty < 1) {
      return res.status(400).json({ error: `Invalid item: ${item.sku}` });
    }
    subtotal += product.price * qty;
    resolved.push({ sku: product.sku, name: product.name, spec: product.spec, quantity: qty, unit_price: product.price });
  }
  subtotal = Math.round(subtotal * 100) / 100;
  const packagingFee = config.PACKAGING_FEE;
  const total = Math.round((subtotal + packagingFee) * 100) / 100;

  const order = db.createOrder({
    buyer: {
      name: buyer.name,
      email: buyer.email,
      address1: buyer.address1,
      address2: buyer.address2 || '',
      city: buyer.city,
      state: buyer.state,
      zip: buyer.zip,
      country: buyer.country || 'US',
    },
    certifiedAt: new Date().toISOString(),
    items: resolved,
    subtotal,
    packagingFee,
    total,
  });

  res.json({
    ok: true,
    orderId: order.id,
    total,
    message: 'Order received and is pending payment instructions. Our team will follow up with how to complete payment.',
  });
});

// ---------- Admin ----------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== config.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong admin password.' });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json({ orders: db.getAllOrders() });
});

app.post('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['pending_payment', 'paid', 'fulfilled', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const order = db.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ ok: true });
});

app.get('/api/admin/orders/:id/packing-slip.pdf', requireAdmin, (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).send('Not found');
  buildPackingSlip(order, order.items, res);
});

app.get('/api/admin/orders/:id/contents-label.pdf', requireAdmin, (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).send('Not found');
  buildContentsLabel(order, order.items, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`${config.SITE_NAME} running on http://localhost:${PORT}`));
