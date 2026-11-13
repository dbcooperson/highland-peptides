// Lifecycle emails:
//  - Abandoned checkout: someone verified their email at checkout (or created an
//    unpaid card order) and did not pay within ABANDONED_CHECKOUT_DELAY_MINUTES.
//    One email with a link that rebuilds their cart.
//  - Reorder reminder: REORDER_REMINDER_DAYS after a paid order, if they have
//    not ordered again. One email with a one-click "reorder" link.
// Every email has an unsubscribe link and the business postal address (CAN-SPAM).
// Nothing is sent until BUSINESS_MAILING_ADDRESS and SMTP are configured.
const crypto = require('crypto');
const config = require('./config');
const { bySku } = require('./products');
const { smtpTransport, htmlEscape } = require('./notifications');
const { isCheckoutEmailVerified, cleanEmail } = require('./checkout-verification');
const { giveawayStatus } = require('./giveaway');

const PAID = new Set(['paid', 'pending_tracking', 'fulfilled']);
const RESTORE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

function sign(value) {
  return crypto.createHmac('sha256', config.SESSION_SECRET).update(`lifecycle:${value}`).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Cart link token: base64url(JSON {i: [[sku, qty]...], x: expiry}).signature
function cartToken(items, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    i: items.filter(item => bySku[item.sku]).map(item => [item.sku, Math.min(99, Math.max(1, Math.floor(Number(item.quantity) || 1)))]),
    x: now + RESTORE_TTL_MS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readCartToken(token, now = Date.now()) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!(data.x > now) || !Array.isArray(data.i)) return null;
    const cart = {};
    data.i.forEach(([sku, qty]) => { if (bySku[sku]) cart[sku] = Math.min(99, Math.max(1, Math.floor(Number(qty) || 1))); });
    return Object.keys(cart).length ? cart : null;
  } catch { return null; }
}

function unsubscribeUrl(email) {
  const normalized = cleanEmail(email);
  return `${config.ACCOUNT_SITE_URL}/api/email/unsubscribe?e=${encodeURIComponent(normalized)}&t=${sign(`unsub:${normalized}`)}`;
}

function lifecycleReady() {
  return Boolean(config.LIFECYCLE_EMAILS_ENABLED && config.BUSINESS_MAILING_ADDRESS && config.SMTP_HOST);
}

// Only paid products (and real catalog items) go into a restore link.
function paidItems(items) {
  return (items || []).filter(item => bySku[item.sku] && Number(item.unit_price == null ? 1 : item.unit_price) > 0);
}

function itemListText(items) {
  return paidItems(items).map(item => `- ${item.quantity}x ${bySku[item.sku].name} ${bySku[item.sku].spec.replace(/\s*x1\s*vial/i, '')}`).join('\n');
}

function itemListHtml(items) {
  return paidItems(items).map(item => `<li>${Number(item.quantity)}&times; ${htmlEscape(bySku[item.sku].name)} <span style="color:#6b7280">${htmlEscape(bySku[item.sku].spec.replace(/\s*x1\s*vial/i, ''))}</span></li>`).join('');
}

function giveawayLine() {
  return giveawayStatus(config.LAUNCH_GIVEAWAY || {}) === 'active'
    ? 'Launch giveaway: every peptide vial in your order is an entry to win $100 store credit.'
    : '';
}

function layout({ heading, intro, items, buttonUrl, buttonText, extra, email }) {
  const giveaway = giveawayLine();
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0e1b24">
    <h2 style="margin:0 0 12px">${htmlEscape(heading)}</h2>
    <p style="margin:0 0 14px;line-height:1.5">${htmlEscape(intro)}</p>
    ${items ? `<ul style="margin:0 0 18px;padding-left:18px;line-height:1.6">${items}</ul>` : ''}
    <p style="margin:0 0 18px"><a href="${buttonUrl}" style="display:inline-block;background:#0e1b24;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">${htmlEscape(buttonText)}</a></p>
    ${extra ? `<p style="margin:0 0 12px;line-height:1.5">${htmlEscape(extra)}</p>` : ''}
    ${giveaway ? `<p style="margin:0 0 12px;line-height:1.5;font-weight:bold">${htmlEscape(giveaway)}</p>` : ''}
    <p style="margin:24px 0 0;font-size:12px;color:#6b7280;line-height:1.5">
      All products are sold for laboratory research use only.<br>
      ${htmlEscape(config.SITE_NAME)} · ${htmlEscape(config.BUSINESS_MAILING_ADDRESS)}<br>
      <a href="${unsubscribeUrl(email)}" style="color:#6b7280">Unsubscribe</a> from these emails.
    </p>
  </div>`;
  return html;
}

async function sendLifecycleEmail({ to, subject, text, html }) {
  const transport = smtpTransport();
  if (!transport) return false;
  const unsubscribe = unsubscribeUrl(to);
  await transport.sendMail({
    from: config.CUSTOMER_EMAIL_FROM,
    to,
    replyTo: config.CUSTOMER_EMAIL_FROM,
    subject,
    text: `${text}\n\n${giveawayLine()}\n\nAll products are sold for laboratory research use only.\n${config.SITE_NAME} · ${config.BUSINESS_MAILING_ADDRESS}\nUnsubscribe: ${unsubscribe}`,
    html,
    headers: {
      'List-Unsubscribe': `<${unsubscribe}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  return true;
}

function abandonedEmail(email, items) {
  const url = `${config.ACCOUNT_SITE_URL}/cart.html?restore=${cartToken(paidItems(items))}`;
  return {
    to: email,
    subject: 'You left something in your cart',
    text: `Your Snowy Research cart is saved:\n${itemListText(items)}\n\nFinish your order: ${url}\n\nQuestions? Just reply to this email.`,
    html: layout({
      heading: 'Your cart is saved',
      intro: 'You started a checkout but did not finish. Everything is still waiting for you:',
      items: itemListHtml(items),
      buttonUrl: url,
      buttonText: 'Finish my order',
      extra: 'Orders confirmed before 5 PM PT ship the same day. Questions? Just reply to this email.',
      email,
    }),
  };
}

function reorderEmail(order) {
  const email = order.buyer.email;
  const url = `${config.ACCOUNT_SITE_URL}/cart.html?restore=${cartToken(paidItems(order.items))}`;
  return {
    to: email,
    subject: 'Time to restock your research supplies?',
    text: `It has been a few weeks since order SR-${order.id}. Reorder the same items in one click: ${url}\n\nQuestions? Just reply to this email.`,
    html: layout({
      heading: 'Ready to restock?',
      intro: `It has been a few weeks since order SR-${order.id}. Reorder the same items in one click:`,
      items: itemListHtml(order.items),
      buttonUrl: url,
      buttonText: 'Reorder these items',
      extra: 'Bigger orders unlock a larger free Reconstitution Solution, and full research sets are 10% off.',
      email,
    }),
  };
}

// Pure decision logic (tested): which emails are due right now.
function dueLifecycleEmails({ orders, checkoutStarts, isSuppressed, nowMs = Date.now() }) {
  const abandonedMs = config.ABANDONED_CHECKOUT_DELAY_MINUTES * 60 * 1000;
  const reorderMs = config.REORDER_REMINDER_DAYS * 24 * 60 * 60 * 1000;
  const byEmail = new Map();
  for (const order of orders) {
    const email = cleanEmail(order.buyer && order.buyer.email);
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, []);
    byEmail.get(email).push(order);
  }
  const ordersAfter = (email, iso) => (byEmail.get(email) || []).filter(order => new Date(order.created_at) > new Date(iso));
  const paidAfter = (email, iso) => ordersAfter(email, iso).some(order => PAID.has(order.status));
  const abandoned = [];
  const reorders = [];
  const emailedNow = new Set();

  // Unpaid card orders (crypto orders already get payment reminders).
  for (const order of orders) {
    const email = cleanEmail(order.buyer && order.buyer.email);
    if (!email || !order.lifecycle_emails || order.abandoned_email_sent_at) continue;
    if (order.status !== 'pending_payment' || order.payment_provider !== 'stripe') continue;
    if (nowMs - new Date(order.created_at).getTime() < abandonedMs) continue;
    if (nowMs - new Date(order.created_at).getTime() > 7 * 24 * 60 * 60 * 1000) continue;
    if (paidAfter(email, order.created_at) || isSuppressed(email) || emailedNow.has(email)) continue;
    if (!paidItems(order.items).length) continue;
    emailedNow.add(email);
    abandoned.push({ kind: 'order', order, email, items: order.items });
  }
  // Verified at checkout but never placed an order.
  for (const start of checkoutStarts) {
    const email = cleanEmail(start.email);
    if (!email || start.emailed_at || start.closed_at) continue;
    const startedMs = new Date(start.updated_at || start.created_at).getTime();
    if (nowMs - startedMs < abandonedMs || nowMs - startedMs > 7 * 24 * 60 * 60 * 1000) continue;
    if (ordersAfter(email, start.created_at).length || isSuppressed(email) || emailedNow.has(email)) continue;
    if (!paidItems(start.items).length) continue;
    emailedNow.add(email);
    abandoned.push({ kind: 'start', start, email, items: start.items });
  }
  // Reorder: latest paid order per email, past the reminder age, nothing newer.
  for (const [email, list] of byEmail) {
    const paid = list.filter(order => PAID.has(order.status)).sort((a, b) => new Date(b.paid_at || b.created_at) - new Date(a.paid_at || a.created_at));
    const latest = paid[0];
    if (!latest || !latest.lifecycle_emails || latest.reorder_email_sent_at) continue;
    const age = nowMs - new Date(latest.paid_at || latest.created_at).getTime();
    if (age < reorderMs || age > reorderMs + 21 * 24 * 60 * 60 * 1000) continue;
    if (ordersAfter(email, latest.created_at).length || isSuppressed(email) || emailedNow.has(email)) continue;
    if (!paidItems(latest.items).length) continue;
    emailedNow.add(email);
    reorders.push({ order: latest, email });
  }
  return { abandoned, reorders };
}

async function runLifecycleScan({ db, send = sendLifecycleEmail, nowMs = Date.now() }) {
  if (!lifecycleReady()) return { sent: 0, errors: [] };
  const due = dueLifecycleEmails({
    orders: db.getAllOrders(),
    checkoutStarts: db.getCheckoutStarts(),
    isSuppressed: email => db.isEmailSuppressed(email),
    nowMs,
  });
  let sent = 0;
  const errors = [];
  for (const item of due.abandoned) {
    try {
      if (item.kind === 'order') {
        if (!db.claimOrderLifecycleEmail(item.order.id, 'abandoned_email_sent_at')) continue;
      } else if (!db.markCheckoutStart(item.email, item.start.created_at, 'emailed_at')) continue;
      if (await send(abandonedEmail(item.email, item.items))) sent += 1;
    } catch (err) { errors.push(err.message || String(err)); }
  }
  for (const item of due.reorders) {
    try {
      if (!db.claimOrderLifecycleEmail(item.order.id, 'reorder_email_sent_at')) continue;
      if (await send(reorderEmail(item.order))) sent += 1;
    } catch (err) { errors.push(err.message || String(err)); }
  }
  return { sent, errors };
}

function startLifecycleScheduler({ db }) {
  if (!lifecycleReady()) {
    if (config.LIFECYCLE_EMAILS_ENABLED && !config.BUSINESS_MAILING_ADDRESS) {
      console.warn('Cart and reorder emails are off: set BUSINESS_MAILING_ADDRESS to turn them on.');
    }
    return null;
  }
  const run = () => runLifecycleScan({ db }).then(result => {
    if (result.errors.length) console.error('Lifecycle email errors:', JSON.stringify(result.errors));
  }).catch(err => console.error('Lifecycle email scan failed:', err.message || err));
  const initial = setTimeout(run, 30000);
  const interval = setInterval(run, config.LIFECYCLE_POLL_MINUTES * 60 * 1000);
  if (typeof initial.unref === 'function') initial.unref();
  if (typeof interval.unref === 'function') interval.unref();
  return interval;
}

function registerLifecycleRoutes(app, { db }) {
  // Saves the cart when a verified shopper reaches checkout (for the reminder).
  app.post('/api/checkout-started', (req, res) => {
    const email = cleanEmail(req.body && req.body.email);
    if (!email || !isCheckoutEmailVerified(req, email)) return res.status(204).end();
    const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 50)
      .filter(item => bySku[item && item.sku])
      .map(item => ({ sku: item.sku, quantity: Math.min(99, Math.max(1, Math.floor(Number(item.quantity) || 1))) }));
    if (items.length) db.recordCheckoutStart(email, items);
    res.status(204).end();
  });

  app.get('/api/cart/restore', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const cart = readCartToken(req.query.t);
    if (!cart) return res.status(400).json({ error: 'This cart link has expired.' });
    res.json({ cart });
  });

  const unsubscribe = (req, res) => {
    const email = cleanEmail(req.query.e);
    if (!email || !safeEqual(req.query.t, sign(`unsub:${email}`))) {
      return res.status(400).send('This unsubscribe link is not valid.');
    }
    db.suppressEmail(email);
    if (req.method === 'POST') return res.status(200).end();
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>
      <body style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#0e1b24">
      <h1>You're unsubscribed</h1><p>${htmlEscape(email)} will no longer get cart or reorder reminder emails from ${htmlEscape(config.SITE_NAME)}. Order and shipping emails still arrive as normal.</p>
      <p><a href="/">Back to the store</a></p></body></html>`);
  };
  app.get('/api/email/unsubscribe', unsubscribe);
  app.post('/api/email/unsubscribe', unsubscribe);
}

module.exports = {
  registerLifecycleRoutes, startLifecycleScheduler, runLifecycleScan, dueLifecycleEmails,
  cartToken, readCartToken, unsubscribeUrl, abandonedEmail, reorderEmail, lifecycleReady,
};
