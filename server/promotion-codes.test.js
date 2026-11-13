const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowy-promotion-codes-'));
process.env.ORDER_DB_PATH = path.join(tempDir, 'db.json');
delete require.cache[require.resolve('./db')];
const db = require('./db');
const config = require('./config');

test('TIKTOK15 (15% off) is the only code that works', () => {
  assert.deepEqual(config.DISCOUNT_CODES, { TIKTOK15: 0.15 });
  assert.deepEqual(config.LIMITED_PROMOTION_CAMPAIGNS, {});
  const serverSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const resolver = serverSource.slice(serverSource.indexOf('function resolveDiscountCode'), serverSource.indexOf("app.get('/api/discount-code'"));
  // Promo-manager codes and customer referral codes never resolve.
  assert.doesNotMatch(resolver, /getPromotionCodeByCode|getAccountByReferralCode/);
  // New codes can no longer be created by promo managers or customers.
  assert.match(fs.readFileSync(path.join(__dirname, 'accounts.js'), 'utf8'), /Referral codes are no longer available/);
});

test('crypto orders are charged no processing fee', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  assert.match(serverSource, /const orderFeeRate = normalizedPaymentMethod === 'crypto' \? 0 : config\.ORDER_FEE_RATE;/);
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

test('the promo-manager page, logins and admin hooks are gone', () => {
  const root = path.join(__dirname, '..');
  assert.equal(fs.existsSync(path.join(root, 'public', 'promo-manager.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'public', 'js', 'promo-manager.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, 'promo-managers.js')), false);
  const serverSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const adminSource = fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8') + fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
  assert.doesNotMatch(serverSource, /\/api\/promo-manager|promo-visibility|promo-audit/);
  assert.doesNotMatch(adminSource, /promo-audit|promo-visibility|promo02/);
  assert.equal(config.PROMO_MANAGER_BUILTIN_ACCOUNTS, undefined);
});
