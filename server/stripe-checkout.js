const crypto = require('crypto');
const Stripe = require('stripe');

function sandboxCheckoutEnabled(env = process.env) {
  return env.STRIPE_SANDBOX_CHECKOUT_ENABLED === 'true'
    && env.NODE_ENV !== 'production' && !env.RENDER && !env.RENDER_SERVICE_ID
    && /^(sk_test_|rk_test_)/.test(env.STRIPE_TEST_SECRET_KEY || '')
    && /^whsec_/.test(env.STRIPE_TEST_WEBHOOK_SECRET || '');
}

function stripeMode(env = process.env) {
  const production = env.NODE_ENV === 'production' || Boolean(env.RENDER || env.RENDER_SERVICE_ID);
  if (production && env.STRIPE_LIVE_CHECKOUT_ENABLED === 'true'
    && /^(sk_live_|rk_live_)/.test(env.STRIPE_LIVE_SECRET_KEY || '')
    && /^whsec_/.test(env.STRIPE_LIVE_WEBHOOK_SECRET || '')) return 'live';
  if (sandboxCheckoutEnabled(env)) return 'test';
  return null;
}

function stripeClient(env = process.env) {
  const mode = stripeMode(env);
  if (!mode) throw new Error('Stripe checkout is not configured.');
  return new Stripe(mode === 'live' ? env.STRIPE_LIVE_SECRET_KEY : env.STRIPE_TEST_SECRET_KEY,
    { apiVersion: '2026-07-29.dahlia' });
}

function cents(value, label) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
    throw new Error(`Invalid ${label} on saved order.`);
  }
  return Math.round(amount * 100);
}

function allocateReduction(lines, amount, eligible) {
  if (!amount) return;
  const indices = lines.map((line, index) => eligible(line) && line.amount > 0 ? index : -1).filter(index => index >= 0);
  let available = indices.reduce((sum, index) => sum + lines[index].amount, 0);
  if (amount > available) throw new Error('Saved order discount exceeds eligible merchandise.');
  let remaining = amount;
  indices.forEach((index, position) => {
    const line = lines[index];
    const share = position === indices.length - 1
      ? remaining
      : Math.min(line.amount, Math.round(remaining * line.amount / available));
    line.amount -= share;
    remaining -= share;
    available -= line.amount + share;
  });
  if (remaining !== 0) throw new Error('Could not allocate saved order discount.');
}

function checkoutSessionParams(order, origin, mode = 'test') {
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 50) {
    throw new Error('Invalid saved order items.');
  }
  const lines = order.items.map(item => {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 || !item.name || !item.sku) {
      throw new Error('Invalid saved order item.');
    }
    return {
      name: `${quantity} × ${String(item.name).slice(0, 160)}`,
      description: `${String(item.spec || '').slice(0, 180)} · SKU ${String(item.sku).slice(0, 32)}`,
      amount: cents(Number(item.unit_price) * quantity, 'item price'),
      promoEligible: item.promo_eligible !== false,
    };
  });
  const subtotal = cents(order.subtotal, 'subtotal');
  if (lines.reduce((sum, line) => sum + line.amount, 0) !== subtotal) {
    throw new Error('Saved order items do not match the subtotal.');
  }
  allocateReduction(lines, cents(order.discount_amount, 'discount'), line => line.promoEligible);
  allocateReduction(lines, cents(order.store_credit_amount, 'store credit'), () => true);
  const extras = [
    ['Shipping', order.shipping_fee],
    ['Packaging', order.packaging_fee],
    ['Processing', order.order_fee],
  ];
  for (const [name, value] of extras) {
    const amount = cents(value, name.toLowerCase());
    if (amount) lines.push({ name, description: `Highland order HP-${order.id}`, amount });
  }
  if (lines.reduce((sum, line) => sum + line.amount, 0) !== cents(order.total, 'total')) {
    throw new Error('Saved order line items do not match the total.');
  }
  const suffix = [...crypto.randomBytes(8)].map(byte => String.fromCharCode(97 + byte % 26)).join('');
  return {
    mode: 'payment',
    line_items: lines.map(line => ({
      price_data: {
        currency: 'usd',
        unit_amount: line.amount,
        product_data: { name: line.name, description: line.description },
      },
      quantity: 1,
    })),
    customer_email: order.buyer.email,
    client_reference_id: `HP-${order.id}`,
    metadata: { order_id: String(order.id) },
    integration_identifier: `highland_research_${suffix}`,
    success_url: `${origin}/success.html?order=${order.id}&stripe_mode=${mode}&stripe_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/cart.html?stripe_cancelled=1`,
  };
}

function verifiedPaidSession(event, mode = 'test') {
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return null;
  const session = event.data && event.data.object;
  const id = Number(session && session.metadata && session.metadata.order_id);
  if (event.livemode !== (mode === 'live') || !session || session.payment_status !== 'paid' ||
    session.mode !== 'payment' || !Number.isSafeInteger(id) || id <= 0 ||
    session.client_reference_id !== `HP-${id}` || !(mode === 'live' ? /^cs_live_/ : /^cs_test_/).test(session.id || '') ||
    !Number.isSafeInteger(session.amount_total) || session.amount_total < 1) return null;
  return { id, sessionId: session.id, amountCents: session.amount_total, currency: session.currency };
}

module.exports = { sandboxCheckoutEnabled, stripeMode, stripeClient, checkoutSessionParams, verifiedPaidSession };
