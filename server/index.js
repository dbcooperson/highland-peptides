const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const config = require('./config');
const db = require('./db');
const { catalog, bySku, costBySku, getProductFamily, priceAudit } = require('./products');
const { requireAdmin } = require('./auth');
const { buildPackingSlip, buildContentsLabel } = require('./labels');
const { isPayPalConfigured, createPayPalOrder, capturePayPalOrder } = require('./paypal');
const { sendOrderBackup, sendCustomerPaymentInstructions } = require('./notifications');

const isProductionRuntime = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production');
if (isProductionRuntime) {
  if (!process.env.ADMIN_PASSWORD || config.ADMIN_PASSWORD === 'change-me-before-launch') {
    throw new Error('ADMIN_PASSWORD must be set before running in production.');
  }
  if (!process.env.SESSION_SECRET || config.SESSION_SECRET === 'change-me-session-secret') {
    throw new Error('SESSION_SECRET must be set before running in production.');
  }
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.use(express.json({ limit: '25kb' }));
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'hp.sid',
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: isProductionRuntime,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  fallthrough: true,
}));

// ---------- Public catalog ----------
app.get('/api/catalog', (req, res) => {
  res.json({
    siteName: config.SITE_NAME,
    products: catalog,
    packagingFee: config.PACKAGING_FEE,
    shippingFee: config.SHIPPING_FEE,
    orderFeeRate: config.ORDER_FEE_RATE,
    altPaymentDiscountRate: config.ALT_PAYMENT_DISCOUNT_RATE,
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

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function cleanPostal(value) {
  return cleanText(value, 20).toUpperCase();
}

function cleanCountry(value) {
  const country = cleanText(value || 'US', 2).toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : 'US';
}

const checkoutAttempts = new Map();
const CHECKOUT_WINDOW_MS = 15 * 60 * 1000;
const CHECKOUT_MAX_ATTEMPTS = 30;

function rateLimitMap(map, key, maxAttempts, windowMs) {
  const now = Date.now();
  const current = map.get(key);
  const attempt = current && current.firstAt + windowMs > now ? current : { count: 0, firstAt: now };
  attempt.count += 1;
  map.set(key, attempt);
  return attempt.count <= maxAttempts;
}

function checkCheckoutRateLimit(req, res, next) {
  if (!rateLimitMap(checkoutAttempts, clientIp(req), CHECKOUT_MAX_ATTEMPTS, CHECKOUT_WINDOW_MS)) {
    return res.status(429).json({ error: 'Too many checkout attempts. Please try again later.' });
  }
  next();
}

// ---------- Checkout (guest, no account) ----------
function prepareCheckout(body) {
  const { items: rawItems, buyer, certified, discountCode, paymentMethod, cryptoAsset } = body || {};

  if (certified !== true) {
    return { error: 'You must certify research/business use to place an order.' };
  }
  const cleanBuyer = buyer ? {
    name: cleanText(buyer.name, 100),
    email: cleanEmail(buyer.email),
    address1: cleanText(buyer.address1, 160),
    address2: cleanText(buyer.address2, 160),
    city: cleanText(buyer.city, 80),
    state: cleanText(buyer.state, 40).toUpperCase(),
    zip: cleanPostal(buyer.zip),
    country: cleanCountry(buyer.country),
  } : null;

  if (!cleanBuyer || !cleanBuyer.name || !cleanBuyer.email || !cleanBuyer.address1 || !cleanBuyer.city || !cleanBuyer.state || !cleanBuyer.zip) {
    return { error: 'Name, valid email, and full shipping address are required.' };
  }

  const normalizedPaymentMethod = ['paypal', 'crypto'].includes(paymentMethod) ? paymentMethod : 'manual';
  const normalizedCryptoAsset = normalizedPaymentMethod === 'crypto' && cryptoAsset === 'USDC' ? 'USDC' : 'BTC';

  const items = Array.isArray(rawItems) ? rawItems : [];
  if (items.length === 0) return { error: 'Cart is empty.' };
  if (items.length > 50) return { error: 'Cart has too many line items.' };

  let subtotal = 0;
  const resolved = [];
  for (const item of items) {
    const product = bySku[item.sku];
    const qty = parseInt(item.quantity, 10);
    if (!product || !qty || qty < 1 || qty > 99) {
      return { error: `Invalid item: ${item.sku}` };
    }
    subtotal += product.price * qty;
    resolved.push({ sku: product.sku, name: product.name, spec: product.spec, quantity: qty, unit_price: product.price });
  }
  subtotal = Math.round(subtotal * 100) / 100;

  const discountMatch = resolveDiscountCode(discountCode);
  const codeDiscount = discountMatch ? subtotal * discountMatch.rate : 0;
  const altPaymentDiscount = normalizedPaymentMethod === 'crypto' ? subtotal * config.ALT_PAYMENT_DISCOUNT_RATE : 0;
  const discountAmount = Math.round((codeDiscount + altPaymentDiscount) * 100) / 100;
  const discountLabel = [discountMatch ? discountMatch.code : null, altPaymentDiscount ? 'CRYPTO5' : null].filter(Boolean).join('+') || null;

  const packagingFee = config.PACKAGING_FEE;
  const shippingFee = config.SHIPPING_FEE;
  const feeBase = Math.max(0, subtotal - discountAmount + packagingFee + shippingFee);
  const orderFee = Math.round(feeBase * config.ORDER_FEE_RATE * 100) / 100;
  const total = Math.round((feeBase + orderFee) * 100) / 100;

  return {
    orderInput: {
      buyer: cleanBuyer,
      certifiedAt: new Date().toISOString(),
      items: resolved,
      subtotal,
      packagingFee,
      shippingFee,
      orderFee,
      orderFeeRate: config.ORDER_FEE_RATE,
      discountCode: discountLabel,
      discountAmount,
      total,
      paymentMethod: normalizedPaymentMethod,
      cryptoAsset: normalizedCryptoAsset,
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

app.post('/api/paypal/create-order', checkCheckoutRateLimit, async (req, res) => {
  if (!isPayPalConfigured()) {
    return res.status(503).json({ error: 'PayPal is not configured yet.' });
  }

  const prepared = prepareCheckout(req.body);
  if (prepared.error) return res.status(400).json({ error: prepared.error });

  try {
    const order = db.createOrder({ ...prepared.orderInput, paymentProvider: 'paypal' });
    const paypalOrder = await createPayPalOrder(order);
    db.setPayPalOrderId(order.id, paypalOrder.id);
    res.json({ ok: true, orderId: order.id, paypalOrderId: paypalOrder.id, total: order.total });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not start PayPal checkout.' });
  }
});

// Manual/invoice checkout fallback -- records the order as pending_payment and
// notifies us (Discord/email backup) so we can follow up with payment
// instructions directly. Used when PayPal is down/restricted, or as a plain
// alternative to it.
app.post('/api/checkout', checkCheckoutRateLimit, async (req, res) => {
  const prepared = prepareCheckout(req.body);
  if (prepared.error) return res.status(400).json({ error: prepared.error });

  const { paymentMethod, cryptoAsset, ...orderInput } = prepared.orderInput;
  const order = db.createOrder({ ...orderInput, paymentProvider: paymentMethod, cryptoAsset });
  await backupOrderIfNeeded(order, `${paymentMethod}_submit`);
  await sendCustomerInstructionsIfNeeded(order);

  const response = {
    ok: true,
    orderId: order.id,
    total: order.total,
    message: 'Checkout request received. We will email payment instructions shortly.',
  };

  if (paymentMethod === 'crypto') {
    const address = cryptoAsset === 'USDC' ? config.CRYPTO_WALLETS.USDC_ERC20 : config.CRYPTO_WALLETS.BTC;
    const network = cryptoAsset === 'USDC' ? 'Ethereum mainnet (ERC-20) only' : 'Bitcoin network';
    response.crypto = { asset: cryptoAsset, address, network, reference: `HP-${order.id}` };
    response.message = `Order received. Send ${cryptoAsset} to the address shown to complete payment.`;
  }

  res.json(response);
});

app.post('/api/orders/:id/confirm-crypto', checkCheckoutRateLimit, (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.payment_provider !== 'crypto') return res.status(400).json({ error: 'Order is not a crypto order.' });

  const email = cleanEmail(req.body && req.body.email);
  if (!email || email !== order.buyer.email) {
    return res.status(403).json({ error: 'Email does not match this order.' });
  }

  const txid = cleanText(req.body && req.body.txid, 200);
  if (!txid || txid.length < 8) {
    return res.status(400).json({ error: 'Enter a valid transaction ID.' });
  }
  if (db.isTxidUsed(txid)) {
    return res.status(409).json({ error: 'This transaction ID has already been submitted for another order.' });
  }

  db.setPaymentReference(order.id, txid);
  res.json({ ok: true, message: "Thanks - we'll verify this on-chain and confirm your order shortly." });
});


function validatePayPalCaptureForOrder(capture, order, paypalOrderId) {
  if (!order || order.payment_provider !== 'paypal') return 'Order is not a PayPal order.';
  if (order.status !== 'pending_payment') return 'Order is not pending payment.';
  if (!order.paypal_order_id || order.paypal_order_id !== paypalOrderId) return 'PayPal order does not match this cart order.';

  const unit = Array.isArray(capture.purchase_units) ? capture.purchase_units[0] : null;
  const referenceOk = unit && unit.reference_id === `HP-${order.id}`;
  const capturePayment = unit && unit.payments && Array.isArray(unit.payments.captures) ? unit.payments.captures[0] : null;
  const amount = capturePayment && capturePayment.amount ? capturePayment.amount : null;
  const expectedTotal = Number(order.total || 0).toFixed(2);

  if (!referenceOk) return 'PayPal reference does not match this order.';
  if (!amount || amount.currency_code !== config.PAYPAL_CURRENCY || amount.value !== expectedTotal) {
    return 'PayPal payment amount does not match this order.';
  }
  if (capturePayment && capturePayment.status && capturePayment.status !== 'COMPLETED') {
    return `PayPal capture was not completed. Status: ${capturePayment.status}`;
  }
  return null;
}

app.post('/api/paypal/capture-order', checkCheckoutRateLimit, async (req, res) => {
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
    const validationError = validatePayPalCaptureForOrder(capture, order, paypalOrderId);
    if (validationError) return res.status(400).json({ error: validationError });
    const paidOrder = db.markOrderPaid(orderId, paypalOrderId);
    await backupOrderIfNeeded(paidOrder, 'paypal_capture');
    res.json({ ok: true, orderId: Number(orderId), paypalOrderId, total: paidOrder.total, message: 'Payment received. Order is confirmed.' });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not confirm PayPal payment.' });
  }
});

async function sendCustomerInstructionsIfNeeded(order) {
  if (!order || order.payment_provider === 'paypal') return;
  try {
    await sendCustomerPaymentInstructions(order);
  } catch (err) {
    console.error('Customer payment instructions email failed:', err.message || err);
  }
}

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


const adminLoginAttempts = new Map();
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 6;

function clientIp(req) {
  return req.ip || req.get('x-forwarded-for') || req.socket.remoteAddress || 'unknown';
}

function safePasswordMatch(input, expected) {
  const inputHash = crypto.createHash('sha256').update(String(input || '')).digest();
  const expectedHash = crypto.createHash('sha256').update(String(expected || '')).digest();
  return crypto.timingSafeEqual(inputHash, expectedHash);
}

function checkAdminLoginLimit(req, res, next) {
  const now = Date.now();
  const key = clientIp(req);
  const attempt = adminLoginAttempts.get(key);
  if (attempt && attempt.blockedUntil && attempt.blockedUntil > now) {
    return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  }
  next();
}

function recordAdminLoginFailure(req) {
  const now = Date.now();
  const key = clientIp(req);
  const current = adminLoginAttempts.get(key);
  const attempt = current && current.firstAt + ADMIN_LOGIN_WINDOW_MS > now
    ? current
    : { count: 0, firstAt: now, blockedUntil: 0 };
  attempt.count += 1;
  if (attempt.count >= ADMIN_LOGIN_MAX_ATTEMPTS) {
    attempt.blockedUntil = now + ADMIN_LOGIN_WINDOW_MS;
  }
  adminLoginAttempts.set(key, attempt);
}

function resetAdminLoginFailures(req) {
  adminLoginAttempts.delete(clientIp(req));
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

app.post('/api/admin/login', checkAdminLoginLimit, (req, res) => {
  const { password } = req.body || {};
  if (!safePasswordMatch(password, config.ADMIN_PASSWORD)) {
    recordAdminLoginFailure(req);
    return res.status(401).json({ error: 'Wrong admin password.' });
  }
  resetAdminLoginFailures(req);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start admin session.' });
    req.session.isAdmin = true;
    res.json({ ok: true });
  });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('hp.sid');
    res.json({ ok: true });
  });
});


app.get('/api/admin/launch-checks', requireAdmin, (req, res) => {
  const storage = db.getStorageInfo();
  const paidOrders = db.getAllOrders().filter(order => ['paid', 'fulfilled'].includes(order.status));
  const checks = [
    {
      key: 'storage',
      label: 'Persistent order storage',
      ok: storage.usingPersistentRenderPath,
      detail: storage.usingPersistentRenderPath
        ? 'Orders are configured for /var/data/db.json. Still confirm Render disk is mounted at /var/data.'
        : 'Orders are not using /var/data. Add/confirm a Render Persistent Disk before taking live orders.',
    },
    {
      key: 'paypal',
      label: 'PayPal credentials',
      ok: isPayPalConfigured() && config.PAYPAL_ENV === 'live',
      detail: isPayPalConfigured()
        ? `PayPal is configured in ${config.PAYPAL_ENV} mode.`
        : 'PayPal credentials are missing, checkout cannot take online payment yet.',
    },
    {
      key: 'discord',
      label: 'Discord order backup',
      ok: Boolean(config.DISCORD_ORDER_WEBHOOK_URL),
      detail: config.DISCORD_ORDER_WEBHOOK_URL
        ? 'Discord webhook is configured for paid-order backups.'
        : 'Add DISCORD_ORDER_WEBHOOK_URL in Render to receive paid orders in Discord.',
    },
    {
      key: 'email',
      label: 'Email order backup',
      ok: Boolean(config.SMTP_HOST && config.ORDER_BACKUP_EMAIL_TO),
      detail: config.SMTP_HOST && config.ORDER_BACKUP_EMAIL_TO
        ? 'SMTP email backup is configured.'
        : 'Optional: add SMTP settings if you want email copies too. Cloudflare routing alone is inbound-only.',
    },
    {
      key: 'price-audit',
      label: 'Catalog price sanity',
      ok: priceAudit().issueCount === 0,
      detail: priceAudit().issueCount === 0
        ? `No bad price ladders found across ${priceAudit().productCount} products.`
        : `${priceAudit().issueCount} price ladder issue(s) need review.`,
    },
    {
      key: 'test-order',
      label: 'Live payment smoke test',
      ok: paidOrders.length > 0,
      detail: paidOrders.length > 0
        ? `${paidOrders.length} paid/fulfilled order(s) recorded.`
        : 'Place a small live test order after deploy, confirm it appears here, then redeploy and confirm it remains.',
    },
  ];
  res.json({ checks, priceAudit: priceAudit(), storage });
});

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function ordersCsv(orders) {
  const headers = ['Order','Status','Buyer','Email','Ship To','Items','Code','Discount','Total','Notes','Created'];
  const rows = orders.map(order => {
    const buyer = order.buyer || {};
    const address = [buyer.address1, buyer.address2, buyer.city, buyer.state, buyer.zip].filter(Boolean).join(', ');
    const items = (order.items || []).map(item => String(item.quantity || 0) + 'x ' + item.name + ' ' + item.spec + ' (' + item.sku + ')').join('; ');
    return [order.id, order.status, buyer.name, buyer.email, address, items, order.discount_code || '', order.discount_amount || 0, order.total || 0, order.notes || '', order.created_at].map(csvEscape).join(',');
  });
  return [headers.map(csvEscape).join(','), ...rows].join('\n');
}
app.get('/api/admin/storage', requireAdmin, (req, res) => {
  res.json(db.getStorageInfo());
});

app.get('/api/admin/orders.csv', requireAdmin, (req, res) => {
  const orders = db.getAllOrders();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="highland-orders.csv"');
  res.send(ordersCsv(orders));
});

app.post('/api/admin/orders/:id/notes', requireAdmin, (req, res) => {
  const notes = cleanText(req.body && req.body.notes, 2000);
  const order = db.updateOrderNotes(req.params.id, notes);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ ok: true, notes: order.notes || '' });
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


