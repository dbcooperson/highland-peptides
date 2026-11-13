const CAMPAIGN_CODE = 'SNOWY10';
// Links shared before the Snowy rebrand keep working.
const LEGACY_CAMPAIGN_CODES = ['HIGHLAND10'];
const BASE_RATE = 0.10;
const EXTRA_CODE_RATE = 0.05;

// The referral-link discount is retired (Nov 2026): links no longer reduce the price.
function hasCampaignReferral(_value) {
  return false;
}

function referralOfferDiscount(eligibleSubtotal, codeMatch) {
  const subtotal = Math.max(0, Number(eligibleSubtotal) || 0);
  const extraRate = codeMatch ? EXTRA_CODE_RATE : 0;
  return {
    amount: Math.round(subtotal * (BASE_RATE + extraRate) * 100) / 100,
    basePercent: BASE_RATE * 100,
    extraPercent: extraRate * 100,
  };
}

module.exports = { CAMPAIGN_CODE, BASE_RATE, EXTRA_CODE_RATE, hasCampaignReferral, referralOfferDiscount };
