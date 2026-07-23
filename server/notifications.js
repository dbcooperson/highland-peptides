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
  const address = [buyer.address1, buyer.address2, buyer.city, buyer.state, buyer.zip]
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
    `Shipping: ${money(order.shipping_fee)}`,
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
    Shipping: ${money(order.shipping_fee)}<br>
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
    from: config.ORDER_BACKUP_EMAIL_FROM,
    to: buyer.email,
    subject: `${config.SITE_NAME} Order HP-${order.id} - Payment Instructions`,
    text: customerInstructionsText(order),
    html: customerInstructionsHtml(order),
  });
  return 'email';
}

module.exports = { sendOrderBackup, sendCustomerPaymentInstructions, orderText };
