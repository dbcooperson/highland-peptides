const test = require('node:test');
const assert = require('node:assert/strict');
const { hasHighlandReferral, referralOfferDiscount } = require('./referral-offer');

test('only the Highland referral link token activates the offer', () => {
  assert.equal(hasHighlandReferral(' highland10 '), true);
  assert.equal(hasHighlandReferral('OTHER10'), false);
  assert.equal(hasHighlandReferral(null), false);
});

test('referral link saves 10% without a promo code', () => {
  assert.deepEqual(referralOfferDiscount(100, null), { amount: 10, basePercent: 10, extraPercent: 0 });
});

test('any valid higher-value code adds no more than five percentage points', () => {
  assert.deepEqual(referralOfferDiscount(100, { rate: 0.15 }), { amount: 15, basePercent: 10, extraPercent: 5 });
  assert.equal(referralOfferDiscount(99.99, { rate: 0.2 }).amount, 15);
});

test('a lower-value code cannot be increased to five percent', () => {
  assert.equal(referralOfferDiscount(100, { rate: 0.03 }).amount, 13);
});
