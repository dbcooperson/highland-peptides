const test = require('node:test');
const assert = require('node:assert/strict');

const { catalog, bySku, labelDoseFromSpec, quantityPricing } = require('./products');
const { recordsForSkus } = require('./coa');

test('L-Carnitine has a fixed $45.99 pre-code price', () => {
  const product = bySku.LCARN50;
  assert.ok(product);
  assert.equal(product.price, 45.99);
});

test('Glutathione 9,000mg is $38.99 after a 15% code', () => {
  const product = bySku.GTT9000;
  assert.ok(product);
  assert.equal(product.spec, '300mg/ml 30ml (9,000mg)');
  assert.equal(product.price, 45.87);
  assert.equal(Math.round(product.price * 0.85 * 100) / 100, 38.99);
  assert.match(product.description, /oxidative-stress response/i);
  assert.equal(labelDoseFromSpec(product.spec), '300 MG/ML · 30 ML (9,000 MG)');
  assert.equal(catalog[0].sku, 'GTT9000');
});

test('requested CJC 5mg products and Klow have fixed pre-code prices', () => {
  assert.equal(bySku.CP10.price, 29.99);
  assert.equal(bySku.CD5.price, 29.99);
  assert.equal(bySku.CD2, undefined);
  assert.equal(bySku.KLOW80.price, 41.99);
});

test('Retatrutide variants have requested fixed pre-code prices', () => {
  assert.equal(bySku.RT15.price, 24.99);
  assert.equal(bySku.RT20.price, 29.99);
  assert.equal(bySku.RT30.price, 39.99);
});

test('Bacteriostatic Water 10ml has a fixed $8.99 non-promo price', () => {
  const product = bySku.WA10;
  assert.ok(product);
  assert.equal(product.price, 8.99);
  assert.equal(product.promoEligible, false);
});

test('Bacteriostatic Water variants and bundle pricing match the requested prices', () => {
  assert.equal(bySku.WA30.price, 17.98);
  assert.equal(bySku.WA50.price, 27.98);
  assert.equal(bySku.WA30.image, bySku.WA10.image);
  assert.equal(bySku.WA50.image, bySku.WA10.image);

  [bySku.WA10, bySku.WA30, bySku.WA50].forEach(product => {
    assert.equal(product.promoEligible, false);
    assert.deepEqual(quantityPricing(product, 2), {
      quantity: 2,
      savings: 0,
      total: product.price * 2,
    });
    assert.equal(quantityPricing(product, 3).savings, 5);
    assert.equal(quantityPricing(product, 5).savings, 10);
  });

  assert.equal(quantityPricing(bySku.WA10, 3).total, 21.97);
  assert.equal(quantityPricing(bySku.WA30, 3).total, 48.94);
  assert.equal(quantityPricing(bySku.WA50, 5).total, 129.9);
});

test('GHK-Cu variants have fixed .99 pre-code prices', () => {
  const variants = [
    { sku: 'CU', publicPrice: 25.99 },
    { sku: 'CU100', publicPrice: 29.99 },
  ];

  variants.forEach(({ sku, publicPrice }) => {
    const product = bySku[sku];
    assert.ok(product);
    assert.equal(product.price, publicPrice);
  });
});

test('RU58841 is a research-only dropper listing with its dedicated image', () => {
  const product = bySku.RU58841;
  assert.ok(product);
  assert.equal(product.spec, '5% solution, 30ml');
  assert.equal(product.price, 34.99);
  assert.equal(product.containerLabel, 'dropper bottle');
  assert.match(product.image, /\/RU58841-v2\.png\?/);
  assert.match(product.description, /research use only/i);
});

test('Retatrutide 20mg uses the older Janoshik report', () => {
  const report = recordsForSkus(['RT20']).RT20;
  assert.ok(report);
  assert.equal(report.lot, 'Reta20mg · Task 154055');
  assert.equal(report.file, '/coa/retatrutide-20mg-janoshik-154055.png');
  assert.equal(report.purity, '99.610%');
});
