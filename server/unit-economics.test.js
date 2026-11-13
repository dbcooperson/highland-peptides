const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8');

test('unit economics endpoint is admin-only', () => {
  assert.match(index, /app\.get\('\/api\/admin\/unit-economics', requireAdmin,/);
});

test('public product data never exposes supplier cost', () => {
  const { catalog } = require('./products');
  for (const product of catalog) assert.equal(product.cost, undefined, `${product.sku} leaks cost`);
});

test('admin calculator is wired into the dashboard', () => {
  assert.match(admin, /loadProfit\(\);\n  loadUnitEconomics\(\);/);
  assert.match(admin, /function ueOrderProfit/);
});
