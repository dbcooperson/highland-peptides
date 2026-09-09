const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Zelle checkout uses the configured recipient across customer and admin flows', () => {
  const config = require('./config');
  const cartHtml = read('public/cart.html');
  const cartJs = read('public/js/cart.js');
  const sharedJs = read('public/js/shared.js');
  const indexJs = read('server/index.js');
  const notificationsJs = read('server/notifications.js');
  const adminJs = read('public/js/admin.js');

  assert.equal(config.ZELLE_RECIPIENT, process.env.ZELLE_RECIPIENT || '+1 (213) 424-4643');
  assert.match(cartHtml, /id="zelleCheckoutBtn"/);
  assert.match(cartHtml, /id="zellePaymentRecipient"/);
  assert.match(cartJs, /catalogData\.zelleRecipient/);
  assert.match(sharedJs, /payload\.paymentMethod = 'zelle'/);
  assert.match(sharedJs, /result\.zelle\.recipient/);
  assert.match(sharedJs, /enter only <strong>.*reference.*and nothing else/);
  assert.match(indexJs, /'manual_paypal', 'zelle', 'crypto'/);
  assert.match(indexJs, /response\.zelle = \{ recipient: config\.ZELLE_RECIPIENT/);
  assert.match(notificationsJs, /order\.payment_provider === 'zelle'/);
  assert.match(notificationsJs, /config\.ZELLE_RECIPIENT/);
  assert.match(notificationsJs, /Zelle note: enter only \$\{ref\} and nothing else/);
  assert.match(adminJs, /admin-payment-manual">Zelle/);
});
