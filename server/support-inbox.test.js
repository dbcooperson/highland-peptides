const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'snowy-support-'));
const db = require('./db');
const { hashToken, readSupportToken } = require('./support-inbox');

test('guest messages create one conversation that the admin can read and answer', () => {
  const tokenHash = hashToken('guest-token-value');
  const first = db.addSupportCustomerMessage({ tokenHash, name: 'Jane', email: 'jane@example.com', body: 'Where is my order?' });
  assert.equal(first.thread.messages.length, 1);
  db.addSupportCustomerMessage({ tokenHash, name: 'Jane', email: 'jane@example.com', body: 'Order SR-12' });
  const threads = db.listSupportThreads();
  assert.equal(threads.length, 1);
  assert.equal(threads[0].adminUnread, 2);
  assert.equal(db.supportUnreadCount(), 1);

  const opened = db.getSupportThreadForAdmin(threads[0].id);
  assert.equal(opened.messages.length, 2);
  assert.equal(db.supportUnreadCount(), 0);

  db.addSupportAdminReply(threads[0].id, 'It shipped today.');
  const customerView = db.getCustomerSupportThread({ tokenHash });
  assert.equal(customerView.messages.at(-1).from, 'admin');
  assert.equal(customerView.customerUnread, 1);
  assert.equal(customerView.token_hash, undefined, 'customer view must not leak internal fields');
  db.getCustomerSupportThread({ tokenHash, markSeen: true });
  assert.equal(db.getCustomerSupportThread({ tokenHash }).customerUnread, 0);
});

test('another visitor cannot read someone else\'s conversation', () => {
  assert.equal(db.getCustomerSupportThread({ tokenHash: hashToken('some-other-token') }), null);
  assert.equal(db.getCustomerSupportThread({}), null);
});

test('support cookie only accepts well-formed tokens', () => {
  const token = 'a'.repeat(43);
  assert.equal(readSupportToken({ headers: { cookie: `x=1; hp.support=${token}` } }), token);
  assert.equal(readSupportToken({ headers: { cookie: 'hp.support=../../etc' } }), null);
});

test('chat widget renders customer text safely and requires an email for guests', () => {
  const shared = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shared.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, 'support-inbox.js'), 'utf8');
  assert.match(shared, /text\.textContent = message\.body/);
  assert.doesNotMatch(shared, /innerHTML = [^;]*message\.body/);
  assert.match(routes, /Please add a valid email/);
  assert.match(routes, /HOURLY_LIMIT/);
});
