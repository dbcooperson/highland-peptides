const fs = require('fs');
const path = require('path');

const COA_PATH = path.join(__dirname, '..', 'data', 'coa.json');

function loadRecords() {
  try {
    const payload = JSON.parse(fs.readFileSync(COA_PATH, 'utf8'));
    return Array.isArray(payload.records) ? payload.records : [];
  } catch {
    return [];
  }
}

function cleanRecord(record) {
  if (!record || !record.sku || !record.file) return null;
  return {
    sku: String(record.sku).trim(),
    lot: String(record.lot || '').trim(),
    lab: String(record.lab || '').trim(),
    testedAt: String(record.testedAt || '').trim(),
    purity: String(record.purity || '').trim(),
    result: String(record.result || '').trim(),
    file: String(record.file).trim(),
  };
}

function recordsForSkus(skus) {
  const wanted = new Set((skus || []).map(String));
  const bySku = {};
  loadRecords().map(cleanRecord).filter(Boolean).forEach(record => {
    if (wanted.has(record.sku)) bySku[record.sku] = record;
  });
  return bySku;
}

module.exports = { recordsForSkus };
