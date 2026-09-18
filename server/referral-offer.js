const CAMPAIGN_CODE = 'HIGHLAND10';
const BASE_RATE = 0.10;
const EXTRA_CODE_RATE = 0.05;

function hasHighlandReferral(value) {
  return String(value || '').trim().toUpperCase() === CAMPAIGN_CODE;
}

function referralOfferDiscount(eligibleSubtotal, codeMatch) {
  const subtotal = Math.max(0, Number(eligibleSubtotal) || 0);
  const extraRate = codeMatch ? Math.min(EXTRA_CODE_RATE, Math.max(0, Number(codeMatch.rate) || 0)) : 0;
  return {
    amount: Math.round(subtotal * (BASE_RATE + extraRate) * 100) / 100,
    basePercent: BASE_RATE * 100,
    extraPercent: extraRate * 100,
  };
}

module.exports = { CAMPAIGN_CODE, BASE_RATE, EXTRA_CODE_RATE, hasHighlandReferral, referralOfferDiscount };
