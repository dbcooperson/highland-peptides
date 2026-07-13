const config = require('./config');

function paypalBaseUrl() {
  return config.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

function isPayPalConfigured() {
  return Boolean(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);
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
    throw new Error(data.error_description || data.message || 'Could not connect to PayPal.');
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
          invoice_id: `HP-${order.id}`,
          description: 'Highland Peptides research-use-only laboratory supplies',
          amount: {
            currency_code: config.PAYPAL_CURRENCY,
            value: order.total.toFixed(2),
            breakdown: {
              item_total: { currency_code: config.PAYPAL_CURRENCY, value: order.subtotal.toFixed(2) },
              shipping: { currency_code: config.PAYPAL_CURRENCY, value: order.shipping_fee.toFixed(2) },
              handling: { currency_code: config.PAYPAL_CURRENCY, value: ((order.packaging_fee || 0) + (order.order_fee || 0)).toFixed(2) },
              discount: { currency_code: config.PAYPAL_CURRENCY, value: order.discount_amount.toFixed(2) },
            },
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
          },
          items: order.items.map(item => ({
            name: `${item.name} ${item.spec}`.slice(0, 127),
            sku: item.sku,
            quantity: String(item.quantity),
            category: 'PHYSICAL_GOODS',
            unit_amount: {
              currency_code: config.PAYPAL_CURRENCY,
              value: item.unit_price.toFixed(2),
            },
          })),
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
    throw new Error(data.message || 'Could not create PayPal order.');
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
    throw new Error(data.message || 'Could not capture PayPal payment.');
  }
  return data;
}

module.exports = {
  isPayPalConfigured,
  createPayPalOrder,
  capturePayPalOrder,
};
