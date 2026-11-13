const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bundles, allocateBundles, linePricing } = require('./bundles');
const { bySku } = require('./products');

test('full sets are 10% off, starter sets 5% off, all with real products', () => {
  assert.ok(bundles.length >= 5);
  for (const bundle of bundles) {
    for (const sku of bundle.skus) assert.ok(bySku[sku], `${bundle.id}: ${sku} missing`);
    const expectedRate = bundle.tier === 'starter' ? 0.05 : 0.10;
    assert.equal(bundle.rate, expectedRate, bundle.id);
    assert.equal(bundle.price, Math.round(bundle.listPrice * (1 - expectedRate) * 100) / 100);
  }
  assert.ok(bundles.some(bundle => bundle.tier === 'starter'));
});

test('a full set and a starter set in one cart each get their own rate', () => {
  const result = allocateBundles({ MS40: 2, RT30: 1, TSM20: 1, RT20: 1, TSM10: 1 });
  assert.deepEqual(result.applied.map(a => a.id).sort(), ['metabolic', 'metabolic-starter']);
  assert.equal(result.bundleSavings.RT30, Math.round(bySku.RT30.price * 0.10 * 100) / 100);
  assert.equal(result.bundleSavings.RT20, Math.round(bySku.RT20.price * 0.05 * 100) / 100);
  assert.equal(result.bundleSavings.MS40, Math.round(bySku.MS40.price * 0.15 * 100) / 100);
});

test('a set only counts when every item is in the cart, and each unit counts once', () => {
  const metabolic = bundles.find(b => b.id === 'metabolic');
  assert.equal(allocateBundles({ MS40: 1, RT30: 1 }).applied.length, 0);
  const full = allocateBundles({ MS40: 1, RT30: 1, TSM20: 1 });
  assert.deepEqual(full.applied.map(a => [a.id, a.sets]), [['metabolic', 1]]);
  const two = allocateBundles({ MS40: 2, RT30: 2, TSM20: 2 });
  assert.equal(two.applied[0].sets, 2);
  // MS40 is in several sets; one unit can only discount one of them.
  const shared = allocateBundles({ MS40: 1, RT30: 1, TSM20: 1, '2S50': 1, NJ1000: 1 });
  assert.equal(shared.applied.length, 1);
  assert.equal(shared.applied[0].savings, metabolic.savings);
});

test('line price: set units at 10% off, extra units at normal price', () => {
  const product = bySku.BC10;
  const perUnit = Math.round(product.price * 0.10 * 100) / 100;
  const pricing = linePricing(product, 3, 1, perUnit);
  assert.equal(pricing.bundledUnits, 1);
  assert.equal(pricing.bundleSavings, perUnit);
  assert.ok(pricing.total < product.price * 3);
});

test('checkout prices sets server-side; storefront mirrors it for display only', () => {
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(index, /const bundleAllocation = allocateBundles\(cartQuantities\)/);
  assert.match(index, /bundle_discount: pricing\.bundleSavings/);
  const shared = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shared.js'), 'utf8');
  assert.match(shared, /function cartLinePricing/);
  assert.match(shared, /function smartCartSuggestions/);
});
