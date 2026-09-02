const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');

test('catalog cards preserve the displayed SKU in product-page links', () => {
  assert.match(appJs, /href="\/product\/\$\{encodeURIComponent\(p\.slug\)\}\?sku=\$\{encodeURIComponent\(p\.sku\)\}"/);
});

test('narrow-phone navigation controls keep accessible tap targets', () => {
  assert.match(styleCss, /@media \(max-width: 520px\)[\s\S]*\.nav-search-button[\s\S]*min-width: 44px;[\s\S]*min-height: 44px;/);
  assert.match(styleCss, /@media \(max-width: 360px\)[\s\S]*\.topbar > \.brand[\s\S]*font-size: 0;/);
});
