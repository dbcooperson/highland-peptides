const nodemailer = require('nodemailer');
const config = require('./config');

function money(value) {
  return '$' + Number(value || 0).toFixed(2);
}

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
    `Highland Peptides order backup`,
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
    `Shipping: ${money(order.shipping_fee)}${order.shipping_method === 'international' ? ' (international)' : ' (U.S.)'}`,
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
    <h2>Highland Peptides order backup</h2>
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
    Shipping: ${money(order.shipping_fee)} ${order.shipping_method === 'international' ? '(international)' : '(U.S.)'}<br>
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
    subject: `Highland Peptides Order #${order.id} - ${money(order.total)}`,
    text: orderText(order, source),
    html: orderHtml(order, source),
  });
  return 'email';
}

async function sendDiscordBackup(order, source) {
  if (!config.DISCORD_ORDER_WEBHOOK_URL) return null;
  const text = orderText(order, source);
  const response = await fetch(config.DISCORD_ORDER_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Highland Orders',
      content: `New order backup: #${order.id} - ${money(order.total)}`,
      embeds: [{
        title: `Order #${order.id}`,
        description: '```' + text.slice(0, 3900) + '```',
        color: 4545349,
      }],
    }),
  });
  if (!response.ok) throw new Error(`Discord backup failed: ${response.status}`);
  return 'discord';
}

function fulfillmentAddressText(order) {
  const buyer = order && order.buyer ? order.buyer : {};
  const cityLine = [buyer.city, buyer.state, buyer.zip].filter(Boolean).join(' ');
  return [
    buyer.name,
    buyer.address1,
    buyer.address2,
    cityLine,
    buyer.country,
  ]
    .map(value => String(value || '').trim().replace(/```/g, "'''").replace(/[\u0000-\u001f\u007f]/g, ''))
    .filter(Boolean)
    .join('\n');
}

function discordWaitUrl(webhookUrl) {
  const url = new URL(webhookUrl);
  url.searchParams.set('wait', 'true');
  return url.toString();
}

async function verifyFulfillmentDiscordWebhook(options = {}) {
  const webhookUrl = String(options.webhookUrl || config.DISCORD_FULFILLMENT_WEBHOOK_URL || '').trim();
  const expectedChannelId = String(options.expectedChannelId || config.DISCORD_FULFILLMENT_CHANNEL_ID || '').trim();
  const fetchImpl = options.fetchImpl || fetch;
  if (!webhookUrl) return null;

  // Discord webhooks are channel-specific. Verify the destination before
  // transmitting customer PII so a stale or copied webhook cannot send an
  // address into the wrong channel.
  const metadataResponse = await fetchImpl(webhookUrl, { method: 'GET' });
  if (!metadataResponse.ok) throw new Error(`Discord fulfillment webhook check failed: ${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  if (!expectedChannelId || String(metadata.channel_id || '') !== expectedChannelId) {
    throw new Error('Discord fulfillment webhook is not attached to the authorized shipping channel.');
  }

  return {
    webhookUrl,
    fetchImpl,
    channelId: String(metadata.channel_id || ''),
    webhookId: String(metadata.id || ''),
    webhookName: String(metadata.name || ''),
  };
}

async function checkFulfillmentDiscordConnection(options = {}) {
  const verified = await verifyFulfillmentDiscordWebhook(options);
  if (!verified) return { configured: false, authorized: false };
  return {
    configured: true,
    authorized: true,
    channelId: verified.channelId,
    webhookId: verified.webhookId,
    webhookName: verified.webhookName,
  };
}

async function sendPendingTrackingDiscord(order, options = {}) {
  const verified = await verifyFulfillmentDiscordWebhook(options);
  if (!verified) return null;

  const response = await verified.fetchImpl(discordWaitUrl(verified.webhookUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Highland Shipping',
      content: `📦 Pending tracking · Order HP-${order.id}`,
      embeds: [{
        title: 'Copy into Pirate Ship',
        description: '```' + fulfillmentAddressText(order).slice(0, 1800) + '```',
        color: 4545349,
        footer: { text: 'Address verified at checkout when Google validation is enabled.' },
      }],
      allowed_mentions: { parse: [] },
    }),
  });
  if (!response.ok) throw new Error(`Discord fulfillment post failed: ${response.status}`);
  const message = await response.json().catch(() => ({}));
  return { channel: 'discord', messageId: String(message.id || '') };
}

async function sendOrderBackup(order, source = 'payment') {
  const channels = [];
  const errors = [];
  for (const send of [sendEmailBackup, sendDiscordBackup]) {
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
  const ref = `HP-${order.id}`;
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
      `If the amount is incorrect, we will send a confirmation email. If no response is received within 72 hours, fulfillment will not proceed and the payment will not be refunded except where required by law.`,
    );
  } else if (order.payment_provider === 'manual_paypal') {
    lines.push(
      `Send the exact total due to PayPal:`,
      config.PAYPAL_MANUAL_EMAIL,
      ``,
      `IMPORTANT: Send with PayPal Friends and Family.`,
      `Include your order number ${ref} in the PayPal note.`,
      ``,
      `Use the exact amount shown above so we can match your payment to ${ref}.`,
      `If the amount is incorrect, we will send a confirmation email. If no response is received within 72 hours, fulfillment will not proceed and the payment will not be refunded except where required by law.`,
      `Payment is manually reviewed before fulfillment. Once confirmed, your order ships the next business day.`,
      `If you have questions, reply to this email.`,
    );
  } else {
    lines.push(
      `We'll follow up shortly with payment instructions.`,
      `If you have questions, reply to this email.`,
    );
  }

  return lines.join('\n');
}

function customerInstructionsHtml(order) {
  const ref = `HP-${order.id}`;
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
      <p>If the amount is incorrect, we will send a confirmation email. If no response is received within 72 hours, fulfillment will not proceed and the payment will not be refunded except where required by law.</p>
    `;
  } else if (order.payment_provider === 'manual_paypal') {
    body = `
      <p>Send the exact total due to PayPal:</p>
      <p style="font-family:monospace; font-size:16px;"><strong>${htmlEscape(config.PAYPAL_MANUAL_EMAIL)}</strong></p>
      <p><strong>Send with PayPal Friends and Family.</strong></p>
      <p>Include your order number <strong>${htmlEscape(ref)}</strong> in the PayPal note.</p>
      <p>Use the exact amount shown above so we can match your payment to <strong>${htmlEscape(ref)}</strong>.</p>
      <p>If the amount is incorrect, we will send a confirmation email. If no response is received within 72 hours, fulfillment will not proceed and the payment will not be refunded except where required by law.</p>
      <p>Payment is manually reviewed before fulfillment. Once confirmed, your order ships the next business day.</p>
      <p>If you have questions, reply to this email.</p>
    `;
  } else {
    body = `<p>We'll follow up shortly with payment instructions. If you have questions, reply to this email.</p>`;
  }

  return `
    <h2>Thanks for your order at ${htmlEscape(config.SITE_NAME)}!</h2>
    <p><strong>Order ${htmlEscape(ref)}</strong> &mdash; Total due: ${money(order.total)}</p>
    ${body}
  `;
}

async function sendCustomerPaymentInstructions(order) {
  const transport = smtpTransport();
  const buyer = order.buyer || {};
  if (!transport || !buyer.email) return null;
  await transport.sendMail({
    from: config.CUSTOMER_EMAIL_FROM,
    to: buyer.email,
    subject: `${config.SITE_NAME} Order HP-${order.id} - Payment Instructions`,
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
  const ref = `HP-${order.id}`;
  const provider = order.payment_provider === 'crypto'
    ? `${order.crypto_asset || 'crypto'} payment`
    : 'PayPal payment';
  const text = [
    `Payment reminder for ${ref}`,
    ``,
    `We have your Highland Peptides order, but it is still awaiting ${provider}.`,
    `Exact total due: ${money(order.total)}`,
    ``,
    `If you already sent payment, reply to this email with ${order.payment_provider === 'crypto' ? 'the TXID' : 'your PayPal confirmation'} so we can match it.`,
    `If you no longer want the order, no action is required.`,
    ``,
    `Questions? Reply to this email and include ${ref}.`,
  ].join('\n');
  const html = `
    <h2>Payment reminder for ${htmlEscape(ref)}</h2>
    <p>We have your Highland Peptides order, but it is still awaiting ${htmlEscape(provider)}.</p>
    <p><strong>Exact total due: ${money(order.total)}</strong></p>
    <p>If you already sent payment, reply to this email with ${order.payment_provider === 'crypto' ? 'the TXID' : 'your PayPal confirmation'} so we can match it.</p>
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

async function sendTrackingEmail(order, carrier, trackingNumber) {
  const transport = smtpTransport();
  const buyer = order && order.buyer ? order.buyer : {};
  if (!transport || !buyer.email) return null;
  const ref = `HP-${order.id}`;
  const url = trackingUrl(carrier, trackingNumber);
  const text = [
    `Your Highland Peptides order has shipped`,
    ``,
    `Order: ${ref}`,
    `Carrier: ${carrier}`,
    `Tracking number: ${trackingNumber}`,
    url ? `Track shipment: ${url}` : null,
    ``,
    `Carrier scans may take up to one business day to appear. Reply to this email if you need help with your shipment.`,
  ].filter(Boolean).join('\n');
  const html = `
    <h2>Your Highland Peptides order has shipped</h2>
    <p><strong>Order:</strong> ${htmlEscape(ref)}<br>
    <strong>Carrier:</strong> ${htmlEscape(carrier)}<br>
    <strong>Tracking number:</strong> ${htmlEscape(trackingNumber)}</p>
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
        <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#315b43;font-weight:700;">Highland Peptides</div>
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
    `Verify your Highland Peptides account`,
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
    `Reset your Highland Peptides password`,
    ``,
    `Open this link to choose a new password:`,
    resetUrl,
    ``,
    `This link expires in 60 minutes.`,
  ].join('\n');
  const html = accountEmailLayout('Reset your password', `
    <p style="font-size:16px;line-height:1.6;">Use the secure link below to choose a new password for your Highland Peptides account.</p>
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

module.exports = {
  sendOrderBackup,
  sendPendingTrackingDiscord,
  checkFulfillmentDiscordConnection,
  sendCustomerPaymentInstructions,
  sendPaymentReminder,
  sendTrackingEmail,
  sendAccountVerificationEmail,
  sendPasswordResetEmail,
  isCustomerEmailConfigured,
  trackingUrl,
  orderText,
  fulfillmentAddressText,
};

