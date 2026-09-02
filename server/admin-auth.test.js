const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMIN_REMEMBER_COOKIE,
  createAdminRememberToken,
  verifyAdminRememberToken,
  adminRememberCookieOptions,
  restoreAdminFromRememberCookie,
} = require('./auth');

function authConfig(overrides = {}) {
  return {
    ADMIN_PASSWORD: 'correct horse battery staple',
    ADMIN_PASSWORD_SHA256: '',
    SESSION_SECRET: 'test-session-secret-with-enough-entropy',
    ADMIN_REMEMBER_DAYS: 30,
    ...overrides,
  };
}

test('remembered admin token survives a new session and restores admin access', () => {
  const now = Date.UTC(2026, 8, 1);
  const config = authConfig();
  const token = createAdminRememberToken(config, now);
  assert.equal(verifyAdminRememberToken(token, config, now + 1000), true);

  const req = {
    headers: { cookie: `${ADMIN_REMEMBER_COOKIE}=${encodeURIComponent(token)}` },
    session: {},
  };
  let called = false;
  restoreAdminFromRememberCookie(config)(req, {}, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.session.isAdmin, true);
});

test('remembered admin token rejects tampering, expiry, and credential rotation', () => {
  const now = Date.UTC(2026, 8, 1);
  const config = authConfig();
  const token = createAdminRememberToken(config, now);
  const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

  assert.equal(verifyAdminRememberToken(tampered, config, now + 1000), false);
  assert.equal(verifyAdminRememberToken(token, config, now + (31 * 24 * 60 * 60 * 1000)), false);
  assert.equal(verifyAdminRememberToken(token, authConfig({ ADMIN_PASSWORD: 'rotated password' }), now + 1000), false);
  assert.equal(verifyAdminRememberToken(token, authConfig({ SESSION_SECRET: 'rotated session secret' }), now + 1000), false);
});

test('remembered admin cookie is browser-inaccessible and production secure', () => {
  const options = adminRememberCookieOptions(authConfig(), true);
  assert.equal(options.httpOnly, true);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, 'strict');
  assert.equal(options.path, '/api/admin');
  assert.equal(options.maxAge, 30 * 24 * 60 * 60 * 1000);
});
