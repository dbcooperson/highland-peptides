const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('./config');
const { reminderIsDue } = require('./reminders');
const { trackingUrl } = require('./notifications');

test('payment reminder becomes due after the configured first delay', () => {
  const now = Date.parse('2026-08-21T12:00:00.000Z');
  const created = new Date(now - (config.PAYMENT_REMINDER_FIRST_HOURS + 1) * 60 * 60 * 1000).toISOString();
  assert.equal(reminderIsDue({
    status: 'pending_payment',
    payment_provider: 'manual_paypal',
    created_at: created,
    payment_reminders_enabled: true,
    payment_reminder_count: 0,
  }, now), true);
});

test('historical pending orders are not enrolled automatically', () => {
  assert.equal(reminderIsDue({
    status: 'pending_payment',
    payment_provider: 'manual_paypal',
    created_at: '2020-01-01T00:00:00.000Z',
    payment_reminder_count: 0,
  }, Date.now()), false);
});

test('paid orders never receive payment reminders', () => {
  assert.equal(reminderIsDue({
    status: 'paid',
    payment_provider: 'manual_paypal',
    created_at: '2020-01-01T00:00:00.000Z',
  }, Date.now()), false);
});

test('carrier tracking links include the encoded tracking number', () => {
  const url = trackingUrl('USPS', '9400 1000');
  assert.match(url, /9400%201000/);
});
