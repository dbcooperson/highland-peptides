const test = require('node:test');
const assert = require('node:assert/strict');

const { applyBundlePromotion, applyCodeGift, paidSubtotal } = require('./promotions');

const bySku = {
  A: { sku: 'A', name: 'Product A', spec: '10mg x1 vial', category: 'Peptide', group: 'Metabolic' },
  WA10: { sku: 'WA10', name: 'Reconstitution Solution', spec: '10ml x1 vial', category: 'Supplies', group: 'Supplies' },
  WA30: { sku: 'WA30', name: 'Reconstitution Solution', spec: '30ml x1 vial', category: 'Supplies', group: 'Supplies' },
  WA100: { sku: 'WA100', name: 'Reconstitution Solution', spec: '100ml x1 vial', category: 'Supplies', group: 'Supplies' },
};

test('no free water below a $50 product subtotal', () => {
  const result = applyBundlePromotion([{ sku: 'A', quantity: 1, unit_price: 49.99 }], bySku);
  assert.equal(result.applied, false);
  assert.equal(result.items.length, 1);
});

test('exactly one free Reconstitution Solution, sized by the highest tier reached', () => {
  for (const [items, sku, threshold] of [
    [[{ sku: 'A', quantity: 1, unit_price: 50 }], 'WA10', 50],
    [[{ sku: 'A', quantity: 1, unit_price: 89.99 }], 'WA10', 50],
    [[{ sku: 'A', quantity: 1, unit_price: 90 }], 'WA30', 90],
    [[{ sku: 'A', quantity: 5, unit_price: 29.99 }], 'WA30', 90],
    [[{ sku: 'A', quantity: 5, unit_price: 30 }], 'WA100', 150],
    [[{ sku: 'A', quantity: 7, unit_price: 25.99 }], 'WA100', 150],
  ]) {
    const result = applyBundlePromotion(items, bySku);
    assert.equal(result.applied, true);
    const free = result.items.filter(item => item.unit_price === 0);
    assert.equal(free.length, 1, 'tiers never stack');
    assert.equal(free[0].sku, sku);
    assert.equal(free[0].quantity, 1);
    assert.equal(free[0].name, `Reconstitution Solution (Free with orders $${threshold}+)`);
  }
});

test('five cheap products under $50 no longer earn the free water', () => {
  const result = applyBundlePromotion([{ sku: 'A', quantity: 5, unit_price: 9.99 }], bySku);
  assert.equal(result.applied, false);
});

test('free items never count toward the $50', () => {
  assert.equal(paidSubtotal([{ sku: 'A', quantity: 1, unit_price: 40 }, { sku: 'WA10', quantity: 3, unit_price: 0 }]), 40);
});

test('TIKTOK15 water does not stack with the $50 free water', () => {
  const catalog = { ...bySku, WA10: { ...bySku.WA10 } };
  const over50 = applyBundlePromotion([{ sku: 'A', quantity: 1, unit_price: 60 }], catalog).items; // $50 tier = WA10
  const withCode = applyCodeGift(over50, 'TIKTOK15', catalog);
  assert.equal(withCode.filter(item => item.sku === 'WA10' && item.unit_price === 0).length, 1);

  const under50 = applyBundlePromotion([{ sku: 'A', quantity: 1, unit_price: 30 }], catalog).items;
  const codeOnly = applyCodeGift(under50, 'TIKTOK15', catalog);
  assert.equal(codeOnly.filter(item => item.sku === 'WA10' && item.unit_price === 0).length, 1);
});

test('a customer who buys water still gets the free one on top', () => {
  const items = applyBundlePromotion([{ sku: 'A', quantity: 1, unit_price: 45 }, { sku: 'WA10', quantity: 1, unit_price: 9.99 }], bySku).items;
  assert.equal(items.filter(item => item.sku === 'WA10').length, 2);
});
