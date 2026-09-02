const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('hero launches Glutathione and orders L-Carnitine, Retatrutide, then Tirzepatide', () => {
  const heroStart = indexHtml.indexOf('<aside class="hero-commerce-panel"');
  const heroEnd = indexHtml.indexOf('</aside>', heroStart);
  const hero = indexHtml.slice(heroStart, heroEnd);

  assert.match(hero, /\/product\/glutathione\?sku=GTT9000/);
  assert.match(hero, /300mg\/ml · 30ml \(9,000mg\)/);
  assert.match(hero, /\$39\.99 after code/);

  const lCarnitine = hero.indexOf('/product/l-carnitine?sku=LCARN50');
  const retatrutide = hero.indexOf('/product/retatrutide');
  const tirzepatide = hero.indexOf('/product/tirzepatide');
  assert.ok(lCarnitine > -1 && lCarnitine < retatrutide);
  assert.ok(retatrutide < tirzepatide);
  assert.doesNotMatch(hero, /\/product\/bpc-157/);
});

test('Glutathione launch photograph is present in the generated catalog', () => {
  const imagePath = path.join(__dirname, '..', 'public', 'images', 'product-mockups', 'generated', 'GTT9000.webp');
  assert.equal(fs.existsSync(imagePath), true);
  assert.ok(fs.statSync(imagePath).size > 100000);
});
