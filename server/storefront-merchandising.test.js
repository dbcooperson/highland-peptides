const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const productHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'product.html'), 'utf8');

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
