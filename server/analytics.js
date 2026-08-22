const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEGACY_ANALYTICS_PATH = path.join(__dirname, '..', 'data', 'analytics.json');
const ALLOWED_EVENTS = new Set([
  'page_view',
  'product_view',
  'add_to_cart',
  'checkout_start',
  'order_created',
]);

function defaultAnalyticsPath() {
  if (process.env.ANALYTICS_DB_PATH) return process.env.ANALYTICS_DB_PATH;
  if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, 'analytics.json');
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return '/var/data/analytics.json';
  return LEGACY_ANALYTICS_PATH;
}

function clean(value, maxLength = 160) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

function hashId(value) {
  const normalized = clean(value, 128);
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24) : '';
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function blankDay() {
  return {
    pageViews: 0,
    visitors: [],
    sessions: [],
    events: {},
    pages: {},
    products: {},
    sources: {},
  };
}

function createAnalyticsStore(filePath = defaultAnalyticsPath()) {
  function ensureDirectory() {
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  }

  function initialData() {
    return { version: 1, trackingStartedAt: new Date().toISOString(), days: {} };
  }

  function load() {
    ensureDirectory();
    if (!fs.existsSync(filePath)) {
      const initial = initialData();
      fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));
      return initial;
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!data || typeof data !== 'object') return initialData();
      if (!data.days || typeof data.days !== 'object') data.days = {};
      if (!data.trackingStartedAt) data.trackingStartedAt = new Date().toISOString();
      return data;
    } catch {
      return initialData();
    }
  }

  function save(data) {
    ensureDirectory();
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 400);
    const cutoffKey = dayKey(cutoff);
    Object.keys(data.days).forEach(key => {
      if (key < cutoffKey) delete data.days[key];
    });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  function increment(bucket, key, amount = 1) {
    const safeKey = clean(key, 180) || 'Unknown';
    bucket[safeKey] = Number(bucket[safeKey] || 0) + Number(amount || 0);
  }

  function addUnique(list, value) {
    if (value && !list.includes(value)) list.push(value);
  }

  function recordEvent(input = {}) {
    const type = clean(input.type, 40);
    if (!ALLOWED_EVENTS.has(type)) return false;

    const data = load();
    const key = dayKey();
    const day = data.days[key] || blankDay();
    const visitorHash = hashId(input.visitorId);
    const sessionHash = hashId(input.sessionId);
    addUnique(day.visitors, visitorHash);
    addUnique(day.sessions, sessionHash);
    increment(day.events, type);

    if (type === 'page_view') {
      day.pageViews += 1;
      increment(day.pages, clean(input.path, 180) || '/');
      increment(day.sources, clean(input.source, 100) || 'Direct / unknown');
    }

    if (['product_view', 'add_to_cart'].includes(type)) {
      const sku = clean(input.sku, 40);
      const name = clean(input.productName, 100);
      const label = [sku, name].filter(Boolean).join('|') || 'Unknown product';
      if (!day.products[label]) day.products[label] = { views: 0, adds: 0 };
      if (type === 'product_view') day.products[label].views += 1;
      if (type === 'add_to_cart') day.products[label].adds += Math.max(1, Math.min(99, Number(input.quantity || 1)));
    }

    data.days[key] = day;
    save(data);
    return true;
  }

  function getSummary(rangeDays = 30) {
    const data = load();
    const days = Math.max(1, Math.min(400, Number(rangeDays) || 30));
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const startKey = dayKey(start);
    const selected = Object.entries(data.days)
      .filter(([key]) => key >= startKey)
      .sort(([a], [b]) => a.localeCompare(b));

    const visitors = new Set();
    const sessions = new Set();
    const totals = {
      pageViews: 0,
      uniqueVisitors: 0,
      sessions: 0,
      productViews: 0,
      addToCarts: 0,
      checkoutStarts: 0,
      ordersCreated: 0,
    };
    const pageTotals = {};
    const sourceTotals = {};
    const productTotals = {};
    const dailyByKey = Object.fromEntries(selected);
    const daily = [];

    for (let offset = 0; offset < days; offset += 1) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + offset);
      const key = dayKey(date);
      const day = dailyByKey[key] || blankDay();
      const eventCounts = day.events || {};
      (day.visitors || []).forEach(id => visitors.add(id));
      (day.sessions || []).forEach(id => sessions.add(id));
      totals.pageViews += Number(day.pageViews || eventCounts.page_view || 0);
      totals.productViews += Number(eventCounts.product_view || 0);
      totals.addToCarts += Number(eventCounts.add_to_cart || 0);
      totals.checkoutStarts += Number(eventCounts.checkout_start || 0);
      totals.ordersCreated += Number(eventCounts.order_created || 0);
      Object.entries(day.pages || {}).forEach(([name, count]) => increment(pageTotals, name, count));
      Object.entries(day.sources || {}).forEach(([name, count]) => increment(sourceTotals, name, count));
      Object.entries(day.products || {}).forEach(([name, product]) => {
        if (!productTotals[name]) productTotals[name] = { views: 0, adds: 0 };
        productTotals[name].views += Number(product.views || 0);
        productTotals[name].adds += Number(product.adds || 0);
      });
      daily.push({
        date: key,
        pageViews: Number(day.pageViews || eventCounts.page_view || 0),
        visitors: (day.visitors || []).length,
        orders: Number(eventCounts.order_created || 0),
      });
    }

    totals.uniqueVisitors = visitors.size;
    totals.sessions = sessions.size;

    const ranked = object => Object.entries(object)
      .map(([name, count]) => ({ name, count: Number(count || 0) }))
      .sort((a, b) => b.count - a.count);

    const topProducts = Object.entries(productTotals)
      .map(([label, values]) => {
        const splitAt = label.indexOf('|');
        return {
          sku: splitAt === -1 ? '' : label.slice(0, splitAt),
          name: splitAt === -1 ? label : label.slice(splitAt + 1),
          views: values.views,
          adds: values.adds,
          addRate: values.views ? Math.round((values.adds / values.views) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.views - a.views || b.adds - a.adds)
      .slice(0, 12);

    return {
      trackingStartedAt: data.trackingStartedAt,
      rangeDays: days,
      totals,
      daily,
      topPages: ranked(pageTotals).slice(0, 10),
      topSources: ranked(sourceTotals).slice(0, 10),
      topProducts,
      storagePath: filePath,
    };
  }

  return {
    recordEvent,
    getSummary,
    getStorageInfo: () => ({
      path: filePath,
      persistent: filePath.replace(/\\/g, '/').startsWith('/var/data/'),
    }),
  };
}

const defaultStore = createAnalyticsStore();

module.exports = {
  createAnalyticsStore,
  recordEvent: defaultStore.recordEvent,
  getSummary: defaultStore.getSummary,
  getStorageInfo: defaultStore.getStorageInfo,
};
