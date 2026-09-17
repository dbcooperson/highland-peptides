const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('./config');
const { registerCheckoutVerificationRoutes, isCheckoutEmailVerified } = require('./checkout-verification');

function routes() {
  const handlers = {};
  const app = {
    get(path, handler) { handlers[`GET ${path}`] = handler; },
    post(path, handler) { handlers[`POST ${path}`] = handler; },
  };
  registerCheckoutVerificationRoutes(app);
  return handlers;
}

function response() {
  return {
    code: 200, body: null, cookies: [],
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    cookie(name, value, options) { this.cookies.push({ name, value, options }); },
  };
}

test('checkout email code verifies only the matching email and becomes single-use', () => {
  const handlers = routes();
  const email = 'research@example.com';
  const code = '123456';
  const hash = crypto.createHmac('sha256', config.SESSION_SECRET).update(`${email}:${code}`).digest('hex');
  const req = {
    body: { email, code, rememberDevice: true },
    session: { checkoutEmailChallenge: { email, hash, expiresAt: Date.now() + 60000, attempts: 0 } },
    headers: {}, secure: true, get() { return undefined; },
  };
  const res = response();
  handlers['POST /api/checkout-email/verify'](req, res);
  assert.equal(res.body.verified, true);
  assert.equal(req.session.checkoutEmailChallenge, null);
  assert.equal(isCheckoutEmailVerified(req, email), true);
  assert.equal(isCheckoutEmailVerified(req, 'other@example.com'), false);
  assert.equal(res.cookies[0].options.httpOnly, true);
  assert.equal(res.cookies[0].options.secure, true);

  const remembered = { session: {}, headers: { cookie: `${res.cookies[0].name}=${res.cookies[0].value}` } };
  assert.equal(isCheckoutEmailVerified(remembered, email), true);
  assert.equal(isCheckoutEmailVerified(remembered, 'other@example.com'), false);
  const tampered = { session: {}, headers: { cookie: `${res.cookies[0].name}=${res.cookies[0].value}x` } };
  assert.equal(isCheckoutEmailVerified(tampered, email), false);
  const repeat = response();
  handlers['POST /api/checkout-email/verify'](req, repeat);
  assert.equal(repeat.code, 400);
});

test('checkout email code rejects wrong codes and expires after five attempts', () => {
  const handlers = routes();
  const email = 'research@example.com';
  const req = {
    body: { email, code: '000000' },
    session: { checkoutEmailChallenge: {
      email,
      hash: crypto.createHmac('sha256', config.SESSION_SECRET).update(`${email}:123456`).digest('hex'),
      expiresAt: Date.now() + 60000,
      attempts: 0,
    } },
    headers: {},
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = response();
    handlers['POST /api/checkout-email/verify'](req, res);
    assert.equal(res.code, 400);
  }
  req.body.code = '123456';
  const locked = response();
  handlers['POST /api/checkout-email/verify'](req, locked);
  assert.equal(locked.code, 400);
  assert.equal(isCheckoutEmailVerified(req, email), false);
});
