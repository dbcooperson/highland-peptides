const config = require('./config');
const db = require('./db');
const { hashPassword, verifyPassword, createToken, hashToken } = require('./account-security');
const { sendAccountVerificationEmail, sendPasswordResetEmail, isCustomerEmailConfigured } = require('./notifications');

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

function cleanEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function clientKey(req, action) {
  return `${action}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

function allowAttempt(req, action, maxAttempts) {
  const key = clientKey(req, action);
  const now = Date.now();
  const current = attempts.get(key);
  const entry = current && current.startedAt + WINDOW_MS > now ? current : { count: 0, startedAt: now };
  entry.count += 1;
  attempts.set(key, entry);
  return entry.count <= maxAttempts;
}

function addHours(hours) {
  return new Date(Date.now() + Number(hours) * 60 * 60 * 1000).toISOString();
}

function addMinutes(minutes) {
  return new Date(Date.now() + Number(minutes) * 60 * 1000).toISOString();
}

function publicAccount(account) {
  return account ? {
    id: account.id,
    name: account.name,
    email: account.email,
    verified: Boolean(account.verified_at),
    referralCode: account.referral_code || null,
    creditBalance: Math.round(Number(account.credit_balance_cents || 0)) / 100,
  } : null;
}

function requireAccount(req, res, next) {
  const account = req.session && req.session.accountId ? db.getAccountById(req.session.accountId) : null;
  if (!account || !account.verified_at) return res.status(401).json({ error: 'Sign in to continue.' });
  req.account = account;
  next();
}

function dashboardOptions() {
  return {
    minCustomers: config.REFERRAL_PAYOUT_MIN_CUSTOMERS,
    minSpend: config.REFERRAL_PAYOUT_MIN_SPEND,
    socialCooldownDays: config.TIKTOK_SUBMISSION_COOLDOWN_DAYS,
  };
}

function cleanTikTokUrl(value) {
  try {
    const url = new URL(cleanText(value, 500));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !(host === 'tiktok.com' || host.endsWith('.tiktok.com'))) return '';
    return url.toString();
  } catch {
    return '';
  }
}

async function issueVerificationEmail(account) {
  const token = createToken();
  db.setAccountVerificationToken(account.id, hashToken(token), addHours(config.ACCOUNT_VERIFICATION_TTL_HOURS));
  const url = `${config.ACCOUNT_SITE_URL}/verify-email?token=${encodeURIComponent(token)}`;
  return sendAccountVerificationEmail(account, url);
}

function registerAccountRoutes(app, requireAdmin) {
  app.post('/api/account/register', async (req, res) => {
    if (!allowAttempt(req, 'register', 8)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    if (!isCustomerEmailConfigured()) return res.status(503).json({ error: 'Account email is temporarily unavailable. Please contact support.' });
    const name = cleanText(req.body && req.body.name, 100);
    const email = cleanEmail(req.body && req.body.email);
    const password = String(req.body && req.body.password || '');
    if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' });
    if (!email) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ error: 'Use at least 8 characters with a letter and a number.' });
    }
    if (db.getAccountByEmail(email)) return res.status(409).json({ error: 'An account already exists for that email. Sign in or resend verification.' });
    let accountCreated = false;
    try {
      const passwordRecord = await hashPassword(password);
      const token = createToken();
      const account = db.createAccount({
        name,
        email,
        passwordSalt: passwordRecord.salt,
        passwordHash: passwordRecord.hash,
        verificationTokenHash: hashToken(token),
        verificationExpiresAt: addHours(config.ACCOUNT_VERIFICATION_TTL_HOURS),
      });
      accountCreated = true;
      const url = `${config.ACCOUNT_SITE_URL}/verify-email?token=${encodeURIComponent(token)}`;
      await sendAccountVerificationEmail(account, url);
      res.status(201).json({ ok: true, message: 'Check your email to verify your account.' });
    } catch (err) {
      res.status(502).json({
        error: accountCreated
          ? 'Your account was created, but the verification email could not be sent. Use resend verification or contact support.'
          : (err.message || 'Could not create the account.'),
        accountCreated,
      });
    }
  });

  app.post('/api/account/resend-verification', async (req, res) => {
    if (!allowAttempt(req, 'resend', 5)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    const email = cleanEmail(req.body && req.body.email);
    const account = email ? db.getAccountByEmail(email) : null;
    try {
      if (account && !account.verified_at && isCustomerEmailConfigured()) await issueVerificationEmail(account);
    } catch (err) {
      console.error('Verification resend failed:', err.message || err);
    }
    res.json({ ok: true, message: 'If an unverified account exists, a new verification email is on the way.' });
  });

  app.get('/verify-email', (req, res) => {
    const token = cleanText(req.query && req.query.token, 200);
    const account = token ? db.verifyAccountByTokenHash(hashToken(token)) : null;
    const result = account ? 'verified=1' : 'verification=invalid';
    res.redirect(`/account.html?${result}`);
  });

  app.post('/api/account/login', async (req, res) => {
    if (!allowAttempt(req, 'login', 10)) return res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.' });
    const email = cleanEmail(req.body && req.body.email);
    const password = String(req.body && req.body.password || '');
    const account = email ? db.getAccountByEmail(email) : null;
    const passwordOk = account ? await verifyPassword(password, account.password_salt, account.password_hash) : false;
    if (!account || !passwordOk) return res.status(401).json({ error: 'Email or password is incorrect.' });
    if (!account.verified_at) return res.status(403).json({ error: 'Verify your email before signing in.', needsVerification: true });
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Could not start your session.' });
      req.session.accountId = account.id;
      const updated = db.touchAccountLogin(account.id);
      res.json({ ok: true, account: publicAccount(updated) });
    });
  });

  app.post('/api/account/logout', (req, res) => {
    if (!req.session) return res.json({ ok: true });
    delete req.session.accountId;
    req.session.save(() => res.json({ ok: true }));
  });

  app.get('/api/account/me', (req, res) => {
    const account = req.session && req.session.accountId ? db.getAccountById(req.session.accountId) : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      authenticated: Boolean(account && account.verified_at),
      account: account && account.verified_at ? publicAccount(account) : null,
      referral: {
        customerDiscountPercent: Math.round(config.REFERRAL_DISCOUNT_RATE * 100),
        creditPercent: Math.round(config.REFERRAL_CREDIT_RATE * 100),
        cryptoMemberPercent: Math.round(config.ACCOUNT_CRYPTO_DISCOUNT_RATE * 100),
        payoutMinCustomers: config.REFERRAL_PAYOUT_MIN_CUSTOMERS,
        payoutMinSpend: config.REFERRAL_PAYOUT_MIN_SPEND,
        manualCreditReview: true,
        tiktokCredit: config.TIKTOK_CREDIT_CENTS / 100,
        tiktokCooldownDays: config.TIKTOK_SUBMISSION_COOLDOWN_DAYS,
        tiktokHandle: config.TIKTOK_HANDLE,
        tiktokProfileUrl: config.TIKTOK_PROFILE_URL,
      },
    });
  });

  app.post('/api/account/forgot-password', async (req, res) => {
    if (!allowAttempt(req, 'forgot', 5)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    const email = cleanEmail(req.body && req.body.email);
    const account = email ? db.getAccountByEmail(email) : null;
    try {
      if (account && account.verified_at && isCustomerEmailConfigured()) {
        const token = createToken();
        db.setPasswordResetToken(account.id, hashToken(token), addMinutes(config.PASSWORD_RESET_TTL_MINUTES));
        const url = `${config.ACCOUNT_SITE_URL}/account.html?reset=${encodeURIComponent(token)}`;
        await sendPasswordResetEmail(account, url);
      }
    } catch (err) {
      console.error('Password reset email failed:', err.message || err);
    }
    res.json({ ok: true, message: 'If an account exists, password-reset instructions have been sent.' });
  });

  app.post('/api/account/reset-password', async (req, res) => {
    if (!allowAttempt(req, 'reset', 8)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    const token = cleanText(req.body && req.body.token, 200);
    const password = String(req.body && req.body.password || '');
    if (!token) return res.status(400).json({ error: 'Reset link is missing or invalid.' });
    if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ error: 'Use at least 8 characters with a letter and a number.' });
    }
    const passwordRecord = await hashPassword(password);
    const account = db.resetPasswordByTokenHash(hashToken(token), passwordRecord.salt, passwordRecord.hash);
    if (!account) return res.status(400).json({ error: 'This reset link is invalid or expired.' });
    res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  });

  app.get('/api/account/dashboard', requireAccount, (req, res) => {
    const dashboard = db.getAccountDashboard(req.account.id, dashboardOptions());
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      account: publicAccount(dashboard.account),
      stats: dashboard.stats,
      orders: dashboard.orders,
      ledger: dashboard.ledger,
      payouts: dashboard.payouts,
      socialSubmissions: dashboard.socialSubmissions,
      nextSocialEligibleAt: dashboard.nextSocialEligibleAt,
      referral: {
        customerDiscountPercent: Math.round(config.REFERRAL_DISCOUNT_RATE * 100),
        creditPercent: Math.round(config.REFERRAL_CREDIT_RATE * 100),
        cryptoMemberPercent: Math.round(config.ACCOUNT_CRYPTO_DISCOUNT_RATE * 100),
        manualCreditReview: true,
        tiktokCredit: config.TIKTOK_CREDIT_CENTS / 100,
        tiktokCooldownDays: config.TIKTOK_SUBMISSION_COOLDOWN_DAYS,
        tiktokHandle: config.TIKTOK_HANDLE,
        tiktokProfileUrl: config.TIKTOK_PROFILE_URL,
      },
    });
  });

  app.post('/api/account/tiktok-submissions', requireAccount, (req, res) => {
    if (!allowAttempt(req, 'tiktok-submit', 8)) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    const videoUrl = cleanTikTokUrl(req.body && req.body.videoUrl);
    if (!videoUrl) return res.status(400).json({ error: 'Paste a valid TikTok video link.' });
    try {
      const submission = db.createSocialCreditSubmission(req.account.id, videoUrl, {
        cooldownDays: config.TIKTOK_SUBMISSION_COOLDOWN_DAYS,
        creditCents: config.TIKTOK_CREDIT_CENTS,
      });
      res.status(201).json({ ok: true, submission, message: 'Video submitted. Highland will review the tag before adding store credit.' });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not submit the video.' });
    }
  });

  app.post('/api/account/referral-code', requireAccount, (req, res) => {
    const code = cleanText(req.body && req.body.code, 18).toUpperCase();
    if (!/^[A-Z0-9]{3,18}$/.test(code) || !/[A-Z]/.test(code)) return res.status(400).json({ error: 'Use 3–18 letters or numbers, including at least one letter.' });
    const reserved = new Set([...Object.keys(config.DISCOUNT_CODES), 'CRYPTO5', 'ADMIN', 'SUPPORT', 'HIGHLAND']);
    if (reserved.has(code)) return res.status(409).json({ error: 'That code is reserved. Choose another.' });
    try {
      const account = db.setAccountReferralCode(req.account.id, code);
      res.status(201).json({ ok: true, referralCode: account.referral_code });
    } catch (err) {
      res.status(409).json({ error: err.message || 'Could not create that code.' });
    }
  });

  app.post('/api/account/payout-request', requireAccount, (req, res) => {
    try {
      const request = db.createPayoutRequest(req.account.id, dashboardOptions());
      res.status(201).json({ ok: true, request: { id: request.id, status: request.status, amount: request.amount_cents / 100 } });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not request payout.' });
    }
  });

  app.get('/api/admin/referrals', requireAdmin, (req, res) => {
    res.json(db.getAdminReferralData(dashboardOptions()));
  });

  app.post('/api/admin/payouts/:id/status', requireAdmin, (req, res) => {
    const status = cleanText(req.body && req.body.status, 20);
    const note = cleanText(req.body && req.body.note, 500);
    try {
      const request = db.updatePayoutRequest(req.params.id, status, note);
      if (!request) return res.status(404).json({ error: 'Payout request not found.' });
      res.json({ ok: true, status: request.status });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not update payout request.' });
    }
  });

  app.post('/api/admin/referral-rewards/:orderId/status', requireAdmin, (req, res) => {
    try {
      const order = db.reviewReferralCredit(req.params.orderId, cleanText(req.body && req.body.status, 30), cleanText(req.body && req.body.note, 500));
      if (!order) return res.status(404).json({ error: 'Referral reward not found.' });
      res.json({ ok: true, status: order.referral_credit_status });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not review referral credit.' });
    }
  });

  app.post('/api/admin/tiktok-submissions/:id/status', requireAdmin, (req, res) => {
    try {
      const submission = db.reviewSocialCreditSubmission(req.params.id, cleanText(req.body && req.body.status, 30), cleanText(req.body && req.body.note, 500));
      if (!submission) return res.status(404).json({ error: 'TikTok submission not found.' });
      res.json({ ok: true, status: submission.status });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Could not review the TikTok submission.' });
    }
  });
}

module.exports = { registerAccountRoutes, requireAccount, publicAccount };
