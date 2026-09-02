const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { createAnalyticsStore } = require('./analytics');

test('analytics aggregates anonymous traffic and funnel events', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-analytics-'));
  const filePath = path.join(directory, 'analytics.json');
  const store = createAnalyticsStore(filePath);

  try {
    store.recordEvent({ type: 'page_view', visitorId: 'visitor-a', sessionId: 'session-a', path: '/', source: 'Direct / unknown' });
    store.recordEvent({ type: 'page_view', visitorId: 'visitor-a', sessionId: 'session-a', path: '/product/bpc-157', source: 'Internal navigation' });
    store.recordEvent({ type: 'product_view', visitorId: 'visitor-a', sessionId: 'session-a', sku: 'BC20', productName: 'BPC-157' });
    store.recordEvent({ type: 'add_to_cart', visitorId: 'visitor-a', sessionId: 'session-a', sku: 'BC20', productName: 'BPC-157', quantity: 2 });
    store.recordEvent({ type: 'checkout_start', visitorId: 'visitor-a', sessionId: 'session-a', checkoutAttemptId: 'attempt-a' });
    store.recordEvent({ type: 'checkout_error', visitorId: 'visitor-a', sessionId: 'session-a', checkoutAttemptId: 'attempt-a', stage: 'validation', reason: 'missing_fields' });
    store.recordEvent({ type: 'shipping_info_added', visitorId: 'visitor-a', sessionId: 'session-a', checkoutAttemptId: 'attempt-a' });
    store.recordEvent({ type: 'payment_method_selected', visitorId: 'visitor-a', sessionId: 'session-a', checkoutAttemptId: 'attempt-a', paymentMethod: 'manual_paypal' });
    store.recordEvent({ type: 'payment_failed', visitorId: 'visitor-a', sessionId: 'session-a', checkoutAttemptId: 'attempt-a', paymentMethod: 'manual_paypal', reason: 'network_error' });
    store.recordEvent({ type: 'order_created', visitorId: 'visitor-a', sessionId: 'session-a' });
    store.recordEvent({ type: 'payment_confirmed', visitorId: 'visitor-a', sessionId: 'session-a' });

    const summary = store.getSummary(7);
    assert.equal(summary.totals.pageViews, 2);
    assert.equal(summary.totals.uniqueVisitors, 1);
    assert.equal(summary.totals.sessions, 1);
    assert.equal(summary.totals.productViews, 1);
    assert.equal(summary.totals.addToCarts, 1);
    assert.equal(summary.totals.checkoutStarts, 1);
    assert.equal(summary.totals.checkoutErrors, 1);
    assert.equal(summary.totals.shippingInfoAdded, 1);
    assert.equal(summary.totals.paymentMethodsSelected, 1);
    assert.equal(summary.totals.paymentFailures, 1);
    assert.equal(summary.totals.paymentsConfirmed, 1);
    assert.equal(summary.totals.ordersCreated, 1);
    assert.deepEqual(summary.checkout.errors[0], { name: 'validation|missing_fields', count: 1 });
    assert.deepEqual(summary.checkout.paymentMethods[0], { name: 'manual_paypal', count: 1 });
    assert.deepEqual(summary.checkout.paymentFailures[0], { name: 'manual_paypal|network_error', count: 1 });
    assert.deepEqual(summary.topProducts[0], {
      sku: 'BC20',
      name: 'BPC-157',
      views: 1,
      adds: 2,
      addRate: 200,
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('analytics deduplicates repeated checkout events within one anonymous attempt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-analytics-'));
  const store = createAnalyticsStore(path.join(directory, 'analytics.json'));

  try {
    const common = { visitorId: 'visitor-a', sessionId: 'session-a', checkoutAttemptId: 'attempt-a' };
    store.recordEvent({ type: 'checkout_start', ...common });
    store.recordEvent({ type: 'checkout_start', ...common });
    store.recordEvent({ type: 'payment_method_selected', paymentMethod: 'manual_paypal', ...common });
    store.recordEvent({ type: 'payment_method_selected', paymentMethod: 'manual_paypal', ...common });
    store.recordEvent({ type: 'payment_method_selected', paymentMethod: 'crypto', ...common });

    const summary = store.getSummary(7);
    assert.equal(summary.totals.checkoutStarts, 1);
    assert.equal(summary.totals.paymentMethodsSelected, 2);
    assert.deepEqual(summary.checkout.paymentMethods, [
      { name: 'manual_paypal', count: 1 },
      { name: 'crypto', count: 1 },
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('analytics ignores unsupported event names', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-analytics-'));
  const store = createAnalyticsStore(path.join(directory, 'analytics.json'));

  try {
    assert.equal(store.recordEvent({ type: 'email_address', visitorId: 'visitor-a' }), false);
    assert.equal(store.getSummary(7).totals.pageViews, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('checkout analytics retains only bounded categorical metadata', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-analytics-'));
  const store = createAnalyticsStore(path.join(directory, 'analytics.json'));

  try {
    store.recordEvent({
      type: 'checkout_error',
      visitorId: 'visitor-a',
      stage: 'validation',
      reason: 'invalid_email',
      email: 'customer@example.com',
      address: '123 Private Street',
    });
    const raw = fs.readFileSync(path.join(directory, 'analytics.json'), 'utf8');
    assert.doesNotMatch(raw, /customer@example\.com|Private Street/);
    assert.deepEqual(store.getSummary(7).checkout.errors[0], { name: 'validation|invalid_email', count: 1 });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
