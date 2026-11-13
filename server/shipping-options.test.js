const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const root = path.join(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
const sharedSource = fs.readFileSync(path.join(root, 'public', 'js', 'shared.js'), 'utf8');
const cartHtml = fs.readFileSync(path.join(root, 'public', 'cart.html'), 'utf8');

test('U.S. shipping is a flat $11.99 and Priority Mail is $19.99', () => {
  assert.equal(config.SHIPPING_FEE, 11.99);
  assert.equal(config.PRIORITY_SHIPPING_FEE, 19.99);
  assert.match(cartHtml, /value="domestic"[\s\S]*?\$11\.99/);
  assert.match(cartHtml, /value="priority"[\s\S]*?\$19\.99/);
  assert.doesNotMatch(cartHtml, /10\.27/);
});

test('Priority Mail is charged its own price and is U.S. only, on the server and in the browser', () => {
  assert.match(indexSource, /normalizedShippingMethod === 'priority' \? config\.PRIORITY_SHIPPING_FEE/);
  assert.match(indexSource, /normalizedShippingMethod === 'priority' && cleanBuyer\.country !== 'US'/);
  assert.match(sharedSource, /payload\.shippingMethod === 'priority' && payload\.buyer\.country !== 'US'/);
  assert.match(sharedSource, /method === 'priority'\) return Number\(fees\.priorityShippingFee/);
});
