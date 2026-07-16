const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./config');
const db = require('./db');
const { catalog, bySku, costBySku, getProductFamily } = require('./products');
const { requireAdmin } = require('./auth');
const { buildPackingSlip, buildContentsLabel } = require('./labels');
const { isPayPalConfigured, createPayPalOrder, capturePayPalOrder } = require('./paypal');
const { sendOrderBackup } = require('./notifications');

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
    const paidOrder = db.markOrderPaid(orderId, paypalOrderId);
    await backupOrderIfNeeded(paidOrder, 'paypal_capture');
    res.json({ ok: true, orderId: Number(orderId), paypalOrderId, total: paidOrder.total, message: 'Payment received. Order is confirmed.' });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not confirm PayPal payment.' });
  }
});

async function backupOrderIfNeeded(order, source) {
  if (!order || order.backup_sent_at) return;
  try {
    const result = await sendOrderBackup(order, source);
    if (result.channels.length || result.errors.length) {
      db.markOrderBackupSent(order.id, result.channels, result.errors);
    }
    if (result.errors.length) console.error('Order backup errors:', result.errors.join('; '));
  } catch (err) {
    console.error('Order backup failed:', err.message || err);
  }
}

// ---------- Admin ----------

function orderFinancialSummary(order) {
  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.discount_amount || 0);
  const shipping = Number(order.shipping_fee || 0);
  const processing = Number(order.order_fee || 0);
  const totalSpent = Number(order.total || 0);
  const discountRate = subtotal > 0 ? discount / subtotal : 0;
  let cogs = 0;
  let productRevenueAfterDiscount = 0;

  (order.items || []).forEach(item => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price || 0);
    const lineRevenueBeforeDiscount = unitPrice * quantity;
    const allocatedDiscount = Math.round(lineRevenueBeforeDiscount * discountRate * 100) / 100;
    productRevenueAfterDiscount += lineRevenueBeforeDiscount - allocatedDiscount;
    cogs += Number(costBySku[item.sku] || 0) * quantity;
  });

  productRevenueAfterDiscount = Math.round(productRevenueAfterDiscount * 100) / 100;
  cogs = Math.round(cogs * 100) / 100;
  const grossProfit = Math.round((productRevenueAfterDiscount - cogs) * 100) / 100;
  const grossMargin = productRevenueAfterDiscount > 0 ? Math.round((grossProfit / productRevenueAfterDiscount) * 1000) / 10 : 0;

  return {
    beforeCodeTotal: Math.round((subtotal + shipping + processing) * 100) / 100,
    subtotal,
    discount,
    shipping,
    processing,
    totalSpent,
    productRevenueAfterDiscount,
    cogs,
    grossProfit,
    grossMargin,
  };
}


app.get('/api/admin/profit', requireAdmin, (req, res) => {
  const countedStatuses = ['paid', 'fulfilled'];
  const orders = db.getAllOrders().filter(order => countedStatuses.includes(order.status));
  const lines = [];
  const totals = {
    orderCount: orders.length,
    vialCount: 0,
    totalCollected: 0,
    productRevenue: 0,
    discounts: 0,
    shippingCollected: 0,
    processingCollected: 0,
    cogs: 0,
    grossProfit: 0,
    grossMargin: 0,
  };

  orders.forEach(order => {
    const subtotal = Number(order.subtotal || 0);
    const discount = Number(order.discount_amount || 0);
    const discountRate = subtotal > 0 ? discount / subtotal : 0;
    totals.totalCollected += Number(order.total || 0);
    totals.discounts += discount;
    totals.shippingCollected += Number(order.shipping_fee || 0);
    totals.processingCollected += Number(order.order_fee || 0);

    (order.items || []).forEach(item => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const lineRevenueBeforeDiscount = unitPrice * quantity;
      const allocatedDiscount = Math.round(lineRevenueBeforeDiscount * discountRate * 100) / 100;
      const lineRevenue = Math.round((lineRevenueBeforeDiscount - allocatedDiscount) * 100) / 100;
      const unitCost = Number(costBySku[item.sku] || 0);
      const lineCost = Math.round(unitCost * quantity * 100) / 100;
      const lineProfit = Math.round((lineRevenue - lineCost) * 100) / 100;

      totals.vialCount += quantity;
      totals.productRevenue += lineRevenue;
      totals.cogs += lineCost;
      lines.push({
        orderId: order.id,
        status: order.status,
        sku: item.sku,
        name: item.name,
        spec: item.spec,
        quantity,
        unitPrice,
        unitCost,
        revenue: lineRevenue,
        cogs: lineCost,
        grossProfit: lineProfit,
        margin: lineRevenue > 0 ? Math.round((lineProfit / lineRevenue) * 1000) / 10 : 0,
      });
    });
  });

  totals.productRevenue = Math.round(totals.productRevenue * 100) / 100;
  totals.discounts = Math.round(totals.discounts * 100) / 100;
  totals.shippingCollected = Math.round(totals.shippingCollected * 100) / 100;
  totals.processingCollected = Math.round(totals.processingCollected * 100) / 100;
  totals.totalCollected = Math.round(totals.totalCollected * 100) / 100;
  totals.cogs = Math.round(totals.cogs * 100) / 100;
  totals.grossProfit = Math.round((totals.productRevenue - totals.cogs) * 100) / 100;
  totals.grossMargin = totals.productRevenue > 0 ? Math.round((totals.grossProfit / totals.productRevenue) * 1000) / 10 : 0;

  res.json({ totals, lines: lines.sort((a, b) => b.grossProfit - a.grossProfit) });
});

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

app.get('/api/admin/storage', requireAdmin, (req, res) => {
  res.json(db.getStorageInfo());
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const orders = db.getAllOrders().map(order => ({
    ...order,
    financials: orderFinancialSummary(order),
  }));
  res.json({ orders });
});

app.post('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['pending_payment', 'paid', 'fulfilled', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const order = db.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (['paid', 'fulfilled'].includes(status)) {
    await backupOrderIfNeeded(order, 'admin_status_' + status);
  }
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

