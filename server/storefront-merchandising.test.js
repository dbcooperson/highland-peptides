const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const productHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'product.html'), 'utf8');
const cartHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'cart.html'), 'utf8');
const accountHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'account.html'), 'utf8');
const sharedJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shared.js'), 'utf8');
const accountJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'account.js'), 'utf8');
const accountRoutes = fs.readFileSync(path.join(__dirname, 'accounts.js'), 'utf8');

test('homepage Most popular row shows SR-3RT, SR-2TZ, Wolverine Stack, then MOTS-c', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  assert.match(appJs, /const BEST_SELLER_SKUS = \['RT20', 'TR30', 'BB20', 'MS40'\];/);
  assert.match(indexHtml, /<h2>Most popular<\/h2>/);
  assert.match(indexHtml, /id="bestSellersGrid"/);
  const { bySku } = require('./products');
  assert.equal(bySku.RT20.name, 'SR-3RT');
  assert.equal(bySku.TR30.name, 'SR-2TZ');
  assert.match(bySku.BB20.name, /^Wolverine Stack/);
  assert.equal(bySku.MS40.spec, '40mg x1 vial');
});

test('Glutathione launch photograph is present in the generated catalog', () => {
  const imagePath = path.join(__dirname, '..', 'public', 'images', 'product-mockups', 'generated', 'GTT9000.webp');
  assert.equal(fs.existsSync(imagePath), true);
  assert.ok(fs.statSync(imagePath).size > 100000);
});

test('product handling notice excludes storage instructions and states no human use', () => {
  assert.match(productHtml, /<li>Not intended for human use\.<\/li>/);
  assert.doesNotMatch(productHtml, /Storage notes|Store lyophilized material|freeze-thaw/i);
});

test('the storefront no longer links to Discord', () => {
  assert.doesNotMatch(indexHtml, /discord/i);
});

test('the temporary shipping-delay notice has been lifted from the storefront', () => {
  const shared = fs.readFileSync(path.join(__dirname, '../public/js/shared.js'), 'utf8');
  assert.doesNotMatch(shared, /Important shipping delay|allow up to 3 weeks/);
});

test('customer pages no longer promote or accept TikTok creator-credit submissions', () => {
  const customerSurface = [cartHtml, accountHtml, sharedJs, accountJs].join('\n');
  assert.doesNotMatch(customerSurface, /TikTok|creator.credit|weekly creator/i);
  assert.match(accountRoutes, /Creator-credit submissions are no longer available/);
  assert.match(accountRoutes, /status\(410\)/);
});

test('first-visit account prompt no longer advertises referral codes', () => {
  assert.match(sharedJs, /Create a verified account to <strong>track your order progress<\/strong>, keep your order history in one place, and keep any referral store credit in one place\.<\/p>/);
  assert.doesNotMatch(sharedJs, /5% off crypto/);
  assert.doesNotMatch(sharedJs, /referral code\. Friends save/);
});

test('product page has no expiry claim or shipping cutoff countdown', () => {
  const productJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'product.js'), 'utf8');
  assert.doesNotMatch(productJs, /Expiry|Good for the next 2 years|data-shipping-countdown|cutoff/i);
});

test('internal Discord alerts and the shipping-delay email tool are gone', () => {
  for (const rel of ['server/index.js', 'server/notifications.js', 'server/config.js', 'server/db.js', 'public/js/admin.js', 'public/admin.html']) {
    const source = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.doesNotMatch(source, /discord/i, rel);
    assert.doesNotMatch(source, /shipping-delay-notice|ShippingDelayNotice|DelayNotice/, rel);
  }
  assert.equal(fs.existsSync(path.join(__dirname, 'shipping-delay.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, 'btc-monitor.js')), false);
});

test('crypto orders get a flat 15% off that never stacks with codes', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const config = require('./config');
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const cart = fs.readFileSync(path.join(__dirname, '..', 'public', 'cart.html'), 'utf8');
  assert.equal(config.ALT_PAYMENT_DISCOUNT_RATE, 0.15);
  assert.match(index, /if \(cryptoOrder && discountMatch\)/);
  assert.match(index, /cannot be combined with promo or referral codes/);
  assert.doesNotMatch(index, /memberCryptoDiscount/);
  assert.match(cart, /Crypto <em>15% off<\/em>/);
  assert.doesNotMatch(cart, /(^|[^0-9])5% off/);
});
