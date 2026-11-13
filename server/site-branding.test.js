const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const logoPath = '/images/branding/snowy-icon-512.png';

test('every page exposes a brand favicon and web manifest', () => {
  const pages = fs.readdirSync(publicDir).filter((name) => name.endsWith('.html'));
  const snowyIcon = '/images/branding/snowy-icon-512.png';

  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    // Every page uses the Snowy icon.
    const icon = html.includes(snowyIcon) ? snowyIcon : logoPath;
    assert.match(html, new RegExp(`<link rel="icon"[^>]+${icon.replaceAll('/', '\\/')}`), `${page} favicon`);
    assert.match(html, /<link rel="apple-touch-icon"/, `${page} Apple icon`);
    assert.match(html, /<link rel="manifest" href="\/site\.webmanifest">/, `${page} manifest`);
  }
});

test('home page is branded Snowy Research with the leopard logo', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.match(html, /<title>Snowy Research<\/title>/);
  assert.match(html, /<meta property="og:site_name" content="Snowy Research">/);
  assert.match(html, /src="\/images\/branding\/snowy-logo\.webp"/);
  assert.ok(fs.existsSync(path.join(publicDir, 'images/branding/snowy-logo.webp')));
  assert.ok(fs.existsSync(path.join(publicDir, 'images/branding/snowy-leopard-bg.webp')));
  assert.doesNotMatch(html, /Highland Peptides/);
});

test('web manifest uses the Snowy Research name and square icon', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'site.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Snowy Research');
  assert.equal(manifest.icons[0].src, '/images/branding/snowy-icon-512.png');
  assert.equal(manifest.icons[0].sizes, '512x512');
  assert.ok(fs.existsSync(path.join(publicDir, manifest.icons[0].src)));
});

test('no customer-facing page, script or email still says Highland', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const pages = fs.readdirSync(publicDir).filter(n => n.endsWith('.html')).map(n => `public/${n}`);
  for (const rel of [...pages, 'public/js/shared.js', 'public/js/cart.js', 'public/js/support.js', 'public/js/product.js',
    'public/js/site-notice.js', 'public/js/account.js', 'server/notifications.js', 'public/site.webmanifest']) {
    assert.doesNotMatch(read(rel), /highland/i, rel);
  }
});
