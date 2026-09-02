const test = require('node:test');
const assert = require('node:assert/strict');
const { fulfillmentAddressText, sendPendingTrackingDiscord, checkFulfillmentDiscordConnection } = require('./notifications');

const order = {
  id: 314,
  buyer: {
    name: 'July Customer',
    email: 'private@example.com',
    address1: '8044 LA CROSSE AVE',
    address2: 'APT 4B',
    city: 'SKOKIE',
    state: 'IL',
    zip: '60077-2527',
    country: 'US',
  },
  items: [{ name: 'Retatrutide', quantity: 3 }],
  total: 99.99,
};

test('fulfillment block contains only copy-ready recipient details', () => {
  const text = fulfillmentAddressText(order);
  assert.equal(text, 'July Customer\n8044 LA CROSSE AVE\nAPT 4B\nSKOKIE IL 60077-2527\nUS');
  assert.doesNotMatch(text, /private@example\.com|Retatrutide|99\.99/);
});

test('fulfillment webhook verifies the authorized channel before posting once', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if ((options.method || 'GET') === 'GET') {
      return { ok: true, json: async () => ({ channel_id: '1544575715024965633' }) };
    }
    return { ok: true, json: async () => ({ id: 'discord-message-1' }) };
  };
  const result = await sendPendingTrackingDiscord(order, {
    webhookUrl: 'https://discord.test/api/webhooks/1/token',
    expectedChannelId: '1544575715024965633',
    fetchImpl,
  });
  assert.equal(result.messageId, 'discord-message-1');
  assert.equal(calls.length, 2);
  const payload = JSON.parse(calls[1].options.body);
  assert.match(payload.embeds[0].description, /July Customer/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.doesNotMatch(JSON.stringify(payload), /private@example\.com|Retatrutide|99\.99/);
});

test('fulfillment connection check verifies the channel without posting a message', async () => {
  const calls = [];
  const result = await checkFulfillmentDiscordConnection({
    webhookUrl: 'https://discord.test/api/webhooks/1/token',
    expectedChannelId: '1544575715024965633',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ id: 'webhook-1', name: 'Highland Shipping', channel_id: '1544575715024965633' }),
      };
    },
  });
  assert.equal(result.configured, true);
  assert.equal(result.authorized, true);
  assert.equal(result.channelId, '1544575715024965633');
  assert.equal(result.webhookName, 'Highland Shipping');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
});

test('fulfillment webhook refuses to send PII to a different channel', async () => {
  let posted = false;
  const fetchImpl = async (url, options = {}) => {
    if ((options.method || 'GET') === 'POST') posted = true;
    return { ok: true, json: async () => ({ channel_id: 'wrong-channel' }) };
  };
  await assert.rejects(
    sendPendingTrackingDiscord(order, {
      webhookUrl: 'https://discord.test/api/webhooks/1/token',
      expectedChannelId: '1544575715024965633',
      fetchImpl,
    }),
    /authorized shipping channel/,
  );
  assert.equal(posted, false);
});
