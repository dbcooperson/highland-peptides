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
const { catalog, bySku, costBySku, getProductFamily, priceAudit, quantityPricing } = require('./products');
const {
  ADMIN_REMEMBER_COOKIE,
  createAdminRememberToken,
  adminRememberCookieOptions,
  restoreAdminFromRememberCookie,
  requireAdmin,
} = require('./auth');
const { buildPackingSlip, buildContentsLabel } = require('./labels');
const { createAdminSecurity } = require('./admin-security');
const { sendOrderBackup, sendCustomerPaymentInstructions, sendPaymentReminder, sendTrackingEmail, isCustomerEmailConfigured } = require('./notifications');
const { acceptAddressAsEntered, validateShippingAddress } = require('./address-validation');
const analytics = require('./analytics');
const coa = require('./coa');
const { applyBundlePromotion, applyCodeGift, codeGift, publicPromotion, bundleTiers } = require('./promotions');
const { reminderIsDue, startPaymentReminderScheduler } = require('./reminders');
const { registerAccountRoutes } = require('./accounts');
const { registerSupportInboxRoutes } = require('./support-inbox');
const { registerGiveawayRoutes } = require('./giveaway');
const { allocateBundles, linePricing, publicBundles } = require('./bundles');
const { registerLifecycleRoutes, startLifecycleScheduler } = require('./lifecycle');
const { registerCheckoutVerificationRoutes, isCheckoutEmailVerified } = require('./checkout-verification');
const { pirateShipCsv, pirateShipExportCandidates, parseInboundTrackingEmail, matchPendingTrackingOrder, verifyResendWebhook, fetchResendReceivedEmail, normalizeInboundDomain, validOrderAliasToken } = require('./pirate-ship');
const { CAMPAIGN_CODE, hasCampaignReferral, referralOfferDiscount } = require('./referral-offer');
const { stripeMode, stripeClient, checkoutSessionParams, verifiedPaidSession } = require('./stripe-checkout');

const CONFIRMED_ORDER_STATUSES = new Set(['paid', 'pending_tracking', 'fulfilled']);
const todayPirateShipStatusMigration = db.applyOrderStatusMigration(
  '2026-09-15-pirate-ship-orders-307-273-pending-tracking',
  [307, 306, 303, 302, 291, 282, 281, 278, 275, 273],
  'pending_tracking',
);
if (todayPirateShipStatusMigration.applied) {
  console.log(`Marked ${todayPirateShipStatusMigration.updatedOrderIds.length} selected order(s) Pending tracking.`);
  if (todayPirateShipStatusMigration.missingOrderIds.length) {
    console.warn(`Selected order IDs not found: ${todayPirateShipStatusMigration.missingOrderIds.join(', ')}`);
  }
}

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

// Content-Security-Policy: pages may only load code from this site (plus Google's
// address-autocomplete script and fonts), can't be framed, and can't post forms elsewhere.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com",
  "connect-src 'self' https://maps.googleapis.com https://places.googleapis.com",
  "media-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const releaseId = process.env.RENDER_GIT_COMMIT
  || process.env.SOURCE_VERSION
  || 'local-development';
const startedAt = new Date().toISOString();

app.use((req, res, next) => {
  res.setHeader('X-Snowy-Release', releaseId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (/^\/(admin(\.html)?|api)(\/|$)/.test(req.path)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.secure || req.get('x-forwarded-proto') === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const mode = stripeMode();
  if (!mode) return res.sendStatus(404);
  let event;
  try {
    const signingSecret = mode === 'live' ? process.env.STRIPE_LIVE_WEBHOOK_SECRET : process.env.STRIPE_TEST_WEBHOOK_SECRET;
    event = stripeClient().webhooks.constructEvent(req.body, req.get('stripe-signature'), signingSecret);
  } catch (_) {
    return res.status(400).json({ error: 'Invalid Stripe webhook signature.' });
  }
  const payment = verifiedPaidSession(event, mode);
  if (!payment) return res.json({ received: true });
  const result = db.markStripeOrderPaid(payment.id, payment.sessionId, payment.amountCents, payment.currency);
  if (!result) return res.status(409).json({ error: 'Stripe payment does not match a pending order.' });
  if (result.newlyPaid) {
    analytics.recordEvent({ type: 'payment_confirmed', paymentMethod: 'stripe' });
    await backupOrderIfNeeded(result.order, 'stripe_webhook');
  }
  return res.json({ received: true });
});

app.use(express.json({
  limit: '25kb',
  verify(req, res, buffer) {
    if (req.originalUrl === '/api/webhooks/resend/inbound') req.rawBody = Buffer.from(buffer);
  },
}));
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
registerCheckoutVerificationRoutes(app);
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

// Resend receives Pirate Ship's tracking notice at an order-specific address
// and posts a signed event here. This route is intentionally public because
// Resend cannot use an admin session; the timestamped HMAC protects it.
app.post('/api/webhooks/resend/inbound', async (req, res) => {
  if (!config.RESEND_API_KEY || !config.RESEND_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Inbound tracking automation is not configured.' });
  }
  let event;
  try {
    event = verifyResendWebhook(String(req.rawBody || ''), {
      id: req.get('svix-id'),
      timestamp: req.get('svix-timestamp'),
      signature: req.get('svix-signature'),
    }, config.RESEND_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(401).json({ error: err.message || 'Invalid webhook signature.' });
  }
  if (event.type !== 'email.received') return res.json({ ok: true, ignored: true });

  const eventId = String(req.get('svix-id') || event.data && event.data.message_id || '');
  if (db.hasInboundTrackingEvent(eventId)) return res.json({ ok: true, duplicate: true });
  const emailId = cleanText(event.data && event.data.email_id, 160);
  try {
    const email = await fetchResendReceivedEmail(emailId, config.RESEND_API_KEY);
    const parsed = parseInboundTrackingEmail(email, { inboundDomain: config.PIRATE_SHIP_INBOUND_DOMAIN });
    if (parsed.orderAliasToken && !validOrderAliasToken(parsed.orderId, parsed.orderAliasToken, config.SESSION_SECRET)) {
      throw new Error('The inbound order address failed its security check.');
    }
    if (!parsed.trackingNumber || !parsed.carrier) {
      throw new Error('The inbound Pirate Ship email did not contain a supported USPS or UPS tracking number.');
    }
    const match = matchPendingTrackingOrder(db.getAllOrders(), parsed);
    if (!match.order) throw new Error(`Could not safely match this tracking email (${match.reason}).`);
    if (match.reason === 'already_processed') {
      db.markInboundTrackingEvent(eventId, { emailId, orderId: match.order.id, trackingNumber: parsed.trackingNumber, result: 'duplicate_order' });
      return res.json({ ok: true, duplicate: true, orderId: match.order.id });
    }

    const claim = db.claimTrackingDispatch(match.order.id, parsed.carrier, parsed.trackingNumber);
    if (!claim.claimed) {
      if (claim.reason === 'already_sent') {
        db.markInboundTrackingEvent(eventId, { emailId, orderId: match.order.id, trackingNumber: parsed.trackingNumber, result: 'duplicate_order' });
        return res.json({ ok: true, duplicate: true, orderId: match.order.id });
      }
      throw new Error(claim.reason === 'in_progress' ? 'Tracking is already being processed.' : 'The matched order is not awaiting tracking.');
    }
    const details = {
      service: parsed.service,
      estimatedDelivery: parsed.estimatedDelivery,
      source: 'pirate_ship_email',
    };
    const channel = await sendTrackingEmail(claim.order, parsed.carrier, parsed.trackingNumber, details);
    if (!channel) {
      db.markTrackingFailed(match.order.id, 'Customer email is not configured.');
      throw new Error('Customer email is not configured.');
    }
    const updated = db.markTrackingSent(match.order.id, parsed.carrier, parsed.trackingNumber, details);
    db.markInboundTrackingEvent(eventId, { emailId, orderId: updated.id, trackingNumber: parsed.trackingNumber, result: 'fulfilled' });
    await backupOrderIfNeeded(updated, 'pirate_ship_tracking');
    console.log(`Pirate Ship tracking fulfilled order SR-${updated.id}.`);
    return res.json({ ok: true, orderId: updated.id, status: updated.status });
  } catch (err) {
    console.error('Pirate Ship inbound tracking failed:', err.message || err);
    return res.status(503).json({ error: err.message || 'Could not process inbound tracking.' });
  }
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
    priorityShippingFee: config.PRIORITY_SHIPPING_FEE,
    shippingOptions: [
      { id: 'domestic', label: 'U.S. shipping', price: config.SHIPPING_FEE },
      { id: 'priority', label: 'Priority Mail (U.S. only)', price: config.PRIORITY_SHIPPING_FEE },
      { id: 'international', label: 'International shipping', price: config.INTERNATIONAL_SHIPPING_FEE },
    ],
    orderFeeRate: config.ORDER_FEE_RATE,
    altPaymentDiscountRate: config.ALT_PAYMENT_DISCOUNT_RATE,
    accountCryptoDiscountRate: 0,
    promotion: publicPromotion(),
    bundles: publicBundles(),
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
  if (rate != null) {
    const campaignConfig = config.LIMITED_PROMOTION_CAMPAIGNS && config.LIMITED_PROMOTION_CAMPAIGNS[normalized];
    const limitedPromotion = campaignConfig ? { ...campaignConfig, code: normalized, fallbackRate: rate } : null;
    const currentRate = limitedPromotion ? db.getLimitedPromotionRate(limitedPromotion, rate) : rate;
    return { code: normalized, rate: currentRate, type: 'promotion', referralAccountId: null, limitedPromotion };
  }
  // Promo-manager codes and customer referral codes are retired and never resolve.
  return null;
}

app.get('/api/discount-code', (req, res) => {
  const match = resolveDiscountCode(req.query.code);
  if (!match) return res.json({ valid: false });
  res.json({ valid: true, code: match.code, percentOff: Math.round(match.rate * 100), referral: match.type === 'referral', gift: codeGift(match.code, bySku) });
});

app.get('/api/referral-offer', (req, res) => {
  res.json({ valid: hasCampaignReferral(req.query.ref), code: CAMPAIGN_CODE, percentOff: 10, extraCodePercent: 5 });
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
registerSupportInboxRoutes(app, { db, requireAdmin, secureCookies: isProductionRuntime, clientIp: req => clientIp(req) });
registerGiveawayRoutes(app, { db, config, bySku, requireAdmin, clientIp: req => clientIp(req) });
registerLifecycleRoutes(app, { db });

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
  const { items: rawItems, buyer, certified, discountCode, referralCampaign, paymentMethod, cryptoAsset, shippingMethod, paymentPolicyAccepted, applyStoreCredit } = body || {};

  if (certified !== true) {
    return { error: 'You must certify research/business use to place an order.' };
  }
  if (paymentPolicyAccepted !== true) {
    return { error: 'You must confirm the exact-payment policy before payment.' };
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

  if (!['crypto', 'stripe'].includes(paymentMethod)) {
    return { error: 'Select an available payment method.' };
  }
  const normalizedPaymentMethod = paymentMethod;
  const normalizedCryptoAsset = normalizedPaymentMethod === 'crypto' && cryptoAsset === 'USDC' ? 'USDC' : 'BTC';

  const items = Array.isArray(rawItems) ? rawItems : [];
  if (items.length === 0) return { error: 'Cart is empty.' };
  if (items.length > 50) return { error: 'Cart has too many line items.' };

  let subtotal = 0;
  let promoEligibleSubtotal = 0;
  const resolved = [];
  const cartQuantities = {};
  for (const item of items) {
    const product = bySku[item.sku];
    const qty = parseInt(item.quantity, 10);
    if (!product || !qty || qty < 1 || qty > 99) {
      return { error: `Invalid item: ${item.sku}` };
    }
    cartQuantities[product.sku] = (cartQuantities[product.sku] || 0) + qty;
  }
  const bundleAllocation = allocateBundles(cartQuantities);
  const bundledLeft = { ...bundleAllocation.bundledUnits };
  for (const item of items) {
    const product = bySku[item.sku];
    const qty = parseInt(item.quantity, 10);
    const allocatedUnits = bundleAllocation.bundledUnits[product.sku] || 0;
    const perUnitSaving = allocatedUnits ? (bundleAllocation.bundleSavings[product.sku] || 0) / allocatedUnits : 0;
    const pricing = linePricing(product, qty, bundledLeft[product.sku] || 0, perUnitSaving);
    bundledLeft[product.sku] = Math.max(0, (bundledLeft[product.sku] || 0) - pricing.bundledUnits);
    const lineTotal = pricing.total;
    subtotal += lineTotal;
    if (product.promoEligible !== false) promoEligibleSubtotal += lineTotal;
    resolved.push({
      sku: product.sku,
      name: product.name,
      spec: product.spec,
      quantity: qty,
      unit_price: lineTotal / qty,
      list_unit_price: product.price,
      quantity_discount: pricing.quantitySavings,
      bundle_discount: pricing.bundleSavings,
      promo_eligible: product.promoEligible !== false,
    });
  }
  subtotal = Math.round(subtotal * 100) / 100;
  promoEligibleSubtotal = Math.round(promoEligibleSubtotal * 100) / 100;

  const promotionResult = applyBundlePromotion(resolved, bySku);

  const discountMatch = resolveDiscountCode(discountCode);
  const campaignReferral = hasCampaignReferral(referralCampaign);
  const customerAccount = accountId ? db.getAccountById(accountId) : null;
  if (discountMatch && discountMatch.type === 'referral') {
    const isSameAccount = customerAccount && customerAccount.id === discountMatch.referralAccountId;
    const isSameEmail = cleanBuyer.email === cleanEmail(discountMatch.referralEmail);
    if (isSameAccount || isSameEmail) {
      return { error: 'Referral codes are for other customers and cannot be used on your own order.' };
    }
  }
  const cryptoOrder = normalizedPaymentMethod === 'crypto';
  if (cryptoOrder && discountMatch) {
    return { error: 'Crypto orders already get 15% off and cannot be combined with promo or referral codes. Remove the code or choose another payment method.' };
  }
  // Crypto: a flat discount (15%) that replaces every other offer, including referral links.
  const referralOfferApplies = campaignReferral && !cryptoOrder;
  const codeDiscount = !referralOfferApplies && discountMatch ? promoEligibleSubtotal * discountMatch.rate : 0;
  const altPaymentDiscount = cryptoOrder ? subtotal * config.ALT_PAYMENT_DISCOUNT_RATE : 0;
  const referralDiscount = referralOfferApplies ? referralOfferDiscount(promoEligibleSubtotal, discountMatch) : null;
  const discountAmount = referralOfferApplies
    ? referralDiscount.amount
    : Math.round((codeDiscount + altPaymentDiscount) * 100) / 100;
  const discountLabel = referralOfferApplies
    ? `${CAMPAIGN_CODE}${discountMatch ? `+${discountMatch.code}` : ''}`
    : (discountMatch ? discountMatch.code : (altPaymentDiscount ? `CRYPTO${Math.round(config.ALT_PAYMENT_DISCOUNT_RATE * 100)}` : null));
  const availableCredit = customerAccount && customerAccount.verified_at
    ? Math.max(0, Number(customerAccount.credit_balance_cents || 0) / 100)
    : 0;
  const merchandiseAfterDiscount = Math.max(0, subtotal - discountAmount);
  const storeCreditAmount = applyStoreCredit === true
    ? Math.round(Math.min(availableCredit, merchandiseAfterDiscount) * 100) / 100
    : 0;

  const packagingFee = config.PACKAGING_FEE;
  const normalizedShippingMethod = ['international', 'priority'].includes(shippingMethod) ? shippingMethod : 'domestic';
  if (normalizedShippingMethod === 'priority' && cleanBuyer.country !== 'US') {
    return { error: 'Priority Mail is only available for U.S. addresses. Choose International shipping instead.' };
  }
  if (normalizedShippingMethod === 'domestic' && cleanBuyer.country !== 'US') {
    return { error: 'Choose International shipping for destinations outside the U.S.' };
  }
  if (normalizedShippingMethod === 'international' && cleanBuyer.country === 'US') {
    return { error: 'International shipping is for destinations outside the U.S. Change the country or select U.S. shipping.' };
  }
  const shippingFee = normalizedShippingMethod === 'international'
    ? config.INTERNATIONAL_SHIPPING_FEE
    : normalizedShippingMethod === 'priority' ? config.PRIORITY_SHIPPING_FEE : config.SHIPPING_FEE;
  const feeBase = Math.max(0, subtotal - discountAmount - storeCreditAmount + packagingFee + shippingFee);
  // Crypto orders skip the processing fee entirely.
  const orderFeeRate = normalizedPaymentMethod === 'crypto' ? 0 : config.ORDER_FEE_RATE;
  const orderFee = Math.round(feeBase * orderFeeRate * 100) / 100;
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
      items: discountMatch ? applyCodeGift(promotionResult.items, discountMatch.code, bySku) : promotionResult.items,
      subtotal,
      promoEligibleSubtotal,
      packagingFee,
      shippingFee,
      shippingMethod: normalizedShippingMethod,
      orderFee,
      orderFeeRate,
      discountCode: discountLabel,
      discountType: discountMatch ? discountMatch.type : null,
      discountAmount,
      limitedPromotion: !campaignReferral && discountMatch ? discountMatch.limitedPromotion : null,
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

async function validatePreparedCheckoutAddress(prepared) {
  const validation = await validateShippingAddress(prepared.orderInput.buyer, {
    apiKey: config.GOOGLE_ADDRESS_VALIDATION_KEY,
  });
  // A third-party lookup is advisory. The required-field checks in
  // prepareCheckout decide whether the shopper supplied a complete address;
  // fulfillment can review any lookup warning before buying the shipping label.
  const result = acceptAddressAsEntered(validation, prepared.orderInput.buyer);
  if (result.acceptedAsEntered) {
    prepared.orderInput.shippingAddressValidation = {
      provider: result.provider || (config.GOOGLE_ADDRESS_VALIDATION_KEY ? 'google_address_validation' : 'census_geocoder'),
      responseId: result.responseId || null,
      granularity: result.validationGranularity || null,
      matchedAddress: result.matchedAddress || null,
      validatedAt: new Date().toISOString(),
      acceptedAsEntered: true,
      warningCode: result.code,
    };
    return result;
  }
  if (result.enabled) {
    prepared.orderInput.buyer = result.buyer;
    prepared.orderInput.shippingAddressValidation = {
      provider: result.provider || 'google_address_validation',
      responseId: result.responseId || null,
      granularity: result.validationGranularity || null,
      matchedAddress: result.matchedAddress || null,
      validatedAt: new Date().toISOString(),
    };
  }
  return result;
}

function checkoutAddressError(res, result) {
  return res.status(result.status || 400).json({
    error: result.error || 'Enter a valid delivery address.',
    code: result.code || 'invalid_address',
    field: result.field || 'address1',
  });
}

app.get('/api/address/config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    autocompleteEnabled: Boolean(config.GOOGLE_PLACES_BROWSER_KEY),
    validationEnabled: true,
    validationProvider: config.GOOGLE_ADDRESS_VALIDATION_KEY ? 'google_address_validation' : 'census_geocoder',
    browserKey: config.GOOGLE_PLACES_BROWSER_KEY || null,
  });
});

// Manual crypto checkout records a pending order for payment matching.
app.post('/api/checkout', checkCheckoutRateLimit, async (req, res) => {
  if (req.body?.paymentMethod === 'stripe') {
    return res.status(400).json({ error: 'Stripe orders must use the hosted Checkout flow.' });
  }
  const prepared = prepareCheckout(req.body, req.session && req.session.accountId);
  if (prepared.error) {
    analytics.recordEvent({ type: 'checkout_error', stage: 'server_validation', reason: 'invalid_checkout', visitorId: cleanText(req.body && req.body.analyticsVisitorId, 128), sessionId: cleanText(req.body && req.body.analyticsSessionId, 128), checkoutAttemptId: cleanText(req.body && req.body.analyticsCheckoutAttemptId, 128) });
    return res.status(400).json({ error: prepared.error });
  }
  if (!isCheckoutEmailVerified(req, prepared.orderInput.buyer.email)) {
    return res.status(403).json({ error: 'Verify your checkout email before placing the order.' });
  }
  const addressValidation = await validatePreparedCheckoutAddress(prepared);
  if (!addressValidation.valid) {
    analytics.recordEvent({ type: 'checkout_error', stage: 'address_validation', reason: addressValidation.code || 'invalid_address', ...prepared.analytics });
    return checkoutAddressError(res, addressValidation);
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

  if (paymentMethod === 'crypto') {
    const address = cryptoAsset === 'USDC' ? config.CRYPTO_WALLETS.USDC_ERC20 : config.CRYPTO_WALLETS.BTC;
    const network = cryptoAsset === 'USDC' ? 'Ethereum mainnet (ERC-20) only' : 'Bitcoin network';
    response.crypto = { asset: cryptoAsset, address, network, reference: `SR-${order.id}` };
    response.message = `Order received. Send ${cryptoAsset} to the address shown to complete payment.`;
  }

  res.json(response);
});

app.post('/api/orders/:id/confirm-crypto', checkCheckoutRateLimit, (req, res) => {
  const order = db.getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.payment_provider !== 'crypto') return res.status(400).json({ error: 'Order is not a crypto order.' });
  if (order.status !== 'pending_payment') return res.status(409).json({ error: 'This order is no longer waiting for payment.' });

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


async function sendCustomerInstructionsIfNeeded(order) {
  if (!order || order.payment_provider !== 'crypto') return;
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

app.get('/api/stripe/config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const mode = stripeMode();
  res.json({ enabled: Boolean(mode), mode });
});

app.post('/api/stripe/create-checkout-session', checkCheckoutRateLimit, async (req, res) => {
  const mode = stripeMode();
  if (!mode) return res.status(503).json({ error: 'Stripe checkout is not enabled.' });
  if (req.body?.paymentMethod !== 'stripe') return res.status(400).json({ error: 'Select Stripe checkout.' });
  const prepared = prepareCheckout(req.body, req.session && req.session.accountId);
  if (prepared.error) return res.status(400).json({ error: prepared.error });
  if (!isCheckoutEmailVerified(req, prepared.orderInput.buyer.email)) {
    return res.status(403).json({ error: 'Verify your checkout email before placing the order.' });
  }
  const addressValidation = await validatePreparedCheckoutAddress(prepared);
  if (!addressValidation.valid) return checkoutAddressError(res, addressValidation);
  let order;
  try {
    order = db.createOrder({ ...prepared.orderInput, paymentProvider: 'stripe' });
    const origin = mode === 'live' ? config.ACCOUNT_SITE_URL : `http://localhost:${process.env.PORT || 3000}`;
    const stripeSession = await stripeClient().checkout.sessions.create(checkoutSessionParams(order, origin, mode), {
      idempotencyKey: `snowy-${mode}-order-${order.id}`,
    });
    if (!(mode === 'live' ? /^cs_live_/ : /^cs_test_/).test(stripeSession.id || '') || !/^https:\/\//.test(stripeSession.url || '')) {
      throw new Error('Stripe did not return a valid Checkout Session.');
    }
    if (!db.setStripeCheckoutSessionId(order.id, stripeSession.id)) throw new Error('Could not save Checkout Session.');
    analytics.recordEvent({ type: 'order_created', paymentMethod: 'stripe', ...prepared.analytics });
    return res.json({ orderId: order.id, url: stripeSession.url, mode });
  } catch (err) {
    if (order && !db.getOrderById(order.id)?.stripe_checkout_session_id) db.deleteOrder(order.id);
    console.error('Stripe Checkout failed:', err.type || err.message);
    return res.status(502).json({ error: 'Could not start Stripe checkout.' });
  }
});

app.get('/api/admin/top-products', requireAdmin, (req, res) => {
  res.json({ products: topSoldProducts(db.getAllOrders(), 10) });
});

// Admin-only unit economics: per-product price/cost/margin plus the store settings
// the break-even calculator needs. Supplier costs never leave admin routes.
app.get('/api/admin/unit-economics', requireAdmin, (req, res) => {
  const products = catalog.map(p => {
    const price = Number(p.price || 0);
    const cost = Number(costBySku[p.sku] || 0);
    const profit = Math.round((price - cost) * 100) / 100;
    return {
      sku: p.sku,
      name: p.name,
      spec: p.spec,
      price,
      cost,
      profit,
      margin: price > 0 ? Math.round((profit / price) * 1000) / 10 : 0,
    };
  });
  const freebieTiers = bundleTiers().map(tier => ({
    minimumSubtotal: tier.minimumSubtotal,
    sku: tier.freeSku,
    cost: Number(costBySku[tier.freeSku] || 0) * tier.freeQuantity,
  }));
  res.json({
    products,
    settings: {
      shippingFee: config.SHIPPING_FEE,
      orderFeeRate: config.ORDER_FEE_RATE,
      altPaymentDiscountRate: config.ALT_PAYMENT_DISCOUNT_RATE,
      freebieTiers,
    },
  });
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

const adminSecurity = createAdminSecurity({
  filePath: path.join(path.dirname(db.getStorageInfo().dbPath), 'admin-login-log.json'),
});

function lockMessage(blocked) {
  const minutes = Math.max(1, Math.ceil(blocked.retryAfterMs / 60000));
  return blocked.reason === 'site_paused'
    ? `Sign-in is paused for ${minutes} minute${minutes === 1 ? '' : 's'} after too many failed attempts.`
    : `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

app.post('/api/admin/login', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const blocked = adminSecurity.check(req);
  if (blocked) {
    adminSecurity.recordBlocked(req, blocked);
    res.setHeader('Retry-After', String(Math.ceil(blocked.retryAfterMs / 1000)));
    return res.status(429).json({ error: lockMessage(blocked) });
  }
  const { password, rememberDevice } = req.body || {};
  const candidate = typeof password === 'string' ? password.slice(0, 256) : '';
  if (!candidate || !safePasswordMatch(candidate, config.ADMIN_PASSWORD, config.ADMIN_PASSWORD_SHA256)) {
    const result = adminSecurity.recordFailure(req);
    await adminSecurity.failureDelay();
    if (result.lockedForMs) {
      const minutes = Math.round(result.lockedForMs / 60000);
      res.setHeader('Retry-After', String(Math.ceil(result.lockedForMs / 1000)));
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${minutes} minutes.` });
    }
    return res.status(401).json({
      error: result.remaining <= 2
        ? `Wrong admin password. ${result.remaining} attempt${result.remaining === 1 ? '' : 's'} left before a lockout.`
        : 'Wrong admin password.',
    });
  }
  adminSecurity.recordSuccess(req, 'password');
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

app.get('/api/admin/security/logins', requireAdmin, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(adminSecurity.summary(200));
});

app.post('/api/admin/security/unblock', requireAdmin, (req, res) => {
  const ip = String((req.body && req.body.ip) || '').slice(0, 80);
  if (!ip) return res.status(400).json({ error: 'Choose an IP to unblock.' });
  adminSecurity.unblock(ip);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('hp.sid', { httpOnly: true, secure: isProductionRuntime, sameSite: 'lax' });
    res.clearCookie(ADMIN_REMEMBER_COOKIE, adminRememberCookieOptions(config, isProductionRuntime, false));
    res.json({ ok: true });
  });
});



app.get('/api/admin/launch-checks', requireAdmin, async (req, res) => {
  const storage = db.getStorageInfo();
  const paidOrders = db.getAllOrders().filter(order => CONFIRMED_ORDER_STATUSES.has(order.status));
  const checks = [
    {
      key: 'lifecycle_emails',
      label: 'Cart & reorder reminder emails',
      ok: Boolean(config.BUSINESS_MAILING_ADDRESS && config.SMTP_HOST),
      detail: config.BUSINESS_MAILING_ADDRESS && config.SMTP_HOST
        ? 'On. Abandoned-checkout emails go out after ' + config.ABANDONED_CHECKOUT_DELAY_MINUTES + ' minutes; reorder reminders after ' + config.REORDER_REMINDER_DAYS + ' days.'
        : 'Off. Set BUSINESS_MAILING_ADDRESS (a P.O. box or mailbox service is fine) and SMTP to turn them on. The law requires a postal address in marketing emails.',
    },
    {
      key: 'giveaway',
      label: 'Launch giveaway',
      ok: Boolean(config.LAUNCH_GIVEAWAY && config.LAUNCH_GIVEAWAY.startsAt),
      detail: config.LAUNCH_GIVEAWAY && config.LAUNCH_GIVEAWAY.startsAt
        ? `Scheduled from ${config.LAUNCH_GIVEAWAY.startsAt} for ${config.LAUNCH_GIVEAWAY.days} days.`
        : 'Not scheduled. Set GIVEAWAY_START to the launch date (for example 2026-11-20).',
    },
    {
      key: 'storage',
      label: 'Persistent order storage',
      ok: storage.usingPersistentRenderPath,
      detail: storage.usingPersistentRenderPath
        ? 'Orders are configured for /var/data/db.json. Still confirm Render disk is mounted at /var/data.'
        : 'Orders are not using /var/data. Add/confirm a Render Persistent Disk before taking live orders.',
    },
    {
      key: 'stripe',
      label: 'Stripe card checkout',
      ok: stripeMode() === 'live',
      detail: stripeMode() === 'live'
        ? 'Live Stripe Checkout and webhook credentials are configured.'
        : 'Live Stripe Checkout remains disabled until the live key, webhook secret, and explicit switch are set.',
    },
    {
      key: 'address-autocomplete',
      label: 'Checkout address autocomplete',
      ok: true,
      detail: config.GOOGLE_PLACES_BROWSER_KEY
        ? 'Google Places address suggestions are enabled.'
        : 'Phone/browser autofill is active. Google-style live suggestions are optional and currently off.',
    },
    {
      key: 'address-validation',
      label: 'Shipping-address validation',
      ok: true,
      detail: config.GOOGLE_ADDRESS_VALIDATION_KEY
        ? 'Google Address Validation is enabled before every order is created.'
        : 'U.S. street, city, state, and ZIP combinations are checked with the Census Geocoder. Apartment/unit entry remains customer-confirmed.',
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
      key: 'pirate-ship-tracking',
      label: 'Pirate Ship tracking automation',
      ok: Boolean(config.RESEND_API_KEY && config.RESEND_WEBHOOK_SECRET && normalizeInboundDomain(config.PIRATE_SHIP_INBOUND_DOMAIN)),
      detail: config.RESEND_API_KEY && config.RESEND_WEBHOOK_SECRET && normalizeInboundDomain(config.PIRATE_SHIP_INBOUND_DOMAIN)
        ? `Order-specific tracking inboxes are active at ${normalizeInboundDomain(config.PIRATE_SHIP_INBOUND_DOMAIN)}.`
        : 'Add RESEND_API_KEY, RESEND_WEBHOOK_SECRET, and PIRATE_SHIP_INBOUND_DOMAIN in Render to activate automatic fulfillment.',
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
  res.setHeader('Content-Disposition', 'attachment; filename="snowy-orders.csv"');
  res.send(ordersCsv(orders));
});

app.get('/api/admin/pirate-ship.csv', requireAdmin, (req, res) => {
  const waiting = pirateShipExportCandidates(db.getAllOrders());
  if (!waiting.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(204).end();
  }
  const exportedAt = new Date().toISOString();
  const filenameTime = exportedAt.replace(/[:.]/g, '-');
  const csv = pirateShipCsv(waiting, { inboundDomain: config.PIRATE_SHIP_INBOUND_DOMAIN, tokenSecret: config.SESSION_SECRET });
  db.markPirateShipOrdersExported(waiting.map(order => order.id), exportedAt);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('X-Pirate-Ship-Order-Count', String(waiting.length));
  res.setHeader('Content-Disposition', `attachment; filename="snowy-pirate-ship-${filenameTime}.csv"`);
  res.send(csv);
});

app.post('/api/admin/pirate-ship/requeue', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body?.orderIds) ? req.body.orderIds : [];
  if (!ids.length || ids.length > 50 || ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    return res.status(400).json({ error: 'Choose between 1 and 50 valid order numbers.' });
  }
  const orders = db.requeuePirateShipOrders(ids);
  if (!orders.length) return res.status(400).json({ error: 'No eligible Pending tracking orders were requeued.' });
  res.json({ ok: true, orderIds: orders.map(order => order.id) });
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
  if (!reminderIsDue(order)) {
    return res.status(429).json({ error: 'This order is not due for another payment reminder yet.' });
  }
  const claim = db.claimPaymentReminder(order.id);
  if (!claim.claimed) {
    return res.status(409).json({ error: claim.reason === 'in_progress' ? 'A reminder is already being sent.' : 'This order cannot receive a reminder.' });
  }
  try {
    const channel = await sendPaymentReminder(claim.order);
    if (!channel) {
      db.markPaymentReminderFailed(order.id, 'Customer email is not configured.');
      return res.status(503).json({ error: 'Customer email is not configured. Add SMTP settings in Render.' });
    }
    const updated = db.markPaymentReminderSent(order.id);
    res.json({ ok: true, sentAt: updated.payment_reminder_last_sent_at, reminderCount: updated.payment_reminder_count });
  } catch (err) {
    db.markPaymentReminderFailed(order.id, err.message || String(err));
    console.error(`Order #${order.id} payment reminder failed:`, err.message || err);
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
  const service = cleanText(req.body && req.body.service, 120);
  const estimatedDelivery = cleanText(req.body && req.body.estimatedDelivery, 120);
  if (!TRACKING_CARRIERS.has(carrier)) return res.status(400).json({ error: 'Choose a supported carrier.' });
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{5,119}$/.test(trackingNumber)) return res.status(400).json({ error: 'Enter a valid tracking number.' });
  const claim = db.claimTrackingDispatch(order.id, carrier, trackingNumber);
  if (!claim.claimed) {
    return res.status(409).json({ error: claim.reason === 'in_progress' ? 'Tracking is already being sent.' : 'Tracking has already been sent for this order.' });
  }
  try {
    const details = { service, estimatedDelivery, source: 'admin' };
    const channel = await sendTrackingEmail(claim.order, carrier, trackingNumber, details);
    if (!channel) {
      db.markTrackingFailed(order.id, 'Customer email is not configured.');
      return res.status(503).json({ error: 'Customer email is not configured. Add SMTP settings in Render.' });
    }
    const updated = db.markTrackingSent(order.id, carrier, trackingNumber, details);
    await backupOrderIfNeeded(updated, 'tracking_sent');
    res.json({ ok: true, status: updated.status, sentAt: updated.tracking_sent_at });
  } catch (err) {
    db.markTrackingFailed(order.id, err.message || String(err));
    console.error(`Order #${order.id} tracking email failed:`, err.message || err);
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
  startLifecycleScheduler({ db });
});





