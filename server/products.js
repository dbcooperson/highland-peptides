const fs = require('fs');
const path = require('path');
const { MARKUP_MULTIPLIER, PRICE_DECIMALS } = require('./config');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'));

function round(n, d) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// Public catalog: cost is never exposed to the frontend, only the sale price.
// salePrice, when set, overrides the cost*markup formula (used for items priced
// directly off a competitor reference rather than our own supplier cost).
const catalog = raw.map(p => ({
  sku: p.sku,
  name: p.name,
  spec: p.spec,
  category: p.category,
  group: p.group,
  price: round(p.salePrice != null ? p.salePrice : p.cost * MARKUP_MULTIPLIER, PRICE_DECIMALS),
}));

const bySku = Object.fromEntries(catalog.map(p => [p.sku, p]));

module.exports = { catalog, bySku };
