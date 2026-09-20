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

test('hero launches Glutathione and orders L-Carnitine, Retatrutide, then Tirzepatide', () => {
  const heroStart = indexHtml.indexOf('<aside class="hero-commerce-panel"');
  const heroEnd = indexHtml.indexOf('</aside>', heroStart);
  const hero = indexHtml.slice(heroStart, heroEnd);

  assert.match(hero, /\/product\/glutathione\?sku=GTT9000/);
  assert.match(hero, /300mg\/ml · 30ml \(9,000mg\)/);
  assert.match(hero, /\$38\.99 after code/);

  const lCarnitine = hero.indexOf('/product/l-carnitine?sku=LCARN50');
  const retatrutide = hero.indexOf('/product/retatrutide');
  const tirzepatide = hero.indexOf('/product/tirzepatide');
  assert.ok(lCarnitine > -1 && lCarnitine < retatrutide);
  assert.ok(retatrutide < tirzepatide);
  assert.doesNotMatch(hero, />Retatrutide\s*·|alt="[^"]*Retatrutide/);
  assert.doesNotMatch(hero, />Tirzepatide\s*·|alt="[^"]*Tirzepatide/);
  assert.doesNotMatch(hero, /\/product\/bpc-157/);
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

test('home page offers the requested Discord shipping-updates link', () => {
  assert.match(indexHtml, /href="https:\/\/discord\.gg\/4dfNB78NQr"/);
  assert.match(indexHtml, /Want a photo of your package before it ships\?/);
  assert.match(indexHtml, /package updates, FAQs, and support/);
});

test('customer pages no longer promote or accept TikTok creator-credit submissions', () => {
  const customerSurface = [cartHtml, accountHtml, sharedJs, accountJs].join('\n');
  assert.doesNotMatch(customerSurface, /TikTok|creator.credit|weekly creator/i);
  assert.match(accountRoutes, /Creator-credit submissions are no longer available/);
  assert.match(accountRoutes, /status\(410\)/);
});

test('first-visit account prompt ends with the requested referral and crypto message', () => {
  assert.match(sharedJs, /Create a verified account to <strong>track your order progress<\/strong> and make one personal referral code\. Friends save <strong>10%<\/strong> when they use it, and you earn that same <strong>10% as store credit<\/strong> after Highland reviews the order\. Members also get an extra <strong>5% off crypto orders<\/strong>\.<\/p>/);
});
