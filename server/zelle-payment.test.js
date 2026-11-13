const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Zelle is removed from checkout, the server and customer emails', () => {
  const config = require('./config');
  const customerSurface = ['public/cart.html', 'public/index.html', 'public/js/cart.js', 'public/js/shared.js',
    'server/index.js', 'server/notifications.js', 'server/reminders.js'].map(read).join('\n');
  assert.doesNotMatch(customerSurface, /zelle/i);
  assert.equal(config.ZELLE_RECIPIENT, undefined);
  assert.equal(config.ZELLE_PAYMENT_DISCOUNT_RATE, undefined);
  // Older Zelle orders stay readable in the admin.
  assert.match(read('public/js/admin.js'), /Zelle \(legacy\)/);
});

test('PayPal is fully removed from checkout and the server', () => {
  const cartHtml = read('public/cart.html');
  const sharedJs = read('public/js/shared.js');
  const indexJs = read('server/index.js');
  assert.doesNotMatch(cartHtml, /PayPal/i);
  assert.doesNotMatch(sharedJs, /PayPal/i);
  assert.doesNotMatch(indexJs, /paypal/i);
  assert.equal(fs.existsSync(path.join(__dirname, 'paypal.js')), false);
});
