// ---------------------------------------------------------------------------
// EDIT THESE to match your real numbers before you launch.
// ---------------------------------------------------------------------------
module.exports = {
  // Markup multiplier applied to your supplier cost (2 = double the cost)
  MARKUP_MULTIPLIER: 2,

  // Applied on top of the markup/salePrice for every product (1.15 = +15%).
  PRICE_ADJUSTMENT: 1.15,

  // Packaging is folded into the fixed shipping charge shown to customers.
  PACKAGING_FEE: 0,

  // Fixed shipping charge added to every order.
  SHIPPING_FEE: 10.27,

  // Percentage-based processing fee added to every order (0.03 = 3%).
  ORDER_FEE_RATE: Number(process.env.ORDER_FEE_RATE || 0.03),

  // Promo codes: key is the code (case-insensitive), value is the fraction off
  // the subtotal (0.15 = 15% off). Validated server-side at checkout.
  DISCOUNT_CODES: {
    NM: 0.15,
    FISH: 0.15,
    PARAM: 0.15,
    PARAM: 0.15,
  },

  // Adds a flat amount to every public product price before final price styling.
  PRICE_OFFSET: 2,

  // Final public prices are snapped to the nearest of these endings.
  PRICE_ENDINGS: [0.25, 0.50, 0.75, 0.99],

  // Round all sale prices to this many decimal places.
  PRICE_DECIMALS: 2,

  // Admin login password (change this via env var ADMIN_PASSWORD before deploying).
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'change-me-before-launch',

  // Session secret (change via env var SESSION_SECRET before deploying).
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-session-secret',

  // PayPal Checkout. Use sandbox while testing, then switch PAYPAL_ENV to live.
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID || '',
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || '',
  PAYPAL_ENV: process.env.PAYPAL_ENV || 'sandbox',
  PAYPAL_CURRENCY: process.env.PAYPAL_CURRENCY || 'USD',

  SITE_NAME: process.env.SITE_NAME || 'Highland Peptides',
};

