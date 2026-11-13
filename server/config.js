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
  SHIPPING_FEE: 11.99,

  // Optional faster USPS Priority Mail, U.S. addresses only.
  PRIORITY_SHIPPING_FEE: 19.99,

  // Flat international shipping option shown at checkout.
  INTERNATIONAL_SHIPPING_FEE: 35,

  // Free Reconstitution Solution tiers, based on the order's product subtotal
  // (after bulk savings, before codes, shipping and fees). Calculated server-side.
  // Tiers: only the highest tier reached applies (they do not stack).
  BUNDLE_PROMOTION: {
    tiers: [
      { minimumSubtotal: 50, freeSku: 'WA10', freeQuantity: 1 },
      { minimumSubtotal: 90, freeSku: 'WA30', freeQuantity: 1 },
      { minimumSubtotal: 150, freeSku: 'WA100', freeQuantity: 1 },
    ],
  },

  // Percentage-based processing fee added to every order (0.03 = 3%).
  ORDER_FEE_RATE: Number(process.env.ORDER_FEE_RATE || 0.03),

  // Research sets (data/bundles.json): buying every item in a set takes this
  // fraction off those items. Stacks with codes/crypto, which apply afterwards.
  BUNDLE_DISCOUNT_RATE: Number(process.env.BUNDLE_DISCOUNT_RATE || 0.10),

  // Abandoned-checkout and reorder reminder emails. These are marketing emails,
  // so U.S. law (CAN-SPAM) requires a real postal address in every one: they stay
  // OFF until BUSINESS_MAILING_ADDRESS is set (a P.O. box or mailbox service works).
  LIFECYCLE_EMAILS_ENABLED: String(process.env.LIFECYCLE_EMAILS_ENABLED || 'true').toLowerCase() === 'true',
  BUSINESS_MAILING_ADDRESS: String(process.env.BUSINESS_MAILING_ADDRESS || '').trim(),
  ABANDONED_CHECKOUT_DELAY_MINUTES: Math.max(15, Number(process.env.ABANDONED_CHECKOUT_DELAY_MINUTES || 60)),
  REORDER_REMINDER_DAYS: Math.max(7, Number(process.env.REORDER_REMINDER_DAYS || 35)),
  LIFECYCLE_POLL_MINUTES: Math.max(5, Number(process.env.LIFECYCLE_POLL_MINUTES || 15)),

  // Launch giveaway. Set GIVEAWAY_START (e.g. 2026-11-20) on the host the day the
  // site goes live; it runs GIVEAWAY_DAYS days. Leave it unset to keep it hidden.
  // Every paid peptide/compound vial in a paid order = 1 entry (Supplies such as
  // Reconstitution Solution and free gifts do not count). Free entry: 1 per day.
  LAUNCH_GIVEAWAY: {
    id: 'launch-2026',
    startsAt: process.env.GIVEAWAY_START || null,
    days: Number(process.env.GIVEAWAY_DAYS || 30),
    excludedCategories: ['Supplies'],
    prizes: [
      { place: 1, label: '$100 store credit', creditCents: 10000 },
      { place: 2, label: '$50 store credit', creditCents: 5000 },
      { place: 3, label: 'Free Reconstitution Solution kit', creditCents: 0 },
    ],
  },

  // Promo codes: key is the code (case-insensitive), value is the fraction off
  // the subtotal (0.15 = 15% off). Validated server-side at checkout.
  // Snowy relaunch (Nov 2026): every earlier code was retired. TIKTOK15 is the only
  // code that works; customer referral codes are not accepted.
  DISCOUNT_CODES: {
    TIKTOK15: 0.15,
  },

  // Free items added to an order when a code is used (on top of any bundle reward).
  DISCOUNT_CODE_GIFTS: {
    TIKTOK15: { sku: 'WA10', quantity: 1 },
  },


  // Temporary promotion boosts are tracked in the persistent order database.
  // Change the campaign ID for any future offer so this usage counter cannot
  // reset after a deployment or server restart.
  LIMITED_PROMOTION_CAMPAIGNS: {},



  // Extra global price multiplier applied after formula/overrides (1.15 = raise all public prices by 15%).
  PUBLIC_PRICE_MULTIPLIER: Number(process.env.PUBLIC_PRICE_MULTIPLIER || 1.15),

  // Flat dollar amount added to every public product price before the .99 rounding
  // (Snowy relaunch, Nov 2026: +$1 on every product).
  PUBLIC_PRICE_INCREASE: Number(process.env.PUBLIC_PRICE_INCREASE || 1),

  // Round all public product prices to this many decimal places.
  PRICE_DECIMALS: 2,

  // Admin login password. Prefer ADMIN_PASSWORD_SHA256 in production so the raw password is not stored.
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'change-me-before-launch',
  ADMIN_PASSWORD_SHA256: process.env.ADMIN_PASSWORD_SHA256 || '',

  // Session secret (change via env var SESSION_SECRET before deploying).
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-session-secret',

  // A remembered admin device stays signed in across tabs and server restarts.
  // Changing the admin password or session secret invalidates every remembered device.
  ADMIN_REMEMBER_DAYS: Math.max(1, Math.min(90, Number(process.env.ADMIN_REMEMBER_DAYS || 30))),



  // Optional order backups. Configure these in Render so paid orders are copied
  // outside the site database.
  // Crypto payment addresses (customer-facing, shown at checkout).
  CRYPTO_WALLETS: {
    BTC: process.env.CRYPTO_BTC_ADDRESS || 'bc1qvz90rnsmdq3fyefxpcxdj4sp03pcwwyysryu82',
    USDC_ERC20: process.env.CRYPTO_USDC_ADDRESS || '0xAD9c0B152064BAFf5A39173a1F68659103ACAEE8',
  },

  // Discount applied for paying via crypto instead of card, as an incentive.
  // This cannot be combined with any promo code.
  // Crypto orders get a flat 15% off, never combined with codes or referral offers.
  ALT_PAYMENT_DISCOUNT_RATE: Number(process.env.ALT_PAYMENT_DISCOUNT_RATE || 0.15),

  ORDER_BACKUP_EMAIL_TO: process.env.ORDER_BACKUP_EMAIL_TO || '',
  ORDER_BACKUP_EMAIL_FROM: process.env.ORDER_BACKUP_EMAIL_FROM || process.env.SMTP_USER || 'orders@snowyresearch.com',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  CUSTOMER_EMAIL_FROM: process.env.CUSTOMER_EMAIL_FROM || process.env.ORDER_BACKUP_EMAIL_FROM || process.env.SMTP_USER || 'support@snowyresearch.com',
  // Pirate Ship tracking automation. The CSV export can route each shipment
  // email to sr-<order>@this domain so tracking is matched without guessing.
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET || '',
  PIRATE_SHIP_INBOUND_DOMAIN: process.env.PIRATE_SHIP_INBOUND_DOMAIN || '',
  PAYMENT_REMINDERS_ENABLED: String(process.env.PAYMENT_REMINDERS_ENABLED || 'true').toLowerCase() === 'true',
  // Pending-payment reminders only: wait one week before the first message,
  // then no more than one message every two weeks. A max of 0 means the
  // biweekly cadence continues while the order remains pending.
  PAYMENT_REMINDER_FIRST_HOURS: Math.max(1, Number(process.env.PAYMENT_REMINDER_FIRST_HOURS || 168)),
  PAYMENT_REMINDER_REPEAT_HOURS: Math.max(1, Number(process.env.PAYMENT_REMINDER_REPEAT_HOURS || 336)),
  PAYMENT_REMINDER_MAX: Math.max(0, Number(process.env.PAYMENT_REMINDER_MAX || 0)),
  PAYMENT_REMINDER_POLL_MINUTES: Math.max(5, Number(process.env.PAYMENT_REMINDER_POLL_MINUTES || 30)),

  // Google Maps Platform address tools. The browser key should be restricted
  // to the storefront's HTTPS origins and the server key to Address Validation API.
  GOOGLE_PLACES_BROWSER_KEY: process.env.GOOGLE_PLACES_BROWSER_KEY || '',
  GOOGLE_ADDRESS_VALIDATION_KEY: process.env.GOOGLE_ADDRESS_VALIDATION_KEY || '',

  // Optional customer accounts and referral rewards. Referral codes give the
  // shopper 10% off and credit the code owner with 10% of net merchandise
  // revenue once the order is paid. Cash-out requests are manually reviewed.
  ACCOUNT_SITE_URL: String(process.env.ACCOUNT_SITE_URL || 'https://snowyresearch.com').replace(/\/$/, ''),
  ACCOUNT_VERIFICATION_TTL_HOURS: Math.max(1, Number(process.env.ACCOUNT_VERIFICATION_TTL_HOURS || 24)),
  PASSWORD_RESET_TTL_MINUTES: Math.max(10, Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60)),
  REFERRAL_DISCOUNT_RATE: 0.10,
  REFERRAL_CREDIT_RATE: 0.10,
  REFERRAL_PAYOUT_MIN_CUSTOMERS: 5,
  REFERRAL_PAYOUT_MIN_SPEND: 500,
  ACCOUNT_CRYPTO_DISCOUNT_RATE: 0.05,
  TIKTOK_CREDIT_CENTS: 500,
  TIKTOK_SUBMISSION_COOLDOWN_DAYS: 7,

  SITE_NAME: process.env.SITE_NAME || 'Snowy Research',
};








