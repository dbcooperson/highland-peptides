const crypto = require('crypto');

const ADMIN_REMEMBER_COOKIE = 'hp.admin';
const DEFAULT_ADMIN_REMEMBER_DAYS = 30;
const MAX_ADMIN_REMEMBER_DAYS = 90;

function rememberDays(config) {
  const configured = Number(config.ADMIN_REMEMBER_DAYS || DEFAULT_ADMIN_REMEMBER_DAYS);
  if (!Number.isFinite(configured)) return DEFAULT_ADMIN_REMEMBER_DAYS;
  return Math.max(1, Math.min(MAX_ADMIN_REMEMBER_DAYS, Math.floor(configured)));
}

function rememberMaxAgeMs(config) {
  return rememberDays(config) * 24 * 60 * 60 * 1000;
}

function adminCredentialFingerprint(config) {
  const configuredHash = String(config.ADMIN_PASSWORD_SHA256 || '').trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(configuredHash)) return configuredHash;
  return crypto.createHash('sha256').update(String(config.ADMIN_PASSWORD || '')).digest('hex');
}

function rememberSigningKey(config) {
  return crypto.createHmac('sha256', String(config.SESSION_SECRET || ''))
    .update(`highland-admin-remember-v1:${adminCredentialFingerprint(config)}`)
    .digest();
}

function createAdminRememberToken(config, now = Date.now()) {
  const issuedAt = Number(now);
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    issuedAt,
    expiresAt: issuedAt + rememberMaxAgeMs(config),
    nonce: crypto.randomBytes(18).toString('base64url'),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', rememberSigningKey(config))
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAdminRememberToken(token, config, now = Date.now()) {
  const [payload, suppliedSignature, extra] = String(token || '').split('.');
  if (!payload || !suppliedSignature || extra) return false;

  const expectedSignature = crypto.createHmac('sha256', rememberSigningKey(config))
    .update(payload)
    .digest();
  let receivedSignature;
  try {
    receivedSignature = Buffer.from(suppliedSignature, 'base64url');
  } catch (_err) {
    return false;
  }
  if (receivedSignature.length !== expectedSignature.length
    || !crypto.timingSafeEqual(receivedSignature, expectedSignature)) return false;

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_err) {
    return false;
  }

  const currentTime = Number(now);
  const maxAge = rememberMaxAgeMs(config);
  return parsed.version === 1
    && Number.isFinite(parsed.issuedAt)
    && Number.isFinite(parsed.expiresAt)
    && typeof parsed.nonce === 'string'
    && parsed.nonce.length >= 20
    && parsed.issuedAt <= currentTime + (5 * 60 * 1000)
    && parsed.expiresAt > currentTime
    && parsed.expiresAt > parsed.issuedAt
    && parsed.expiresAt - parsed.issuedAt <= maxAge;
}

function readCookie(req, name) {
  const header = String(req.headers?.cookie || '');
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch (_err) {
      return '';
    }
  }
  return '';
}

function adminRememberCookieOptions(config, isProductionRuntime, includeMaxAge = true) {
  const options = {
    httpOnly: true,
    secure: Boolean(isProductionRuntime),
    sameSite: 'strict',
    path: '/api/admin',
  };
  if (includeMaxAge) options.maxAge = rememberMaxAgeMs(config);
  return options;
}

function restoreAdminFromRememberCookie(config) {
  return (req, _res, next) => {
    if (!req.session?.isAdmin) {
      const token = readCookie(req, ADMIN_REMEMBER_COOKIE);
      if (verifyAdminRememberToken(token, config)) req.session.isAdmin = true;
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) {
    return res.status(401).json({ error: 'Admin login required.' });
  }
  next();
}

module.exports = {
  ADMIN_REMEMBER_COOKIE,
  createAdminRememberToken,
  verifyAdminRememberToken,
  adminRememberCookieOptions,
  restoreAdminFromRememberCookie,
  requireAdmin,
};
