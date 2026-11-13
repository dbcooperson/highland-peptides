const nodemailer = require('nodemailer');
const config = require('./config');

function money(value) {
  return '$' + Number(value || 0).toFixed(2);
}

const PAYMENT_MISMATCH_TEXT = 'If the amount is incorrect, we will contact you and pause fulfillment until the payment is resolved. Your refund rights remain in effect.';
const DELIVERY_REFUND_TEXT = 'If you do not receive your order within 30 days, we will give you your entire order for free, on us. Just email support@snowyresearch.com with your order number.';

function htmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function orderText(order, source = 'payment') {
  const items = (order.items || [])
    .map(item => `- ${item.quantity}x ${item.name} (${item.spec} | ${item.sku}) @ ${money(item.unit_price)}`)
    .join('\n');
  const buyer = order.buyer || {};
  const address = [buyer.address1, buyer.address2, buyer.city, buyer.state, buyer.zip, buyer.country]
    .filter(Boolean)
    .join(', ');

  return [
    `Snowy Research order backup`,
    `Source: ${source}`,
    `Order #: ${order.id}`,
    `Status: ${order.status}`,
    `Payment: ${order.payment_provider || 'unknown'} ${order.payment_reference ? '(' + order.payment_reference + ')' : ''}`,
    `Created: ${order.created_at}`,
    `Paid: ${order.paid_at || 'not marked paid'}`,
    ``,
    `Buyer: ${buyer.name || ''}`,
    `Email: ${buyer.email || ''}`,
    `Ship to: ${address}`,
    ``,
    `Items:`,
    items || '- No items',
    ``,
    `Subtotal: ${money(order.subtotal)}`,
    order.discount_code ? `Discount (${order.discount_code}): -${money(order.discount_amount)}` : `Discount: ${money(0)}`,
    order.store_credit_amount ? `Store credit used: -${money(order.store_credit_amount)}` : null,
    `Shipping: ${money(order.shipping_fee)}${order.shipping_method === 'international' ? ' (international)' : order.shipping_method === 'priority' ? ' (U.S. Priority Mail)' : ' (U.S.)'}`,
    order.order_fee ? `Processing: ${money(order.order_fee)}` : null,
    `Total: ${money(order.total)}`,
  ].filter(line => line !== null).join('\n');
}

function orderHtml(order, source = 'payment') {
  const buyer = order.buyer || {};
  const address = [buyer.address1, buyer.address2, buyer.city, buyer.state, buyer.zip]
    .filter(Boolean)
    .join(', ');
  const itemRows = (order.items || []).map(item => `
    <tr>
      <td>${htmlEscape(item.quantity)}</td>
      <td>${htmlEscape(item.name)}</td>
      <td>${htmlEscape(item.spec)}</td>
      <td>${htmlEscape(item.sku)}</td>
      <td>${money(item.unit_price)}</td>
    </tr>
  `).join('');

  return `
    <h2>Snowy Research order backup</h2>
    <p><strong>Source:</strong> ${htmlEscape(source)}</p>
    <p><strong>Order #:</strong> ${htmlEscape(order.id)}<br>
    <strong>Status:</strong> ${htmlEscape(order.status)}<br>
    <strong>Payment:</strong> ${htmlEscape(order.payment_provider || 'unknown')} ${order.payment_reference ? '(' + htmlEscape(order.payment_reference) + ')' : ''}<br>
    <strong>Created:</strong> ${htmlEscape(order.created_at)}<br>
    <strong>Paid:</strong> ${htmlEscape(order.paid_at || 'not marked paid')}</p>
    <h3>Buyer</h3>
    <p><strong>${htmlEscape(buyer.name)}</strong><br>${htmlEscape(buyer.email)}<br>${htmlEscape(address)}</p>
    <h3>Items</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><th>Qty</th><th>Name</th><th>Spec</th><th>SKU</th><th>Unit</th></tr>
      ${itemRows}
    </table>
    <h3>Total</h3>
    <p>Subtotal: ${money(order.subtotal)}<br>
    ${order.discount_code ? `Discount (${htmlEscape(order.discount_code)}): -${money(order.discount_amount)}<br>` : ''}
    ${order.store_credit_amount ? `Store credit used: -${money(order.store_credit_amount)}<br>` : ''}
    Shipping: ${money(order.shipping_fee)} ${order.shipping_method === 'international' ? '(international)' : order.shipping_method === 'priority' ? '(U.S. Priority Mail)' : '(U.S.)'}<br>
    ${order.order_fee ? `Processing: ${money(order.order_fee)}<br>` : ''}
    <strong>Total: ${money(order.total)}</strong></p>
  `;
}

function smtpTransport() {
  if (!config.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER && config.SMTP_PASS ? {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    } : undefined,
  });
}

async function sendEmailBackup(order, source) {
  if (!config.ORDER_BACKUP_EMAIL_TO) return null;
  const transport = smtpTransport();
  if (!transport) return null;
  await transport.sendMail({
    from: config.ORDER_BACKUP_EMAIL_FROM,
    to: config.ORDER_BACKUP_EMAIL_TO,
    subject: `Snowy Research Order #${order.id} - ${money(order.total)}`,
    text: orderText(order, source),
    html: orderHtml(order, source),
  });
  return 'email';
}

async function sendOrderBackup(order, source = 'payment') {
  const channels = [];
  const errors = [];
  for (const send of [sendEmailBackup]) {
    try {
      const channel = await send(order, source);
      if (channel) channels.push(channel);
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }
  return { channels, errors };
}

function customerInstructionsText(order) {
  const ref = `SR-${order.id}`;
  const lines = [
    `Thanks for your order at ${config.SITE_NAME}!`,
    ``,
    `Order ${ref} - Total due: ${money(order.total)}`,
    ``,
  ];

  if (order.payment_provider === 'crypto') {
    const asset = order.crypto_asset || 'BTC';
    const address = asset === 'USDC' ? config.CRYPTO_WALLETS.USDC_ERC20 : config.CRYPTO_WALLETS.BTC;
    const network = asset === 'USDC' ? 'Ethereum mainnet (ERC-20) ONLY - do not send on another network' : 'Bitcoin network';
    lines.push(
      `Send ${asset} to this address (${network}):`,
      address,
      ``,
      `After sending, reply to this email with your transaction ID (TXID) or submit it on our site so we can confirm your payment quickly.`,
      `Please reference your order number: ${ref}`,
      PAYMENT_MISMATCH_TEXT,
    );
  } else {
    lines.push(
      `We'll follow up shortly with payment instructions.`,
      `If you have questions, reply to this email.`,
    );
  }

  lines.push('', DELIVERY_REFUND_TEXT);
  return lines.join('\n');
}

function customerInstructionsHtml(order) {
  const ref = `SR-${order.id}`;
  let body;
  if (order.payment_provider === 'crypto') {
    const asset = order.crypto_asset || 'BTC';
    const address = asset === 'USDC' ? config.CRYPTO_WALLETS.USDC_ERC20 : config.CRYPTO_WALLETS.BTC;
    const network = asset === 'USDC' ? 'Ethereum mainnet (ERC-20) ONLY &mdash; do not send on another network' : 'Bitcoin network';
    body = `
      <p>Send <strong>${htmlEscape(asset)}</strong> to this address (${network}):</p>
      <p style="font-family:monospace; font-size:15px;">${htmlEscape(address)}</p>
      <p>After sending, reply to this email with your transaction ID (TXID) or submit it on our site so we can confirm your payment quickly.</p>
      <p>Please reference your order number: <strong>${htmlEscape(ref)}</strong></p>
      <p>${htmlEscape(PAYMENT_MISMATCH_TEXT)}</p>
    `;
  } else {
    body = `<p>We'll follow up shortly with payment instructions. If you have questions, reply to this email.</p>`;
  }

  return `
    <h2>Thanks for your order at ${htmlEscape(config.SITE_NAME)}!</h2>
    <p><strong>Order ${htmlEscape(ref)}</strong> &mdash; Total due: ${money(order.total)}</p>
    ${body}
    <p>${htmlEscape(DELIVERY_REFUND_TEXT)}</p>
  `;
}

async function sendCustomerPaymentInstructions(order) {
  const transport = smtpTransport();
  const buyer = order.buyer || {};
  if (!transport || !buyer.email) return null;
  await transport.sendMail({
    from: config.CUSTOMER_EMAIL_FROM,
    to: buyer.email,
    subject: `${config.SITE_NAME} Order SR-${order.id} - Payment Instructions`,
    text: customerInstructionsText(order),
    html: customerInstructionsHtml(order),
  });
  return 'email';
}

function trackingUrl(carrier, trackingNumber) {
  const encoded = encodeURIComponent(String(trackingNumber || '').trim());
  const urls = {
    USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`,
    UPS: `https://www.ups.com/track?tracknum=${encoded}`,
    FedEx: `https://www.fedex.com/fedextrack/?trknbr=${encoded}`,
    DHL: `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encoded}`,
    'Canada Post': `https://www.canadapost-postescanada.ca/track-reperage/en#/details/${encoded}`,
    'Royal Mail': `https://www.royalmail.com/track-your-item#/tracking-results/${encoded}`,
    'Australia Post': `https://auspost.com.au/mypost/track/#/details/${encoded}`,
  };
  return urls[carrier] || '';
}

async function sendPaymentReminder(order) {
  const transport = smtpTransport();
  const buyer = order && order.buyer ? order.buyer : {};
  if (!transport || !buyer.email) return null;
  const ref = `SR-${order.id}`;
  const provider = order.payment_provider === 'crypto'
    ? `${order.crypto_asset || 'crypto'} payment`
    : 'payment';
  const confirmation = order.payment_provider === 'crypto'
    ? 'the TXID'
    : 'your payment confirmation';
  const text = [
    `Payment reminder for ${ref}`,
    ``,
    `We have your Snowy Research order, but it is still awaiting ${provider}.`,
    `Exact total due: ${money(order.total)}`,
    ``,
    `If you already sent payment, reply to this email with ${confirmation} so we can match it.`,
    `If you no longer want the order, no action is required.`,
    ``,
    `Questions? Reply to this email and include ${ref}.`,
  ].join('\n');
  const html = `
    <h2>Payment reminder for ${htmlEscape(ref)}</h2>
    <p>We have your Snowy Research order, but it is still awaiting ${htmlEscape(provider)}.</p>
    <p><strong>Exact total due: ${money(order.total)}</strong></p>
    <p>If you already sent payment, reply to this email with ${htmlEscape(confirmation)} so we can match it.</p>
    <p>If you no longer want the order, no action is required.</p>
    <p>Questions? Reply to this email and include <strong>${htmlEscape(ref)}</strong>.</p>
  `;
  await transport.sendMail({
    from: config.CUSTOMER_EMAIL_FROM,
    to: buyer.email,
    replyTo: config.CUSTOMER_EMAIL_FROM,
    subject: `${config.SITE_NAME} Order ${ref} - Payment Reminder`,
    text,
    html,
  });
  return 'email';
}

async function sendTrackingEmail(order, carrier, trackingNumber, details = {}) {
  const transport = smtpTransport();
  const buyer = order && order.buyer ? order.buyer : {};
  if (!transport || !buyer.email) return null;
  const ref = `SR-${order.id}`;
  const url = trackingUrl(carrier, trackingNumber);
  const service = String(details.service || '').trim();
  const estimatedDelivery = String(details.estimatedDelivery || '').trim();
  const text = [
    `Your Snowy Research order has shipped`,
    ``,
    `Order: ${ref}`,
    `Carrier: ${carrier}`,
    service ? `Service: ${service}` : null,
    `Tracking number: ${trackingNumber}`,
    estimatedDelivery ? `Estimated delivery: ${estimatedDelivery}` : 'Estimated delivery: Check the carrier tracking page for the latest estimate.',
    url ? `Track shipment: ${url}` : null,
    ``,
    `Carrier scans may take up to one business day to appear. Reply to this email if you need help with your shipment.`,
  ].filter(Boolean).join('\n');
  const html = `
    <h2>Your Snowy Research order has shipped</h2>
    <p><strong>Order:</strong> ${htmlEscape(ref)}<br>
    <strong>Carrier:</strong> ${htmlEscape(carrier)}<br>
    ${service ? `<strong>Service:</strong> ${htmlEscape(service)}<br>` : ''}
    <strong>Tracking number:</strong> ${htmlEscape(trackingNumber)}<br>
    <strong>Estimated delivery:</strong> ${htmlEscape(estimatedDelivery || 'Check the carrier tracking page for the latest estimate.')}</p>
    ${url ? `<p><a href="${htmlEscape(url)}">Track your shipment</a></p>` : ''}
    <p>Carrier scans may take up to one business day to appear. Reply to this email if you need help with your shipment.</p>
  `;
  await transport.sendMail({
    from: config.CUSTOMER_EMAIL_FROM,
    to: buyer.email,
    replyTo: config.CUSTOMER_EMAIL_FROM,
    subject: `${config.SITE_NAME} Order ${ref} - Tracking Information`,
    text,
    html,
  });
  return 'email';
}

function accountEmailLayout(title, body) {
  return `
    <div style="background:#f3efe6;padding:32px 18px;font-family:Arial,sans-serif;color:#1c1a17;">
      <div style="max-width:560px;margin:0 auto;background:#faf7f1;border:1px solid #d9d0c1;border-radius:18px;padding:30px;">
        <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#315b43;font-weight:700;">Snowy Research</div>
        <h1 style="font-size:26px;line-height:1.15;margin:12px 0 16px;">${htmlEscape(title)}</h1>
        ${body}
        <p style="margin:26px 0 0;font-size:12px;color:#756c60;line-height:1.5;">If you did not request this, you can safely ignore this email. For help, reply to this message.</p>
      </div>
    </div>`;
}

async function sendAccountVerificationEmail(account, verificationUrl) {
  const transport = smtpTransport();
  if (!transport || !account || !account.email) return null;
  const text = [
    `Verify your Snowy Research account`,
    ``,
    `Hi ${account.name || 'there'},`,
    `Open this link to verify your email and finish creating your account:`,
    verificationUrl,
    ``,
    `This link expires in 24 hours.`,
  ].join('\n');
  const html = accountEmailLayout('Verify your email', `
    <p style="font-size:16px;line-height:1.6;">Hi ${htmlEscape(account.name || 'there')}, confirm this email address to activate your account and create your one personal referral code.</p>
    <p style="margin:24px 0;"><a href="${htmlEscape(verificationUrl)}" style="display:inline-block;background:#173d2b;color:#fff;text-decoration:none;border-radius:999px;padding:13px 22px;font-weight:700;">Verify email</a></p>
    <p style="font-size:13px;color:#756c60;line-height:1.5;">This secure link expires in 24 hours.</p>`);
  await transport.sendMail({
    from: config.CUSTOMER_EMAIL_FROM,
    to: account.email,
    replyTo: config.CUSTOMER_EMAIL_FROM,
    subject: `Verify your ${config.SITE_NAME} account`,
    text,
    html,
  });
  return 'email';
}

async function sendPasswordResetEmail(account, resetUrl) {
  const transport = smtpTransport();
  if (!transport || !account || !account.email) return null;
  const text = [
    `Reset your Snowy Research password`,
    ``,
    `Open this link to choose a new password:`,
    resetUrl,
    ``,
    `This link expires in 60 minutes.`,
  ].join('\n');
  const html = accountEmailLayout('Reset your password', `
    <p style="font-size:16px;line-height:1.6;">Use the secure link below to choose a new password for your Snowy Research account.</p>
    <p style="margin:24px 0;"><a href="${htmlEscape(resetUrl)}" style="display:inline-block;background:#173d2b;color:#fff;text-decoration:none;border-radius:999px;padding:13px 22px;font-weight:700;">Reset password</a></p>
    <p style="font-size:13px;color:#756c60;line-height:1.5;">This link expires in 60 minutes and can only be used once.</p>`);
  await transport.sendMail({
    from: config.CUSTOMER_EMAIL_FROM,
    to: account.email,
    replyTo: config.CUSTOMER_EMAIL_FROM,
    subject: `Reset your ${config.SITE_NAME} password`,
    text,
    html,
  });
  return 'email';
}

function isCustomerEmailConfigured() {
  return Boolean(config.SMTP_HOST && config.CUSTOMER_EMAIL_FROM);
}

async function sendCheckoutVerificationCode(email, code) {
  const transport = smtpTransport();
  if (!transport) throw new Error('Customer email is not configured.');
  await transport.sendMail({
    from: config.CUSTOMER_EMAIL_FROM,
    to: email,
    replyTo: config.CUSTOMER_EMAIL_FROM,
    subject: `Your ${config.SITE_NAME} checkout code`,
    text: `Your Snowy Research checkout verification code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.`,
    html: accountEmailLayout('Verify your checkout email', `<p style="font-size:16px;line-height:1.6;">Your checkout verification code is <strong style="font-size:24px;letter-spacing:3px;">${htmlEscape(code)}</strong>.</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`),
  });
  return 'email';
}

module.exports = {
  smtpTransport, htmlEscape,
  sendOrderBackup,
  sendCustomerPaymentInstructions,
  sendPaymentReminder,
  sendTrackingEmail,
  sendAccountVerificationEmail,
  sendPasswordResetEmail,
  sendCheckoutVerificationCode,
  isCustomerEmailConfigured,
  trackingUrl,
  orderText,
};

