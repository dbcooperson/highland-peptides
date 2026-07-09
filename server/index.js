const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const config = require('./config');
const db = require('./db');
const { catalog, bySku } = require('./products');
const { emailDomain, requireApprovedAccount, requireLoggedIn, requireAdmin } = require('./auth');
const { buildPackingSlip, buildContentsLabel } = require('./labels');

const app = express();
app.use(express.json());
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Public catalog ----------
app.get('/api/catalog', (req, res) => {
  res.json({ siteName: config.SITE_NAME, products: catalog });
});

// ---------- Signup / login (buyer accounts) ----------
app.post('/api/signup', (req, res) => {
  const { companyName, contactName, email, password, agreedToTerms } = req.body || {};
  if (!companyName || !email || !password) {
    return res.status(400).json({ error: 'Company name, email, and password are required.' });
  }
  if (agreedToTerms !== true) {
    return res.status(400).json({ error: 'You must agree to the Research Use Only Terms to create an account.' });
  }
  if (db.getAccountByEmail(email)) {
    return res.status(400).json({ error: 'An account with this email already exists.' });
  }
  const account = db.createAccount({
    companyName,
    contactName,
    email,
    emailDomain: emailDomain(email),
    passwordHash: bcrypt.hashSync(password, 10),
    agreedToTerms: true,
    agreedAt: new Date().toISOString(),
  });

  res.json({
    ok: true,
    message: 'Account created. It is pending manual review before you can place orders. You will be notified once approved.',
    accountId: account.id,
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const account = db.getAccountByEmail(email || '');
  if (!account || !bcrypt.compareSync(password || '', account.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  req.session.accountId = account.id;
  req.session.accountStatus = account.status;
  res.json({ ok: true, status: account.status, companyName: account.company_name });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.accountId) return res.json({ loggedIn: false });
  const account = db.getAccountById(req.session.accountId);
  if (!account) return res.json({ loggedIn: false });
  req.session.accountStatus = account.status;
  res.json({
    loggedIn: true,
    account: {
      id: account.id,
      company_name: account.company_name,
      contact_name: account.contact_name,
      email: account.email,
      status: account.status,
    },
  });
});

// ---------- Checkout (approved accounts only, no guest checkout) ----------
app.post('/api/checkout', (req, res) => {
  if (!req.session.accountId) return res.status(401).json({ error: 'Please log in.' });
  const account = db.getAccountById(req.session.accountId);
  if (!account || account.status !== 'approved') {
    return res.status(403).json({ error: 'Your account is not yet approved for purchasing.' });
  }

  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) return res.status(400).json({ error: 'Cart is empty.' });

  let subtotal = 0;
  const resolved = [];
  for (const item of items) {
    const product = bySku[item.sku];
    const qty = parseInt(item.quantity, 10);
    if (!product || !qty || qty < 1) {
      return res.status(400).json({ error: `Invalid item: ${item.sku}` });
    }
    subtotal += product.price * qty;
    resolved.push({ sku: product.sku, name: product.name, spec: product.spec, quantity: qty, unit_price: product.price });
  }
  subtotal = Math.round(subtotal * 100) / 100;
  const packagingFee = config.PACKAGING_FEE;
  const total = Math.round((subtotal + packagingFee) * 100) / 100;

  const order = db.createOrder({ accountId: account.id, items: resolved, subtotal, packagingFee, total });

  res.json({
    ok: true,
    orderId: order.id,
    total,
    message: 'Order received and is pending payment instructions. Our team will follow up with how to complete payment.',
  });
});

app.get('/api/my-orders', requireLoggedIn, (req, res) => {
  res.json({ orders: db.getOrdersByAccount(req.session.accountId) });
});

// ---------- Admin ----------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== config.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong admin password.' });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ ok: true });
});

app.get('/api/admin/accounts', requireAdmin, (req, res) => {
  res.json({ accounts: db.getAllAccounts() });
});

app.post('/api/admin/accounts/:id/review', requireAdmin, (req, res) => {
  const { decision } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be approved or rejected' });
  }
  const account = db.reviewAccount(req.params.id, decision);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json({ orders: db.getAllOrders() });
});

app.post('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['pending_payment', 'paid', 'fulfilled', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const order = db.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ ok: true });
});

function loadOrderBundle(id) {
  const order = db.getOrderById(id);
  if (!order) return null;
  const account = db.getAccountById(order.account_id);
  return { order, items: order.items, account };
}

app.get('/api/admin/orders/:id/packing-slip.pdf', requireAdmin, (req, res) => {
  const bundle = loadOrderBundle(req.params.id);
  if (!bundle) return res.status(404).send('Not found');
  buildPackingSlip(bundle.order, bundle.items, bundle.account, res);
});

app.get('/api/admin/orders/:id/contents-label.pdf', requireAdmin, (req, res) => {
  const bundle = loadOrderBundle(req.params.id);
  if (!bundle) return res.status(404).send('Not found');
  buildContentsLabel(bundle.order, bundle.items, bundle.account, res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`${config.SITE_NAME} running on http://localhost:${PORT}`));
