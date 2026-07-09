const { BLOCKED_EMAIL_DOMAINS } = require('./config');

function emailDomain(email) {
  const parts = String(email).toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : null;
}

function isBusinessEmail(email) {
  const domain = emailDomain(email);
  if (!domain || !domain.includes('.')) return false;
  return !BLOCKED_EMAIL_DOMAINS.includes(domain);
}

function requireApprovedAccount(req, res, next) {
  if (!req.session.accountId) {
    return res.status(401).json({ error: 'Please log in.' });
  }
  if (req.session.accountStatus !== 'approved') {
    return res.status(403).json({ error: 'Your account is not yet approved for purchasing.' });
  }
  next();
}

function requireLoggedIn(req, res, next) {
  if (!req.session.accountId) {
    return res.status(401).json({ error: 'Please log in.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin login required.' });
  }
  next();
}

module.exports = { emailDomain, isBusinessEmail, requireApprovedAccount, requireLoggedIn, requireAdmin };
