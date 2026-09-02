// JSON-backed storefront database.
//
// IMPORTANT FOR RENDER:
// Mount a Persistent Disk at /var/data. Orders, verified customer accounts,
// referral balances, and payout requests all live in /var/data/db.json.

const fs = require('fs');
const path = require('path');

const LEGACY_DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const CONFIRMED_ORDER_STATUSES = new Set(['paid', 'pending_tracking', 'fulfilled']);

function isConfirmedOrderStatus(status) {
  return CONFIRMED_ORDER_STATUSES.has(String(status || ''));
}

function defaultDbPath() {
  if (process.env.ORDER_DB_PATH) return process.env.ORDER_DB_PATH;
  if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, 'db.json');
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return '/var/data/db.json';
  return LEGACY_DB_PATH;
}

const DB_PATH = defaultDbPath();

function ensureDbDirectory() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function migrateLegacyDbIfNeeded() {
  ensureDbDirectory();
  if (DB_PATH === LEGACY_DB_PATH || fs.existsSync(DB_PATH)) return;
  if (fs.existsSync(LEGACY_DB_PATH)) fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
}

function initialData() {
  return {
    orders: [],
    nextOrderId: 1,
    accounts: [],
    nextAccountId: 1,
    creditLedger: [],
    nextCreditLedgerId: 1,
    payoutRequests: [],
    nextPayoutRequestId: 1,
    socialCreditSubmissions: [],
    nextSocialCreditSubmissionId: 1,
  };
}

function normalizeData(raw) {
  const data = raw && typeof raw === 'object' ? raw : initialData();
  data.orders = Array.isArray(data.orders) ? data.orders : [];
  data.accounts = Array.isArray(data.accounts) ? data.accounts : [];
  data.creditLedger = Array.isArray(data.creditLedger) ? data.creditLedger : [];
  data.payoutRequests = Array.isArray(data.payoutRequests) ? data.payoutRequests : [];
  data.socialCreditSubmissions = Array.isArray(data.socialCreditSubmissions) ? data.socialCreditSubmissions : [];
  data.nextOrderId = Math.max(Number(data.nextOrderId || 1), ...data.orders.map(item => Number(item.id || 0) + 1), 1);
  data.nextAccountId = Math.max(Number(data.nextAccountId || 1), ...data.accounts.map(item => Number(item.id || 0) + 1), 1);
  data.nextCreditLedgerId = Math.max(Number(data.nextCreditLedgerId || 1), ...data.creditLedger.map(item => Number(item.id || 0) + 1), 1);
  data.nextPayoutRequestId = Math.max(Number(data.nextPayoutRequestId || 1), ...data.payoutRequests.map(item => Number(item.id || 0) + 1), 1);
  data.nextSocialCreditSubmissionId = Math.max(Number(data.nextSocialCreditSubmissionId || 1), ...data.socialCreditSubmissions.map(item => Number(item.id || 0) + 1), 1);
  return data;
}

function load() {
  migrateLegacyDbIfNeeded();
  if (!fs.existsSync(DB_PATH)) {
    const initial = initialData();
    save(initial);
    return initial;
  }
  return normalizeData(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
}

function save(data) {
  ensureDbDirectory();
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(normalizeData(data), null, 2));
  fs.renameSync(tempPath, DB_PATH);
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function dollars(value) {
  return Math.round(Number(value || 0)) / 100;
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedCode(value) {
  return String(value || '').trim().toUpperCase();
}

function addLedgerEntry(data, accountId, amountCents, type, details = {}) {
  const entry = {
    id: data.nextCreditLedgerId++,
    account_id: Number(accountId),
    amount_cents: Number(amountCents || 0),
    type,
    order_id: details.orderId ? Number(details.orderId) : null,
    payout_request_id: details.payoutRequestId ? Number(details.payoutRequestId) : null,
    note: String(details.note || '').slice(0, 300),
    created_at: new Date().toISOString(),
  };
  data.creditLedger.push(entry);
  return entry;
}

function accountById(data, id) {
  return data.accounts.find(account => account.id === Number(id)) || null;
}

// ---------- Customer accounts ----------
function createAccount({ name, email, passwordSalt, passwordHash, verificationTokenHash, verificationExpiresAt }) {
  const data = load();
  const normalized = normalizedEmail(email);
  if (data.accounts.some(account => normalizedEmail(account.email) === normalized)) {
    throw new Error('An account already exists for this email.');
  }
  const now = new Date().toISOString();
  const account = {
    id: data.nextAccountId++,
    name: String(name || '').trim().slice(0, 100),
    email: normalized,
    password_salt: passwordSalt,
    password_hash: passwordHash,
    verified_at: null,
    verification_token_hash: verificationTokenHash,
    verification_expires_at: verificationExpiresAt,
    reset_token_hash: null,
    reset_expires_at: null,
    referral_code: null,
    credit_balance_cents: 0,
    payout_reserved_cents: 0,
    created_at: now,
    updated_at: now,
    last_login_at: null,
  };
  data.accounts.push(account);
  save(data);
  return account;
}

function getAccountById(id) {
  return accountById(load(), id);
}

function getAccountByEmail(email) {
  const normalized = normalizedEmail(email);
  return load().accounts.find(account => normalizedEmail(account.email) === normalized) || null;
}

function setAccountVerificationToken(id, tokenHash, expiresAt) {
  const data = load();
  const account = accountById(data, id);
  if (!account) return null;
  account.verification_token_hash = tokenHash;
  account.verification_expires_at = expiresAt;
  account.updated_at = new Date().toISOString();
  save(data);
  return account;
}

function verifyAccountByTokenHash(tokenHash) {
  const data = load();
  const account = data.accounts.find(item => item.verification_token_hash === tokenHash) || null;
  if (!account || !account.verification_expires_at || new Date(account.verification_expires_at).getTime() < Date.now()) return null;
  const now = new Date().toISOString();
  account.verified_at = account.verified_at || now;
  account.verification_token_hash = null;
  account.verification_expires_at = null;
  account.updated_at = now;
  data.orders.forEach(order => {
    if (!order.customer_account_id && normalizedEmail(order.buyer && order.buyer.email) === account.email) {
      order.customer_account_id = account.id;
    }
  });
  save(data);
  return account;
}

function setPasswordResetToken(id, tokenHash, expiresAt) {
  const data = load();
  const account = accountById(data, id);
  if (!account) return null;
  account.reset_token_hash = tokenHash;
  account.reset_expires_at = expiresAt;
  account.updated_at = new Date().toISOString();
  save(data);
  return account;
}

function resetPasswordByTokenHash(tokenHash, passwordSalt, passwordHash) {
  const data = load();
  const account = data.accounts.find(item => item.reset_token_hash === tokenHash) || null;
  if (!account || !account.reset_expires_at || new Date(account.reset_expires_at).getTime() < Date.now()) return null;
  account.password_salt = passwordSalt;
  account.password_hash = passwordHash;
  account.reset_token_hash = null;
  account.reset_expires_at = null;
  account.updated_at = new Date().toISOString();
  save(data);
  return account;
}

function touchAccountLogin(id) {
  const data = load();
  const account = accountById(data, id);
  if (!account) return null;
  account.last_login_at = new Date().toISOString();
  data.orders.forEach(order => {
    if (!order.customer_account_id && normalizedEmail(order.buyer && order.buyer.email) === account.email) {
      order.customer_account_id = account.id;
    }
  });
  save(data);
  return account;
}

function getAccountByReferralCode(code) {
  const normalized = normalizedCode(code);
  return load().accounts.find(account => account.referral_code === normalized && account.verified_at) || null;
}

function setAccountReferralCode(id, code) {
  const data = load();
  const account = accountById(data, id);
  const normalized = normalizedCode(code);
  if (!account || !account.verified_at) throw new Error('Verify your email before creating a referral code.');
  if (account.referral_code) throw new Error('This account already has a referral code.');
  if (data.accounts.some(item => item.referral_code === normalized)) throw new Error('That referral code is already taken.');
  account.referral_code = normalized;
  account.updated_at = new Date().toISOString();
  save(data);
  return account;
}

// ---------- Orders ----------
function paymentMatchAdjustmentCents(orderId, paymentProvider) {
  if (paymentProvider === 'paypal') return 0;
  return (Number(orderId) % 49) + 1;
}

function createOrder({ buyer, certifiedAt, items, subtotal, promoEligibleSubtotal, packagingFee, shippingFee, shippingMethod, orderFee, orderFeeRate, discountCode, discountAmount, total, paymentProvider, cryptoAsset, customerAccountId, referralAccountId, referralCreditRate, storeCreditAmount, shippingAddressValidation }) {
  const data = load();
  const id = data.nextOrderId++;
  const normalizedProvider = paymentProvider || 'manual';
  const appliedCreditCents = cents(storeCreditAmount);
  const customerAccount = customerAccountId ? accountById(data, customerAccountId) : null;
  if (appliedCreditCents > 0) {
    if (!customerAccount || !customerAccount.verified_at) throw new Error('Sign in to use store credit.');
    if (Number(customerAccount.credit_balance_cents || 0) < appliedCreditCents) throw new Error('Store-credit balance changed. Refresh checkout and try again.');
    customerAccount.credit_balance_cents -= appliedCreditCents;
    addLedgerEntry(data, customerAccount.id, -appliedCreditCents, 'order_credit_used', { orderId: id, note: `Applied to order HP-${id}` });
  }
  const matchCents = paymentMatchAdjustmentCents(id, normalizedProvider);
  const paymentMatchAdjustment = Math.round(matchCents) / 100;
  const baseTotal = Number(total || 0);
  const finalTotal = Math.round((baseTotal + paymentMatchAdjustment) * 100) / 100;
  const order = {
    id,
    status: 'pending_payment',
    payment_provider: normalizedProvider,
    payment_reference: null,
    crypto_asset: normalizedProvider === 'crypto' ? (cryptoAsset || 'BTC') : null,
    paypal_order_id: null,
    paid_at: null,
    buyer,
    customer_account_id: customerAccount ? customerAccount.id : null,
    referral_account_id: referralAccountId ? Number(referralAccountId) : null,
    referral_credit_rate: Number(referralCreditRate || 0),
    referral_credit_cents: 0,
    referral_credit_status: referralAccountId ? 'pending' : null,
    certified_at: certifiedAt,
    items,
    subtotal,
    promo_eligible_subtotal: promoEligibleSubtotal == null ? subtotal : promoEligibleSubtotal,
    packaging_fee: packagingFee,
    shipping_fee: shippingFee,
    shipping_method: shippingMethod || 'domestic',
    order_fee: orderFee || 0,
    order_fee_rate: orderFeeRate || 0,
    discount_code: discountCode || null,
    discount_amount: discountAmount || 0,
    store_credit_amount: dollars(appliedCreditCents),
    store_credit_status: appliedCreditCents ? 'debited' : null,
    base_total: baseTotal,
    payment_match_adjustment: paymentMatchAdjustment,
    total: finalTotal,
    notes: '',
    payment_reminders_enabled: true,
    payment_reminder_count: 0,
    payment_reminder_last_sent_at: null,
    tracking_carrier: null,
    tracking_number: null,
    tracking_sent_at: null,
    labels_printed_at: null,
    shipping_address_validation: shippingAddressValidation || null,
    fulfillment_discord_dispatch_started_at: null,
    fulfillment_discord_sent_at: null,
    fulfillment_discord_message_id: null,
    fulfillment_discord_error: null,
    created_at: new Date().toISOString(),
  };
  data.orders.push(order);
  save(data);
  return order;
}

function getAllOrders() {
  return [...load().orders].sort((a, b) => b.id - a.id);
}

function getOrderById(id) {
  return load().orders.find(order => order.id === Number(id)) || null;
}

function setPayPalOrderId(id, paypalOrderId) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.paypal_order_id = paypalOrderId || null;
  save(data);
  return order;
}

function syncReferralCredit(data, order) {
  if (!order || !order.referral_account_id) return;
  const account = accountById(data, order.referral_account_id);
  if (!account) return;
  const paid = isConfirmedOrderStatus(order.status);
  const eligibleSubtotal = order.promo_eligible_subtotal == null ? order.subtotal : order.promo_eligible_subtotal;
  const merchandiseCents = Math.max(0, cents(eligibleSubtotal) - cents(order.discount_amount));
  const rewardCents = Math.round(merchandiseCents * Number(order.referral_credit_rate || 0.10));
  if (paid && ['pending', null, undefined].includes(order.referral_credit_status) && rewardCents > 0) {
    order.referral_credit_cents = rewardCents;
    order.referral_credit_status = 'pending_review';
  } else if (!paid && ['approved', 'earned'].includes(order.referral_credit_status)) {
    const reversal = Number(order.referral_credit_cents || rewardCents);
    account.credit_balance_cents = Math.max(0, Number(account.credit_balance_cents || 0) - reversal);
    order.referral_credit_status = 'reversed';
    addLedgerEntry(data, account.id, -reversal, 'referral_reversal', { orderId: order.id, note: `Reversed reward from HP-${order.id}` });
  } else if (!paid && order.referral_credit_status === 'pending_review') {
    order.referral_credit_status = 'void';
  }
}

function reviewReferralCredit(orderId, decision, adminNote = '') {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Invalid referral-credit decision.');
  const data = load();
  const order = data.orders.find(item => item.id === Number(orderId));
  if (!order || !order.referral_account_id) return null;
  if (order.referral_credit_status !== 'pending_review') throw new Error('This referral reward is no longer awaiting review.');
  if (decision === 'approved' && !isConfirmedOrderStatus(order.status)) throw new Error('Only confirmed orders can earn referral credit.');
  const account = accountById(data, order.referral_account_id);
  if (!account) throw new Error('Referral account not found.');
  const now = new Date().toISOString();
  order.referral_credit_status = decision;
  order.referral_credit_reviewed_at = now;
  order.referral_credit_admin_note = String(adminNote || '').slice(0, 500);
  if (decision === 'approved') {
    const amount = Number(order.referral_credit_cents || 0);
    account.credit_balance_cents = Number(account.credit_balance_cents || 0) + amount;
    addLedgerEntry(data, account.id, amount, 'referral_reward', { orderId: order.id, note: `Approved referral reward from HP-${order.id}` });
  }
  save(data);
  return order;
}

function refundStoreCredit(data, order) {
  if (!order || order.store_credit_status !== 'debited' || !order.customer_account_id) return;
  const account = accountById(data, order.customer_account_id);
  const refundCents = cents(order.store_credit_amount);
  if (!account || refundCents <= 0) return;
  account.credit_balance_cents = Number(account.credit_balance_cents || 0) + refundCents;
  order.store_credit_status = 'refunded';
  addLedgerEntry(data, account.id, refundCents, 'order_credit_refund', { orderId: order.id, note: `Credit restored from HP-${order.id}` });
}

function markOrderPaid(id, paymentReference) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.status = 'paid';
  order.payment_reference = paymentReference || order.payment_reference || null;
  order.paid_at = order.paid_at || new Date().toISOString();
  syncReferralCredit(data, order);
  save(data);
  return order;
}

function isTxidUsed(txid) {
  const normalized = String(txid).trim().toLowerCase();
  return load().orders.some(order => order.payment_reference && String(order.payment_reference).trim().toLowerCase() === normalized);
}

function setPaymentReference(id, reference) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.payment_reference = reference;
  save(data);
  return order;
}

function updateOrderStatus(id, status) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.status = status;
  if (isConfirmedOrderStatus(status)) order.paid_at = order.paid_at || new Date().toISOString();
  if (status === 'pending_tracking') order.labels_printed_at = order.labels_printed_at || new Date().toISOString();
  syncReferralCredit(data, order);
  if (status === 'cancelled') refundStoreCredit(data, order);
  save(data);
  return order;
}

function updateOrderNotes(id, notes) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.notes = String(notes || '').slice(0, 2000);
  save(data);
  return order;
}

function markPaymentReminderSent(id) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.payment_reminder_count = Number(order.payment_reminder_count || 0) + 1;
  order.payment_reminder_last_sent_at = new Date().toISOString();
  save(data);
  return order;
}

function markTrackingSent(id, carrier, trackingNumber) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.tracking_carrier = String(carrier || '').slice(0, 60);
  order.tracking_number = String(trackingNumber || '').slice(0, 120);
  order.tracking_sent_at = new Date().toISOString();
  order.status = 'fulfilled';
  order.paid_at = order.paid_at || new Date().toISOString();
  syncReferralCredit(data, order);
  save(data);
  return order;
}

function claimFulfillmentDiscordPost(id, staleAfterMs = 10 * 60 * 1000) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return { claimed: false, reason: 'not_found', order: null };
  if (order.fulfillment_discord_sent_at) return { claimed: false, reason: 'already_sent', order };
  const startedAt = order.fulfillment_discord_dispatch_started_at
    ? new Date(order.fulfillment_discord_dispatch_started_at).getTime()
    : 0;
  if (startedAt && Number.isFinite(startedAt) && Date.now() - startedAt < staleAfterMs) {
    return { claimed: false, reason: 'in_progress', order };
  }
  order.fulfillment_discord_dispatch_started_at = new Date().toISOString();
  order.fulfillment_discord_error = null;
  save(data);
  return { claimed: true, reason: 'claimed', order };
}

function markFulfillmentDiscordSent(id, messageId = '') {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.fulfillment_discord_sent_at = order.fulfillment_discord_sent_at || new Date().toISOString();
  order.fulfillment_discord_message_id = String(messageId || '').slice(0, 80) || order.fulfillment_discord_message_id || null;
  order.fulfillment_discord_dispatch_started_at = null;
  order.fulfillment_discord_error = null;
  save(data);
  return order;
}

function markFulfillmentDiscordFailed(id, error) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.fulfillment_discord_dispatch_started_at = null;
  order.fulfillment_discord_error = String(error || 'Could not post fulfillment address.').slice(0, 500);
  save(data);
  return order;
}

function markOrderBackupSent(id, channels = [], errors = []) {
  const data = load();
  const order = data.orders.find(item => item.id === Number(id));
  if (!order) return null;
  order.backup_sent_at = new Date().toISOString();
  order.backup_channels = channels;
  order.backup_errors = errors;
  save(data);
  return order;
}

function deleteOrder(id) {
  const data = load();
  const index = data.orders.findIndex(item => item.id === Number(id));
  if (index === -1) return null;
  const order = data.orders[index];
  if (['approved', 'earned', 'pending_review'].includes(order.referral_credit_status)) {
    order.status = 'cancelled';
    syncReferralCredit(data, order);
  }
  refundStoreCredit(data, order);
  const [removed] = data.orders.splice(index, 1);
  save(data);
  return removed;
}

// ---------- Referral dashboard and payouts ----------
function referralStatsFromData(data, accountId, options = {}) {
  const account = accountById(data, accountId);
  if (!account) return null;
  const paidOrders = data.orders.filter(order => order.referral_account_id === account.id && isConfirmedOrderStatus(order.status));
  const customerSpend = new Map();
  let totalSpendCents = 0;
  paidOrders.forEach(order => {
    const spend = Math.max(0, cents(order.subtotal) - cents(order.discount_amount));
    const email = normalizedEmail(order.buyer && order.buyer.email);
    totalSpendCents += spend;
    if (email) customerSpend.set(email, (customerSpend.get(email) || 0) + spend);
  });
  const uniqueCustomers = customerSpend.size;
  const minCustomers = Number(options.minCustomers || 5);
  const minSpendCents = cents(options.minSpend || 500);
  const recentReferrals = [...paidOrders]
    .sort((a, b) => new Date(b.paid_at || b.created_at) - new Date(a.paid_at || a.created_at))
    .slice(0, 12)
    .map(order => ({ orderId: order.id, customer: order.buyer && order.buyer.name ? String(order.buyer.name).split(/\s+/)[0] : 'Customer', productSpend: dollars(Math.max(0, cents(order.subtotal) - cents(order.discount_amount))), creditAmount: dollars(order.referral_credit_cents), creditStatus: order.referral_credit_status, paidAt: order.paid_at || order.created_at }));
  return {
    uniqueCustomers,
    totalSpend: dollars(totalSpendCents),
    paidOrderCount: paidOrders.length,
    creditBalance: dollars(account.credit_balance_cents),
    payoutReserved: dollars(account.payout_reserved_cents),
    payoutEligible: uniqueCustomers >= minCustomers && totalSpendCents >= minSpendCents,
    minCustomers,
    minSpend: dollars(minSpendCents),
    recentReferrals,
  };
}

function getAccountDashboard(id, options = {}) {
  const data = load();
  const account = accountById(data, id);
  if (!account) return null;
  const stats = referralStatsFromData(data, id, options);
  const orders = data.orders.filter(order => order.customer_account_id === account.id).sort((a, b) => b.id - a.id).slice(0, 12).map(order => ({
    id: order.id,
    status: order.status,
    total: order.total,
    createdAt: order.created_at,
    itemCount: (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    trackingCarrier: order.tracking_carrier || '',
    trackingNumber: order.tracking_number || '',
    trackingSentAt: order.tracking_sent_at || null,
  }));
  const ledger = data.creditLedger.filter(entry => entry.account_id === account.id).sort((a, b) => b.id - a.id).slice(0, 20).map(entry => ({ ...entry, amount: dollars(entry.amount_cents) }));
  const payouts = data.payoutRequests.filter(request => request.account_id === account.id).sort((a, b) => b.id - a.id).map(request => ({ ...request, amount: dollars(request.amount_cents) }));
  const socialSubmissions = data.socialCreditSubmissions.filter(item => item.account_id === account.id).sort((a, b) => b.id - a.id).slice(0, 12).map(item => ({ ...item, creditAmount: dollars(item.credit_cents) }));
  const cooldownMs = Number(options.socialCooldownDays || 7) * 86400000;
  const newest = socialSubmissions[0];
  const nextSocialEligibleAt = newest ? new Date(new Date(newest.created_at).getTime() + cooldownMs).toISOString() : null;
  return { account, stats, orders, ledger, payouts, socialSubmissions, nextSocialEligibleAt };
}

function createSocialCreditSubmission(accountId, videoUrl, options = {}) {
  const data = load();
  const account = accountById(data, accountId);
  if (!account || !account.verified_at) throw new Error('A verified account is required.');
  const normalizedVideoUrl = String(videoUrl || '').trim().slice(0, 500);
  if (data.socialCreditSubmissions.some(item => String(item.video_url || '').trim().toLowerCase() === normalizedVideoUrl.toLowerCase())) {
    throw new Error('This TikTok video has already been submitted.');
  }
  const days = Number(options.cooldownDays || 7);
  const cooldownMs = days * 86400000;
  const latest = data.socialCreditSubmissions.filter(item => item.account_id === account.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (latest && Date.now() - new Date(latest.created_at).getTime() < cooldownMs) {
    const next = new Date(new Date(latest.created_at).getTime() + cooldownMs);
    throw new Error(`You can submit one video every ${days} days. Try again after ${next.toLocaleDateString('en-US')}.`);
  }
  const now = new Date().toISOString();
  const submission = { id: data.nextSocialCreditSubmissionId++, account_id: account.id, platform: 'tiktok', video_url: normalizedVideoUrl, credit_cents: Number(options.creditCents || 500), status: 'pending_review', admin_note: '', created_at: now, reviewed_at: null };
  data.socialCreditSubmissions.push(submission);
  save(data);
  return submission;
}

function reviewSocialCreditSubmission(id, decision, adminNote = '') {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Invalid social-credit decision.');
  const data = load();
  const submission = data.socialCreditSubmissions.find(item => item.id === Number(id));
  if (!submission) return null;
  if (submission.status !== 'pending_review') throw new Error('This submission is no longer awaiting review.');
  const account = accountById(data, submission.account_id);
  if (!account) throw new Error('Account not found.');
  submission.status = decision;
  submission.admin_note = String(adminNote || '').slice(0, 500);
  submission.reviewed_at = new Date().toISOString();
  if (decision === 'approved') {
    account.credit_balance_cents = Number(account.credit_balance_cents || 0) + Number(submission.credit_cents || 0);
    addLedgerEntry(data, account.id, submission.credit_cents, 'tiktok_credit', { note: `Approved TikTok video submission #${submission.id}` });
  }
  save(data);
  return submission;
}

function createPayoutRequest(accountId, options = {}) {
  const data = load();
  const account = accountById(data, accountId);
  if (!account) throw new Error('Account not found.');
  const stats = referralStatsFromData(data, accountId, options);
  if (!stats.payoutEligible) throw new Error(`Payouts unlock after ${stats.minCustomers} referred customers and $${stats.minSpend.toFixed(0)} in paid referral spend.`);
  if (data.payoutRequests.some(request => request.account_id === account.id && ['pending', 'approved'].includes(request.status))) throw new Error('You already have a payout request under review.');
  const amountCents = Math.max(0, Number(account.credit_balance_cents || 0));
  if (amountCents <= 0) throw new Error('No available balance to withdraw.');
  const now = new Date().toISOString();
  const request = { id: data.nextPayoutRequestId++, account_id: account.id, amount_cents: amountCents, status: 'pending', admin_note: '', created_at: now, updated_at: now };
  account.credit_balance_cents -= amountCents;
  account.payout_reserved_cents = Number(account.payout_reserved_cents || 0) + amountCents;
  data.payoutRequests.push(request);
  addLedgerEntry(data, account.id, -amountCents, 'payout_reserved', { payoutRequestId: request.id, note: 'Cash payout requested' });
  save(data);
  return request;
}

function updatePayoutRequest(id, status, adminNote = '') {
  const allowed = new Set(['pending', 'approved', 'paid', 'rejected']);
  if (!allowed.has(status)) throw new Error('Invalid payout status.');
  const data = load();
  const request = data.payoutRequests.find(item => item.id === Number(id));
  if (!request) return null;
  const account = accountById(data, request.account_id);
  const previous = request.status;
  if (['paid', 'rejected'].includes(previous) && status !== previous) throw new Error('Completed payout requests cannot be reopened.');
  if (status === 'rejected' && !['rejected', 'paid'].includes(previous) && account) {
    account.payout_reserved_cents = Math.max(0, Number(account.payout_reserved_cents || 0) - request.amount_cents);
    account.credit_balance_cents = Number(account.credit_balance_cents || 0) + request.amount_cents;
    addLedgerEntry(data, account.id, request.amount_cents, 'payout_released', { payoutRequestId: request.id, note: 'Rejected payout returned to store credit' });
  }
  if (status === 'paid' && previous !== 'paid' && account) {
    account.payout_reserved_cents = Math.max(0, Number(account.payout_reserved_cents || 0) - request.amount_cents);
    addLedgerEntry(data, account.id, 0, 'payout_paid', { payoutRequestId: request.id, note: 'Cash payout marked paid' });
  }
  request.status = status;
  request.admin_note = String(adminNote || '').slice(0, 500);
  request.updated_at = new Date().toISOString();
  save(data);
  return request;
}

function getAdminReferralData(options = {}) {
  const data = load();
  const accounts = data.accounts.map(account => ({ id: account.id, name: account.name, email: account.email, verifiedAt: account.verified_at, referralCode: account.referral_code, createdAt: account.created_at, ...referralStatsFromData(data, account.id, options) })).sort((a, b) => b.totalSpend - a.totalSpend);
  const payouts = data.payoutRequests.map(request => {
    const account = accountById(data, request.account_id);
    return { ...request, amount: dollars(request.amount_cents), accountName: account ? account.name : 'Unknown', accountEmail: account ? account.email : '', referralCode: account ? account.referral_code : null };
  }).sort((a, b) => b.id - a.id);
  const referralRewards = data.orders.filter(order => order.referral_account_id && order.referral_credit_status && order.referral_credit_status !== 'pending').map(order => {
    const account = accountById(data, order.referral_account_id);
    return { orderId: order.id, status: order.referral_credit_status, orderStatus: order.status, customerName: order.buyer && order.buyer.name, customerEmail: order.buyer && order.buyer.email, amount: dollars(order.referral_credit_cents), productSpend: dollars(Math.max(0, cents(order.subtotal) - cents(order.discount_amount))), accountName: account ? account.name : 'Unknown', accountEmail: account ? account.email : '', referralCode: account ? account.referral_code : null, adminNote: order.referral_credit_admin_note || '', createdAt: order.paid_at || order.created_at };
  }).sort((a, b) => b.orderId - a.orderId);
  const socialSubmissions = data.socialCreditSubmissions.map(item => {
    const account = accountById(data, item.account_id);
    return { ...item, creditAmount: dollars(item.credit_cents), accountName: account ? account.name : 'Unknown', accountEmail: account ? account.email : '' };
  }).sort((a, b) => b.id - a.id);
  return { accounts, payouts, referralRewards, socialSubmissions };
}

function getStorageInfo() {
  return { dbPath: DB_PATH, legacyDbPath: LEGACY_DB_PATH, usingPersistentRenderPath: DB_PATH.replace(/\\/g, '/').startsWith('/var/data/'), exists: fs.existsSync(DB_PATH) };
}

module.exports = {
  createOrder, getAllOrders, getOrderById, setPayPalOrderId, markOrderPaid, updateOrderStatus, updateOrderNotes, deleteOrder, markOrderBackupSent, markPaymentReminderSent, markTrackingSent, claimFulfillmentDiscordPost, markFulfillmentDiscordSent, markFulfillmentDiscordFailed, getStorageInfo, isTxidUsed, setPaymentReference,
  createAccount, getAccountById, getAccountByEmail, setAccountVerificationToken, verifyAccountByTokenHash, touchAccountLogin, setPasswordResetToken, resetPasswordByTokenHash, getAccountByReferralCode, setAccountReferralCode, getAccountDashboard, createPayoutRequest, updatePayoutRequest, getAdminReferralData, reviewReferralCredit, createSocialCreditSubmission, reviewSocialCreditSubmission,
};
