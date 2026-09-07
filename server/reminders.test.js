const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('./config');
const { reminderIsDue, runPaymentReminderScan } = require('./reminders');
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

test('repeat reminders wait for the configured two-week interval', () => {
  const now = Date.parse('2026-09-07T12:00:00.000Z');
  const almostDue = new Date(now - (config.PAYMENT_REMINDER_REPEAT_HOURS - 1) * 60 * 60 * 1000).toISOString();
  const due = new Date(now - (config.PAYMENT_REMINDER_REPEAT_HOURS + 1) * 60 * 60 * 1000).toISOString();
  const base = {
    status: 'pending_payment',
    payment_provider: 'crypto',
    payment_reminders_enabled: true,
    payment_reminder_count: 1,
  };
  assert.equal(reminderIsDue({ ...base, payment_reminder_last_sent_at: almostDue }, now), false);
  assert.equal(reminderIsDue({ ...base, payment_reminder_last_sent_at: due }, now), true);
});

test('reminder scan claims an order before sending it', async () => {
  const originalSmtpHost = config.SMTP_HOST;
  config.SMTP_HOST = 'smtp.test.invalid';
  const now = Date.parse('2026-09-07T12:00:00.000Z');
  const order = {
    id: 91,
    status: 'pending_payment',
    payment_provider: 'manual_paypal',
    payment_reminders_enabled: true,
    payment_reminder_count: 0,
    created_at: new Date(now - (config.PAYMENT_REMINDER_FIRST_HOURS + 1) * 60 * 60 * 1000).toISOString(),
  };
  const calls = [];
  try {
    const result = await runPaymentReminderScan({
      db: {
        getAllOrders: () => [order],
        claimPaymentReminder: id => { calls.push(`claim:${id}`); return { claimed: true, order }; },
        markPaymentReminderSent: id => calls.push(`sent:${id}`),
        markPaymentReminderFailed: id => calls.push(`failed:${id}`),
      },
      sendPaymentReminder: async () => { calls.push('email'); return 'email'; },
      nowMs: now,
    });
    assert.deepEqual(calls, ['claim:91', 'email', 'sent:91']);
    assert.equal(result.sent, 1);
  } finally {
    config.SMTP_HOST = originalSmtpHost;
  }
});

test('carrier tracking links include the encoded tracking number', () => {
  const url = trackingUrl('USPS', '9400 1000');
  assert.match(url, /9400%201000/);
});
