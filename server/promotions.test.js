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
    promotion: 'Buy 5+ paid research products (Bac Water excluded)',
  });
});

test('supplies do not count and large orders still receive only one reward', () => {
  const fourProductsPlusWater = applyBundlePromotion([{ sku: 'A', quantity: 4 }, { sku: 'WA10', quantity: 1 }], bySku);
  assert.equal(fourProductsPlusWater.eligibleQuantity, 4);
  assert.equal(fourProductsPlusWater.applied, false);
  const result = applyBundlePromotion([{ sku: 'A', quantity: 12 }, { sku: 'WA10', quantity: 2 }], bySku);
  assert.equal(result.applied, true);
  assert.equal(result.items.filter(item => item.promotion).length, 1);
});
