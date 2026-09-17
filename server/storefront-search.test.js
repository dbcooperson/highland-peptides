const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { catalog } = require('./products');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shared.js'), 'utf8');
const start = source.indexOf('const SEARCH_ALIASES =');
const end = source.indexOf('// ---------- Shared product search', start);
assert.ok(start >= 0 && end > start);
const context = {};
vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.searchableValues = searchableValues;`, context);

function matches(query) {
  return catalog.filter(product => context.searchableValues(product).some(value => value.includes(query.toLowerCase())));
}

test('scientific names and brand codes find the same research products', () => {
  for (const [query, compound] of [
    ['retatrutide', 'Retatrutide'], ['hp-3rt', 'Retatrutide'],
    ['tirzepatide', 'Tirzepatide'], ['hp-trz', 'Tirzepatide'],
    ['tesamorelin', 'Tesamorelin'], ['hp-tsm', 'Tesamorelin'],
    ['ss-31', 'SS-31'], ['hp-31', 'SS-31'],
  ]) {
    assert.ok(matches(query).some(product => product.compoundName === compound), query);
  }
});

test('bac water and sterile water both find the disclosed bacteriostatic listing', () => {
  for (const query of ['bac water', 'bacteriostatic water', 'sterile water']) {
    assert.ok(matches(query).some(product => product.sku === 'WA100'), query);
  }
});
