const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { catalog, bySku, getProductFamily, labelDoseFromSpec, quantityPricing } = require('./products');
const { recordsForSkus } = require('./coa');

test('L-Carnitine has a fixed $45.99 pre-code price', () => {
  const product = bySku.LCARN50;
  assert.ok(product);
  assert.equal(product.price, 45.99);
});

test('Glutathione 9,000mg has a .99 storefront price', () => {
  const product = bySku.GTT9000;
  assert.ok(product);
  assert.equal(product.spec, '300mg/ml 30ml (9,000mg)');
  assert.equal(product.price, 45.99);
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

test('HP-3RT and HP-TRZ use brand-only display names while retaining original product URLs', () => {
  assert.equal(bySku.RT20.name, 'HP-3RT');
  assert.equal(bySku.TR30.name, 'HP-TRZ');
  const tesa = catalog.find(product => product.compoundName === 'Tesamorelin');
  assert.ok(tesa);
  assert.equal(tesa.name, 'HP-TSM (Tesamorelin)');
  assert.equal(bySku.RT20.slug, 'retatrutide');
  assert.equal(bySku['2S10'].name, 'HP-31 (SS-31)');
  assert.equal(bySku['2S50'].name, 'HP-31 (SS-31)');
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
  assert.match(bySku.WA10.name, /^Sterile Water \(Bacteriostatic, 0\.9% benzyl alcohol\)$/);
  assert.equal(bySku.WA10.compoundName, 'Bacteriostatic Water');
  assert.equal(bySku.WA10.slug, 'bacteriostatic-water');
});

test('Bacteriostatic Water 10ml has a fixed $8.99 non-promo price', () => {
  const product = bySku.WA10;
  assert.ok(product);
  assert.equal(product.price, 8.99);
  assert.equal(product.promoEligible, false);
});

test('Bacteriostatic Water variants and bundle pricing match the requested prices', () => {
  assert.equal(bySku.WA30.price, 17.99);
  assert.equal(bySku.WA50.price, 23.99);
  assert.equal(bySku.WA100.price, 38.99);
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

  assert.equal(quantityPricing(bySku.WA10, 3).total, 21.97);
  assert.equal(quantityPricing(bySku.WA30, 3).total, 48.97);
  assert.equal(quantityPricing(bySku.WA50, 5).total, 109.95);
  assert.equal(quantityPricing(bySku.WA100, 5).total, 184.95);
});

test('renamed products use strength-specific branded images', () => {
  for (const sku of ['RT15', 'RT20', 'RT30', 'TR20', 'TR30', 'TR40', 'TSM10', 'TSM20', 'WA10', 'WA30', 'WA50', 'WA100']) {
    const product = bySku[sku];
    const imagePath = path.join(__dirname, '..', 'public', product.image.split('?')[0].replace(/^\//, ''));
    assert.equal(fs.existsSync(imagePath), true, sku);
    assert.ok(fs.statSync(imagePath).size > 100000, sku);
    assert.match(product.image, new RegExp(`/${sku}-(?:branded|sterile-bacteriostatic)-clean\\.png`), sku);
  }
});

test('HP-31 variants use separate matching vial images', () => {
  for (const sku of ['2S10', '2S50']) {
    const product = bySku[sku];
    const imagePath = path.join(__dirname, '..', 'public', product.image.split('?')[0].replace(/^\//, ''));
    assert.equal(fs.existsSync(imagePath), true, sku);
    assert.match(product.image, new RegExp(`/${sku}-HP-31-clean\\.png`));
  }
});

test('every public catalog price ends in .99', () => {
  catalog.forEach(product => {
    assert.equal(Math.round(product.price * 100) % 100, 99, `${product.sku} price`);
  });
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
