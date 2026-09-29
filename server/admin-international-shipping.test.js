const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adminSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'admin.js'), 'utf8');

test('admin order log identifies international shipping included in the customer total', () => {
  assert.match(adminSource, /shipping_method[^\n]+international/);
  assert.match(adminSource, /International shipping included/);
  assert.match(adminSource, /International shipping paid/);
  assert.match(adminSource, /admin-international-shipping/);
});
