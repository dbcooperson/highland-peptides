const test = require('node:test');
const assert = require('node:assert/strict');

const { applyBundlePromotion, qualifyingQuantity } = require('./promotions');

const bySku = {
  A: { sku: 'A', name: 'Product A', spec: '10mg x1 vial', category: 'Peptide', group: 'Metabolic' },
  B: { sku: 'B', name: 'Product B', spec: '10mg x1 vial', category: 'Peptide', group: 'Recovery' },
  WA10: { sku: 'WA10', name: 'Bacteriostatic Water', spec: '10ml x1 vial', category: 'Supplies', group: 'Supplies' },
};

test('bundle promotion does not unlock below five paid research products', () => {
  const result = applyBundlePromotion([{ sku: 'A', quantity: 4, unit_price: 20 }], bySku);
  assert.equal(result.applied, false);
  assert.equal(result.items.length, 1);
});

test('bundle promotion adds exactly one free Bac Water at five products', () => {
  const result = applyBundlePromotion([{ sku: 'A', quantity: 3 }, { sku: 'B', quantity: 2 }], bySku);
  assert.equal(result.applied, true);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items[2], {
    sku: 'WA10',
    name: 'Bacteriostatic Water (Free bundle reward)',
    spec: '10ml x1 vial',
    quantity: 1,
    unit_price: 0,
    promotion: 'Buy 5+ research products',
  });
});

test('supplies do not count and large orders still receive only one reward', () => {
  assert.equal(qualifyingQuantity([{ sku: 'A', quantity: 4 }, { sku: 'WA10', quantity: 10 }], bySku), 4);
  const result = applyBundlePromotion([{ sku: 'A', quantity: 12 }, { sku: 'WA10', quantity: 2 }], bySku);
  assert.equal(result.applied, true);
  assert.equal(result.items.filter(item => item.promotion).length, 1);
});
