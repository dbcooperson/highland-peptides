const config = require('./config');

function paypalBaseUrl() {
  return config.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function isPayPalConfigured() {
  return Boolean(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);
}

function formatPayPalError(data, fallback) {
  const detail = Array.isArray(data && data.details) && data.details.length ? data.details[0] : null;
  const parts = [
    data && (data.message || data.error_description || data.error),
    detail && detail.issue,
    detail && detail.description,
    data && data.debug_id ? `PayPal debug ID: ${data.debug_id}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' - ') : fallback;
}

async function getAccessToken() {
  if (!isPayPalConfigured()) {
    throw new Error('PayPal is not configured.');
  }

  const auth = Buffer.from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(formatPayPalError(data, 'Could not connect to PayPal.'));
  }
  return data.access_token;
}

async function createPayPalOrder(order) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: `HP-${order.id}`,
          description: 'Highland Peptides research-use-only laboratory supplies',
          amount: {
            currency_code: config.PAYPAL_CURRENCY,
            value: order.total.toFixed(2),
          },
          shipping: {
            name: { full_name: order.buyer.name },
            address: {
              address_line_1: order.buyer.address1,
              address_line_2: order.buyer.address2 || undefined,
              admin_area_2: order.buyer.city,
              admin_area_1: order.buyer.state,
              postal_code: order.buyer.zip,
              country_code: order.buyer.country || 'US',
            },
          }
        },
      ],
      application_context: {
        brand_name: config.SITE_NAME,
        shipping_preference: 'SET_PROVIDED_ADDRESS',
        user_action: 'PAY_NOW',
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(formatPayPalError(data, 'Could not create PayPal order.'));
  }
  return data;
}

async function capturePayPalOrder(paypalOrderId) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(formatPayPalError(data, 'Could not capture PayPal payment.'));
  }
  return data;
}

module.exports = {
  isPayPalConfigured,
  createPayPalOrder,
  capturePayPalOrder,
};
