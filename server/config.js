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

  // Fixed U.S. shipping charge added to domestic orders.
  SHIPPING_FEE: 10.27,

  // Flat international shipping option shown at checkout.
  INTERNATIONAL_SHIPPING_FEE: 35,

  // One complimentary 10ml bacteriostatic water is added when an order
  // contains at least five paid research products. Supplies do not count
  // toward the threshold, and the reward is calculated server-side.
  BUNDLE_PROMOTION: {
    qualifyingQuantity: 5,
    freeSku: 'WA10',
    freeQuantity: 1,
  },

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
    TK: 0.15,
    ONE: 0.15,
    OZAN: 0.15,
    JARED: 0.15,
    CERT: 0.15,
    CHUD: 0.15,
    TORAH: 0.15,
    OGRE: 0.15,
    PEAR: 0.15,
    CAR: 0.15,
    LANG10: 0.10,
    CNTRL: 0.10,
    BIOMAX: 0.10,
    PHARMACODE: 0.15,
    NOOR: 0.15,
  },


  // Extra global price multiplier applied after formula/overrides (1.15 = raise all public prices by 15%).
  PUBLIC_PRICE_MULTIPLIER: Number(process.env.PUBLIC_PRICE_MULTIPLIER || 1.15),

  // Round all public product prices to this many decimal places.
  PRICE_DECIMALS: 2,

  // Admin login password. Prefer ADMIN_PASSWORD_SHA256 in production so the raw password is not stored.
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'change-me-before-launch',
  ADMIN_PASSWORD_SHA256: process.env.ADMIN_PASSWORD_SHA256 || '',

  // Session secret (change via env var SESSION_SECRET before deploying).
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-session-secret',

  // PayPal Checkout. Use sandbox while testing, then switch PAYPAL_ENV to live.
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID || '',
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || '',
  PAYPAL_ENV: process.env.PAYPAL_ENV || 'sandbox',
  PAYPAL_CURRENCY: process.env.PAYPAL_CURRENCY || 'USD',
  PAYPAL_MANUAL_EMAIL: process.env.PAYPAL_MANUAL_EMAIL || 'at475756@gmail.com',

  // Optional order backups. Configure these in Render so paid orders are copied
  // outside the site database.
  // Crypto payment addresses (customer-facing, shown at checkout).
  CRYPTO_WALLETS: {
    BTC: process.env.CRYPTO_BTC_ADDRESS || 'bc1qvz90rnsmdq3fyefxpcxdj4sp03pcwwyysryu82',
    USDC_ERC20: process.env.CRYPTO_USDC_ADDRESS || '0xAD9c0B152064BAFf5A39173a1F68659103ACAEE8',
  },

  // Discount applied for paying via crypto instead of card, as an incentive.
  // This cannot be combined with any promo code.
  ALT_PAYMENT_DISCOUNT_RATE: Number(process.env.ALT_PAYMENT_DISCOUNT_RATE || 0.05),

  DISCORD_ORDER_WEBHOOK_URL: process.env.DISCORD_ORDER_WEBHOOK_URL || '',
  BTC_MONITOR: {
    ENABLED: String(process.env.BTC_MONITOR_ENABLED || '').toLowerCase() === 'true',
    ADDRESSES: String(process.env.BTC_MONITOR_ADDRESSES || process.env.CRYPTO_BTC_ADDRESS || 'bc1qvz90rnsmdq3fyefxpcxdj4sp03pcwwyysryu82')
      .split(',').map(address => address.trim()).filter(Boolean),
    DISCORD_WEBHOOK_URL: process.env.DISCORD_BTC_WEBHOOK_URL || process.env.DISCORD_ORDER_WEBHOOK_URL || '',
    API_URL: process.env.BTC_MONITOR_API_URL || 'https://mempool.space/api',
    EXPLORER_URL: process.env.BTC_MONITOR_EXPLORER_URL || 'https://mempool.space',
    POLL_INTERVAL_MS: Number(process.env.BTC_MONITOR_POLL_INTERVAL_MS || 60000),
    MIN_CONFIRMATIONS: Math.max(0, Number(process.env.BTC_MONITOR_MIN_CONFIRMATIONS || 0)),
    ALERT_EXISTING: String(process.env.BTC_MONITOR_ALERT_EXISTING || '').toLowerCase() === 'true',
  },
  ORDER_BACKUP_EMAIL_TO: process.env.ORDER_BACKUP_EMAIL_TO || '',
  ORDER_BACKUP_EMAIL_FROM: process.env.ORDER_BACKUP_EMAIL_FROM || process.env.SMTP_USER || 'orders@highlandpeptides.com',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  CUSTOMER_EMAIL_FROM: process.env.CUSTOMER_EMAIL_FROM || process.env.ORDER_BACKUP_EMAIL_FROM || process.env.SMTP_USER || 'support@highlandpeptides.com',
  PAYMENT_REMINDERS_ENABLED: String(process.env.PAYMENT_REMINDERS_ENABLED || 'true').toLowerCase() === 'true',
  PAYMENT_REMINDER_FIRST_HOURS: Math.max(1, Number(process.env.PAYMENT_REMINDER_FIRST_HOURS || 12)),
  PAYMENT_REMINDER_REPEAT_HOURS: Math.max(1, Number(process.env.PAYMENT_REMINDER_REPEAT_HOURS || 24)),
  PAYMENT_REMINDER_MAX: Math.max(1, Number(process.env.PAYMENT_REMINDER_MAX || 2)),
  PAYMENT_REMINDER_POLL_MINUTES: Math.max(5, Number(process.env.PAYMENT_REMINDER_POLL_MINUTES || 30)),

  SITE_NAME: process.env.SITE_NAME || 'Highland Peptides',
};








