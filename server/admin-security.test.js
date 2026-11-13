const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAdminSecurity } = require('./admin-security');

function fakeReq(ip, extra = {}) {
  const headers = { 'user-agent': 'curl/8.0', cookie: 'hp.sid=s%3Asecret-session-value; other=1', ...extra };
  return { ip, headers, socket: {}, get: name => headers[name.toLowerCase()] };
}

function setup() {
  let clock = Date.UTC(2026, 10, 10);
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adminsec-')), 'log.json');
  const security = createAdminSecurity({ filePath, now: () => clock, failureDelayMs: [0, 1] });
  return { security, filePath, now: () => clock, tick: ms => { clock += ms; } };
}

test('five wrong passwords lock that IP and the lock doubles on repeat', () => {
  const { security, tick } = setup();
  const req = fakeReq('203.0.113.9');
  for (let i = 0; i < 4; i += 1) assert.equal(security.recordFailure(req).lockedForMs, 0);
  assert.equal(security.recordFailure(req).lockedForMs, 15 * 60 * 1000);
  assert.equal(security.check(req).reason, 'ip_locked');
  assert.equal(security.check(fakeReq('198.51.100.1')), null);
  tick(15 * 60 * 1000 + 1);
  assert.equal(security.check(req), null);
  for (let i = 0; i < 4; i += 1) security.recordFailure(req);
  assert.equal(security.recordFailure(req).lockedForMs, 30 * 60 * 1000);
});

test('a burst of failures from many IPs pauses sign-in site-wide', () => {
  const { security } = setup();
  for (let i = 0; i < 61; i += 1) security.recordFailure(fakeReq(`192.0.2.${i}`));
  assert.equal(security.check(fakeReq('198.51.100.77')).reason, 'site_paused');
});

test('log keeps IP, device and cookie names but never raw cookie values', () => {
  const { security, filePath } = setup();
  security.recordFailure(fakeReq('203.0.113.5'));
  const saved = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(saved, /secret-session-value/);
  const entry = security.summary().attempts[0];
  assert.equal(entry.ip, '203.0.113.5');
  assert.equal(entry.result, 'failed');
  assert.deepEqual(entry.cookieNames, ['hp.sid', 'other']);
  assert.match(entry.sessionFingerprint, /^[a-f0-9]{12}$/);
  assert.equal(entry.userAgent, 'curl/8.0');
});

test('lockouts survive a restart and can be lifted by the owner', () => {
  const { security, filePath, now } = setup();
  const req = fakeReq('203.0.113.20');
  for (let i = 0; i < 5; i += 1) security.recordFailure(req);
  const restarted = createAdminSecurity({ filePath, now, failureDelayMs: [0, 1] });
  assert.equal(restarted.check(req).reason, 'ip_locked');
  restarted.unblock('203.0.113.20');
  assert.equal(restarted.check(req), null);
});
