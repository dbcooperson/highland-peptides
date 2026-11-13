const test = require('node:test');
const assert = require('node:assert/strict');
const shippingCountdown = require('../public/js/shipping-countdown');

test('shipping countdown uses the 5 PM Pacific cutoff and ships the same day', () => {
  const status = shippingCountdown.getStatus('2026-09-01T22:00:00Z'); // 3 PM PDT Tuesday
  assert.equal(status.beforeTodayCutoff, true);
  assert.equal(status.remainingMs, 2 * 60 * 60 * 1000);
  assert.equal(status.cutoff.toISOString(), '2026-09-02T00:00:00.000Z');
  assert.equal(status.shipDate.toISOString(), '2026-09-02T01:00:00.000Z');
});

test('shipping countdown advances to the next business day after 5 PM Pacific', () => {
  const status = shippingCountdown.getStatus('2026-09-02T01:00:00Z'); // 6 PM PDT Tuesday
  assert.equal(status.beforeTodayCutoff, false);
  assert.equal(status.remainingMs, 23 * 60 * 60 * 1000);
  assert.equal(status.cutoff.toISOString(), '2026-09-03T00:00:00.000Z');
});

test('shipping copy promises same-day dispatch before the cutoff, with no delay warning', () => {
  const copy = shippingCountdown.getCopy('card', '2026-09-01T22:00:00Z', 'America/Los_Angeles');
  assert.match(copy, /to ship today/i);
  assert.doesNotMatch(copy, /3 weeks|delay/i);
});
