const test = require('node:test');
const assert = require('node:assert/strict');

const { bySku, quantityPricing } = require('./products');

function afterFifteenPercentCode(price) {
  const discount = Math.round(Number(price) * 0.15 * 100) / 100;
  return Math.round((Number(price) - discount) * 100) / 100;
}

test('50ml and 100ml Bac Water use the requested storefront prices', () => {
  assert.equal(bySku.WA50.price, 23.99);
  assert.equal(bySku.WA100.price, 38.99);
  assert.equal(bySku.WA50.promoEligible, true);
  assert.equal(bySku.WA100.promoEligible, true);
  assert.equal(afterFifteenPercentCode(bySku.WA50.price), 20.39);
  assert.equal(afterFifteenPercentCode(bySku.WA100.price), 33.14);
});

test('every Bac Water size is visibly specified at pH 4.5', () => {
  for (const sku of ['WA10', 'WA30', 'WA50', 'WA100']) {
    assert.match(bySku[sku].spec, /pH 4\.5/i);
    assert.match(bySku[sku].description, /pH 4\.5/i);
  }
});

test('100ml Bac Water keeps the established quantity discounts', () => {
  assert.match(bySku.WA100.image, /WA100-sterile-bacteriostatic-clean\.png/);
  assert.equal(quantityPricing(bySku.WA100, 3).savings, 5);
  assert.equal(quantityPricing(bySku.WA100, 5).savings, 10);
});
