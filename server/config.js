// ---------------------------------------------------------------------------
// EDIT THESE to match your real numbers before you launch.
// ---------------------------------------------------------------------------
module.exports = {
  // Markup multiplier applied to your supplier cost (1.5 = cost + 50%)
  MARKUP_MULTIPLIER: 1.5,

  // Flat packaging fee added to every order.
  // Set from real bag cost ($27/100 = $0.27/unit). Doesn't yet include a separate
  // ink/label-roll estimate -- bump this up if you want that folded in too.
  PACKAGING_FEE: 0.27,

  // Round all sale prices to this many decimal places.
  PRICE_DECIMALS: 2,

  // NOTE: as of the latest revision, personal email domains (Gmail, Yahoo, etc.)
  // are accepted at signup -- this list is no longer enforced in server/index.js.
  // Kept here in case you want to re-enable the business-email-only check later
  // (re-add the isBusinessEmail(email) check in the POST /api/signup route).
  BLOCKED_EMAIL_DOMAINS: [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
    'aol.com', 'protonmail.com', 'mail.com', 'live.com', 'msn.com',
    'yandex.com', 'gmx.com', 'zoho.com'
  ],

  // Admin login password (change this via env var ADMIN_PASSWORD before deploying).
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'change-me-before-launch',

  // Session secret (change via env var SESSION_SECRET before deploying).
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-session-secret',

  SITE_NAME: process.env.SITE_NAME || 'Highland Peptides',
};
