// Research sets: buying every product in a set takes BUNDLE_DISCOUNT_RATE off
// those units. The discount is worked out here, server-side, from whatever is in
// the cart, so a customer can never set their own price.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { bySku, quantityPricing } = require('./products');

const round2 = value => Math.round(value * 100) / 100;

function loadBundles() {
  const file = path.join(__dirname, '..', 'data', 'bundles.json');
  if (!fs.existsSync(file)) return [];
  const defaultRate = Number(config.BUNDLE_DISCOUNT_RATE || 0);
  return JSON.parse(fs.readFileSync(file, 'utf8'))
    .filter(bundle => Array.isArray(bundle.skus) && bundle.skus.length >= 2 && bundle.skus.every(sku => bySku[sku]))
    .map(bundle => {
      // Each set can set its own "rate" (e.g. 0.05 for a starter set); otherwise the default.
      const rate = Number.isFinite(Number(bundle.rate)) && Number(bundle.rate) >= 0 && Number(bundle.rate) < 0.5
        ? Number(bundle.rate)
        : defaultRate;
      const listPrice = round2(bundle.skus.reduce((sum, sku) => sum + bySku[sku].price, 0));
      return {
        id: bundle.id,
        name: bundle.name,
        tier: bundle.tier || 'full',
        // Optional set photo: public/images/sets/<id>.webp (falls back to the 3 product photos).
        image: fs.existsSync(path.join(__dirname, '..', 'public', 'images', 'sets', `${bundle.id}.webp`))
          ? `/images/sets/${bundle.id}.webp?v=${Math.floor(fs.statSync(path.join(__dirname, '..', 'public', 'images', 'sets', `${bundle.id}.webp`)).mtimeMs)}`
          : null,
        area: bundle.area || '',
        description: bundle.description || '',
        skus: bundle.skus,
        rate,
        listPrice,
        price: round2(listPrice * (1 - rate)),
        savings: round2(listPrice * rate),
      };
    });
}

const bundles = loadBundles();

// Greedy: biggest-saving sets claim units first; each unit counts toward one set.
// Returns, per SKU, how many units are in sets and how many dollars they save.
function allocateBundles(quantities, bundleList = bundles) {
  const remaining = { ...quantities };
  const bundledUnits = {};
  const bundleSavings = {};
  const applied = [];
  for (const bundle of [...bundleList].sort((a, b) => b.savings - a.savings)) {
    const sets = Math.min(...bundle.skus.map(sku => Math.floor(Number(remaining[sku] || 0))));
    if (!(sets > 0)) continue;
    bundle.skus.forEach(sku => {
      remaining[sku] -= sets;
      bundledUnits[sku] = (bundledUnits[sku] || 0) + sets;
      bundleSavings[sku] = round2((bundleSavings[sku] || 0) + bySku[sku].price * bundle.rate * sets);
    });
    applied.push({ id: bundle.id, name: bundle.name, sets, savings: round2(bundle.savings * sets) });
  }
  return { bundledUnits, bundleSavings, applied };
}

// Line total for one SKU: units in sets get their set saving, the rest normal (quantity-tier) pricing.
function linePricing(product, quantity, bundledUnits = 0, savingsPerBundledUnit = 0) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const inSets = Math.min(qty, Math.floor(Number(bundledUnits || 0)));
  const rest = qty - inSets;
  const restPricing = rest > 0 ? quantityPricing(product, rest) : { total: 0, savings: 0 };
  const bundleSavings = round2(Number(savingsPerBundledUnit || 0) * inSets);
  return {
    total: round2(product.price * inSets - bundleSavings + restPricing.total),
    quantitySavings: restPricing.savings,
    bundleSavings,
    bundledUnits: inSets,
  };
}

function publicBundles() {
  return bundles;
}

module.exports = { bundles, publicBundles, allocateBundles, linePricing, loadBundles };
