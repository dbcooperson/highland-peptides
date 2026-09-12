const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highland-promotion-codes-'));
process.env.ORDER_DB_PATH = path.join(tempDir, 'db.json');
delete require.cache[require.resolve('./db')];
const db = require('./db');
const { requirePromoManager } = require('./auth');

test('promo manager creates persistent fixed 15% codes', () => {
  const created = db.createPromotionCode('launch15', 'promo15');
  assert.equal(created.code, 'LAUNCH15');
  assert.equal(created.rate, 0.15);
  assert.equal(db.getPromotionCodeByCode('launch15').rate, 0.15);
  assert.equal(db.getPromotionCodes()[0].code, 'LAUNCH15');
  assert.throws(() => db.createPromotionCode('launch15', 'promo15'), /already exists/i);
  assert.throws(() => db.createPromotionCode('bad code', 'promo15'), /letters or numbers/i);
});

test('promo account activity is recorded newest-first for owner review', () => {
  db.recordPromoAudit({ username: 'promo15', action: 'login', outcome: 'success', ip: '192.0.2.10' });
  db.recordPromoAudit({ username: 'promo15', action: 'code_create', outcome: 'success', code: 'LAUNCH15', ip: '192.0.2.10' });
  const entries = db.getPromoAuditLog(10);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].action, 'code_create');
  assert.equal(entries[0].code, 'LAUNCH15');
  assert.equal(entries[0].username, 'promo15');
  assert.equal(entries[1].action, 'login');
});

test('promo manager middleware grants only its dedicated session role', () => {
  let nextCalled = false;
  requirePromoManager({ session: { isPromoManager: true } }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  let statusCode = 0;
  let payload = null;
  requirePromoManager({ session: { isAdmin: true } }, {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; },
  }, () => {});
  assert.equal(statusCode, 401);
  assert.match(payload.error, /promo manager/i);
});

test('promo manager page exposes no general admin data or controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'promo-manager.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'promo-manager.js'), 'utf8');
  assert.match(html, /only create fixed 15%-off codes/i);
  assert.doesNotMatch(script, /\/api\/admin\//);
  assert.doesNotMatch(html, /id="ordersTable"|data-admin-tab|adminOrderSearch|adminTracking/i);
});

test('promo audit UI and API are confined to the full admin area', () => {
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(adminHtml, /data-admin-tab="promo-audit"/);
  assert.match(serverSource, /app\.get\('\/api\/admin\/promo-audit', requireAdmin/);
  assert.match(serverSource, /app\.post\('\/api\/promo-manager\/logout', requirePromoManager/);
});
