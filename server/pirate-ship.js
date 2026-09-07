const crypto = require('crypto');

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeInboundDomain(value) {
  return normalizeEmail(value).replace(/^@+/, '').replace(/^https?:\/\//, '').split('/')[0];
}

function orderAliasToken(orderId, secret) {
  return crypto.createHmac('sha256', String(secret || '')).update(`pirate-ship-order:${Number(orderId)}`).digest('hex').slice(0, 16);
}

function orderAliasEmail(orderId, domain, secret) {
  const normalizedDomain = normalizeInboundDomain(domain);
  if (!normalizedDomain) return '';
  return `hp-${Number(orderId)}-${orderAliasToken(orderId, secret)}@${normalizedDomain}`;
}

function orderItemsText(order) {
  return (order.items || [])
    .map(item => `${Math.max(0, Number(item.quantity || 0))}x ${item.name || ''} ${item.spec || ''}`.trim())
    .join('; ');
}

function pirateShipCsv(orders, options = {}) {
  const inboundDomain = normalizeInboundDomain(options.inboundDomain);
  const headers = [
    'Order ID',
    'Full Name',
    'Address Line 1',
    'Address Line 2',
    'City',
    'State',
    'Zip',
    'Country',
    'Email',
    'Customer Email',
    'Order Items',
    'Note',
  ];
  const rows = (orders || []).map(order => {
    const buyer = order.buyer || {};
    const automationEmail = inboundDomain
      ? orderAliasEmail(order.id, inboundDomain, options.tokenSecret)
      : normalizeEmail(buyer.email);
    return [
      `HP-${order.id}`,
      buyer.name,
      buyer.address1,
      buyer.address2,
      buyer.city,
      buyer.state,
      buyer.zip,
      buyer.country || 'United States',
      automationEmail,
      normalizeEmail(buyer.email),
      orderItemsText(order),
      `Highland order HP-${order.id}`,
    ].map(csvEscape).join(',');
  });
  return `\ufeff${[headers.map(csvEscape).join(','), ...rows].join('\r\n')}`;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function emailAddresses(value) {
  const matches = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return matches.map(normalizeEmail);
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return String(match[1]).trim();
  }
  return '';
}

function normalizedTrackingCandidate(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function trackingNumberFromText(text) {
  const upper = String(text || '').toUpperCase();
  const ups = upper.match(/\b(1Z[A-Z0-9]{16})\b/);
  if (ups) return ups[1];

  const labeled = firstMatch(upper, [
    /TRACKING\s*(?:NUMBER|NO\.?|#|ID)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9 -]{5,40})/,
    /TRACK(?:ING)?[^\n]{0,30}[?&](?:TRACKING(?:_?NUMBER|_?ID)?|TRACKNUM)\s*=\s*([A-Z0-9% -]{6,50})/,
  ]);
  let decodedLabeled = labeled || '';
  try { decodedLabeled = decodeURIComponent(decodedLabeled); } catch (_) { /* keep the raw candidate */ }
  const normalizedLabeled = normalizedTrackingCandidate(decodedLabeled);
  if (/^1Z[A-Z0-9]{16}$/.test(normalizedLabeled)) return normalizedLabeled;
  if (/^9\d{19,33}$/.test(normalizedLabeled)) return normalizedLabeled;

  const numericCandidates = upper.match(/(?:\d[ -]?){20,34}/g) || [];
  for (const candidate of numericCandidates) {
    const normalized = normalizedTrackingCandidate(candidate);
    if (/^9\d{19,33}$/.test(normalized)) return normalized;
  }
  return '';
}

function parseInboundTrackingEmail(email, options = {}) {
  const headers = email && email.headers && typeof email.headers === 'object' ? email.headers : {};
  const subject = String(email && email.subject || '');
  const text = [subject, email && email.text, stripHtml(email && email.html)].filter(Boolean).join('\n');
  const recipientText = [
    ...(Array.isArray(email && email.to) ? email.to : []),
    headers.to,
    headers['delivered-to'],
    headers['x-original-to'],
    headers['x-forwarded-to'],
  ].filter(Boolean).join(', ');
  const allText = `${recipientText}\n${text}`;
  const orderIdText = firstMatch(allText, [
    /\bHP[-_ #:]*(\d{1,12})\b/i,
    /\bhp-(\d{1,12})@/i,
  ]);
  const aliasMatch = recipientText.match(/\bhp-(\d{1,12})-([a-f0-9]{16})@/i);
  const trackingNumber = trackingNumberFromText(allText);
  const upper = allText.toUpperCase();
  let carrier = '';
  if (/\b1Z[A-Z0-9]{16}\b/.test(trackingNumber) || /\bUPS\b/.test(upper)) carrier = 'UPS';
  else if (/^9\d{19,33}$/.test(trackingNumber) || /\bUSPS\b|UNITED STATES POSTAL SERVICE/.test(upper)) carrier = 'USPS';

  const service = firstMatch(text, [
    /(?:SHIPPING\s+SERVICE|MAIL\s+CLASS|SERVICE)\s*:\s*([^\n\r<]{2,120})/i,
  ]).replace(/\s+/g, ' ').trim();
  const estimatedDelivery = firstMatch(text, [
    /(?:ESTIMATED|EXPECTED)\s+DELIVERY\s*:\s*([^\n\r<]{2,120})/i,
    /ARRIVES?\s+(?:BY|ON)\s*:\?\s*([^\n\r<]{2,120})/i,
  ]).replace(/\s+/g, ' ').trim();

  const inboundDomain = normalizeInboundDomain(options.inboundDomain);
  const excluded = new Set([
    normalizeEmail(email && email.from),
    ...emailAddresses(headers.from),
    ...(inboundDomain ? emailAddresses(recipientText).filter(address => address.endsWith(`@${inboundDomain}`)) : []),
  ]);
  const customerEmail = emailAddresses(recipientText).find(address => !excluded.has(address) && !/pirateship\.com$/i.test(address)) || '';

  return {
    orderId: orderIdText ? Number(orderIdText) : null,
    orderAliasToken: aliasMatch ? aliasMatch[2].toLowerCase() : '',
    customerEmail,
    carrier,
    trackingNumber,
    service,
    estimatedDelivery,
  };
}

function validOrderAliasToken(orderId, token, secret) {
  if (!orderId || !token || !secret) return false;
  const expected = Buffer.from(orderAliasToken(orderId, secret));
  const actual = Buffer.from(String(token).toLowerCase());
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function matchPendingTrackingOrder(orders, parsed) {
  const candidates = (orders || []).filter(order => ['paid', 'pending_tracking'].includes(order.status) && !order.tracking_number);
  if (parsed.orderId) {
    const exact = candidates.find(order => Number(order.id) === Number(parsed.orderId));
    if (exact) return { order: exact, reason: 'order_id' };
    const completed = (orders || []).find(order => Number(order.id) === Number(parsed.orderId));
    if (completed && completed.tracking_number === parsed.trackingNumber) return { order: completed, reason: 'already_processed' };
    return { order: null, reason: 'order_id_not_waiting' };
  }
  if (!parsed.customerEmail) return { order: null, reason: 'missing_order_identity' };
  const email = normalizeEmail(parsed.customerEmail);
  const matching = candidates.filter(order => normalizeEmail(order.buyer && order.buyer.email) === email);
  if (matching.length === 1) return { order: matching[0], reason: 'customer_email' };
  if (matching.length > 1) return { order: null, reason: 'ambiguous_customer_email' };
  return { order: null, reason: 'customer_email_not_waiting' };
}

function verifyResendWebhook(payload, headers, secret, now = Date.now()) {
  const id = String(headers.id || '');
  const timestamp = String(headers.timestamp || '');
  const signatureHeader = String(headers.signature || '');
  if (!id || !timestamp || !signatureHeader || !secret) throw new Error('Missing Resend webhook signature.');
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) {
    throw new Error('Expired Resend webhook signature.');
  }
  const secretText = String(secret).replace(/^whsec_/, '');
  let key;
  try {
    key = Buffer.from(secretText, 'base64');
  } catch (_) {
    throw new Error('Invalid Resend webhook secret.');
  }
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64');
  const signatures = signatureHeader.split(/\s+/).map(item => item.split(',')).filter(parts => parts[0] === 'v1' && parts[1]).map(parts => parts[1]);
  const expectedBuffer = Buffer.from(expected);
  const valid = signatures.some(signature => {
    const actual = Buffer.from(signature);
    return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
  });
  if (!valid) throw new Error('Invalid Resend webhook signature.');
  return JSON.parse(payload);
}

async function fetchResendReceivedEmail(emailId, apiKey, fetchImpl = global.fetch) {
  if (!emailId || !apiKey) throw new Error('Resend inbound email is not configured.');
  const response = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Resend returned HTTP ${response.status}.`);
  return body;
}

module.exports = {
  pirateShipCsv,
  parseInboundTrackingEmail,
  matchPendingTrackingOrder,
  verifyResendWebhook,
  fetchResendReceivedEmail,
  normalizeInboundDomain,
  orderAliasEmail,
  validOrderAliasToken,
};
