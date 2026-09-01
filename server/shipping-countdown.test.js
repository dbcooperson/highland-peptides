const test = require('node:test');
const assert = require('node:assert/strict');
const shippingCountdown = require('../public/js/shipping-countdown');

test('shipping countdown uses the current Pacific cutoff before 2 PM', () => {
  const status = shippingCountdown.getStatus('2026-09-01T19:00:00Z');
  assert.equal(status.beforeTodayCutoff, true);
  assert.equal(status.remainingMs, 2 * 60 * 60 * 1000);
  assert.equal(status.cutoff.toISOString(), '2026-09-01T21:00:00.000Z');
  assert.equal(status.shipDate.toISOString(), '2026-09-02T19:00:00.000Z');
});

test('shipping countdown advances to the next cutoff after 2 PM Pacific', () => {
  const status = shippingCountdown.getStatus('2026-09-01T22:00:00Z');
  assert.equal(status.beforeTodayCutoff, false);
  assert.equal(status.remainingMs, 23 * 60 * 60 * 1000);
  assert.equal(status.cutoff.toISOString(), '2026-09-02T21:00:00.000Z');
  assert.equal(status.shipDate.toISOString(), '2026-09-03T19:00:00.000Z');
});

test('shipping copy converts the cutoff to the shopper time zone', () => {
  const copy = shippingCountdown.getCopy('card', '2026-09-01T19:00:00Z', 'America/New_York');
  assert.match(copy, /Order within 2h 0m/);
  assert.match(copy, /5:00 PM EDT your time \(2:00 PM PDT\)/);
});
