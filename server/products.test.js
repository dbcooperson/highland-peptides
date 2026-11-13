const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { catalog, bySku, getProductFamily, labelDoseFromSpec, quantityPricing } = require('./products');
const { recordsForSkus } = require('./coa');

test('L-Carnitine has a fixed $46.99 pre-code price', () => {
  const product = bySku.LCARN50;
  assert.ok(product);
  assert.equal(product.price, 46.99);
});

test('Glutathione 9,000mg has a .99 storefront price', () => {
  const product = bySku.GTT9000;
  assert.ok(product);
  assert.equal(product.spec, '300mg/ml 30ml (9,000mg)');
  assert.equal(product.price, 46.99);
  assert.match(product.description, /oxidative stress/i);
  assert.equal(labelDoseFromSpec(product.spec), '300 MG/ML');
  assert.equal(catalog[0].sku, 'GTT9000');
});

test('requested CJC 5mg products and Klow have fixed pre-code prices', () => {
  assert.equal(bySku.CP10.price, 30.99);
  assert.equal(bySku.CD5.price, 30.99);
  assert.equal(bySku.CD2, undefined);
  assert.equal(bySku.KLOW80.price, 42.99);
});

test('Retatrutide variants have requested fixed pre-code prices', () => {
  assert.equal(bySku.RT15.price, 25.99);
  assert.equal(bySku.RT20.price, 30.99);
  assert.equal(bySku.RT30.price, 40.99);
});

test('SR-3RT and SR-2TZ use brand-only display names while retaining original product URLs', () => {
  assert.equal(bySku.RT20.name, 'SR-3RT');
  assert.equal(bySku.TR30.name, 'SR-2TZ');
  const tesa = catalog.find(product => product.compoundName === 'Tesamorelin');
  assert.ok(tesa);
  assert.equal(tesa.name, 'SR-TSM');
  assert.equal(bySku.RT20.slug, 'retatrutide');
  assert.equal(bySku['2S10'].name, 'SR-31');
  assert.equal(bySku['2S50'].name, 'SR-31');
  assert.equal(bySku['2S10'].slug, 'ss-31');
});

test('Oxytocin is not listed or purchasable in the current catalog', () => {
  assert.equal(bySku.OT10, undefined);
  assert.equal(getProductFamily({ slug: 'oxytocin-acetate' }), null);
  assert.equal(catalog.some(product => /oxytocin/i.test(product.name)), false);
});

test('HCG variants are not listed or purchasable in the current catalog', () => {
  assert.equal(bySku.G5K, undefined);
  assert.equal(bySku.G10K, undefined);
  assert.equal(getProductFamily({ slug: 'hcg' }), null);
  assert.equal(catalog.some(product => product.name === 'HCG'), false);
});

test('water is displayed as sterile while disclosing the bacteriostatic preservative', () => {
  assert.equal(bySku.WA10.name, 'Reconstitution Solution');
  assert.equal(bySku.WA10.compoundName, 'Bacteriostatic Water');
  assert.equal(bySku.WA10.labelName, 'RECONSTITUTION SOLUTION');
  assert.equal(bySku.WA10.slug, 'bacteriostatic-water');
});

test('Bacteriostatic Water 10ml has a fixed $9.99 non-promo price', () => {
  const product = bySku.WA10;
  assert.ok(product);
  assert.equal(product.price, 9.99);
  assert.equal(product.promoEligible, false);
});

test('Bacteriostatic Water variants and bundle pricing match the requested prices', () => {
  assert.equal(bySku.WA30.price, 18.99);
  assert.equal(bySku.WA50.price, 24.99);
  assert.equal(bySku.WA100.price, 39.99);
  for (const sku of ['WA30', 'WA50', 'WA100']) assert.notEqual(bySku[sku].image, bySku.WA10.image);

  [bySku.WA10, bySku.WA30].forEach(product => {
    assert.equal(product.promoEligible, false);
    assert.deepEqual(quantityPricing(product, 2), {
      quantity: 2,
      savings: 0,
      total: product.price * 2,
    });
    assert.equal(quantityPricing(product, 3).savings, 5);
    assert.equal(quantityPricing(product, 5).savings, 10);
  });
  [bySku.WA50, bySku.WA100].forEach(product => {
    assert.equal(product.promoEligible, true);
    assert.equal(quantityPricing(product, 3).savings, 5);
    assert.equal(quantityPricing(product, 5).savings, 10);
  });

  assert.equal(quantityPricing(bySku.WA10, 3).total, 24.97);
  assert.equal(quantityPricing(bySku.WA30, 3).total, 51.97);
  assert.equal(quantityPricing(bySku.WA50, 5).total, 114.95);
  assert.equal(quantityPricing(bySku.WA100, 5).total, 189.95);
});

test('every product uses its Snowy Research snow photo', () => {
  catalog.forEach(product => {
    const imagePath = path.join(__dirname, '..', 'public', product.image.split('?')[0].replace(/^\//, ''));
    assert.equal(fs.existsSync(imagePath), true, product.sku);
    assert.match(product.image, new RegExp(`/product-mockups/snow/${product.sku}\\.webp\\?`), product.sku);
  });
});

test('every public catalog price ends in .99', () => {
  catalog.forEach(product => {
    assert.equal(Math.round(product.price * 100) % 100, 99, `${product.sku} price`);
  });
});

test('GHK-Cu variants have fixed .99 pre-code prices', () => {
  const variants = [
    { sku: 'CU', publicPrice: 26.99 },
    { sku: 'CU100', publicPrice: 30.99 },
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
  assert.equal(product.spec, '5% solution, 30ml (1,500mg)');
  assert.equal(product.price, 35.99);
  assert.equal(product.containerLabel, 'dropper bottle');
  assert.match(product.description, /research use only/i);
});

test('Retatrutide 20mg uses the older Janoshik report', () => {
  const report = recordsForSkus(['RT20']).RT20;
  assert.ok(report);
  assert.equal(report.lot, 'Reta20mg · Task 154055');
  assert.equal(report.file, '/coa/retatrutide-20mg-janoshik-154055.png');
  assert.equal(report.purity, '99.610%');
});
