const crypto = require('crypto');
const { isCustomerEmailConfigured, sendCheckoutVerificationCode } = require('./notifications');
const config = require('./config');

const CODE_LIFETIME_MS = 10 * 60 * 1000;
const VERIFIED_LIFETIME_MS = 8 * 60 * 60 * 1000;
const REMEMBER_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SEND_COOLDOWN_MS = 60 * 1000;
const COOKIE_NAME = 'hp.checkout_email';
const sendAttempts = new Map();

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function codeHash(email, code) {
  return crypto.createHmac('sha256', config.SESSION_SECRET).update(`${email}:${code}`).digest('hex');
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookieValue(email, expiresAt) {
  const encoded = Buffer.from(email).toString('base64url');
  const body = `${encoded}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', config.SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function cookieEmail(req) {
  const raw = String(req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE_NAME}=`));
  if (!raw) return '';
  const parts = raw.slice(COOKIE_NAME.length + 1).split('.');
  if (parts.length !== 3) return '';
  const [encoded, expiresText, signature] = parts;
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return '';
  const expected = crypto.createHmac('sha256', config.SESSION_SECRET)
    .update(`${encoded}.${expiresText}`).digest('base64url');
  if (!safeEqual(signature, expected)) return '';
  try { return cleanEmail(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return ''; }
}

function isCheckoutEmailVerified(req, value) {
  const email = cleanEmail(value);
  if (!email) return false;
  const verified = req.session && req.session.checkoutEmailVerified;
  return Boolean((verified && verified.email === email && verified.expiresAt > Date.now()) || cookieEmail(req) === email);
}

function registerCheckoutVerificationRoutes(app) {
  app.get('/api/checkout-email/status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ verified: isCheckoutEmailVerified(req, req.query.email) });
  });

  app.post('/api/checkout-email/send', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const email = cleanEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'Enter a valid research email.' });
    if (!isCustomerEmailConfigured()) return res.status(503).json({ error: 'Email verification is temporarily unavailable.' });
    const now = Date.now();
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const key = crypto.createHash('sha256').update(`${ip}:${email}`).digest('hex');
    for (const [entry, until] of sendAttempts) if (until <= now) sendAttempts.delete(entry);
    if ((sendAttempts.get(key) || 0) > now || (req.session.checkoutEmailLastSentAt || 0) + SEND_COOLDOWN_MS > now) {
      return res.status(429).json({ error: 'Please wait one minute before requesting another code.' });
    }
    sendAttempts.set(key, now + SEND_COOLDOWN_MS);
    req.session.checkoutEmailLastSentAt = now;
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    req.session.checkoutEmailChallenge = { email, hash: codeHash(email, code), expiresAt: now + CODE_LIFETIME_MS, attempts: 0 };
    req.session.checkoutEmailVerified = null;
    try {
      await sendCheckoutVerificationCode(email, code);
      res.json({ ok: true, message: 'A six-digit code has been sent. It expires in 10 minutes.' });
    } catch (err) {
      req.session.checkoutEmailChallenge = null;
      console.error('Checkout email verification failed:', err.message || err);
      res.status(503).json({ error: 'Could not send the code. Please try again later.' });
    }
  });

  app.post('/api/checkout-email/verify', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const email = cleanEmail(req.body && req.body.email);
    const code = String(req.body && req.body.code || '').trim();
    const challenge = req.session && req.session.checkoutEmailChallenge;
    if (!email || !/^\d{6}$/.test(code) || !challenge || challenge.email !== email || challenge.expiresAt <= Date.now() || challenge.attempts >= 5) {
      return res.status(400).json({ error: 'Code is invalid or expired. Request a new code.' });
    }
    challenge.attempts += 1;
    if (!safeEqual(codeHash(email, code), challenge.hash)) {
      return res.status(400).json({ error: 'Code is invalid or expired. Request a new code.' });
    }
    req.session.checkoutEmailChallenge = null;
    req.session.checkoutEmailVerified = { email, expiresAt: Date.now() + VERIFIED_LIFETIME_MS };
    if (req.body.rememberDevice === true) {
      const expiresAt = Date.now() + REMEMBER_LIFETIME_MS;
      res.cookie(COOKIE_NAME, cookieValue(email, expiresAt), {
        httpOnly: true, secure: Boolean(req.secure),
        sameSite: 'lax', maxAge: REMEMBER_LIFETIME_MS, path: '/',
      });
    }
    res.json({ ok: true, verified: true });
  });
}

module.exports = { registerCheckoutVerificationRoutes, isCheckoutEmailVerified, cleanEmail };
