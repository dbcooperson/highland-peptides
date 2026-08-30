const test = require('node:test');
const assert = require('node:assert/strict');

const { bySku } = require('./products');
const { recordsForSkus } = require('./coa');

test('L-Carnitine is $40 after a 15% promo code', () => {
  const product = bySku.LCARN50;
  assert.ok(product);
  assert.equal(product.price, 47.06);

  const discount = Math.round(product.price * 0.15 * 100) / 100;
  assert.equal(product.price - discount, 40);
});

test('Bacteriostatic Water 10ml has a fixed $8.99 non-promo price', () => {
  const product = bySku.WA10;
  assert.ok(product);
  assert.equal(product.price, 8.99);
  assert.equal(product.promoEligible, false);
});

test('Retatrutide 20mg uses the older Janoshik report', () => {
  const report = recordsForSkus(['RT20']).RT20;
  assert.ok(report);
  assert.equal(report.lot, 'Reta20mg · Task 154055');
  assert.equal(report.file, '/coa/retatrutide-20mg-janoshik-154055.png');
  assert.equal(report.purity, '99.610%');
});
