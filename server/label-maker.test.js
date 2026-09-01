const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');
const rawProducts = JSON.parse(fs.readFileSync(path.join(root, 'data', 'products.json'), 'utf8'));
const { catalog, labelDoseFromSpec, labelNameForProduct } = require('./products');

test('admin includes the protected label maker controls', () => {
  assert.match(html, /data-admin-panel="labels"/);
  assert.match(html, /id="labelCatalogProduct"/);
  assert.match(html, /id="labelProductName"/);
  assert.match(html, /id="labelDosage"/);
  assert.match(html, /id="labelQuantity"/);
  assert.match(html, /id="labelStartPosition"/);
  assert.match(html, /id="labelPrintPortal"/);
  assert.match(html, /name="labelDesign" value="ridge-current"/);
  assert.match(html, /OL1735WS White Gloss sheets/);
});

test('label sheet matches the OL1735WS 48-up geometry', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*1\.75in\)/);
  assert.match(css, /grid-template-rows:\s*repeat\(12,\s*0\.75in\)/);
  assert.match(css, /column-gap:\s*0\.333in/);
  assert.match(css, /row-gap:\s*0\.136in/);
  assert.match(css, /padding:\s*0\.25in/);
  assert.match(js, /position\s*<=\s*48/);
});

test('label maker receives every current storefront SKU and strength', () => {
  assert.equal(catalog.length, rawProducts.length);
  assert.equal(new Set(catalog.map(product => product.sku)).size, rawProducts.length);
  catalog.forEach(product => {
    assert.ok(product.labelName, `${product.sku} is missing a printable label name`);
    assert.ok(product.labelDose, `${product.sku} is missing a printable label strength`);
  });
  assert.match(js, /products\.map\(product\s*=>/);
  assert.match(js, /option\.value\s*=\s*product\.sku/);
  assert.doesNotMatch(js, /new Set\(\(catalogData\.products/);
});

test('storefront specs are converted into production label text', () => {
  assert.equal(labelNameForProduct('MOTS-c'), 'MOTS-C');
  assert.equal(labelNameForProduct('Bacteriostatic Water'), 'BAC WATER');
  assert.equal(labelNameForProduct('BPC-157 + GHK-Cu + TB-500 Blend (Glow)'), 'GLOW BLEND');
  assert.equal(labelDoseFromSpec('40mg x1 vial'), '40 MG');
  assert.equal(labelDoseFromSpec('5mg+5mg x1 vial'), '5 MG + 5 MG');
  assert.equal(labelDoseFromSpec('600mg/ml 50ml'), '600 MG/ML · 50 ML');
});

test('free-form label text is inserted as text, not executable markup', () => {
  assert.match(js, /compound\.textContent\s*=/);
  assert.match(js, /dose\.textContent\s*=/);
});

test('Ridge Current labels include deterministic contour artwork', () => {
  assert.match(js, /ridge-current-label-base-v2\.png/);
  assert.match(css, /\.label-design-ridge-current/);
  assert.match(css, /\.ridge-current-artwork/);
  assert.match(css, /\.label-design-ridge-current \.highland-label-footer[\s\S]*bottom:\s*0\.27in/);
});
