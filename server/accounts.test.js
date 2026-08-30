const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highland-accounts-'));
process.env.ORDER_DB_PATH = path.join(tempDir, 'db.json');
delete require.cache[require.resolve('./db')];
const db = require('./db');
const { hashPassword, verifyPassword, createToken, hashToken } = require('./account-security');

async function verifiedAccount(name, email) {
  const password = await hashPassword('Testpass1');
  const token = createToken();
  const account = db.createAccount({
    name,
    email,
    passwordSalt: password.salt,
    passwordHash: password.hash,
    verificationTokenHash: hashToken(token),
    verificationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  return db.verifyAccountByTokenHash(hashToken(token)) || account;
}

function referredOrder(referrer, email, subtotal = 100, discount = 10) {
  return db.createOrder({
    buyer: { name: 'Referred Customer', email },
    certifiedAt: new Date().toISOString(),
    items: [{ sku: 'TEST', name: 'Test Product', spec: '10mg', quantity: 1, unit_price: subtotal }],
    subtotal,
    packagingFee: 0,
    shippingFee: 10.27,
    shippingMethod: 'domestic',
    orderFee: 3,
    orderFeeRate: 0.03,
    discountCode: referrer.referral_code,
    discountAmount: discount,
    total: subtotal - discount + 13.27,
    paymentProvider: 'manual_paypal',
    referralAccountId: referrer.id,
    referralCreditRate: 0.10,
  });
}

test('passwords use salted scrypt hashes', async () => {
  const record = await hashPassword('Highland123');
  assert.notEqual(record.hash, 'Highland123');
  assert.equal(await verifyPassword('Highland123', record.salt, record.hash), true);
  assert.equal(await verifyPassword('wrong-password', record.salt, record.hash), false);
});

test('verification is single-use and one referral code is enforced', async () => {
  const account = await verifiedAccount('Referral Owner', 'owner@example.com');
  assert.ok(account.verified_at);
  const withCode = db.setAccountReferralCode(account.id, 'RIDGE10');
  assert.equal(withCode.referral_code, 'RIDGE10');
  assert.throws(() => db.setAccountReferralCode(account.id, 'SECOND10'), /already has/i);
  assert.equal(db.getAccountByReferralCode('ridge10').id, account.id);
});

test('paid referral orders wait for approval, award credit once, and cancelled credit orders are restored', async () => {
  const owner = db.getAccountByEmail('owner@example.com');
  const order = referredOrder(owner, 'friend1@example.com');
  db.markOrderPaid(order.id, 'payment-1');
  db.markOrderPaid(order.id, 'payment-1');
  let dashboard = db.getAccountDashboard(owner.id, { minCustomers: 5, minSpend: 500 });
  assert.equal(dashboard.stats.creditBalance, 0);
  assert.equal(db.getOrderById(order.id).referral_credit_status, 'pending_review');

  db.reviewReferralCredit(order.id, 'approved', 'Verified by admin');
  assert.throws(() => db.reviewReferralCredit(order.id, 'approved'), /no longer awaiting review/i);
  dashboard = db.getAccountDashboard(owner.id, { minCustomers: 5, minSpend: 500 });
  assert.equal(dashboard.stats.creditBalance, 9);
  assert.equal(dashboard.stats.uniqueCustomers, 1);
  assert.equal(dashboard.stats.totalSpend, 90);

  const creditOrder = db.createOrder({
    buyer: { name: 'Owner', email: owner.email },
    certifiedAt: new Date().toISOString(),
    items: [{ sku: 'TEST2', name: 'Test Product 2', spec: '5mg', quantity: 1, unit_price: 20 }],
    subtotal: 20,
    packagingFee: 0,
    shippingFee: 10.27,
    shippingMethod: 'domestic',
    orderFee: 1,
    orderFeeRate: 0.03,
    discountAmount: 0,
    storeCreditAmount: 4,
    customerAccountId: owner.id,
    total: 27.27,
    paymentProvider: 'manual_paypal',
  });
  dashboard = db.getAccountDashboard(owner.id, { minCustomers: 5, minSpend: 500 });
  assert.equal(dashboard.stats.creditBalance, 5);
  db.updateOrderStatus(creditOrder.id, 'cancelled');
  dashboard = db.getAccountDashboard(owner.id, { minCustomers: 5, minSpend: 500 });
  assert.equal(dashboard.stats.creditBalance, 9);
});

test('payout unlocks at five unique customers and $500 aggregate paid spend', () => {
  const owner = db.getAccountByEmail('owner@example.com');
  for (let index = 2; index <= 5; index += 1) {
    const order = referredOrder(owner, `friend${index}@example.com`, 115, 11.5);
    db.markOrderPaid(order.id, `payment-${index}`);
    db.reviewReferralCredit(order.id, 'approved');
  }
  const dashboard = db.getAccountDashboard(owner.id, { minCustomers: 5, minSpend: 500 });
  assert.equal(dashboard.stats.uniqueCustomers, 5);
  assert.equal(dashboard.stats.totalSpend, 504);
  assert.equal(dashboard.stats.payoutEligible, true);
  assert.equal(dashboard.stats.creditBalance, 50.4);

  const payout = db.createPayoutRequest(owner.id, { minCustomers: 5, minSpend: 500 });
  assert.equal(payout.amount_cents, 5040);
  assert.throws(() => db.createPayoutRequest(owner.id, { minCustomers: 5, minSpend: 500 }), /under review/i);
  db.updatePayoutRequest(payout.id, 'rejected', 'Test rejection');
  const restored = db.getAccountDashboard(owner.id, { minCustomers: 5, minSpend: 500 });
  assert.equal(restored.stats.creditBalance, 50.4);
});

test('TikTok creator credit is manually approved, unique, and limited to one submission every seven days', async () => {
  const owner = db.getAccountByEmail('owner@example.com');
  const submission = db.createSocialCreditSubmission(
    owner.id,
    'https://www.tiktok.com/@highlandoffical/video/1234567890',
    { creditCents: 500, cooldownDays: 7 }
  );

  let dashboard = db.getAccountDashboard(owner.id, { minCustomers: 5, minSpend: 500, socialCooldownDays: 7 });
  assert.equal(submission.status, 'pending_review');
  assert.equal(dashboard.stats.creditBalance, 50.4);
  assert.equal(dashboard.socialSubmissions[0].creditAmount, 5);
  assert.throws(
    () => db.createSocialCreditSubmission(owner.id, 'https://www.tiktok.com/@highlandoffical/video/999', { creditCents: 500, cooldownDays: 7 }),
    /every 7 days/i
  );
  const secondOwner = await verifiedAccount('Second Creator', 'second-creator@example.com');
  assert.throws(
    () => db.createSocialCreditSubmission(secondOwner.id, submission.video_url, { creditCents: 500, cooldownDays: 7 }),
    /already been submitted/i
  );

  db.reviewSocialCreditSubmission(submission.id, 'approved', 'Verified tag');
  assert.throws(() => db.reviewSocialCreditSubmission(submission.id, 'approved'), /no longer awaiting review/i);
  dashboard = db.getAccountDashboard(owner.id, { minCustomers: 5, minSpend: 500, socialCooldownDays: 7 });
  assert.equal(dashboard.stats.creditBalance, 55.4);
  assert.equal(dashboard.socialSubmissions[0].status, 'approved');
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
