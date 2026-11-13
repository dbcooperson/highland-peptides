const test = require('node:test');
const assert = require('node:assert/strict');

const { bySku, quantityPricing } = require('./products');

function afterFifteenPercentCode(price) {
  const discount = Math.round(Number(price) * 0.15 * 100) / 100;
  return Math.round((Number(price) - discount) * 100) / 100;
}

test('50ml and 100ml Bac Water use the requested storefront prices', () => {
  assert.equal(bySku.WA50.price, 24.99);
  assert.equal(bySku.WA100.price, 39.99);
  assert.equal(bySku.WA50.promoEligible, true);
  assert.equal(bySku.WA100.promoEligible, true);
  assert.equal(afterFifteenPercentCode(bySku.WA50.price), 21.24);
  assert.equal(afterFifteenPercentCode(bySku.WA100.price), 33.99);
});

test('Sterile Water never shows a pH value anywhere a shopper can see it', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const sku of ['WA10', 'WA30', 'WA50', 'WA100']) {
    for (const field of ['name', 'spec', 'description', 'labelName', 'labelDose']) {
      assert.doesNotMatch(String(bySku[sku][field] || ''), /\bpH\b/i, `${sku} ${field}`);
    }
  }
  const root = path.join(__dirname, '..');
  for (const rel of ['public/js/shared.js', 'public/js/cart.js', 'public/js/product.js', 'public/js/app.js', 'server/promotions.js',
    'data/descriptions.json', 'public/index.html', 'public/cart.html', 'public/product.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, rel), 'utf8'), /pH 4\.5/i, rel);
  }
});

test('TIKTOK15 adds one free Sterile Water 10ml to the order', () => {
  const { applyCodeGift, codeGift } = require('./promotions');
  const gift = codeGift('tiktok15', bySku);
  assert.deepEqual({ sku: gift.sku, quantity: gift.quantity }, { sku: 'WA10', quantity: 1 });
  const items = applyCodeGift([{ sku: 'RT20', quantity: 1, unit_price: 30.99 }], 'TIKTOK15', bySku);
  assert.equal(items.length, 2);
  assert.equal(items[1].sku, 'WA10');
  assert.equal(items[1].unit_price, 0);
  assert.equal(codeGift('OTHER', bySku), null);
});

test('100ml Bac Water keeps the established quantity discounts', () => {
  assert.match(bySku.WA100.image, /\/snow\/WA100\.webp\?/);
  assert.equal(quantityPricing(bySku.WA100, 3).savings, 5);
  assert.equal(quantityPricing(bySku.WA100, 5).savings, 10);
});
