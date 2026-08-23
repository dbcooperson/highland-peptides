# Highland Peptides — Site Starter

A working storefront for a B2B research-chemical business: catalog, verified-account
signup, manual approval (no guest checkout), order placement, and packing-slip / label
PDF generation. Payment processing is intentionally stubbed — orders land as
"pending_payment" so you can wire in a real processor once you've picked one.

## What's actually built and tested

- Product catalog (`data/products.json`) — flagged prescription-drug items excluded, see `legal/EXCLUDED_ITEMS.md`
- Sale price = your cost x 1.5, plus a flat packaging fee — both configurable in `server/config.js`
- Entry gate on page load: visitor confirms 21+ and research-use intent before seeing the catalog (localStorage-remembered, so returning visitors aren't re-prompted)
- Signup requires a company/account name, email (personal email providers like Gmail are currently accepted — this was previously blocked; see note below), and a checked, logged acceptance of the Research Use Only Terms shown on the signup form
- New accounts are `pending` until you manually approve them in `/admin.html` — there is no guest checkout and no way to buy without an approved account
- Order placement (approved accounts only) computes totals from the live catalog
- Admin dashboard: review/approve accounts, view orders, change order status, download a **packing slip PDF** (full order contents, letter size, for your regular printer) and a **4x6 contents label PDF** (sized for the Nimbot B1 or any 4x6 label printer)

## Before you launch — things that still need real values

1. **Supplier costs.** `data/products.json` currently has placeholder cost figures. Replace `cost` for each SKU with what you're actually paying your COA-verified supplier.
2. **Packaging fee.** `server/config.js` → `PACKAGING_FEE` is a $1.50 placeholder. Update it to your real per-order ink + bag cost.
3. **Admin password & session secret.** Set `ADMIN_PASSWORD_SHA256` (preferred) or `ADMIN_PASSWORD`, plus `SESSION_SECRET`, before deploying — do not leave the defaults in `config.js`.
4. **Payment.** No processor is wired in. Checkout currently just records the order as pending. Once you've set up a business entity + a processor that allows this product category, this is the next thing to build.
5. **Legal review.** `legal/RUO_Disclaimer_DRAFT.docx` is a first-draft disclaimer, not legal advice. Have an attorney review and finalize it, and confirm your final product list, before this goes live.

## Running it locally

```
npm install
node server/index.js
```

Then open `http://localhost:3000` for the storefront and `http://localhost:3000/admin.html` for the admin dashboard (password is whatever `ADMIN_PASSWORD` is set to; defaults to `change-me-before-launch`).

## Deploying it

This is a plain Node/Express app with no native dependencies, so it runs on most
Node hosts. Reasonable low-effort options: Render, Railway, or a small VPS.
Steps are the same everywhere:

1. Push this folder to a GitHub repo (or upload directly if the host supports it).
2. Set environment variables: `ADMIN_PASSWORD_SHA256`, `SESSION_SECRET`, `SITE_NAME`. Use `ADMIN_PASSWORD` only for local testing if needed.
3. Start command: `npm install && node server/index.js`.
4. Point your domain's DNS at the host once you've registered one.
5. Data is stored in `data/db.json` on disk — make sure your host's disk persists between deploys (Render/Railway both support this with a persistent disk/volume; without one, orders would reset on redeploy).

## Printer / label workflow

- **Packing slip** (`/api/admin/orders/:id/packing-slip.pdf`) — full-page list of exactly what was ordered and the quantities, for your regular printer, so you know what to pull and pack.
- **Contents label** (`/api/admin/orders/:id/contents-label.pdf`) — compact 4x6 version of the same info, sized for the Nimbot B1. Ship-to address isn't included; use your existing address-label workflow alongside this one, or let me know if you want the two merged into one label.
- Neither of these auto-prints to a physical printer by itself — that last step (browser print dialog, or a print-relay tool like PrintNode if you want it to fire without you sitting at the machine) still needs to be connected on your end.

## Folder structure

```
server/       Express app, routes, product/pricing logic, PDF generation
public/       Storefront + admin frontend (plain HTML/CSS/JS)
data/         products.json (catalog) + db.json (accounts/orders, created on first run)
legal/        Draft RUO disclaimer for attorney review
```

## Permanent order storage on Render

Orders are written to a JSON database file. On Render, the app now defaults to:

```txt
/var/data/db.json
```

To make orders survive deploys/restarts, add a **Render Persistent Disk** to the web service:

1. Open the Highland Peptides service in Render.
2. Go to **Disks**.
3. Add a persistent disk.
4. Set the mount path to:

```txt
/var/data
```

5. Redeploy the service.
6. Open `/admin.html` and check the storage banner. It should say the persistent Render path is active.

Optional override environment variables:

```txt
ORDER_DB_PATH=/var/data/db.json
```

or:

```txt
DATA_DIR=/var/data
```

If an old `data/db.json` exists when this new code first runs, the app copies it into the persistent path automatically.

## Order backups: email and Discord

Paid orders can be backed up outside the website database. This is strongly recommended.

### Discord order bot / webhook

Create a Discord webhook in the channel where you want order alerts, then add this Render environment variable:

```txt
DISCORD_ORDER_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

When PayPal captures an order, or when you manually mark an order as paid/fulfilled in admin, the site will post the order details to Discord.

### Email order backup

To email yourself a copy of every paid order, configure SMTP in Render:

```txt
ORDER_BACKUP_EMAIL_TO=support@highlandpeptides.com
ORDER_BACKUP_EMAIL_FROM=support@highlandpeptides.com
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-login
SMTP_PASS=your-smtp-password
```

If you use a provider that requires SSL on port 465, set:

```txt
SMTP_PORT=465
SMTP_SECURE=true
```

Backups are sent after payment capture. They are also sent if an admin manually changes an order to paid or fulfilled.

### Customer payment reminders and tracking email

The same SMTP connection powers customer-facing email. Set a verified Highland sender address in Render:

```txt
CUSTOMER_EMAIL_FROM=Highland Peptides <support@highlandpeptides.com>
PAYMENT_REMINDERS_ENABLED=true
PAYMENT_REMINDER_FIRST_HOURS=12
PAYMENT_REMINDER_REPEAT_HOURS=24
PAYMENT_REMINDER_MAX=2
PAYMENT_REMINDER_POLL_MINUTES=30
```

New PayPal/crypto orders created after this feature is deployed receive at most two reminders: the first after 12 hours and the second 24 hours later. Historical pending orders are deliberately excluded to prevent a surprise backlog email blast. Sent timestamps are saved with the order so a restart does not reset the reminder count.

For paid orders, the admin dashboard includes a carrier dropdown and tracking-number field. Clicking **Send tracking email** emails the buyer from the configured Highland sender and marks the order fulfilled. Your SMTP provider must authorize `support@highlandpeptides.com` as a sender; Cloudflare Email Routing by itself only handles incoming mail.

## Current-lot COAs

COA screenshots or PDFs belong in `public/coa/`. Add one record per vial to `data/coa.json`:

```json
{
  "records": [
    {
      "sku": "RT20",
      "lot": "LOT-EXAMPLE",
      "lab": "Testing laboratory",
      "testedAt": "2026-08-21",
      "purity": "99.4%",
      "result": "20.8mg measured quantity",
      "file": "/coa/retatrutide-20mg-lot-example.pdf"
    }
  ]
}
```

When a purity result exists, its product page shows a **View Certificate of Analysis** button. Quantity- or identity-only reports are labeled **View Laboratory Report** instead. Without a record, the same location becomes a prefilled COA request link so the site never points to a missing document.

## Bitcoin deposit alerts in Discord

The server can poll the public mempool.space API and post a Discord message whenever a watched Bitcoin address receives a new transaction. It stores notified transaction IDs on the persistent data disk, so restarts do not create duplicate alerts.

Configure these environment variables:

```txt
BTC_MONITOR_ENABLED=true
BTC_MONITOR_ADDRESSES=bc1q...your-address
DISCORD_BTC_WEBHOOK_URL=https://discord.com/api/webhooks/...
BTC_MONITOR_MIN_CONFIRMATIONS=0
BTC_MONITOR_POLL_INTERVAL_MS=60000
```

`BTC_MONITOR_ADDRESSES` accepts a comma-separated list. If it is omitted, `CRYPTO_BTC_ADDRESS` is watched. If `DISCORD_BTC_WEBHOOK_URL` is omitted, the existing `DISCORD_ORDER_WEBHOOK_URL` is used. A minimum confirmation count of `0` alerts when a transaction first enters the mempool; use `1` or more to wait for mining confirmations. The minimum polling interval is 15 seconds.

On its first run, the monitor records the address's current transactions without alerting, preventing a flood of old deposits. Set `BTC_MONITOR_ALERT_EXISTING=true` only if you intentionally want the latest existing deposits announced. The state file is `data/btc-monitor-state.json` locally or `${DATA_DIR}/btc-monitor-state.json` on a persistent deployment disk.
