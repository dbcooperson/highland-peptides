const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'snowy-giveaway-'));
const db = require('./db');
const { tallyEntries, drawWinners, orderEntryCount, giveawayStatus, parseStart } = require('./giveaway');

const bySku = {
  BC10: { sku: 'BC10', category: 'Peptide' },
  RU: { sku: 'RU', category: 'Research Compound' },
  WA10: { sku: 'WA10', category: 'Supplies' },
};
const settings = { id: 'test', startsAt: '2026-11-20', days: 30, excludedCategories: ['Supplies'], prizes: [
  { place: 1, label: '$100 store credit', creditCents: 10000 },
  { place: 2, label: '$50 store credit', creditCents: 5000 },
  { place: 3, label: 'Kit', creditCents: 0 },
] };
const inWindow = '2026-11-25T18:00:00Z';

test('each paid peptide or compound vial is one entry; water and free gifts are not', () => {
  const order = { items: [
    { sku: 'BC10', quantity: 3, unit_price: 20.99 },
    { sku: 'RU', quantity: 1, unit_price: 35.99 },
    { sku: 'WA10', quantity: 5, unit_price: 9.99 },
    { sku: 'BC10', quantity: 1, unit_price: 0 },
  ] };
  assert.equal(orderEntryCount(order, bySku, settings.excludedCategories), 4);
});

test('only paid orders inside the window count, grouped by email', () => {
  const orders = [
    { id: 1, status: 'paid', paid_at: inWindow, buyer: { email: 'A@x.com', name: 'A' }, items: [{ sku: 'BC10', quantity: 2, unit_price: 20 }] },
    { id: 2, status: 'fulfilled', paid_at: inWindow, buyer: { email: 'a@x.com' }, items: [{ sku: 'BC10', quantity: 1, unit_price: 20 }] },
    { id: 3, status: 'pending_payment', created_at: inWindow, buyer: { email: 'b@x.com' }, items: [{ sku: 'BC10', quantity: 9, unit_price: 20 }] },
    { id: 4, status: 'cancelled', paid_at: inWindow, buyer: { email: 'c@x.com' }, items: [{ sku: 'BC10', quantity: 9, unit_price: 20 }] },
    { id: 5, status: 'paid', paid_at: '2026-11-19T12:00:00Z', buyer: { email: 'd@x.com' }, items: [{ sku: 'BC10', quantity: 9, unit_price: 20 }] },
    { id: 6, status: 'paid', paid_at: '2026-12-21T12:00:00Z', buyer: { email: 'e@x.com' }, items: [{ sku: 'BC10', quantity: 9, unit_price: 20 }] },
  ];
  const freeEntries = [{ email: 'f@x.com', name: 'F', created_at: inWindow }, { email: 'a@x.com', created_at: inWindow }];
  const tally = tallyEntries({ orders, freeEntries, bySku, settings });
  assert.deepEqual(tally.entrants.map(e => [e.email.toLowerCase(), e.entries]), [['a@x.com', 4], ['f@x.com', 1]]);
  assert.equal(tally.totalEntries, 5);
  assert.deepEqual(tally.entrants[0].orderIds, [1, 2]);
});

test('draw is weighted by entries and gives one prize per person', () => {
  const entrants = [{ email: 'a', entries: 5, orderIds: [] }, { email: 'b', entries: 1, orderIds: [] }, { email: 'c', entries: 2, orderIds: [] }];
  const winners = drawWinners(entrants, settings.prizes, () => 0);
  assert.deepEqual(winners.map(w => w.email), ['a', 'b', 'c']);
  assert.equal(new Set(winners.map(w => w.email)).size, 3);
  const last = drawWinners(entrants, settings.prizes, total => total - 1);
  assert.deepEqual(last.map(w => w.email), ['c', 'b', 'a']);
  assert.equal(drawWinners([{ email: 'solo', entries: 3 }], settings.prizes).length, 1, 'fewer entrants than prizes');
});

test('window opens at midnight Pacific and lasts 30 days', () => {
  assert.equal(parseStart('2026-11-20').toISOString(), '2026-11-20T08:00:00.000Z');
  assert.equal(giveawayStatus(settings, new Date('2026-11-20T07:59:00Z')), 'upcoming');
  assert.equal(giveawayStatus(settings, new Date('2026-11-20T08:00:00Z')), 'active');
  assert.equal(giveawayStatus(settings, new Date('2026-12-20T08:00:00Z')), 'ended');
  assert.equal(giveawayStatus({ startsAt: null }), 'not_scheduled');
  assert.equal(parseStart('2026-11-01').toISOString(), '2026-11-01T07:00:00.000Z', 'daylight time on Nov 1');
  assert.equal(parseStart('2026-07-04').toISOString(), '2026-07-04T07:00:00.000Z');
});

test('free entry: one per email per day; draw saved once; credit awarded once', () => {
  assert.ok(db.addGiveawayFreeEntry({ giveawayId: 'g1', name: 'A', email: 'a@x.com', day: '2026-11-21' }).entry);
  assert.match(db.addGiveawayFreeEntry({ giveawayId: 'g1', name: 'A', email: 'A@X.com', day: '2026-11-21' }).error, /already/);
  assert.ok(db.addGiveawayFreeEntry({ giveawayId: 'g1', name: 'A', email: 'a@x.com', day: '2026-11-22' }).entry);

  const winners = [{ place: 1, prize: '$100', credit_cents: 10000, email: 'win@x.com', awarded_at: null }, { place: 3, prize: 'Kit', credit_cents: 0, email: 'k@x.com', awarded_at: null }];
  assert.ok(db.saveGiveawayDraw({ giveaway_id: 'g1', winners }).draw);
  assert.match(db.saveGiveawayDraw({ giveaway_id: 'g1', winners: [] }).error, /already/);
  assert.match(db.awardGiveawayCredit('g1', 1).error, /No account/);
  assert.match(db.awardGiveawayCredit('g1', 3).error, /not store credit/);
});

test('admin routes require admin and the public page has the no-purchase-necessary rules', () => {
  const routes = fs.readFileSync(path.join(__dirname, 'giveaway.js'), 'utf8');
  for (const route of ['/api/admin/giveaway', '/api/admin/giveaway/draw', '/api/admin/giveaway/award']) {
    assert.match(routes, new RegExp(`app\\.(get|post)\\('${route.replace(/\//g, '\\/')}', requireAdmin,`));
  }
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'giveaway.html'), 'utf8');
  assert.match(page, /No purchase necessary/);
  assert.match(page, /Official rules/);
});
