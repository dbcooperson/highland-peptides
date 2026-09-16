const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const logoPath = '/images/branding/highland-social-avatar-v1.png';

test('every page exposes the Highland favicon and web manifest', () => {
  const pages = fs.readdirSync(publicDir).filter((name) => name.endsWith('.html'));

  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    assert.match(html, new RegExp(`<link rel="icon"[^>]+${logoPath.replaceAll('/', '\\/')}`), `${page} favicon`);
    assert.match(html, /<link rel="apple-touch-icon"/, `${page} Apple icon`);
    assert.match(html, /<link rel="manifest" href="\/site\.webmanifest">/, `${page} manifest`);
  }
});

test('home page identifies the Highland logo for search engines', () => {
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'Organization structured data should exist');

  const organization = JSON.parse(match[1]);
  assert.equal(organization['@type'], 'OnlineStore');
  assert.equal(organization.name, 'Highland Peptides');
  assert.equal(organization.logo.width, organization.logo.height);
  assert.match(organization.logo.url, /highland-social-avatar-v1\.png$/);
});

test('web manifest uses the same stable square Highland icon', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'site.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Highland Peptides');
  assert.equal(manifest.icons[0].src, logoPath);
  assert.equal(manifest.icons[0].sizes, '1254x1254');
  assert.ok(fs.existsSync(path.join(publicDir, logoPath)));
});
