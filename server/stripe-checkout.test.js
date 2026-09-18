const test = require('node:test');
const assert = require('node:assert/strict');
const { sandboxCheckoutEnabled, stripeMode, checkoutSessionParams, verifiedPaidSession } = require('./stripe-checkout');
const { catalog, quantityPricing } = require('./products');

test('Stripe checkout requires a test key, webhook secret and explicit local opt-in', () => {
  const env = { STRIPE_SANDBOX_CHECKOUT_ENABLED: 'true', STRIPE_TEST_SECRET_KEY: 'sk_test_example', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_example' };
  assert.equal(sandboxCheckoutEnabled(env), true);
  assert.equal(sandboxCheckoutEnabled({ ...env, NODE_ENV: 'production' }), false);
  assert.equal(sandboxCheckoutEnabled({ ...env, RENDER: 'true' }), false);
  assert.equal(sandboxCheckoutEnabled({ ...env, STRIPE_TEST_SECRET_KEY: 'sk_live_example' }), false);
});

test('live checkout requires production, an explicit switch and separate live credentials', () => {
  const env = { NODE_ENV: 'production', STRIPE_LIVE_CHECKOUT_ENABLED: 'true',
    STRIPE_LIVE_SECRET_KEY: 'rk_live_example', STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_example' };
  assert.equal(stripeMode(env), 'live');
  assert.equal(stripeMode({ ...env, STRIPE_LIVE_CHECKOUT_ENABLED: 'false' }), null);
  assert.equal(stripeMode({ ...env, STRIPE_LIVE_SECRET_KEY: 'sk_test_example' }), null);
  assert.equal(stripeMode({ ...env, STRIPE_LIVE_WEBHOOK_SECRET: '' }), null);
  assert.equal(stripeMode({ ...env, NODE_ENV: 'development' }), null);
});

test('Checkout shows saved products and fees while charging the exact discounted order total', () => {
  const params = checkoutSessionParams({
    id: 123, subtotal: 49.99, discount_amount: 5, store_credit_amount: 4,
    shipping_fee: 7.50, packaging_fee: 0, order_fee: 1, total: 49.49,
    buyer: { email: 'test@example.com' },
    items: [
      { sku: '2S10', name: 'HP-31', spec: '10 mg', quantity: 2, unit_price: 15, promo_eligible: true },
      { sku: 'WA10', name: 'Sterile Water', spec: '10 ml', quantity: 1, unit_price: 19.99, promo_eligible: false },
    ],
  }, 'http://localhost:3000');
  assert.equal(params.line_items.length, 4);
  assert.equal(params.line_items[0].price_data.product_data.name, '2 × HP-31');
  assert.match(params.line_items[0].price_data.product_data.description, /10 mg · SKU 2S10/);
  assert.equal(params.line_items.reduce((sum, line) => sum + line.price_data.unit_amount, 0), 4949);
  assert.equal(params.line_items[2].price_data.product_data.name, 'Shipping');
  assert.equal(params.metadata.order_id, '123');
  assert.match(params.success_url, /\{CHECKOUT_SESSION_ID\}/);
  assert.ok(!('payment_method_types' in params));
});

test('Checkout displays free reward and distributes discounts across eligible products', () => {
  const params = checkoutSessionParams({
    id: 124, subtotal: 30, discount_amount: 10, store_credit_amount: 5,
    shipping_fee: 3, total: 18, buyer: { email: 'test@example.com' },
    items: [
      { sku: 'A', name: 'A', quantity: 1, unit_price: 10, promo_eligible: true },
      { sku: 'B', name: 'B', quantity: 1, unit_price: 20, promo_eligible: true },
      { sku: 'FREE', name: 'Bundle reward', quantity: 1, unit_price: 0 },
    ],
  }, 'http://localhost:3000');
  assert.equal(params.line_items[2].price_data.unit_amount, 0);
  assert.deepEqual(params.line_items.map(line => line.price_data.unit_amount), [500, 1000, 0, 300]);
});

test('Checkout refuses a mismatched saved subtotal or total before contacting Stripe', () => {
  const order = {
    id: 125, subtotal: 10, total: 10, buyer: { email: 'test@example.com' },
    items: [{ sku: 'A', name: 'A', quantity: 1, unit_price: 10 }],
  };
  assert.throws(() => checkoutSessionParams({ ...order, subtotal: 12 }, 'http://localhost:3000'), /subtotal/);
  assert.throws(() => checkoutSessionParams({ ...order, total: 9 }, 'http://localhost:3000'), /total/);
  assert.throws(() => checkoutSessionParams({ ...order, discount_amount: 11, total: 0 }, 'http://localhost:3000'), /discount/);
});

test('all catalog quantity tiers preserve the server-calculated cent total', () => {
  for (const product of catalog) {
    for (const quantity of [1, 3, 5, 99]) {
      const pricing = quantityPricing(product, quantity);
      const params = checkoutSessionParams({
        id: 126, subtotal: pricing.total, total: pricing.total + 5,
        shipping_fee: 5, buyer: { email: 'test@example.com' },
        items: [{ sku: product.sku, name: product.name, spec: product.spec,
          quantity, unit_price: pricing.total / quantity, promo_eligible: product.promoEligible }],
      }, 'http://localhost:3000');
      assert.equal(params.line_items.reduce((sum, line) => sum + line.price_data.unit_amount, 0),
        Math.round((pricing.total + 5) * 100), `${product.sku} × ${quantity}`);
    }
  }
});

test('Paid-session verification rejects live, unpaid and mismatched references', () => {
  const event = { livemode: false, type: 'checkout.session.completed', data: { object: { id: 'cs_test_123', mode: 'payment', payment_status: 'paid', amount_total: 3499, currency: 'usd', metadata: { order_id: '123' }, client_reference_id: 'HP-123' } } };
  assert.deepEqual(verifiedPaidSession(event), { id: 123, sessionId: 'cs_test_123', amountCents: 3499, currency: 'usd' });
  assert.equal(verifiedPaidSession({ ...event, livemode: true }), null);
  assert.equal(verifiedPaidSession({ ...event, data: { object: { ...event.data.object, payment_status: 'unpaid' } } }), null);
  assert.equal(verifiedPaidSession({ ...event, data: { object: { ...event.data.object, client_reference_id: 'HP-456' } } }), null);
  const live = { ...event, livemode: true, data: { object: { ...event.data.object, id: 'cs_live_123' } } };
  assert.deepEqual(verifiedPaidSession(live, 'live'), { id: 123, sessionId: 'cs_live_123', amountCents: 3499, currency: 'usd' });
  assert.equal(verifiedPaidSession(event, 'live'), null);
  assert.equal(verifiedPaidSession({ ...live, data: { object: { ...live.data.object, id: 'cs_test_123' } } }, 'live'), null);
});
