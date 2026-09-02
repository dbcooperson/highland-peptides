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
  assert.match(html, /id="labelOffsetX"[^>]*value="-3"/);
  assert.match(html, /id="labelOffsetY"[^>]*value="-3"/);
  assert.match(html, /id="labelPitchX"[^>]*value="2\.3"/);
  assert.match(html, /id="labelPitchY"[^>]*value="1"/);
  assert.match(html, /id="labelQuantity"/);
  assert.match(html, /id="labelQuantity"[^>]*value="1"/);
  assert.match(html, /id="labelSheetRow"/);
  assert.match(html, /id="labelSheetColumn"/);
  assert.doesNotMatch(html, /id="labelStartPosition"/);
  assert.match(html, /id="labelPrintPortal"/);
  assert.match(html, /name="labelDesign" value="vial-current"/);
  assert.match(html, /OL1735WS White Gloss sheets/);
});

test('label sheet matches the OL1735WS 48-up geometry', () => {
  assert.match(js, /marginX:\s*6\.35/);
  assert.match(js, /marginY:\s*6\.35/);
  assert.match(js, /pitchX:\s*52\.9082/);
  assert.match(js, /pitchY:\s*22\.5044/);
  assert.match(js, /positionLabelPrintCell/);
  assert.match(js, /columnIndex \* \(LABEL_SHEET_GEOMETRY_MM\.pitchX \+ values\.pitchX\)/);
  assert.match(js, /rowIndex \* \(LABEL_SHEET_GEOMETRY_MM\.pitchY \+ values\.pitchY\)/);
  assert.match(js, /position\s*<=\s*48/);
  assert.match(js, /labelPositionFromRowAndColumn/);
  assert.match(js, /\(\(row - 1\) \* 4\) \+ column/);
  assert.match(js, /highland-label-next-position-v1/);
  assert.match(js, /highland-label-position-used/);
  assert.match(js, /openLabelPrintWindow/);
  assert.match(js, /Highland Label Print Sheet/);
  assert.match(js, /left:\s*\$\{values\.offsetX\}mm/);
  assert.match(js, /top:\s*\$\{values\.offsetY\}mm/);
  assert.match(js, /highland-label-calibration-v5/);
  assert.match(js, /id="printSheetButton"/);
  assert.match(js, /window\.print\(\)/);
  assert.match(js, /display: block !important/);
  assert.match(js, /\.label-print-cell \{ position: absolute/);
  assert.match(css, /\.highland-label-dose[\s\S]*?-webkit-text-fill-color:\s*#07563f/);
});

test('paid orders can print all vial labels into consecutive unused positions', () => {
  assert.match(html, /id="paidLabelOrderQueue"/);
  assert.match(html, /id="refreshPaidLabelOrders"/);
  assert.match(js, /class="admin-print-order-labels"/);
  assert.match(js, /order\.status === 'paid'/);
  assert.match(js, /PAID_LABEL_QUEUE_WINDOW_MS\s*=\s*3\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(js, /isRecentPaidLabelOrder\(order\)/);
  assert.match(js, /paidAt\s*>=\s*now\s*-\s*PAID_LABEL_QUEUE_WINDOW_MS/);
  assert.match(html, /Only the last 72 hours of paid orders appear here/);
  assert.match(js, /renderPaidOrderLabelQueue/);
  assert.match(js, /\.filter\(order => order\.status === 'paid'[\s\S]*?isRecentPaidLabelOrder\(order\)[\s\S]*?!hiddenPaidLabelOrderIds\.has\(String\(order\.id\)\)\)/);
  assert.match(js, /paid_at \|\| b\.created_at/);
  assert.match(js, /paid-label-customer-button/);
  assert.match(js, /highland-order-labels-printed/);
  assert.match(js, /printedPaidOrderIds\.add/);
  assert.match(js, /paid-label-pending-button/);
  assert.match(js, /paid-label-inline-confirm/);
  assert.match(html, /id="restoreRemovedLabelOrders"/);
  assert.match(js, /paid-label-remove-button/);
  assert.match(js, /paid-label-inline-confirm is-remove/);
  assert.match(js, /confirmRemoveLabelOrder/);
  assert.match(js, /paid-label-confirm-remove/);
  assert.match(js, /highland-label-hidden-orders-v1/);
  assert.match(js, /The paid transaction stays in Orders and profit totals\. You can restore this card later\./);
  assert.doesNotMatch(js, /confirmRemoveLabelOrder[\s\S]*?method: 'DELETE'/);
  assert.match(js, /confirmOrderPendingTracking/);
  assert.match(js, /status: 'pending_tracking'/);
  assert.match(html, /It stays in this list until you separately confirm Pending tracking/);
  assert.match(js, /window\.addEventListener\('afterprint', notifyPrintComplete\)/);
  assert.match(js, /window\.setTimeout\(startOrderPrint, 250\)/);
  assert.match(js, /renderOrdersTable\(\);\s*renderPaidOrderLabelQueue\(\);/);
  assert.match(js, /buildOrderLabelValues/);
  assert.match(js, /labelCatalogProducts\.find\(product => String\(product\.sku\) === String\(item\.sku\)\)/);
  assert.match(js, /count < quantity; count \+= 1/);
  assert.match(js, /labels\[labelIndex\]/);
  assert.match(js, /quantity:\s*labels\.length/);
  assert.match(js, /const available = 49 - values\.start/);
  assert.match(js, /openLabelPrintWindow\(values, printWindow\)/);
  assert.match(css, /\.admin-print-order-labels/);
  assert.match(css, /\.paid-label-order-list/);
  assert.match(css, /\.paid-label-customer-button/);
  assert.match(css, /\.paid-label-remove-button/);
  assert.match(css, /\.paid-label-inline-confirm\.is-remove/);
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
