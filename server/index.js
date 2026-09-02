// Load local secrets for development. Deployment-provided environment variables
// keep precedence, and a missing .env file is expected in production.
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const config = require('./config');
const db = require('./db');
const { catalog, bySku, costBySku, getProductFamily, priceAudit } = require('./products');
const {
  ADMIN_REMEMBER_COOKIE,
  createAdminRememberToken,
  adminRememberCookieOptions,
  restoreAdminFromRememberCookie,
  requireAdmin,
} = require('./auth');
const { buildPackingSlip, buildContentsLabel } = require('./labels');
const { isPayPalConfigured, createPayPalOrder, capturePayPalOrder } = require('./paypal');
const { sendOrderBackup, sendCustomerPaymentInstructions, sendPaymentReminder, sendTrackingEmail, isCustomerEmailConfigured } = require('./notifications');
const { createBitcoinMonitor } = require('./btc-monitor');
const analytics = require('./analytics');
const coa = require('./coa');
const { applyBundlePromotion, publicPromotion } = require('./promotions');
const { startPaymentReminderScheduler } = require('./reminders');
const { registerAccountRoutes } = require('./accounts');

const CONFIRMED_ORDER_STATUSES = new Set(['paid', 'pending_tracking', 'fulfilled']);

const isProductionRuntime = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.NODE_ENV === 'production');
if (isProductionRuntime) {
  if ((!process.env.ADMIN_PASSWORD_SHA256 && !process.env.ADMIN_PASSWORD) || (!config.ADMIN_PASSWORD_SHA256 && config.ADMIN_PASSWORD === 'change-me-before-launch')) {
    throw new Error('ADMIN_PASSWORD_SHA256 or ADMIN_PASSWORD must be set before running in production.');
  }
  if (!process.env.SESSION_SECRET || config.SESSION_SECRET === 'change-me-session-secret') {
    throw new Error('SESSION_SECRET must be set before running in production.');
  }
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const releaseId = process.env.RENDER_GIT_COMMIT
  || process.env.SOURCE_VERSION
  || 'local-development';
const startedAt = new Date().toISOString();

app.use((req, res, next) => {
  res.setHeader('X-Highland-Release', releaseId);
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
app.use('/api/admin', restoreAdminFromRememberCookie(config));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    if (path.extname(filePath).toLowerCase() === '.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
  fallthrough: true,
}));

app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    release: releaseId,
    startedAt,
  });
});

// ---------- Public catalog ----------
app.get('/api/catalog', (req, res) => {
  const coaBySku = coa.recordsForSkus(catalog.map(product => product.sku));
  res.json({
    siteName: config.SITE_NAME,
    products: catalog.map(product => ({ ...product, coa: coaBySku[product.sku] || null })),
    packagingFee: config.PACKAGING_FEE,
    shippingFee: config.SHIPPING_FEE,
    internationalShippingFee: config.INTERNATIONAL_SHIPPING_FEE,
    shippingOptions: [
      { id: 'domestic', label: 'U.S. shipping', price: config.SHIPPING_FEE },
      { id: 'international', label: 'International shipping', price: config.INTERNATIONAL_SHIPPING_FEE },
    ],
    orderFeeRate: config.ORDER_FEE_RATE,
    altPaymentDiscountRate: config.ALT_PAYMENT_DISCOUNT_RATE,
    accountCryptoDiscountRate: config.ACCOUNT_CRYPTO_DISCOUNT_RATE,
    promotion: publicPromotion(),
  });
});

app.get('/api/product', (req, res) => {
  const family = getProductFamily({ sku: req.query.sku, slug: req.query.slug });
  if (!family) return res.status(404).json({ error: 'Product not found' });
  const coaBySku = coa.recordsForSkus(family.variants.map(variant => variant.sku));
  res.json({ siteName: config.SITE_NAME, ...family, coaBySku });
});

const analyticsAttempts = new Map();
const ANALYTICS_WINDOW_MS = 15 * 60 * 1000;
const ANALYTICS_MAX_ATTEMPTS = 250;
const PUBLIC_ANALYTICS_EVENTS = new Set([
  'page_view',
  'product_view',
  'add_to_cart',
  'checkout_start',
  'checkout_error',
  'shipping_info_added',
  'payment_method_selected',
  'payment_failed',
]);

app.post('/api/analytics/event', (req, res) => {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const current = analyticsAttempts.get(key);
  const attempt = current && current.firstAt + ANALYTICS_WINDOW_MS > now
    ? current
    : { count: 0, firstAt: now };
  attempt.count += 1;
  analyticsAttempts.set(key, attempt);
  if (attempt.count > ANALYTICS_MAX_ATTEMPTS) return res.status(204).end();

  const input = req.body || {};
  const type = cleanText(input.type, 40);
  if (!PUBLIC_ANALYTICS_EVENTS.has(type)) return res.status(204).end();
  analytics.recordEvent({
    type,
    visitorId: cleanText(input.visitorId, 128),
    sessionId: cleanText(input.sessionId, 128),
    path: cleanText(input.path, 180),
    source: cleanText(input.source, 100),
    sku: cleanText(input.sku, 40),
    productName: cleanText(input.productName, 100),
    quantity: Math.max(1, Math.min(99, Number(input.quantity || 1))),
    stage: cleanText(input.stage, 40),
    reason: cleanText(input.reason, 60),
    paymentMethod: cleanText(input.paymentMethod, 30),
    checkoutAttemptId: cleanText(input.checkoutAttemptId, 128),
  });
  res.status(204).end();
});

// Clean product URLs, e.g. /product/bpc-157 -- serves the same page as
// product.html, which reads the slug from the URL to fetch the right product.
app.get('/product/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'product.html'));
});

// Looks up a discount code without exposing the full code list to the client.
function resolveDiscountCode(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  const rate = config.DISCOUNT_CODES[normalized];
  if (rate != null) return { code: normalized, rate, type: 'promotion', referralAccountId: null };
  const referralAccount = db.getAccountByReferralCode(normalized);
  return referralAccount ? {
    code: normalized,
    rate: config.REFERRAL_DISCOUNT_RATE,
    type: 'referral',
    referralAccountId: referralAccount.id,
    referralEmail: referralAccount.email,
  } : null;
}

app.get('/api/discount-code', (req, res) => {
  const match = resolveDiscountCode(req.query.code);
  if (!match) return res.json({ valid: false });
  res.json({ valid: true, code: match.code, percentOff: Math.round(match.rate * 100), referral: match.type === 'referral' });
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

registerAccountRoutes(app, requireAdmin);

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

// ---------- Checkout (guest checkout remains available; accounts are optional) ----------
function prepareCheckout(body, accountId = null) {
  const { items: rawItems, buyer, certified, discountCode, paymentMethod, cryptoAsset, shippingMethod, paymentPolicyAccepted, applyStoreCredit } = body || {};

  if (certified !== true) {
    return { error: 'You must certify research/business use to place an order.' };
  }
  if (paymentPolicyAccepted !== true) {
    return { error: 'You must confirm the exact-payment and 72-hour mismatch policy before payment.' };
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

  if (!cleanBuyer || !cleanBuyer.name || !cleanBuyer.email || !cleanBuyer.address1 || !cleanBuyer.city || !cleanBuyer.state || !cleanBuyer.zip || !cleanBuyer.country) {
    return { error: 'Name, valid email, destination country, and full shipping address are required.' };
  }

  const normalizedPaymentMethod = ['paypal', 'manual_paypal', 'crypto'].includes(paymentMethod) ? paymentMethod : 'manual_paypal';
  const normalizedCryptoAsset = normalizedPaymentMethod === 'crypto' && cryptoAsset === 'USDC' ? 'USDC' : 'BTC';

  const items = Array.isArray(rawItems) ? rawItems : [];
  if (items.length === 0) return { error: 'Cart is empty.' };
  if (items.length > 50) return { error: 'Cart has too many line items.' };

  let subtotal = 0;
  let promoEligibleSubtotal = 0;
  const resolved = [];
  for (const item of items) {
    const product = bySku[item.sku];
    const qty = parseInt(item.quantity, 10);
    if (!product || !qty || qty < 1 || qty > 99) {
      return { error: `Invalid item: ${item.sku}` };
    }
    const lineTotal = product.price * qty;
    subtotal += lineTotal;
    if (product.promoEligible !== false) promoEligibleSubtotal += lineTotal;
    resolved.push({ sku: product.sku, name: product.name, spec: product.spec, quantity: qty, unit_price: product.price, promo_eligible: product.promoEligible !== false });
  }
  subtotal = Math.round(subtotal * 100) / 100;
  promoEligibleSubtotal = Math.round(promoEligibleSubtotal * 100) / 100;

  const promotionResult = applyBundlePromotion(resolved, bySku);

  const discountMatch = resolveDiscountCode(discountCode);
  const customerAccount = accountId ? db.getAccountById(accountId) : null;
  if (discountMatch && discountMatch.type === 'referral') {
    const isSameAccount = customerAccount && customerAccount.id === discountMatch.referralAccountId;
    const isSameEmail = cleanBuyer.email === cleanEmail(discountMatch.referralEmail);
    if (isSameAccount || isSameEmail) {
      return { error: 'Referral codes are for other customers and cannot be used on your own order.' };
    }
  }
  if (normalizedPaymentMethod === 'crypto' && discountMatch) {
    return { error: 'Promo codes cannot be combined with the crypto discount. Remove the promo code or choose PayPal checkout.' };
  }
  const codeDiscount = discountMatch ? promoEligibleSubtotal * discountMatch.rate : 0;
  const altPaymentDiscount = normalizedPaymentMethod === 'crypto' ? subtotal * config.ALT_PAYMENT_DISCOUNT_RATE : 0;
  const memberCryptoDiscount = normalizedPaymentMethod === 'crypto' && customerAccount && customerAccount.verified_at ? subtotal * config.ACCOUNT_CRYPTO_DISCOUNT_RATE : 0;
  const discountAmount = Math.round((codeDiscount + altPaymentDiscount + memberCryptoDiscount) * 100) / 100;
  const discountLabel = discountMatch ? discountMatch.code : (memberCryptoDiscount ? 'CRYPTO5+MEMBER5' : (altPaymentDiscount ? 'CRYPTO5' : null));
  const availableCredit = customerAccount && customerAccount.verified_at
    ? Math.max(0, Number(customerAccount.credit_balance_cents || 0) / 100)
    : 0;
  const merchandiseAfterDiscount = Math.max(0, subtotal - discountAmount);
  const storeCreditAmount = applyStoreCredit === true
    ? Math.round(Math.min(availableCredit, merchandiseAfterDiscount) * 100) / 100
    : 0;

  const packagingFee = config.PACKAGING_FEE;
  const normalizedShippingMethod = shippingMethod === 'international' ? 'international' : 'domestic';
  if (normalizedShippingMethod === 'domestic' && cleanBuyer.country !== 'US') {
    return { error: 'Choose International shipping for destinations outside the U.S.' };
  }
  if (normalizedShippingMethod === 'international' && cleanBuyer.country === 'US') {
    return { error: 'International shipping is for destinations outside the U.S. Change the country or select U.S. shipping.' };
  }
  const shippingFee = normalizedShippingMethod === 'international' ? config.INTERNATIONAL_SHIPPING_FEE : config.SHIPPING_FEE;
  const feeBase = Math.max(0, subtotal - discountAmount - storeCreditAmount + packagingFee + shippingFee);
  const orderFee = Math.round(feeBase * config.ORDER_FEE_RATE * 100) / 100;
  const total = Math.round((feeBase + orderFee) * 100) / 100;

  return {
    analytics: {
      visitorId: cleanText(body && body.analyticsVisitorId, 128),
      sessionId: cleanText(body && body.analyticsSessionId, 128),
      checkoutAttemptId: cleanText(body && body.analyticsCheckoutAttemptId, 128),
    },
    orderInput: {
      buyer: cleanBuyer,
      certifiedAt: new Date().toISOString(),
      items: promotionResult.items,
      subtotal,
      promoEligibleSubtotal,
      packagingFee,
      shippingFee,
      shippingMethod: normalizedShippingMethod,
      orderFee,
      orderFeeRate: config.ORDER_FEE_RATE,
      discountCode: discountLabel,
      discountAmount,
      storeCreditAmount,
      customerAccountId: customerAccount && customerAccount.verified_at ? customerAccount.id : null,
      referralAccountId: discountMatch && discountMatch.type === 'referral' ? discountMatch.referralAccountId : null,
      referralCreditRate: discountMatch && discountMatch.type === 'referral' ? config.REFERRAL_CREDIT_RATE : 0,
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

  const prepared = prepareCheckout(req.body, req.session && req.session.accountId);
  if (prepared.error) {
    analytics.recordEvent({ type: 'checkout_error', stage: 'server_validation', reason: 'invalid_checkout', visitorId: cleanText(req.body && req.body.analyticsVisitorId, 128), sessionId: cleanText(req.body && req.body.analyticsSessionId, 128), checkoutAttemptId: cleanText(req.body && req.body.analyticsCheckoutAttemptId, 128) });
    return res.status(400).json({ error: prepared.error });
  }

  let order = null;
  try {
    order = db.createOrder({ ...prepared.orderInput, paymentProvider: 'paypal' });
    analytics.recordEvent({ type: 'order_created', ...prepared.analytics });
    const paypalOrder = await createPayPalOrder(order);
    db.setPayPalOrderId(order.id, paypalOrder.id);
    res.json({ ok: true, orderId: order.id, paypalOrderId: paypalOrder.id, total: order.total });
  } catch (err) {
    if (order && !order.paypal_order_id) db.deleteOrder(order.id);
    analytics.recordEvent({ type: 'payment_failed', paymentMethod: 'paypal', reason: 'create_order_failed', ...prepared.analytics });
    res.status(502).json({ error: err.message || 'Could not start PayPal checkout.' });
  }
});

// Manual/invoice checkout fallback -- records the order as pending_payment and
// notifies us (Discord/email backup) so we can follow up with payment
// instructions directly. Used when PayPal is down/restricted, or as a plain
// alternative to it.
app.post('/api/checkout', checkCheckoutRateLimit, async (req, res) => {
  const prepared = prepareCheckout(req.body, req.session && req.session.accountId);
  if (prepared.error) {
    analytics.recordEvent({ type: 'checkout_error', stage: 'server_validation', reason: 'invalid_checkout', visitorId: cleanText(req.body && req.body.analyticsVisitorId, 128), sessionId: cleanText(req.body && req.body.analyticsSessionId, 128), checkoutAttemptId: cleanText(req.body && req.body.analyticsCheckoutAttemptId, 128) });
    return res.status(400).json({ error: prepared.error });
  }

  const { paymentMethod, cryptoAsset, ...orderInput } = prepared.orderInput;
  let order;
  try {
    order = db.createOrder({ ...orderInput, paymentProvider: paymentMethod, cryptoAsset });
  } catch (err) {
    analytics.recordEvent({ type: 'checkout_error', stage: 'order_creation', reason: 'create_order_failed', ...prepared.analytics });
    return res.status(409).json({ error: err.message || 'Could not create the order.' });
  }
  analytics.recordEvent({ type: 'order_created', ...prepared.analytics });
  await backupOrderIfNeeded(order, `${paymentMethod}_submit`);
  await sendCustomerInstructionsIfNeeded(order);

  const response = {
    ok: true,
    orderId: order.id,
    total: order.total,
    baseTotal: order.base_total || order.total,
    paymentMatchAdjustment: order.payment_match_adjustment || 0,
    paymentMethod: order.payment_provider,
    message: 'Order received. Send the exact total shown for manual payment verification.',
  };

  if (paymentMethod === 'manual_paypal') {
    response.paypal = { email: config.PAYPAL_MANUAL_EMAIL, reference: `HP-${order.id}` };
    response.message = 'Order received. Send the exact total shown to PayPal. We manually verify payment before fulfillment.';
  }

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
  const { paypalOrderId, orderId, analyticsVisitorId, analyticsSessionId, analyticsCheckoutAttemptId } = req.body || {};
  const captureAnalytics = {
    visitorId: cleanText(analyticsVisitorId, 128),
    sessionId: cleanText(analyticsSessionId, 128),
    checkoutAttemptId: cleanText(analyticsCheckoutAttemptId, 128),
  };
  if (!paypalOrderId || !orderId) {
    return res.status(400).json({ error: 'Missing PayPal order details.' });
  }

  const order = db.getOrderById(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  try {
    const capture = await capturePayPalOrder(paypalOrderId);
    if (capture.status !== 'COMPLETED') {
      analytics.recordEvent({ type: 'payment_failed', paymentMethod: 'paypal', reason: 'capture_incomplete', ...captureAnalytics });
      return res.status(400).json({ error: `PayPal payment was not completed. Status: ${capture.status}` });
    }
    const validationError = validatePayPalCaptureForOrder(capture, order, paypalOrderId);
    if (validationError) {
      analytics.recordEvent({ type: 'payment_failed', paymentMethod: 'paypal', reason: 'capture_validation_failed', ...captureAnalytics });
      return res.status(400).json({ error: validationError });
    }
    const paidOrder = db.markOrderPaid(orderId, paypalOrderId);
    analytics.recordEvent({ type: 'payment_confirmed', ...captureAnalytics });
    await backupOrderIfNeeded(paidOrder, 'paypal_capture');
    res.json({ ok: true, orderId: Number(orderId), paypalOrderId, total: paidOrder.total, message: 'Payment received. Order is confirmed.' });
  } catch (err) {
    analytics.recordEvent({ type: 'payment_failed', paymentMethod: 'paypal', reason: 'capture_request_failed', ...captureAnalytics });
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

function orderDiscountAllocation(order, subtotal, discount) {
  const cryptoDiscount = String(order.discount_code || '').startsWith('CRYPTO');
  const eligibleSubtotal = cryptoDiscount
    ? subtotal
    : Number(order.promo_eligible_subtotal == null ? subtotal : order.promo_eligible_subtotal);
  return {
    eligibleSubtotal,
    lineDiscount(item, lineRevenue) {
      if (!cryptoDiscount && item.promo_eligible === false) return 0;
      return eligibleSubtotal > 0 ? Math.round(lineRevenue * (discount / eligibleSubtotal) * 100) / 100 : 0;
    },
  };
}

function orderFinancialSummary(order) {
  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.discount_amount || 0);
  const shipping = Number(order.shipping_fee || 0);
  const processing = Number(order.order_fee || 0);
  const totalSpent = Number(order.total || 0);
  const discountAllocation = orderDiscountAllocation(order, subtotal, discount);
  let cogs = 0;
  let productRevenueAfterDiscount = 0;

  (order.items || []).forEach(item => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price || 0);
    const lineRevenueBeforeDiscount = unitPrice * quantity;
    const allocatedDiscount = discountAllocation.lineDiscount(item, lineRevenueBeforeDiscount);
    productRevenueAfterDiscount += lineRevenueBeforeDiscount - allocatedDiscount;
    cogs += Number(costBySku[item.sku] || 0) * quantity;
  });

  productRevenueAfterDiscount = Math.round(productRevenueAfterDiscount * 100) / 100;
  cogs = Math.round(cogs * 100) / 100;
  const referralReward = ['approved', 'earned'].includes(order.referral_credit_status) ? Math.round((Number(order.referral_credit_cents || 0) / 100) * 100) / 100 : 0;
  const storeCreditUsed = Math.round(Number(order.store_credit_amount || 0) * 100) / 100;
  const grossProfit = Math.round((productRevenueAfterDiscount - cogs - referralReward) * 100) / 100;
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
    referralReward,
    storeCreditUsed,
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

function safePasswordMatch(input, expected, expectedSha256 = '') {
  const inputHashHex = crypto.createHash('sha256').update(String(input || '')).digest('hex');
  const expectedHashHex = String(expectedSha256 || '').trim().toLowerCase()
    || crypto.createHash('sha256').update(String(expected || '')).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(expectedHashHex)) return false;
  const inputHash = Buffer.from(inputHashHex, 'hex');
  const expectedHash = Buffer.from(expectedHashHex, 'hex');
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

function topSoldProducts(orders, limit = 10) {
  const leaders = new Map();
  orders.filter(order => CONFIRMED_ORDER_STATUSES.has(order.status)).forEach(order => {
    (order.items || []).forEach(item => {
      const key = String(item.sku || `${item.name}|${item.spec}`);
      const current = leaders.get(key) || {
        sku: item.sku || '',
        name: item.name || 'Product',
        spec: item.spec || '',
        quantity: 0,
        orderCount: 0,
        revenue: 0,
      };
      const quantity = Number(item.quantity || 0);
      current.quantity += quantity;
      current.orderCount += 1;
      current.revenue += Number(item.unit_price || 0) * quantity;
      leaders.set(key, current);
    });
  });
  return [...leaders.values()]
    .map(item => ({ ...item, revenue: Math.round(item.revenue * 100) / 100 }))
    .sort((a, b) => b.quantity - a.quantity || b.orderCount - a.orderCount || b.revenue - a.revenue)
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
}

app.get('/api/admin/analytics', requireAdmin, (req, res) => {
  const allowedRanges = new Set([7, 30, 90, 365]);
  const requestedRange = Number(req.query.days || 30);
  const rangeDays = allowedRanges.has(requestedRange) ? requestedRange : 30;
  const summary = analytics.getSummary(rangeDays);
  const rangeStart = new Date();
  rangeStart.setUTCHours(0, 0, 0, 0);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - (rangeDays - 1));

  const salesOrders = db.getAllOrders().filter(order => {
    const createdAt = new Date(order.created_at || 0);
    return createdAt >= rangeStart && CONFIRMED_ORDER_STATUSES.has(order.status);
  });
  const trackingStartedAt = new Date(summary.trackingStartedAt || 0);
  const conversionStart = trackingStartedAt > rangeStart ? trackingStartedAt : rangeStart;
  const trackedPaidOrders = salesOrders.filter(order => new Date(order.created_at || 0) >= conversionStart);
  const paidRevenue = Math.round(salesOrders.reduce((sum, order) => sum + Number(order.total || 0), 0) * 100) / 100;
  const totals = summary.totals;
  const rate = (numerator, denominator) => denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10
    : null;

  res.json({
    ...summary,
    sales: {
      paidOrders: salesOrders.length,
      paidRevenue,
      averageOrderValue: salesOrders.length ? Math.round((paidRevenue / salesOrders.length) * 100) / 100 : 0,
      topSoldProducts: topSoldProducts(salesOrders, 10),
    },
    rates: {
      visitorToOrder: rate(totals.ordersCreated, totals.uniqueVisitors),
      visitorToPaid: rate(trackedPaidOrders.length, totals.uniqueVisitors),
      productToCart: rate(totals.addToCarts, totals.productViews),
      checkoutToOrder: rate(totals.ordersCreated, totals.checkoutStarts),
      orderToPaid: rate(trackedPaidOrders.length, totals.ordersCreated),
    },
    storage: analytics.getStorageInfo(),
  });
});

app.get('/api/admin/top-products', requireAdmin, (req, res) => {
  res.json({ products: topSoldProducts(db.getAllOrders(), 10) });
});

app.get('/api/admin/profit', requireAdmin, (req, res) => {
  const orders = db.getAllOrders().filter(order => CONFIRMED_ORDER_STATUSES.has(order.status));
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
    referralRewards: 0,
    grossProfit: 0,
    grossMargin: 0,
  };

  orders.forEach(order => {
    const subtotal = Number(order.subtotal || 0);
    const discount = Number(order.discount_amount || 0);
    const discountAllocation = orderDiscountAllocation(order, subtotal, discount);
    totals.totalCollected += Number(order.total || 0);
    totals.discounts += discount;
    totals.shippingCollected += Number(order.shipping_fee || 0);
    totals.processingCollected += Number(order.order_fee || 0);
    const orderReferralReward = ['approved', 'earned'].includes(order.referral_credit_status) ? Number(order.referral_credit_cents || 0) / 100 : 0;
    totals.referralRewards += orderReferralReward;
    const orderProductRevenue = Math.max(0, subtotal - discount);

    (order.items || []).forEach(item => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || 0);
      const lineRevenueBeforeDiscount = unitPrice * quantity;
      const allocatedDiscount = discountAllocation.lineDiscount(item, lineRevenueBeforeDiscount);
      const lineRevenue = Math.round((lineRevenueBeforeDiscount - allocatedDiscount) * 100) / 100;
      const unitCost = Number(costBySku[item.sku] || 0);
      const lineCost = Math.round(unitCost * quantity * 100) / 100;
      const allocatedReferralReward = orderProductRevenue > 0
        ? Math.round(orderReferralReward * (lineRevenue / orderProductRevenue) * 100) / 100
        : 0;
      const lineProfit = Math.round((lineRevenue - lineCost - allocatedReferralReward) * 100) / 100;

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
        referralReward: allocatedReferralReward,
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
  totals.referralRewards = Math.round(totals.referralRewards * 100) / 100;
  totals.grossProfit = Math.round((totals.productRevenue - totals.cogs - totals.referralRewards) * 100) / 100;
  totals.grossMargin = totals.productRevenue > 0 ? Math.round((totals.grossProfit / totals.productRevenue) * 1000) / 10 : 0;

  res.json({ totals, lines: lines.sort((a, b) => b.grossProfit - a.grossProfit) });
});

app.get('/api/admin/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ authenticated: Boolean(req.session?.isAdmin) });
});

app.post('/api/admin/login', checkAdminLoginLimit, (req, res) => {
  const { password, rememberDevice } = req.body || {};
  if (!safePasswordMatch(password, config.ADMIN_PASSWORD, config.ADMIN_PASSWORD_SHA256)) {
    recordAdminLoginFailure(req);
    return res.status(401).json({ error: 'Wrong admin password.' });
  }
  resetAdminLoginFailures(req);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start admin session.' });
    req.session.isAdmin = true;
    const cookieOptions = adminRememberCookieOptions(config, isProductionRuntime);
    if (rememberDevice === true) {
      res.cookie(ADMIN_REMEMBER_COOKIE, createAdminRememberToken(config), cookieOptions);
    } else {
      res.clearCookie(ADMIN_REMEMBER_COOKIE, adminRememberCookieOptions(config, isProductionRuntime, false));
    }
    res.json({ ok: true });
  });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('hp.sid', { httpOnly: true, secure: isProductionRuntime, sameSite: 'lax' });
    res.clearCookie(ADMIN_REMEMBER_COOKIE, adminRememberCookieOptions(config, isProductionRuntime, false));
    res.json({ ok: true });
  });
});


app.get('/api/admin/launch-checks', requireAdmin, (req, res) => {
  const storage = db.getStorageInfo();
  const paidOrders = db.getAllOrders().filter(order => CONFIRMED_ORDER_STATUSES.has(order.status));
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
      key: 'account-email',
      label: 'Account verification email',
      ok: isCustomerEmailConfigured(),
      detail: isCustomerEmailConfigured()
        ? 'Verification, password-reset, and account emails are configured.'
        : 'Add SMTP settings in Render before enabling customer account registration.',
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
        ? `${paidOrders.length} confirmed order(s) recorded.`
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

app.post('/api/admin/orders/:id/payment-reminder', requireAdmin, async (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending_payment') return res.status(400).json({ error: 'Only pending orders can receive a payment reminder.' });
  try {
    const channel = await sendPaymentReminder(order);
    if (!channel) return res.status(503).json({ error: 'Customer email is not configured. Add SMTP settings in Render.' });
    const updated = db.markPaymentReminderSent(order.id);
    res.json({ ok: true, sentAt: updated.payment_reminder_last_sent_at, reminderCount: updated.payment_reminder_count });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not send payment reminder.' });
  }
});

const TRACKING_CARRIERS = new Set(['USPS', 'UPS', 'FedEx', 'DHL', 'Canada Post', 'Royal Mail', 'Australia Post', 'Other']);

app.post('/api/admin/orders/:id/tracking', requireAdmin, async (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!['paid', 'pending_tracking'].includes(order.status)) return res.status(400).json({ error: 'Tracking can only be sent for a paid order awaiting fulfillment.' });
  if (order.tracking_sent_at || order.tracking_number) return res.status(409).json({ error: 'Tracking has already been sent for this order.' });
  const carrier = cleanText(req.body && req.body.carrier, 60);
  const trackingNumber = cleanText(req.body && req.body.trackingNumber, 120);
  if (!TRACKING_CARRIERS.has(carrier)) return res.status(400).json({ error: 'Choose a supported carrier.' });
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{5,119}$/.test(trackingNumber)) return res.status(400).json({ error: 'Enter a valid tracking number.' });
  try {
    const channel = await sendTrackingEmail(order, carrier, trackingNumber);
    if (!channel) return res.status(503).json({ error: 'Customer email is not configured. Add SMTP settings in Render.' });
    const updated = db.markTrackingSent(order.id, carrier, trackingNumber);
    await backupOrderIfNeeded(updated, 'tracking_sent');
    res.json({ ok: true, status: updated.status, sentAt: updated.tracking_sent_at });
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not send tracking email.' });
  }
});
function txidDuplicateMap(orders) {
  const map = new Map();
  orders.forEach(order => {
    if (order.payment_provider !== 'crypto' || !order.payment_reference) return;
    const normalized = String(order.payment_reference).trim().toLowerCase();
    if (!normalized) return;
    if (!map.has(normalized)) map.set(normalized, []);
    map.get(normalized).push(order.id);
  });
  return map;
}

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const allOrders = db.getAllOrders();
  const duplicateMap = txidDuplicateMap(allOrders);
  const orders = allOrders.map(order => {
    const normalizedTxid = order.payment_provider === 'crypto' && order.payment_reference
      ? String(order.payment_reference).trim().toLowerCase()
      : '';
    const duplicateOrderIds = normalizedTxid ? (duplicateMap.get(normalizedTxid) || []) : [];
    return {
      ...order,
      payment_reference_duplicate: duplicateOrderIds.length > 1,
      payment_reference_duplicate_order_ids: duplicateOrderIds,
      financials: orderFinancialSummary(order),
    };
  });
  const txidDuplicateCount = [...duplicateMap.values()].filter(ids => ids.length > 1).length;
  res.json({ orders, txidDuplicateCount });
});

app.post('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  if (!['pending_payment', 'paid', 'pending_tracking', 'fulfilled', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const previousOrder = db.getOrderById(req.params.id);
  const wasConfirmed = previousOrder && CONFIRMED_ORDER_STATUSES.has(previousOrder.status);
  const order = db.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!wasConfirmed && CONFIRMED_ORDER_STATUSES.has(status)) {
    analytics.recordEvent({ type: 'payment_confirmed' });
  }
  if (CONFIRMED_ORDER_STATUSES.has(status)) {
    await backupOrderIfNeeded(order, 'admin_status_' + status);
  }
  res.json({ ok: true });
});

app.delete('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const removed = db.deleteOrder(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Order not found' });
  res.json({ ok: true, deletedOrderId: removed.id });
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
app.listen(PORT, () => {
  console.log(`${config.SITE_NAME} running on http://localhost:${PORT}`);
  startPaymentReminderScheduler({ db, sendPaymentReminder });
  if (config.BTC_MONITOR.ENABLED) {
    try {
      createBitcoinMonitor({
        addresses: config.BTC_MONITOR.ADDRESSES,
        webhookUrl: config.BTC_MONITOR.DISCORD_WEBHOOK_URL,
        apiUrl: config.BTC_MONITOR.API_URL,
        explorerUrl: config.BTC_MONITOR.EXPLORER_URL,
        intervalMs: config.BTC_MONITOR.POLL_INTERVAL_MS,
        minConfirmations: config.BTC_MONITOR.MIN_CONFIRMATIONS,
        alertExisting: config.BTC_MONITOR.ALERT_EXISTING,
      }).start();
      console.log(`BTC monitor started for ${config.BTC_MONITOR.ADDRESSES.length} address(es).`);
    } catch (err) {
      console.error('BTC monitor did not start:', err.message || err);
    }
  }
});





