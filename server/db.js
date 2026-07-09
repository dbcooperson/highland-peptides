// Simple JSON-file-backed store. No native dependencies, so it deploys anywhere
// Node runs (Render, Railway, a VPS, etc.) without a compile step.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { accounts: [], orders: [], nextAccountId: 1, nextOrderId: 1 };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ---------- Accounts ----------
function createAccount({ companyName, contactName, email, emailDomain, passwordHash, agreedToTerms, agreedAt }) {
  const data = load();
  const account = {
    id: data.nextAccountId++,
    company_name: companyName,
    contact_name: contactName || null,
    email: email.toLowerCase(),
    email_domain: emailDomain,
    password_hash: passwordHash,
    status: 'pending',
    agreed_to_terms: !!agreedToTerms,
    agreed_at: agreedAt || null,
    created_at: new Date().toISOString(),
    reviewed_at: null,
  };
  data.accounts.push(account);
  save(data);
  return account;
}

function getAccountByEmail(email) {
  const data = load();
  return data.accounts.find(a => a.email === email.toLowerCase()) || null;
}

function getAccountById(id) {
  const data = load();
  return data.accounts.find(a => a.id === Number(id)) || null;
}

function getAllAccounts() {
  const data = load();
  return [...data.accounts].sort((a, b) => b.id - a.id);
}

function reviewAccount(id, decision) {
  const data = load();
  const account = data.accounts.find(a => a.id === Number(id));
  if (!account) return null;
  account.status = decision;
  account.reviewed_at = new Date().toISOString();
  save(data);
  return account;
}

// ---------- Orders ----------
function createOrder({ accountId, items, subtotal, packagingFee, total }) {
  const data = load();
  const order = {
    id: data.nextOrderId++,
    account_id: accountId,
    status: 'pending_payment',
    items,
    subtotal,
    packaging_fee: packagingFee,
    total,
    created_at: new Date().toISOString(),
  };
  data.orders.push(order);
  save(data);
  return order;
}

function getOrdersByAccount(accountId) {
  const data = load();
  return data.orders.filter(o => o.account_id === Number(accountId)).sort((a, b) => b.id - a.id);
}

function getAllOrders() {
  const data = load();
  const accountsById = Object.fromEntries(data.accounts.map(a => [a.id, a]));
  return [...data.orders]
    .sort((a, b) => b.id - a.id)
    .map(o => ({
      ...o,
      company_name: accountsById[o.account_id] ? accountsById[o.account_id].company_name : 'Unknown',
      email: accountsById[o.account_id] ? accountsById[o.account_id].email : '',
    }));
}

function getOrderById(id) {
  const data = load();
  return data.orders.find(o => o.id === Number(id)) || null;
}

function updateOrderStatus(id, status) {
  const data = load();
  const order = data.orders.find(o => o.id === Number(id));
  if (!order) return null;
  order.status = status;
  save(data);
  return order;
}

module.exports = {
  createAccount, getAccountByEmail, getAccountById, getAllAccounts, reviewAccount,
  createOrder, getOrdersByAccount, getAllOrders, getOrderById, updateOrderStatus,
};
