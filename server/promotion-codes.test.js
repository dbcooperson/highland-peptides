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
const { configuredPromoManagers } = require('./promo-managers');

test('multiple promo managers can be configured without exposing plaintext passwords', () => {
  const managers = configuredPromoManagers({
    PROMO_MANAGER_BUILTIN_ACCOUNTS: [
      { username: 'BuiltInPromo', passwordSha256: 'd'.repeat(64) },
    ],
    PROMO_MANAGER_USERNAME: 'LegacyPromo',
    PROMO_MANAGER_PASSWORD_SHA256: 'a'.repeat(64),
    PROMO_MANAGER_ACCOUNTS_JSON: JSON.stringify([
      { username: 'PromoTwo', passwordSha256: 'b'.repeat(64) },
      { username: 'PromoThree', passwordSha256: 'c'.repeat(64) },
    ]),
  });
  assert.deepEqual(managers.map(item => item.username), ['builtinpromo', 'legacypromo', 'promotwo', 'promothree']);
  assert.equal(managers.every(item => /^[a-f0-9]{64}$/.test(item.passwordSha256)), true);
});

test('duplicate or malformed promo manager accounts are rejected at startup', () => {
  assert.throws(() => configuredPromoManagers({
    PROMO_MANAGER_USERNAME: 'same',
    PROMO_MANAGER_PASSWORD_SHA256: 'a'.repeat(64),
    PROMO_MANAGER_ACCOUNTS_JSON: JSON.stringify([{ username: 'SAME', passwordSha256: 'b'.repeat(64) }]),
  }), /duplicate/i);
  assert.throws(() => configuredPromoManagers({ PROMO_MANAGER_ACCOUNTS_JSON: '{bad json' }), /valid JSON/i);
});

test('promo manager creates persistent fixed 15% codes', () => {
  const created = db.createPromotionCode('launch15', 'promo15');
  assert.equal(created.code, 'LAUNCH15');
  assert.equal(created.rate, 0.15);
  assert.equal(db.getPromotionCodeByCode('launch15').rate, 0.15);
  assert.equal(db.getPromotionCodes()[0].code, 'LAUNCH15');
  assert.throws(() => db.createPromotionCode('launch15', 'promo15'), /already exists/i);
  assert.throws(() => db.createPromotionCode('bad code', 'promo15'), /letters or numbers/i);
});

test('NM gives the next two order redemptions 20% off, then returns to 15%', () => {
  const campaign = {
    id: 'nm-next-two-20-2026-09-22',
    code: 'NM',
    boostedRate: 0.20,
    fallbackRate: 0.15,
    maxUses: 2,
  };
  const createNmOrder = email => db.createOrder({
    buyer: { name: 'NM Customer', email },
    certifiedAt: new Date().toISOString(),
    items: [{ name: 'Research item', spec: '10mg', sku: 'TEST10', quantity: 1, unit_price: 100 }],
    subtotal: 100,
    promoEligibleSubtotal: 100,
    packagingFee: 0,
    shippingFee: 0,
    orderFee: 0,
    orderFeeRate: 0,
    discountCode: 'NM',
    discountType: 'promotion',
    discountAmount: 15,
    total: 85,
    paymentProvider: 'stripe',
    limitedPromotion: campaign,
  });

  assert.equal(db.getLimitedPromotionRate(campaign), 0.20);
  const first = createNmOrder('first-nm@example.com');
  const second = createNmOrder('second-nm@example.com');
  const third = createNmOrder('third-nm@example.com');
  assert.deepEqual([first.discount_amount, second.discount_amount, third.discount_amount], [20, 20, 15]);
  assert.deepEqual([first.total, second.total, third.total], [80, 80, 85]);
  assert.equal(db.getLimitedPromotionRate(campaign), 0.15);
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

test('promo02 sees only owner-approved OGRE orders', () => {
  const order = db.createOrder({
    buyer: { name: 'Approved Researcher', email: 'approved@example.com', address1: 'Private address', city: 'Private city', state: 'CA', zip: '90001', country: 'US' },
    certifiedAt: new Date().toISOString(),
    items: [{ name: 'Research item', spec: '10mg', sku: 'TEST10', quantity: 1, price: 50 }],
    subtotal: 50,
    promoEligibleSubtotal: 50,
    packagingFee: 0,
    shippingFee: 10,
    orderFee: 0,
    discountCode: 'OGRE',
    discountType: 'promotion',
    discountAmount: 7.50,
    total: 52.50,
    paymentProvider: 'zelle',
  });
  assert.deepEqual(db.getApprovedPromoManagerOrders('promo02', 'OGRE'), []);
  assert.equal(db.setPromoManagerOrderVisibility(order.id, 'promo03', true), null);
  assert.equal(db.setPromoManagerOrderVisibility(order.id, 'promo02', true).id, order.id);
  assert.deepEqual(db.getApprovedPromoManagerOrders('promo02', 'OGRE').map(item => item.id), [order.id]);
  assert.deepEqual(db.getApprovedPromoManagerOrders('promo03', 'OGRE'), []);
  assert.equal(db.setPromoManagerOrderVisibility(order.id, 'promo02', false).id, order.id);
  assert.deepEqual(db.getApprovedPromoManagerOrders('promo02', 'OGRE'), []);
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

test('approved OGRE order access is gated to promo02 and owner approval', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'promo-manager.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'promo-manager.js'), 'utf8');
  const adminScript = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(html, /Owner-approved OGRE orders/i);
  assert.match(script, /\/api\/promo-manager\/ogre-orders/);
  assert.match(adminScript, /\/api\/admin\/orders\/\$\{btn\.dataset\.id\}\/promo-visibility/);
  assert.match(serverSource, /username !== 'promo02'/);
  assert.match(serverSource, /db\.getApprovedPromoManagerOrders\(username, 'OGRE'\)/);
  assert.doesNotMatch(script, /address|payment_reference|tracking_number|private notes/i);
});

test('promo audit UI and API are confined to the full admin area', () => {
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(adminHtml, /data-admin-tab="promo-audit"/);
  assert.match(serverSource, /app\.get\('\/api\/admin\/promo-audit', requireAdmin/);
  assert.match(serverSource, /app\.post\('\/api\/promo-manager\/logout', requirePromoManager/);
});
