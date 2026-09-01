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
  assert.match(html, /id="labelProductSearch"[^>]*type="search"/);
  assert.match(html, /id="labelProductResults"[^>]*role="listbox"/);
  assert.match(html, /id="labelProductName"/);
  assert.match(html, /id="labelDosage"/);
  assert.match(html, /id="labelLotNumber"[^>]*value="314"/);
  assert.match(html, /id="labelExpiryDate"[^>]*value="9\/1\/2027"/);
  assert.match(html, /id="labelStorage"[^>]*value="36–46°F"/);
  assert.match(html, /id="labelQuantity"/);
  assert.match(html, /id="labelQuantity"[^>]*value="1"/);
  assert.match(html, /id="labelStartPosition"/);
  assert.match(html, /id="labelPrintPortal"/);
  assert.match(html, /name="labelDesign" value="vial-current"/);
  assert.match(html, /OL1735WS White Gloss sheets/);
});

test('label sheet matches the OL1735WS 48-up geometry', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*1\.75in\)/);
  assert.match(css, /grid-template-rows:\s*repeat\(12,\s*0\.75in\)/);
  assert.match(css, /column-gap:\s*0\.333in/);
  assert.match(css, /row-gap:\s*0\.136in/);
  assert.match(css, /padding:\s*0\.25in/);
  assert.match(js, /position\s*<=\s*48/);
  assert.match(js, /openLabelPrintWindow/);
  assert.match(js, /Highland Label Print Sheet/);
  assert.match(js, /id="printSheetButton"/);
  assert.match(js, /window\.print\(\)/);
  assert.match(js, /#labelPrintPortal \{ box-sizing: border-box; display: grid !important/);
  assert.match(css, /\.highland-label-dose[\s\S]*?-webkit-text-fill-color:\s*#07563f/);
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
  assert.match(js, /labelProductSearchText/);
  assert.match(js, /labelProductResults/);
  assert.match(js, /selectLabelCatalogProduct/);
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

test('print labels match the current photographed vial hierarchy', () => {
  assert.match(js, /highland-hp-ridge-mark-v1\.png/);
  assert.match(js, /purity\.textContent\s*=\s*'99% PURITY'/);
  assert.match(js, /ruo\.textContent\s*=\s*'RESEARCH USE ONLY'/);
  assert.match(js, /storageTitle\.textContent\s*=\s*'STORE AT'/);
  assert.match(js, /`LOT \$\{String\(lot/);
  assert.match(js, /`EXP \$\{String\(expiry/);
  assert.match(css, /\.label-design-vial-current/);
  assert.match(css, /\.highland-label-divider/);
  assert.match(css, /\.highland-label-accent/);
  assert.match(css, /\.highland-label-footer-dot/);
  assert.match(css, /\.highland-label-side-storage/);
  assert.match(css, /\.highland-label-side-batch/);
  assert.match(css, /\.highland-label-side-storage[\s\S]*?color:\s*#111/);
  assert.match(css, /\.highland-label-side-batch[\s\S]*?color:\s*#111/);
  assert.doesNotMatch(js, /ridge-current-label-base-v2\.png/);
});
