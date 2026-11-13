const config = require('./config');

function paidSubtotal(items) {
  const total = (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const price = Number(item.unit_price || 0);
    const quantity = Number(item.quantity || 0);
    return price > 0 && quantity > 0 ? sum + price * quantity : sum;
  }, 0);
  return Math.round(total * 100) / 100;
}

// Free Reconstitution Solution tiers, lowest threshold first.
function bundleTiers() {
  const promotion = config.BUNDLE_PROMOTION || {};
  const tiers = Array.isArray(promotion.tiers) && promotion.tiers.length
    ? promotion.tiers
    : (promotion.freeSku ? [promotion] : []);
  return tiers
    .map(tier => ({
      minimumSubtotal: Number(tier.minimumSubtotal || 0),
      freeSku: tier.freeSku,
      freeQuantity: Number(tier.freeQuantity || 1),
    }))
    .filter(tier => tier.freeSku && tier.minimumSubtotal > 0)
    .sort((a, b) => a.minimumSubtotal - b.minimumSubtotal);
}

// Highest tier the subtotal reaches, or null.
function bundleTierFor(subtotal) {
  return bundleTiers().filter(tier => subtotal >= tier.minimumSubtotal).pop() || null;
}

function tierLabel(tier, product) {
  const size = product && product.spec ? String(product.spec).split(' x')[0] : '';
  return `Orders $${tier.minimumSubtotal}+ get a free ${product ? product.name : 'gift'}${size ? ` ${size}` : ''}`;
}

// Adds the free Reconstitution Solution for the highest tier the order reaches.
function applyBundlePromotion(items, bySku) {
  const paidItems = Array.isArray(items) ? [...items] : [];
  const subtotal = paidSubtotal(paidItems);
  const tier = bundleTierFor(subtotal);
  const freeProduct = tier && bySku[tier.freeSku];

  if (!tier || !freeProduct) {
    return { items: paidItems, applied: false, subtotal, tier: null };
  }

  return {
    items: [
      ...paidItems,
      {
        sku: freeProduct.sku,
        name: `${freeProduct.name} (Free with orders $${tier.minimumSubtotal}+)`,
        spec: freeProduct.spec,
        quantity: tier.freeQuantity,
        unit_price: 0,
        promotion: tierLabel(tier, freeProduct),
      },
    ],
    applied: true,
    subtotal,
    tier,
  };
}

// Adds the free gift tied to a promo code (e.g. TIKTOK15 -> one Reconstitution Solution 10ml).
function codeGift(code, bySku) {
  const gift = code && (config.DISCOUNT_CODE_GIFTS || {})[String(code).toUpperCase()];
  const product = gift && bySku[gift.sku];
  return product ? { sku: product.sku, name: product.name, spec: product.spec, quantity: gift.quantity || 1 } : null;
}

// A code's free item does not stack with the same free item from a tier:
// the customer gets one, not two.
function applyCodeGift(items, code, bySku) {
  const gift = codeGift(code, bySku);
  if (!gift) return Array.isArray(items) ? items : [];
  const alreadyFree = (Array.isArray(items) ? items : []).some(item => item.sku === gift.sku && Number(item.unit_price) === 0);
  if (alreadyFree) return items;
  return [
    ...(Array.isArray(items) ? items : []),
    {
      sku: gift.sku,
      name: `${gift.name} (Free with ${String(code).toUpperCase()})`,
      spec: gift.spec,
      quantity: gift.quantity,
      unit_price: 0,
      promotion: `${String(code).toUpperCase()} free gift`,
    },
  ];
}

function publicPromotion() {
  const tiers = bundleTiers();
  const first = tiers[0] || { minimumSubtotal: 0, freeSku: null, freeQuantity: 1 };
  return {
    // Legacy single-offer fields (first tier) kept for older cached scripts.
    minimumSubtotal: first.minimumSubtotal,
    freeSku: first.freeSku,
    freeQuantity: first.freeQuantity,
    tiers,
    label: tiers.map(tier => `$${tier.minimumSubtotal}+`).join(' / ') + ' orders (not including shipping) get free Reconstitution Solution',
  };
}

module.exports = { applyBundlePromotion, applyCodeGift, codeGift, paidSubtotal, publicPromotion, bundleTiers, bundleTierFor };
