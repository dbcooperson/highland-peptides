// Built-in support inbox: customers message from the site, the admin reads and
// replies in the admin panel. Nothing is emailed; everything stays on the server.
const crypto = require('crypto');

const COOKIE_NAME = 'hp.support';
const COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_BODY = 2000;
const EMAIL_PATTERN = /^[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[A-Za-z]{2,}$/;
const HOURLY_LIMIT = 12;
const DAILY_LIMIT = 40;

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function readSupportToken(req) {
  const raw = String(req.headers.cookie || '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE_NAME}=`));
  if (!raw) return null;
  const token = raw.slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

function registerSupportInboxRoutes(app, { db, requireAdmin, secureCookies = false, clientIp = req => req.ip }) {
  const attempts = new Map();

  function rateLimited(ip) {
    const now = Date.now();
    const recent = (attempts.get(ip) || []).filter(at => now - at < 24 * 60 * 60 * 1000);
    const lastHour = recent.filter(at => now - at < 60 * 60 * 1000).length;
    if (lastHour >= HOURLY_LIMIT || recent.length >= DAILY_LIMIT) {
      attempts.set(ip, recent);
      return true;
    }
    recent.push(now);
    attempts.set(ip, recent);
    if (attempts.size > 5000) {
      for (const [key, list] of attempts) if (!list.some(at => now - at < 24 * 60 * 60 * 1000)) attempts.delete(key);
    }
    return false;
  }

  function signedInAccount(req) {
    const accountId = req.session && req.session.accountId;
    return accountId ? db.getAccountById(accountId) : null;
  }

  app.get('/api/support/thread', (req, res) => {
    const account = signedInAccount(req);
    const token = readSupportToken(req);
    const thread = db.getCustomerSupportThread({
      accountId: account ? account.id : null,
      tokenHash: token ? hashToken(token) : null,
      markSeen: req.query.seen === '1',
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      thread,
      account: account ? { name: account.name, email: account.email } : null,
    });
  });

  app.post('/api/support/messages', (req, res) => {
    const body = req.body || {};
    // Hidden field real visitors never fill in; bots usually do.
    if (cleanText(body.website, 200)) return res.json({ ok: true, thread: null });
    if (rateLimited(clientIp(req))) {
      return res.status(429).json({ error: 'Too many messages in a short time. Please wait a bit and try again.' });
    }
    const message = cleanText(body.message, MAX_BODY);
    if (!message) return res.status(400).json({ error: 'Type a message first.' });

    const account = signedInAccount(req);
    let name = cleanText(body.name, 80);
    let email = cleanText(body.email, 254).toLowerCase();
    if (account) {
      name = account.name || name;
      email = account.email || email;
    } else {
      const existingToken = readSupportToken(req);
      const existing = existingToken ? db.getCustomerSupportThread({ tokenHash: hashToken(existingToken) }) : null;
      if (existing) {
        name = name || existing.name;
        email = email || existing.email;
      }
      if (!name) return res.status(400).json({ error: 'Please add your name.' });
      if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'Please add a valid email so we can identify your conversation.' });
    }
    const orderNumber = cleanText(body.orderNumber, 24).replace(/[^A-Za-z0-9#-]/g, '');

    let tokenHash = null;
    if (!account) {
      let token = readSupportToken(req);
      if (!token) {
        token = crypto.randomBytes(32).toString('base64url');
      }
      res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: COOKIE_MAX_AGE_MS, path: '/' });
      tokenHash = hashToken(token);
    }

    const result = db.addSupportCustomerMessage({ accountId: account ? account.id : null, tokenHash, name, email, orderNumber, body: message });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, thread: result.thread });
  });

  app.get('/api/admin/support/unread', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ unread: db.supportUnreadCount() });
  });

  app.get('/api/admin/support/threads', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ threads: db.listSupportThreads() });
  });

  app.get('/api/admin/support/threads/:id', requireAdmin, (req, res) => {
    const thread = db.getSupportThreadForAdmin(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Conversation not found.' });
    res.set('Cache-Control', 'no-store');
    res.json({ thread });
  });

  app.post('/api/admin/support/threads/:id/reply', requireAdmin, (req, res) => {
    const message = cleanText(req.body && req.body.message, MAX_BODY);
    if (!message) return res.status(400).json({ error: 'Type a reply first.' });
    const thread = db.addSupportAdminReply(req.params.id, message);
    if (!thread) return res.status(404).json({ error: 'Conversation not found.' });
    if (thread.error) return res.status(400).json({ error: thread.error });
    res.json({ thread });
  });

  app.post('/api/admin/support/threads/:id/status', requireAdmin, (req, res) => {
    const thread = db.setSupportThreadStatus(req.params.id, req.body && req.body.status);
    if (!thread) return res.status(404).json({ error: 'Conversation not found.' });
    res.json({ thread });
  });
}

module.exports = { registerSupportInboxRoutes, hashToken, readSupportToken, COOKIE_NAME };
