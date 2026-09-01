const test = require('node:test');
const assert = require('node:assert/strict');

const { bySku } = require('./products');
const { recordsForSkus } = require('./coa');

test('L-Carnitine has a fixed $46.99 pre-code price', () => {
  const product = bySku.LCARN50;
  assert.ok(product);
  assert.equal(product.price, 46.99);
});

test('Bacteriostatic Water 10ml has a fixed $8.99 non-promo price', () => {
  const product = bySku.WA10;
  assert.ok(product);
  assert.equal(product.price, 8.99);
  assert.equal(product.promoEligible, false);
});

test('GHK-Cu variants have fixed .99 pre-code prices', () => {
  const variants = [
    { sku: 'CU', publicPrice: 25.99 },
    { sku: 'CU100', publicPrice: 34.99 },
  ];

  variants.forEach(({ sku, publicPrice }) => {
    const product = bySku[sku];
    assert.ok(product);
    assert.equal(product.price, publicPrice);
  });
});

test('Retatrutide 20mg uses the older Janoshik report', () => {
  const report = recordsForSkus(['RT20']).RT20;
  assert.ok(report);
  assert.equal(report.lot, 'Reta20mg · Task 154055');
  assert.equal(report.file, '/coa/retatrutide-20mg-janoshik-154055.png');
  assert.equal(report.purity, '99.610%');
});
