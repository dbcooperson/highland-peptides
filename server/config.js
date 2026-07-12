// ---------------------------------------------------------------------------
// EDIT THESE to match your real numbers before you launch.
// ---------------------------------------------------------------------------
module.exports = {
  // Markup multiplier applied to your supplier cost (2 = double the cost)
  MARKUP_MULTIPLIER: 2,

  // Applied on top of the markup/salePrice for every product (1.15 = +15%).
  PRICE_ADJUSTMENT: 1.15,

  // Flat packaging fee added to every order.
  // Set from real bag cost ($27/100 = $0.27/unit). Doesn't yet include a separate
  // ink/label-roll estimate -- bump this up if you want that folded in too.
  PACKAGING_FEE: 0.27,

  // Flat shipping fee added to every order.
  SHIPPING_FEE: 10.00,

  // Promo codes: key is the code (case-insensitive), value is the fraction off
  // the subtotal (0.15 = 15% off). Validated server-side at checkout.
  DISCOUNT_CODES: {
    NM: 0.15,
  },

  // Round all sale prices to this many decimal places.
  PRICE_DECIMALS: 2,

  // Admin login password (change this via env var ADMIN_PASSWORD before deploying).
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'change-me-before-launch',

  // Session secret (change via env var SESSION_SECRET before deploying).
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-session-secret',

  SITE_NAME: process.env.SITE_NAME || 'Highland Peptides',
};
