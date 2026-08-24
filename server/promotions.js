const config = require('./config');

function isQualifyingProduct(product) {
  return Boolean(product)
    && product.sku !== config.BUNDLE_PROMOTION.freeSku
    && product.category !== 'Supplies'
    && product.group !== 'Supplies';
}

function qualifyingQuantity(items, bySku) {
  return (Array.isArray(items) ? items : []).reduce((total, item) => {
    const product = bySku[item.sku];
    return isQualifyingProduct(product) ? total + Number(item.quantity || 0) : total;
  }, 0);
}

function applyBundlePromotion(items, bySku) {
  const paidItems = Array.isArray(items) ? [...items] : [];
  const promotion = config.BUNDLE_PROMOTION;
  const freeProduct = bySku[promotion.freeSku];
  const eligibleQuantity = qualifyingQuantity(paidItems, bySku);

  if (!freeProduct || eligibleQuantity < promotion.qualifyingQuantity) {
    return { items: paidItems, applied: false, eligibleQuantity };
  }

  return {
    items: [
      ...paidItems,
      {
        sku: freeProduct.sku,
        name: `${freeProduct.name} (Free bundle reward)`,
        spec: freeProduct.spec,
        quantity: promotion.freeQuantity,
        unit_price: 0,
        promotion: 'Buy 5+ paid research products (Bac Water excluded)',
      },
    ],
    applied: true,
    eligibleQuantity,
  };
}

function publicPromotion() {
  return {
    qualifyingQuantity: config.BUNDLE_PROMOTION.qualifyingQuantity,
    freeSku: config.BUNDLE_PROMOTION.freeSku,
    freeQuantity: config.BUNDLE_PROMOTION.freeQuantity,
    label: 'Buy 5+ paid research products and receive a free Bac Water 10ml (Bac Water does not count)',
  };
}

module.exports = { applyBundlePromotion, isQualifyingProduct, publicPromotion, qualifyingQuantity };
