// ---------------------------------------------------------------------------
// EDIT THESE to match your real numbers before you launch.
// ---------------------------------------------------------------------------
module.exports = {
  // Markup multiplier applied to your supplier cost (2 = double the cost)
  MARKUP_MULTIPLIER: 2,

  // Applied on top of the markup for every product (1.15 = +15%).
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
    KAY: 0.15,
    HUM: 0.15,
    JUSTIN: 0.15,
    BCG: 0.15,
    JETT: 0.15,
    BABE: 0.15,
    VICKY: 0.15,
  },


  // Round all public product prices to this many decimal places.
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

  // Optional order backups. Configure these in Render so paid orders are copied
  // outside the site database.
  // Crypto payment addresses (customer-facing, shown at checkout).
  CRYPTO_WALLETS: {
    BTC: process.env.CRYPTO_BTC_ADDRESS || 'bc1qvz90rnsmdq3fyefxpcxdj4sp03pcwwyysryu82',
    USDC_ERC20: process.env.CRYPTO_USDC_ADDRESS || '0xAD9c0B152064BAFf5A39173a1F68659103ACAEE8',
  },

  // Discount applied for paying via crypto/Zelle instead of card, as an incentive
  // (0.05 = 5% off subtotal). Stacks with a promo code if both are used.
  ALT_PAYMENT_DISCOUNT_RATE: Number(process.env.ALT_PAYMENT_DISCOUNT_RATE || 0.05),

  DISCORD_ORDER_WEBHOOK_URL: process.env.DISCORD_ORDER_WEBHOOK_URL || '',
  ORDER_BACKUP_EMAIL_TO: process.env.ORDER_BACKUP_EMAIL_TO || '',
  ORDER_BACKUP_EMAIL_FROM: process.env.ORDER_BACKUP_EMAIL_FROM || process.env.SMTP_USER || 'orders@highlandpeptides.com',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',

  SITE_NAME: process.env.SITE_NAME || 'Highland Peptides',
};




