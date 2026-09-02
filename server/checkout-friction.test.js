const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cartHtml = fs.readFileSync(path.join(root, 'public', 'cart.html'), 'utf8');
const sharedJs = fs.readFileSync(path.join(root, 'public', 'js', 'shared.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

test('checkout exposes mobile-friendly browser autofill semantics', () => {
  assert.match(cartHtml, /id="checkoutForm"[^>]*autocomplete="on"/);
  ['name', 'email', 'address-line1', 'address-line2', 'address-level2', 'address-level1', 'postal-code', 'country'].forEach(token => {
    assert.match(cartHtml, new RegExp(`autocomplete="${token}"`));
  });
  assert.match(cartHtml, /id="buyerEmail"[^>]*inputmode="email"[^>]*autocapitalize="none"/);
  assert.match(cartHtml, /id="addressAutocompleteMount"/);
  assert.match(cartHtml, /Required when applicable/);
  assert.match(sharedJs, /PlaceAutocompleteElement/);
  assert.match(sharedJs, /gmp-select/);
  assert.match(serverJs, /validatePreparedCheckoutAddress/);
});

test('checkout instrumentation uses anonymous attempt IDs and categorical events', () => {
  assert.match(sharedJs, /hp_checkout_attempt/);
  assert.match(sharedJs, /trackCheckoutEvent\('checkout_start'\)/);
  assert.match(sharedJs, /trackCheckoutEvent\('shipping_info_added'\)/);
  assert.match(sharedJs, /'payment_method_selected'/);
  assert.match(sharedJs, /'checkout_error'/);
  assert.match(sharedJs, /'payment_failed'/);
  assert.match(sharedJs, /analyticsCheckoutAttemptId/);
  assert.doesNotMatch(sharedJs, /trackCheckoutEvent\([^\n]*(buyer|email|address|zip)/i);
});

test('paid conversion is server-confirmed and cannot be posted through the public analytics endpoint', () => {
  const publicEvents = serverJs.match(/const PUBLIC_ANALYTICS_EVENTS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(publicEvents);
  assert.doesNotMatch(publicEvents[1], /payment_confirmed/);
  assert.doesNotMatch(publicEvents[1], /order_created/);
  assert.match(serverJs, /analytics\.recordEvent\(\{ type: 'payment_confirmed'/);
  assert.match(serverJs, /visitorToPaid: rate\(trackedPaidOrders\.length, totals\.uniqueVisitors\)/);
});
