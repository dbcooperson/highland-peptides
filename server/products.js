const fs = require('fs');
const path = require('path');
const { MARKUP_MULTIPLIER, PRICE_ADJUSTMENT, PUBLIC_PRICE_MULTIPLIER, PRICE_DECIMALS } = require('./config');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf8'));
const descriptions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'descriptions.json'), 'utf8'));
const PRODUCT_IMAGE_REVISION = 'offwhite-closeup-20260825';

// Customer-facing brand names. The underlying catalog identity remains available
// internally for legacy URLs, search aliases, COA matching, and fulfillment.
const DISPLAY_NAME_OVERRIDES = {
  Tirzepatide: 'HP-TRZ',
  Retatrutide: 'HP-3RT',
  Tesamorelin: 'HP-TSM',
  'SS-31': 'HP-31',
};

function publicProductName(name) {
  const code = DISPLAY_NAME_OVERRIDES[name];
  if (name === 'Bacteriostatic Water') return 'Sterile Water (Bacteriostatic, 0.9% benzyl alcohol)';
  if (name === 'Tirzepatide' || name === 'Retatrutide') return code;
  return code ? `${code} (${name})` : name;
}

const LABEL_NAME_OVERRIDES = {
  'CJC-1295 without DAC + Ipamorelin': 'CJC W/O DAC + IPA',
  'CJC-1295 without DAC': 'CJC W/O DAC',
  'Cagrilintide + Semaglutide': 'CAGRI + SEMA',
  'Semax 10mg + Selank 10mg': 'SEMAX + SELANK',
  'Semax 5mg + Selank 5mg': 'SEMAX + SELANK',
  'BPC-157 + GHK-Cu + TB-500 + KPV Blend (Klow)': 'KLOW BLEND',
  'BPC-157 + GHK-Cu + TB-500 Blend (Glow)': 'GLOW BLEND',
  'BPC-157 + TB-500 Blend': 'BPC + TB-500',
  'Bacteriostatic Water': 'STERILE WATER',
  'MOTS-c': 'MOTS-C',
  'SS-31': 'HP-31 (SS-31)',
};

function labelNameForProduct(name) {
  const cleanName = String(name || '').trim();
  return LABEL_NAME_OVERRIDES[cleanName] || cleanName;
}

function labelDoseFromSpec(spec) {
  let dose = String(spec || '')
    .replace(/\s*x\s*1\s*vial\s*$/i, '')
    .trim()
    .replace(/(\d)\s*(mcg|mg|iu|ml)\b/gi, '$1 $2')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/\s+/g, ' ')
    .toUpperCase();

  dose = dose.replace(
    /^(\d+(?:\.\d+)?) MG\/ML\s+(\d+(?:\.\d+)?) ML(?:\s+\(([\d,]+) MG\))?$/,
    (_match, concentration, volume, total) => `${concentration} MG/ML · ${volume} ML${total ? ` (${total} MG)` : ''}`,
  );
  return dose;
}

function round(n, d) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function priceEndingIn99(value) {
  const roundedPrice = round(Number(value), PRICE_DECIMALS);
  return round(Math.floor(roundedPrice) + 0.99, PRICE_DECIMALS);
}

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
// Completed-order merchandising snapshot, refreshed from paid and fulfilled
// Highland orders on 2026-08-22. Keep these labels factual when inventory or
// sales patterns change.
const BEST_SELLER_SKUS = new Set([
  'MS40', 'RT20', 'CU100', 'RT30', 'CP10',
  'RT15', 'MT1', 'KLOW80', 'GTT600', 'BC20',
]);
const LOW_STOCK_SKUS = new Set(BEST_SELLER_SKUS);

// Curated catalog order. Best-seller presentation is handled by the completed-
// order snapshot above rather than broad market assumptions.
const POPULAR_SKUS = [
  'GTT9000', 'MS40', 'RT20', 'CU100', 'RT30', 'CP10', 'RT15', 'MT1', 'KLOW80', 'GTT600', 'BC20',
  'BC10', 'BT10', 'TR30', 'SM10', 'CGL5',
  'ML10', 'TA10', 'MS10', 'ET10', 'NJ500',
];
const popularRank = Object.fromEntries(POPULAR_SKUS.map((sku, i) => [sku, i]));

function quantityPricing(product, quantity) {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const tiers = Object.entries(product && product.quantityDiscounts || {})
    .map(([minimum, savings]) => ({ minimum: Number(minimum), savings: Number(savings) }))
    .filter(tier => tier.minimum > 0 && tier.savings > 0 && qty >= tier.minimum)
    .sort((a, b) => b.minimum - a.minimum);
  const savings = tiers.length ? tiers[0].savings : 0;
  const listTotal = round(Number(product && product.price || 0) * qty, PRICE_DECIMALS);
  return {
    quantity: qty,
    savings: round(Math.min(listTotal, savings), PRICE_DECIMALS),
    total: round(Math.max(0, listTotal - savings), PRICE_DECIMALS),
  };
}

// Public catalog: cost is never exposed to the frontend, only the sale price.
// Price rule: supplier per-vial cost * markup * adjustment, unless a fixed public salePrice is set.
// Storefront prices are normalized to end in .99.
const pricedCatalog = raw
  .map(p => ({
    sku: p.sku,
    name: publicProductName(p.name),
    compoundName: p.name,
    spec: p.spec,
    category: p.category,
    group: p.group,
    slug: slugify(p.name),
    popular: popularRank[p.sku] !== undefined,
    salesBadge: BEST_SELLER_SKUS.has(p.sku) ? 'Best seller' : '',
    availabilityLabel: LOW_STOCK_SKUS.has(p.sku)
      ? 'Low stock'
      : 'Available to order',
    promoEligible: p.promoEligible !== false,
    quantityDiscounts: p.quantityDiscounts || null,
    containerLabel: p.containerLabel || 'vial',
    description: p.description || descriptions[p.name] || '',
    image: `/images/product-mockups/generated/${p.imageFile || `${p.imageSku || p.sku}.webp`}?v=${PRODUCT_IMAGE_REVISION}`,
    labelName: labelNameForProduct(p.name),
    labelDose: labelDoseFromSpec(p.spec),
    price: priceEndingIn99(p.fixedPublicPrice != null
      ? p.fixedPublicPrice
      : (p.salePrice != null ? p.salePrice : p.cost * MARKUP_MULTIPLIER * PRICE_ADJUSTMENT) * PUBLIC_PRICE_MULTIPLIER),
  }));

const byNameForPricing = new Map();
pricedCatalog.forEach(product => {
  if (!byNameForPricing.has(product.name)) byNameForPricing.set(product.name, []);
  byNameForPricing.get(product.name).push(product);
});


const catalog = pricedCatalog
  .sort((a, b) => {
    const aRank = popularRank[a.sku];
    const bRank = popularRank[b.sku];
    if (aRank !== undefined || bRank !== undefined) {
      return (aRank ?? 999) - (bRank ?? 999);
    }
    return a.group.localeCompare(b.group) || a.name.localeCompare(b.name);
  });

function priceAudit() {
  const issues = [];
  byNameForPricing.forEach((variants, name) => {
    const sorted = [...variants].sort(compareVariants);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (specSortValue(current.spec) > specSortValue(previous.spec) && current.price <= previous.price) {
        issues.push({
          name,
          previous: { sku: previous.sku, spec: previous.spec, price: previous.price },
          current: { sku: current.sku, spec: current.spec, price: current.price },
          type: current.price < previous.price ? 'higher_strength_cheaper' : 'higher_strength_same_price',
        });
      }
    }
  });
  return { productCount: catalog.length, issueCount: issues.length, issues };
}

const bySku = Object.fromEntries(catalog.map(p => [p.sku, p]));
const costBySku = Object.fromEntries(raw.map(p => [p.sku, p.cost]));
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
    compoundName: product.compoundName,
    description: product.description,
    category: product.category,
    group: product.group,
    variants,
  };
}

module.exports = {
  catalog,
  bySku,
  bySlug,
  costBySku,
  getProductFamily,
  priceAudit,
  labelNameForProduct,
  labelDoseFromSpec,
  quantityPricing,
};



