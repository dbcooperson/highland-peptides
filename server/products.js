const fs = require('fs');
const path = require('path');
const { MARKUP_MULTIPLIER, PRICE_ADJUSTMENT, PRICE_DECIMALS, PRICE_OFFSET, PRICE_ENDINGS } = require('./config');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'));
const descriptions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'descriptions.json'), 'utf8'));

function round(n, d) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function prettyPrice(amount) {
  const target = amount + PRICE_OFFSET;
  const floor = Math.floor(target);
  const endings = Array.isArray(PRICE_ENDINGS) && PRICE_ENDINGS.length ? PRICE_ENDINGS : [0.25, 0.50, 0.75, 0.99];
  const candidates = [];

  for (let dollar = Math.max(0, floor - 1); dollar <= floor + 2; dollar += 1) {
    endings.forEach(ending => candidates.push(round(dollar + ending, PRICE_DECIMALS)));
  }

  return candidates
    .filter(price => price > 0)
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || b - a)[0];
}

function specSortValue(spec) {
  const text = String(spec || '').toLowerCase();
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(mcg|mg|iu|ml)/g)];
  if (!matches.length) return Number.MAX_SAFE_INTEGER;

  return matches.reduce((total, match) => {
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit === 'mcg') return total + amount / 1000;
    if (unit === 'iu') return total + amount / 1000000;
    if (unit === 'ml') return total + amount * 1000000;
    return total + amount;
  }, 0);
}

function compareVariants(a, b) {
  const specDifference = specSortValue(a.spec) - specSortValue(b.spec);
  if (specDifference !== 0) return specDifference;
  return a.price - b.price || a.spec.localeCompare(b.spec);
}
// Curated by general market popularity, not sales data (this business is new).
// Sets both catalog order and which items appear in "Best Sellers".
const POPULAR_SKUS = [
  'BC10', 'BT10', 'TR30', 'SM10', 'RT20', 'CGL5', 'CP10',
  'ML10', 'TA10', 'MS10', 'ET10', 'NJ500',
];
const popularRank = Object.fromEntries(POPULAR_SKUS.map((sku, i) => [sku, i]));

// Public catalog: cost is never exposed to the frontend, only the sale price.
// salePrice, when set, overrides the cost*markup formula (used for items priced
// directly off a competitor reference rather than our own supplier cost).
const catalog = raw
  .map(p => ({
    sku: p.sku,
    name: p.name,
    spec: p.spec,
    category: p.category,
    group: p.group,
    slug: slugify(p.name),
    popular: popularRank[p.sku] !== undefined,
    description: descriptions[p.name] || '',
    price: prettyPrice((p.salePrice != null ? p.salePrice : p.cost * MARKUP_MULTIPLIER) * PRICE_ADJUSTMENT),
  }))
  .sort((a, b) => {
    const aRank = popularRank[a.sku];
    const bRank = popularRank[b.sku];
    if (aRank !== undefined || bRank !== undefined) {
      return (aRank ?? 999) - (bRank ?? 999);
    }
    return a.group.localeCompare(b.group) || a.name.localeCompare(b.name);
  });

const bySku = Object.fromEntries(catalog.map(p => [p.sku, p]));
const bySlug = Object.fromEntries(catalog.map(p => [p.slug, p]));

// Resolves a SKU or slug to its full product family (all spec variants sharing
// the same name) for the product detail page, e.g. "ET10" / "epithalon" -> the
// whole Epithalon family.
function getProductFamily({ sku, slug }) {
  const product = (sku && bySku[sku]) || (slug && bySlug[slug]);
  if (!product) return null;
  const variants = catalog
    .filter(p => p.name === product.name)
    .sort(compareVariants);
  return {
    name: product.name,
    slug: product.slug,
    description: descriptions[product.name] || '',
    category: product.category,
    group: product.group,
    variants,
  };
}

module.exports = { catalog, bySku, bySlug, getProductFamily };
