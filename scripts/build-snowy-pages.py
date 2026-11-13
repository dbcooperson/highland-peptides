#!/usr/bin/env python3
"""Rebuild the customer pages on the shared Snowy Research page frame.

Each page keeps its own <main> content and scripts; this script supplies the
common <head>, entry gate, RUO strip, navigation and footer so every page
matches the homepage. Re-run after editing the frame below:
    python3 scripts/build-snowy-pages.py
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'public'
V = 'snowy-20261110o'

def head(title, description, extra_css=''):
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="{description}">
<title>{title}</title>
<link rel="icon" type="image/png" href="/images/branding/snowy-icon-512.png">
<link rel="apple-touch-icon" href="/images/branding/snowy-icon-512.png">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:site_name" content="Snowy Research">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css?v={V}">
<link rel="stylesheet" href="/css/snowy.css?v=inbox-20261112b">
<link rel="stylesheet" href="/css/snowy-pages.css?v=frost-20261112">{extra_css}
</head>'''

GATE = '''<div id="entryGate" class="entry-gate">
  <div class="entry-gate-box">
    <div class="brand">Snowy Research</div>
    <h2>Research Use Only</h2>
    <p>This site sells laboratory research compounds. They are not drugs, foods, cosmetics, or dietary supplements, and are not for human or veterinary use. By entering, you certify that:</p>
    <ul>
      <li>You are 21 years of age or older.</li>
      <li>You are an independent research company or an independent researcher, purchasing solely for laboratory / research purposes.</li>
      <li>You are NOT using these products for human consumption, injection, or administration of any kind.</li>
    </ul>
    <div class="entry-gate-actions">
      <button id="entryAgreeBtn">I certify &amp; enter</button>
      <button id="entryExitBtn" class="secondary">Exit</button>
    </div>
  </div>
</div>'''

def nav(active):
    def link(href, label, key):
        cls = ' class="active"' if key == active else ''
        return f'<a href="{href}"{cls}>{label}</a>'
    return f'''  <div class="ruo-strip">For laboratory and research use only · Not for human or veterinary use · Not a drug, food, or cosmetic</div>

  <div class="nav-wrap">
    <header class="topbar">
      <a class="brand" href="/">Snowy</a>
      <nav class="site-nav">
        {link('/index.html#catalogSection', 'Shop', 'shop')}
        {link('/about.html', 'About', 'about')}
        {link('/support.html', 'Support', 'support')}
      </nav>
      <div class="header-actions">
        <button id="openProductSearch" class="nav-search-button" type="button" aria-label="Search products">
          <span class="nav-search-icon" aria-hidden="true"></span>
        </button>
        <nav class="cart-nav">
          <a href="/cart.html" class="cart-link" aria-label="View cart">
            <span class="cart-icon" aria-hidden="true"></span>
            <span class="cart-label">Cart</span>
            <span id="cartCount" class="cart-count" aria-label="0 items">0</span>
          </a>
        </nav>
      </div>
    </header>
  </div>'''

FOOTER = '''  <footer class="sn-footer">
    <div class="sn-footer-top">
      <div class="sn-footer-brand">
        <div class="sn-footer-wordmark">Snowy</div>
        <p>Research-grade peptides, tested and shipped fast. All products sold as laboratory research materials only. Not evaluated by the FDA.</p>
      </div>
      <div class="sn-footer-col">
        <h4>Shop</h4>
        <a href="/index.html#catalogSection">All compounds</a>
        <a href="/index.html#bestSellers">Most popular</a>
        <a href="/cart.html">Cart</a>
      </div>
      <div class="sn-footer-col">
        <h4>Account</h4>
        <a href="/account.html">Sign in</a>
        <a href="/account.html">Orders</a>
      </div>
      <div class="sn-footer-col">
        <h4>Help</h4>
        <a href="/support.html">Support</a>
        <a href="/about.html">About</a>
        <a href="/terms-of-sale.html">Terms of sale</a>
      </div>
    </div>
    <div class="sn-footer-bottom">
      <span>© 2026 Snowy Research. All products for laboratory research only.</span>
      <div class="sn-pay">Card · Crypto</div>
    </div>
  </footer>'''

def page(file, title, description, active, body_class, main, scripts):
    html = f'''{head(title, description)}
<body class="snowy {body_class}">

<div class="leopard-layer" aria-hidden="true"></div>

{GATE}

<div class="site-wrap">

{nav(active)}

{main.strip()}

{FOOTER}
</div>

{scripts.strip()}
</body>
</html>
'''
    (ROOT / file).write_text(html, encoding='utf-8')
    print('built', file)

def keep(file, start_pat, end_pat):
    s = (ROOT / file).read_text(encoding='utf-8')
    m = re.search(start_pat + r'.*?' + end_pat, s, re.S)
    if not m:
        raise SystemExit(f'{file}: could not find {start_pat}')
    return m.group(0)

# ---------------------------------------------------------------- product
page('product.html', 'Snowy Research',
     'Research-use-only product details from Snowy Research: vial sizes, batch reports and same-day U.S. dispatch.',
     'shop', 'sn-product-page', '''
  <main class="sn-page sn-product">
    <nav id="breadcrumb" class="sn-breadcrumb" aria-label="Breadcrumb"></nav>
    <section id="productSection">
      <div id="productContent"><p class="sn-loading">Loading…</p></div>
      <div class="product-info-panel">
        <h4>Research handling notes</h4>
        <ul class="hint">
          <li>For laboratory and analytical research use only.</li>
          <li>Not intended for human use.</li>
          <li>Handle only in a controlled research environment by qualified personnel.</li>
          <li>Use the posted batch report when documentation is available for the selected product.</li>
        </ul>
      </div>
    </section>
  </main>''', f'''
<script src="/js/shipping-countdown.js?v={V}"></script>
<script src="/js/shared.js?v={V}"></script>
<script src="/js/product.js?v={V}"></script>
<script src="/js/site-notice.js?v={V}"></script>''')

# ---------------------------------------------------------------- about
page('about.html', 'About - Snowy Research',
     'Learn about Snowy Research, a research-use-only supplier with clear catalog standards, published batch reports, and same-day California fulfillment.',
     'about', 'sn-info-page', '''
  <main class="sn-page sn-info">
    <header class="sn-info-hero">
      <span class="sn-kicker">About Snowy Research</span>
      <h1>Clean research supply, shipped the same day.</h1>
      <p>Snowy Research is a research-use-only supplier built around clear catalog standards, published batch reports, and fast, careful fulfillment.</p>
    </header>
    <div class="sn-info-grid">
      <article class="sn-info-card">
        <span>01</span>
        <h2>What we do</h2>
        <p>We supply laboratory research compounds to independent researchers and research companies. Products are listed for research use only and are not sold as drugs, foods, cosmetics, supplements, or items for human or veterinary administration.</p>
      </article>
      <article class="sn-info-card">
        <span>02</span>
        <h2>Catalog standards</h2>
        <p>Every listing is built around clear product identity and research documentation. COA documentation is available on request for current lots, and research-use language appears at entry, on every product, and at checkout so the intended use stays unambiguous.</p>
      </article>
      <article class="sn-info-card">
        <span>03</span>
        <h2>Fulfillment</h2>
        <p>Orders ship from California. Orders confirmed before 5 PM PT on a business day ship the same day, and tracking is emailed as soon as your package is on its way.</p>
      </article>
      <article class="sn-info-card">
        <span>04</span>
        <h2>Our goal</h2>
        <p>Snowy Research is built around one clear goal: offering some of the most affordable high-quality research products in the United States, without compromising clear labeling, dependable documentation, or fast professional fulfillment.</p>
      </article>
    </div>
    <section class="sn-info-cta">
      <div>
        <h2>Our 30-day guarantee</h2>
        <p>If you do not receive your order within 30 days, we will give you your entire order for free, on us.</p>
      </div>
      <a href="/index.html#catalogSection" class="sn-btn-primary">Browse the catalog</a>
    </section>
  </main>''', f'''
<script src="/js/shared.js?v={V}"></script>
<script src="/js/site-notice.js?v={V}"></script>''')

# ---------------------------------------------------------------- support
page('support.html', 'Support - Snowy Research',
     'Contact Snowy Research support for research-use-only order, catalog, and COA questions.',
     'support', 'sn-info-page', '''
  <main class="sn-page sn-support">
    <div class="sn-support-grid">
      <div class="sn-support-intro">
        <span class="sn-kicker">Snowy Research Support</span>
        <h1>How can we help?</h1>
        <p>Email us about order status, COA requests, payments, catalog questions, or anything else research-related.</p>
        <div class="sn-support-cards">
          <div class="sn-support-card">
            <strong>Email</strong>
            <a href="mailto:support@snowyresearch.com">support@snowyresearch.com</a>
            <span>Typical response: within 1 business day.</span>
          </div>
          <div class="sn-support-card">
            <strong>30-day guarantee</strong>
            <span>If you do not receive your order within 30 days, we will give you your entire order for free, on us. Email us your order number and we'll take care of it.</span>
          </div>
        </div>
        <p class="sn-support-note">Please do not describe human use, dosing, injection, administration, or medical outcomes. Snowy Research products are for laboratory research use only.</p>
      </div>
      <form id="supportForm" class="sn-support-form">
        <h2>Send us a message</h2>
        <div class="sn-form-row">
          <label>Your name <input type="text" id="supportName" required></label>
          <label>Your email <input type="email" id="supportEmail" required></label>
        </div>
        <div class="sn-form-row">
          <label>Order number <span>optional</span> <input type="text" id="supportOrder" placeholder="Example: SR-1042"></label>
          <label>Topic
            <select id="supportTopic">
              <option>Order question</option>
              <option>Payment question</option>
              <option>COA request</option>
              <option>Catalog question</option>
              <option>Other support</option>
            </select>
          </label>
        </div>
        <label>Message <textarea id="supportMessage" rows="6" required placeholder="Tell us how we can help."></textarea></label>
        <button type="submit" class="sn-btn-primary">Open email draft</button>
        <p class="form-msg" id="supportMsg"></p>
      </form>
    </div>
  </main>''', f'''
<script src="/js/shared.js?v={V}"></script>
<script src="/js/support.js?v={V}"></script>
<script src="/js/site-notice.js?v={V}"></script>''')

# ---------------------------------------------------------------- terms
page('terms-of-sale.html', 'Terms of Sale - Snowy Research',
     'Snowy Research terms of sale and 30-day delivery guarantee.',
     '', 'sn-info-page', '''
  <main class="sn-page sn-terms">
    <span class="sn-kicker">Legal</span>
    <h1>Terms of Sale</h1>
    <div class="sn-terms-body">
      <p>By purchasing, you confirm that you are 21 or older and a qualified researcher or authorized entity purchasing solely for lawful laboratory research. You assume responsibility for proper handling, storage, and lawful use of the products after delivery.</p>
      <p>Products are not for human or animal consumption, injection, administration, diagnosis, treatment, cure, or prevention of disease. They are not sold as medicines, foods, cosmetics, or medical devices.</p>
      <p><strong>Returns and refunds:</strong> Except for the delivery guarantee below and any rights required by applicable law, completed sales are final.</p>
      <p><strong>Delivery guarantee:</strong> If you do not receive your paid order within 30 days of placing it, Snowy Research will give you your entire order for free, on us. Email <a href="mailto:support@snowyresearch.com">support@snowyresearch.com</a> with your order number to claim it.</p>
      <p>Email-code verification confirms access to an email address; it does not independently establish research qualifications.</p>
    </div>
  </main>''', f'''
<script src="/js/shared.js?v={V}"></script>
<script src="/js/site-notice.js?v={V}"></script>''')

# ---------------------------------------------------------------- order confirmation
page('success.html', 'Order confirmed - Snowy Research',
     'Snowy Research order confirmation for research-use-only orders.',
     '', 'sn-info-page', '''
  <main class="sn-page sn-success">
    <section class="success-card">
      <div class="sn-success-check" aria-hidden="true"></div>
      <div class="success-eyebrow">Payment successful</div>
      <h1>Your order is confirmed.</h1>
      <p class="success-lede">Thank you for your research-use-only order with Snowy Research.</p>
      <div id="successOrderNumber" class="success-order-number" hidden></div>
      <div class="success-next-steps">
        <div>
          <strong>What happens next?</strong>
          <span>Orders confirmed before 5 PM PT on a business day ship the same day. We'll email your tracking number as soon as it's on its way.</span>
        </div>
        <div>
          <strong>Need help?</strong>
          <span>Email <a href="mailto:support@snowyresearch.com">support@snowyresearch.com</a> with your order number.</span>
        </div>
      </div>
      <div class="success-actions">
        <a href="/index.html#catalogSection" class="sn-btn-primary">Continue shopping</a>
        <a href="/support.html" class="sn-btn-ghost">Contact support</a>
      </div>
      <p class="success-ruo-note">Products are sold strictly for laboratory research use only. Not for human or veterinary consumption, administration, diagnostic use, or injection.</p>
    </section>
  </main>''', f'''
<script src="/js/shared.js?v={V}"></script>
<script>
  const query = new URLSearchParams(window.location.search);
  const order = query.get('order');
  const target = document.getElementById('successOrderNumber');
  if (query.has('stripe_session_id')) {{
    const live = query.get('stripe_mode') === 'live';
    document.querySelector('.success-eyebrow').textContent = live ? 'Stripe checkout returned' : 'Stripe sandbox checkout returned';
    document.querySelector('.success-card h1').textContent = live ? 'We’re confirming your payment.' : 'Test payment is being verified.';
    document.querySelector('.success-lede').textContent = live
      ? 'Your order is not marked paid until Stripe confirms it. Please keep your order number and don’t pay again while confirmation is pending.'
      : 'This was a test-mode checkout. No real money was charged or order fulfilled. The signed webhook determines payment status.';
  }}
  if (/^\\d{{1,10}}$/.test(order || '') && target) {{
    target.hidden = false;
    target.textContent = `Order SR-${{order}}`;
  }}
</script>
<script src="/js/site-notice.js?v={V}"></script>''')

# ---------------------------------------------------------------- account (content kept as-is)
account_main = keep('account.html', r'<main class="account-main">', r'</main>')
account_main = account_main.replace('<main class="account-main">', '<main class="sn-page account-main">', 1)
page('account.html', 'Account - Snowy Research',
     'Optional Snowy Research customer account with order tracking, order history, and member crypto savings.',
     '', 'sn-account-page', account_main, f'''
<script src="/js/shared.js?v={V}"></script>
<script src="/js/account.js?v={V}"></script>
<script src="/js/site-notice.js?v={V}"></script>''')
