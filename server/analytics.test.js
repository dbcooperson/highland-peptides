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
    store.recordEvent({ type: 'checkout_start', visitorId: 'visitor-a', sessionId: 'session-a' });
    store.recordEvent({ type: 'order_created', visitorId: 'visitor-a', sessionId: 'session-a' });

    const summary = store.getSummary(7);
    assert.equal(summary.totals.pageViews, 2);
    assert.equal(summary.totals.uniqueVisitors, 1);
    assert.equal(summary.totals.sessions, 1);
    assert.equal(summary.totals.productViews, 1);
    assert.equal(summary.totals.addToCarts, 1);
    assert.equal(summary.totals.checkoutStarts, 1);
    assert.equal(summary.totals.ordersCreated, 1);
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
