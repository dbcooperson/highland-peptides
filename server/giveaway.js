// Launch giveaway: every paid peptide/compound vial in a paid order during the
// giveaway window is one entry; anyone can also enter free once per day (the
// legally required "no purchase necessary" route). The admin draws winners once,
// weighted by entries, with one prize per person.
const crypto = require('crypto');

const EMAIL_PATTERN = /^[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[A-Za-z]{2,}$/;
const PAID_STATUSES = new Set(['paid', 'pending_tracking', 'fulfilled']);
const FREE_ENTRY_HOURLY_LIMIT = 10;

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizedEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// "2026-11-20" means midnight Pacific time (PST or PDT, whichever applies that
// day); full ISO timestamps are used as given.
function pacificMidnight(day) {
  for (const offset of ['-08:00', '-07:00']) {
    const date = new Date(`${day}T00:00:00${offset}`);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(date);
    if (local.startsWith(day) && /\b00$/.test(local)) return date;
  }
  return new Date(`${day}T00:00:00-08:00`);
}

function parseStart(value) {
  if (!value) return null;
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? pacificMidnight(text) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function giveawayWindow(settings) {
  const start = parseStart(settings && settings.startsAt);
  if (!start) return null;
  const end = new Date(start.getTime() + Number(settings.days || 30) * 24 * 60 * 60 * 1000);
  return { start, end };
}

function giveawayStatus(settings, now = new Date()) {
  const window = giveawayWindow(settings);
  if (!window) return 'not_scheduled';
  if (now < window.start) return 'upcoming';
  if (now >= window.end) return 'ended';
  return 'active';
}

function pacificDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Entries one order earns: paid quantity of products outside the excluded categories.
function orderEntryCount(order, bySku, excludedCategories = ['Supplies']) {
  const excluded = new Set(excludedCategories);
  return (order && Array.isArray(order.items) ? order.items : []).reduce((sum, item) => {
    const product = bySku[item.sku];
    const paid = Number(item.unit_price || 0) > 0;
    if (!paid || !product || excluded.has(product.category)) return sum;
    return sum + Math.max(0, Math.floor(Number(item.quantity || 0)));
  }, 0);
}

// Entrants keyed by email: purchase entries from paid orders in the window plus free entries.
function tallyEntries({ orders, freeEntries, bySku, settings }) {
  const window = giveawayWindow(settings);
  const entrants = new Map();
  const entrant = (email, name) => {
    const key = normalizedEmail(email);
    if (!entrants.has(key)) entrants.set(key, { email: String(email).trim(), name: name || '', purchaseEntries: 0, freeEntries: 0, orderIds: [] });
    const record = entrants.get(key);
    if (!record.name && name) record.name = name;
    return record;
  };
  if (window) {
    for (const order of orders || []) {
      if (!PAID_STATUSES.has(order.status)) continue;
      const email = order.buyer && order.buyer.email;
      if (!email) continue;
      const at = new Date(order.paid_at || order.created_at);
      if (!(at >= window.start && at < window.end)) continue;
      const count = orderEntryCount(order, bySku, settings.excludedCategories);
      if (!count) continue;
      const record = entrant(email, order.buyer.name);
      record.purchaseEntries += count;
      record.orderIds.push(order.id);
    }
  }
  for (const entry of freeEntries || []) {
    const at = new Date(entry.created_at);
    if (window && !(at >= window.start && at < window.end)) continue;
    entrant(entry.email, entry.name).freeEntries += 1;
  }
  const list = [...entrants.values()]
    .map(record => ({ ...record, entries: record.purchaseEntries + record.freeEntries }))
    .filter(record => record.entries > 0)
    .sort((a, b) => b.entries - a.entries);
  return {
    entrants: list,
    totalEntries: list.reduce((sum, record) => sum + record.entries, 0),
    purchaseEntries: list.reduce((sum, record) => sum + record.purchaseEntries, 0),
    freeEntries: list.reduce((sum, record) => sum + record.freeEntries, 0),
  };
}

// Weighted draw without replacement: each person can win at most one prize.
function drawWinners(entrants, prizes, randomInt = crypto.randomInt) {
  const pool = entrants.filter(record => record.entries > 0).map(record => ({ ...record }));
  const winners = [];
  for (const prize of [...prizes].sort((a, b) => a.place - b.place)) {
    const total = pool.reduce((sum, record) => sum + record.entries, 0);
    if (!total) break;
    let ticket = randomInt(total);
    const index = pool.findIndex(record => (ticket -= record.entries) < 0);
    const [winner] = pool.splice(index, 1);
    winners.push({
      place: prize.place,
      prize: prize.label,
      credit_cents: Number(prize.creditCents || 0),
      email: winner.email,
      name: winner.name,
      entries: winner.entries,
      order_ids: winner.orderIds,
      awarded_at: null,
    });
  }
  return winners;
}

function publicSettings(settings) {
  const window = giveawayWindow(settings);
  return {
    status: giveawayStatus(settings),
    startsAt: window ? window.start.toISOString() : null,
    endsAt: window ? window.end.toISOString() : null,
    prizes: (settings.prizes || []).map(prize => ({ place: prize.place, label: prize.label })),
  };
}

function registerGiveawayRoutes(app, { db, config, bySku, requireAdmin, clientIp = req => req.ip }) {
  const settings = config.LAUNCH_GIVEAWAY || {};
  const attempts = new Map();

  function rateLimited(ip) {
    const now = Date.now();
    const recent = (attempts.get(ip) || []).filter(at => now - at < 60 * 60 * 1000);
    if (recent.length >= FREE_ENTRY_HOURLY_LIMIT) { attempts.set(ip, recent); return true; }
    recent.push(now);
    attempts.set(ip, recent);
    if (attempts.size > 5000) for (const [key, list] of attempts) if (!list.some(at => now - at < 60 * 60 * 1000)) attempts.delete(key);
    return false;
  }

  function currentTally() {
    return tallyEntries({ orders: db.getAllOrders(), freeEntries: db.getGiveawayFreeEntries(settings.id), bySku, settings });
  }

  app.get('/api/giveaway', (req, res) => {
    res.json(publicSettings(settings));
  });

  app.post('/api/giveaway/free-entry', (req, res) => {
    const body = req.body || {};
    if (cleanText(body.website, 200)) return res.json({ ok: true }); // honeypot: quietly drop bots
    if (giveawayStatus(settings) !== 'active') return res.status(400).json({ error: 'The giveaway is not open right now.' });
    if (rateLimited(clientIp(req))) return res.status(429).json({ error: 'Too many entries from this connection. Try again later.' });
    const name = cleanText(body.name, 120);
    const email = cleanText(body.email, 254);
    if (!name) return res.status(400).json({ error: 'Please add your name.' });
    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'Please add a valid email so we can reach you if you win.' });
    if (body.agree !== true) return res.status(400).json({ error: 'Please confirm you are 21+, a U.S. resident, and agree to the official rules.' });
    const result = db.addGiveawayFreeEntry({ giveawayId: settings.id, name, email, day: pacificDay() });
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ ok: true });
  });

  app.get('/api/admin/giveaway', requireAdmin, (req, res) => {
    const tally = currentTally();
    res.json({
      ...publicSettings(settings),
      giveawayId: settings.id,
      entrantCount: tally.entrants.length,
      totalEntries: tally.totalEntries,
      purchaseEntries: tally.purchaseEntries,
      freeEntries: tally.freeEntries,
      topEntrants: tally.entrants.slice(0, 25),
      draw: db.getGiveawayDraw(settings.id),
    });
  });

  app.post('/api/admin/giveaway/draw', requireAdmin, (req, res) => {
    if (giveawayStatus(settings) !== 'ended') return res.status(400).json({ error: 'Winners can only be drawn after the giveaway ends.' });
    const tally = currentTally();
    if (!tally.entrants.length) return res.status(400).json({ error: 'There are no entries to draw from.' });
    const draw = {
      giveaway_id: settings.id,
      drawn_at: new Date().toISOString(),
      total_entries: tally.totalEntries,
      entrant_count: tally.entrants.length,
      winners: drawWinners(tally.entrants, settings.prizes || []),
    };
    const result = db.saveGiveawayDraw(draw);
    if (result.error) return res.status(409).json({ error: result.error });
    res.json({ draw: result.draw });
  });

  app.post('/api/admin/giveaway/award', requireAdmin, (req, res) => {
    const place = Number(req.body && req.body.place);
    const prize = (settings.prizes || []).find(item => item.place === place);
    if (!prize) return res.status(400).json({ error: 'Unknown prize.' });
    const result = prize.creditCents > 0
      ? db.awardGiveawayCredit(settings.id, place)
      : db.markGiveawayPrizeSent(settings.id, place);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ winner: result.winner });
  });
}

module.exports = { registerGiveawayRoutes, tallyEntries, drawWinners, orderEntryCount, giveawayStatus, giveawayWindow, parseStart, pacificDay };
