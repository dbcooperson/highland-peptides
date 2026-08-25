const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public', 'js', 'admin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');

test('admin includes the protected label maker controls', () => {
  assert.match(html, /data-admin-panel="labels"/);
  assert.match(html, /id="labelProductName"/);
  assert.match(html, /id="labelDosage"/);
  assert.match(html, /id="labelQuantity"/);
  assert.match(html, /id="labelStartPosition"/);
  assert.match(html, /id="labelPrintPortal"/);
});

test('label sheet matches the OL1735WG 48-up geometry', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*1\.75in\)/);
  assert.match(css, /grid-template-rows:\s*repeat\(12,\s*0\.75in\)/);
  assert.match(css, /column-gap:\s*0\.333in/);
  assert.match(css, /row-gap:\s*0\.136in/);
  assert.match(css, /padding:\s*0\.25in/);
  assert.match(js, /position\s*<=\s*48/);
});

test('free-form label text is inserted as text, not executable markup', () => {
  assert.match(js, /compound\.textContent\s*=/);
  assert.match(js, /dose\.textContent\s*=/);
});
