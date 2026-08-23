const config = require('./config');

function hoursBetween(olderIso, newerMs) {
  const olderMs = new Date(olderIso || 0).getTime();
  if (!Number.isFinite(olderMs)) return 0;
  return (newerMs - olderMs) / (60 * 60 * 1000);
}

function reminderIsDue(order, nowMs = Date.now()) {
  if (!order || order.status !== 'pending_payment') return false;
  // Opt in orders created after the reminder feature was deployed. Historical
  // pending records do not contain this flag and must never receive a surprise
  // automated email blast.
  if (order.payment_reminders_enabled !== true) return false;
  if (!['manual_paypal', 'crypto'].includes(order.payment_provider)) return false;
  const count = Number(order.payment_reminder_count || 0);
  if (count >= config.PAYMENT_REMINDER_MAX) return false;
  if (!count) return hoursBetween(order.created_at, nowMs) >= config.PAYMENT_REMINDER_FIRST_HOURS;
  return hoursBetween(order.payment_reminder_last_sent_at, nowMs) >= config.PAYMENT_REMINDER_REPEAT_HOURS;
}

async function runPaymentReminderScan({ db, sendPaymentReminder, nowMs = Date.now() }) {
  if (!config.PAYMENT_REMINDERS_ENABLED || !config.SMTP_HOST) return { checked: 0, sent: 0, errors: [] };
  const due = db.getAllOrders().filter(order => reminderIsDue(order, nowMs));
  const errors = [];
  let sent = 0;
  for (const order of due) {
    try {
      const channel = await sendPaymentReminder(order);
      if (channel) {
        db.markPaymentReminderSent(order.id);
        sent += 1;
      }
    } catch (err) {
      errors.push({ orderId: order.id, error: err.message || String(err) });
    }
  }
  return { checked: due.length, sent, errors };
}

function startPaymentReminderScheduler(dependencies) {
  if (!config.PAYMENT_REMINDERS_ENABLED || !config.SMTP_HOST) return null;
  const run = () => runPaymentReminderScan(dependencies).then(result => {
    if (result.errors.length) console.error('Payment reminder errors:', JSON.stringify(result.errors));
  }).catch(err => console.error('Payment reminder scan failed:', err.message || err));
  const initial = setTimeout(run, 15000);
  const interval = setInterval(run, config.PAYMENT_REMINDER_POLL_MINUTES * 60 * 1000);
  if (typeof initial.unref === 'function') initial.unref();
  if (typeof interval.unref === 'function') interval.unref();
  return interval;
}

module.exports = { reminderIsDue, runPaymentReminderScan, startPaymentReminderScheduler };
