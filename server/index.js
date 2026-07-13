const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./config');
const db = require('./db');
const { catalog, bySku, getProductFamily } = require('./products');
const { requireAdmin } = require('./auth');
const { buildPackingSlip, buildContentsLabel } = require('./labels');
const { isPayPalConfigured, createPayPalOrder, capturePayPalOrder } = require('./paypal');

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
  res.json({
    siteName: config.SITE_NAME,
    products: catalog,
    packagingFee: config.PACKAGING_FEE,
    shippingFee: config.SHIPPING_FEE,
    orderFeeRate: config.ORDER_FEE_RATE,
  });
});

app.get('/api/product', (req, res) => {
  const family = getProductFamily({ sku: req.query.sku, slug: req.query.slug });
  if (!family) return res.status(404).json({ error: 'Product not found' });
  res.json({ siteName: config.SITE_NAME, ...family });
});

// Clean product URLs, e.g. /product/bpc-157 -- serves the same page as
// product.html, which reads the slug from the URL to fetch the right product.
app.get('/product/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'product.html'));
});

// Looks up a discount code without exposing the full code list to the client.
function resolveDiscountCode(code) {
  if (!code) return null;
  const rate = config.DISCOUNT_CODES[String(code).trim().toUpperCase()];
  return rate != null ? { code: String(code).trim().toUpperCase(), rate } : null;
}

app.get('/api/discount-code', (req, res) => {
  const match = resolveDiscountCode(req.query.code);
  if (!match) return res.json({ valid: false });
  res.json({ valid: true, code: match.code, percentOff: Math.round(match.rate * 100) });
});

// ---------- Checkout (guest, no account) ----------
function prepareCheckout(body) {
  const { items: rawItems, buyer, certified, discountCode, paymentMethod } = body || {};

  if (certified !== true) {
    return { error: 'You must certify research/business use to place an order.' };
  }
  if (!buyer || !buyer.name || !buyer.email || !buyer.address1 || !buyer.city || !buyer.state || !buyer.zip) {
    return { error: 'Name, email, and full shipping address are required.' };
  }

  const normalizedPaymentMethod = paymentMethod === 'paypal' ? 'paypal' : 'manual';

  const items = Array.isArray(rawItems) ? rawItems : [];
  if (items.length === 0) return { error: 'Cart is empty.' };

  let subtotal = 0;
  const resolved = [];
  for (const item of items) {
    const product = bySku[item.sku];
    const qty = parseInt(item.quantity, 10);
    if (!product || !qty || qty < 1) {
      return { error: `Invalid item: ${item.sku}` };
    }
    subtotal += product.price * qty;
    resolved.push({ sku: product.sku, name: product.name, spec: product.spec, quantity: qty, unit_price: product.price });
  }
  subtotal = Math.round(subtotal * 100) / 100;

  const discountMatch = resolveDiscountCode(discountCode);
  const discountAmount = discountMatch ? Math.round(subtotal * discountMatch.rate * 100) / 100 : 0;

  const packagingFee = config.PACKAGING_FEE;
  const shippingFee = config.SHIPPING_FEE;
  const feeBase = Math.max(0, subtotal - discountAmount + packagingFee + shippingFee);
  const orderFee = Math.round(feeBase * config.ORDER_FEE_RATE * 100) / 100;
  const total = Math.round((feeBase + orderFee) * 100) / 100;

  return {
    orderInput: {
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
      shippingFee,
      orderFee,
      orderFeeRate: config.ORDER_FEE_RATE,
      discountCode: discountMatch ? discountMatch.code : null,
      discountAmount,
      total,
      paymentMethod: normalizedPaymentMethod,
    },
  };
}

app.get('/api/paypal/config', (req, res) => {
  res.json({
    enabled: isPayPalConfigured(),
    clientId: isPayPalConfigured() ? config.PAYPAL_CLIENT_ID : null,
    currency: config.PAYPAL_CURRENCY,
    environment: config.PAYPAL_ENV,
  });
});

app.post('/api/paypal/create-order', async (req, res) => {
  if (!isPayPalConfigured()) {
    return res.status(503).json({ error: 'PayPal is not configured yet.' });
  }

  const prepared = prepareCheckout(req.body);
  if (prepared.error) return res.status(400).json({ error: prepared.error });

  try {
    const order = db.createOrder({ ...prepared.orderInput, paymentProvider: 'paypal' });
    const paypalOrder = await createPayPalOrder(order);
    res.json({ ok: true, orderId: order.id, paypalOrderId: paypalOrder.id, total: order.total });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not start PayPal checkout.' });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  const { paypalOrderId, orderId } = req.body || {};
  if (!paypalOrderId || !orderId) {
    return res.status(400).json({ error: 'Missing PayPal order details.' });
  }

  const order = db.getOrderById(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  try {
    const capture = await capturePayPalOrder(paypalOrderId);
    if (capture.status !== 'COMPLETED') {
      return res.status(400).json({ error: `PayPal payment was not completed. Status: ${capture.status}` });
    }
    db.markOrderPaid(orderId, paypalOrderId);
    res.json({ ok: true, orderId: Number(orderId), paypalOrderId, total: order.total, message: 'Payment received. Order is confirmed.' });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not confirm PayPal payment.' });
  }
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
