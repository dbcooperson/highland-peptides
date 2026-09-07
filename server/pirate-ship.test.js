const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const {
  pirateShipCsv,
  parseInboundTrackingEmail,
  matchPendingTrackingOrder,
  verifyResendWebhook,
  fetchResendReceivedEmail,
  validOrderAliasToken,
} = require('./pirate-ship');

function order(overrides = {}) {
  return {
    id: 187,
    status: 'pending_tracking',
    tracking_number: null,
    buyer: {
      name: 'July Researcher',
      email: 'july@example.com',
      address1: '8044 La Crosse Ave',
      address2: 'Apt 3',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90001',
      country: 'United States',
    },
    items: [{ quantity: 3, name: 'Retatrutide', spec: '20mg' }],
    ...overrides,
  };
}

test('Pirate Ship CSV includes only mapping-friendly fields and an order-specific inbox', () => {
  const csv = pirateShipCsv([order()], { inboundDomain: 'track.example.resend.app' });
  assert.match(csv, /^\ufeff"Order ID","Full Name","Address Line 1"/);
  assert.match(csv, /"HP-187","July Researcher","8044 La Crosse Ave","Apt 3","Los Angeles","CA","90001","United States","hp-187-[a-f0-9]{16}@track\.example\.resend\.app","july@example\.com"/);
  assert.match(csv, /"3x Retatrutide 20mg"/);
});

test('inbound tracking parser matches order alias and USPS tracking', () => {
  const parsed = parseInboundTrackingEmail({
    to: ['hp-187-d24b9d19c62ce7b3@track.example.resend.app'],
    from: 'ship@pirateship.com',
    subject: 'Your Pirate Ship tracking information',
    text: 'Shipping Service: USPS Ground Advantage\nTracking Number: 9400 1000 0000 0000 0000 00',
    headers: { to: 'hp-187-d24b9d19c62ce7b3@track.example.resend.app' },
  }, { inboundDomain: 'track.example.resend.app' });
  assert.deepEqual(parsed, {
    orderId: 187,
    orderAliasToken: 'd24b9d19c62ce7b3',
    customerEmail: '',
    carrier: 'USPS',
    trackingNumber: '9400100000000000000000',
    service: 'USPS Ground Advantage',
    estimatedDelivery: '',
  });
});

test('inbound tracking parser supports BCC copies matched by the original customer email', () => {
  const parsed = parseInboundTrackingEmail({
    to: ['tracking@track.example.resend.app'],
    from: 'Highland Shipping <ship@highlandpeptides.com>',
    subject: 'Shipment tracking',
    html: '<p>Carrier: UPS</p><p>Tracking number: 1Z999AA10123456784</p>',
    headers: { to: 'July Researcher <july@example.com>', from: 'Highland Shipping <ship@highlandpeptides.com>' },
  }, { inboundDomain: 'track.example.resend.app' });
  assert.equal(parsed.orderId, null);
  assert.equal(parsed.orderAliasToken, '');
  assert.equal(parsed.customerEmail, 'july@example.com');
  assert.equal(parsed.carrier, 'UPS');
  assert.equal(parsed.trackingNumber, '1Z999AA10123456784');
});

test('order-specific inbound aliases use a verifiable private token', () => {
  const csv = pirateShipCsv([order()], { inboundDomain: 'track.example.resend.app', tokenSecret: 'secret-1' });
  const token = csv.match(/hp-187-([a-f0-9]{16})@/)[1];
  assert.equal(validOrderAliasToken(187, token, 'secret-1'), true);
  assert.equal(validOrderAliasToken(187, token, 'wrong-secret'), false);
  assert.equal(validOrderAliasToken(188, token, 'secret-1'), false);
});

test('pending order matching refuses to guess when one email has multiple waiting orders', () => {
  const orders = [order(), order({ id: 188 })];
  assert.equal(matchPendingTrackingOrder(orders, { orderId: 187, customerEmail: '', trackingNumber: '9400100000000000000000' }).order.id, 187);
  assert.equal(matchPendingTrackingOrder(orders, { orderId: null, customerEmail: 'july@example.com' }).reason, 'ambiguous_customer_email');
});

test('Resend webhook signatures are verified with replay protection', () => {
  const payload = JSON.stringify({ type: 'email.received', data: { email_id: 'email_1' } });
  const secretBytes = Buffer.from('highland-test-webhook-key');
  const secret = `whsec_${secretBytes.toString('base64')}`;
  const id = 'msg_test_1';
  const now = 1_800_000_000_000;
  const timestamp = String(Math.floor(now / 1000));
  const signature = crypto.createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${payload}`).digest('base64');
  const event = verifyResendWebhook(payload, { id, timestamp, signature: `v1,${signature}` }, secret, now);
  assert.equal(event.type, 'email.received');
  assert.throws(() => verifyResendWebhook(payload, { id, timestamp, signature: 'v1,bad' }, secret, now), /Invalid/);
  assert.throws(() => verifyResendWebhook(payload, { id, timestamp: String(Number(timestamp) - 601), signature: `v1,${signature}` }, secret, now), /Expired/);
});

test('received email retrieval uses Resend API authorization', async () => {
  let request;
  const email = await fetchResendReceivedEmail('email 1', 're_test', async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: 'email 1', text: 'Tracking Number: 123' }) };
  });
  assert.equal(request.url, 'https://api.resend.com/emails/receiving/email%201');
  assert.equal(request.options.headers.Authorization, 'Bearer re_test');
  assert.equal(email.id, 'email 1');
});
