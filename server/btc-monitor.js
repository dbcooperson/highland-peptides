const fs = require('fs');
const path = require('path');

const SATOSHIS_PER_BTC = 100_000_000;
const DEFAULT_STATE_PATH = path.join(__dirname, '..', 'data', 'btc-monitor-state.json');
const RENDER_STATE_PATH = '/var/data/btc-monitor-state.json';
const MAX_REMEMBERED_TXIDS_PER_ADDRESS = 500;

function confirmationsFor(tx, tipHeight) {
  const status = tx && tx.status;
  if (!status || !status.confirmed || !Number.isInteger(status.block_height)) return 0;
  if (!Number.isInteger(tipHeight)) return 1;
  return Math.max(1, tipHeight - status.block_height + 1);
}

function incomingSatoshis(tx, address) {
  if (!tx || !Array.isArray(tx.vout)) return 0;
  return tx.vout.reduce((total, output) => {
    if (output && output.scriptpubkey_address === address) {
      return total + Number(output.value || 0);
    }
    return total;
  }, 0);
}

function extractIncomingPayments(transactions, address, tipHeight, minConfirmations) {
  return (Array.isArray(transactions) ? transactions : [])
    .map(tx => ({
      txid: String((tx && tx.txid) || ''),
      satoshis: incomingSatoshis(tx, address),
      confirmations: confirmationsFor(tx, tipHeight),
      confirmed: Boolean(tx && tx.status && tx.status.confirmed),
    }))
    .filter(payment => payment.txid && payment.satoshis > 0 && payment.confirmations >= minConfirmations);
}

function loadState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && parsed.addresses && typeof parsed.addresses === 'object'
      ? parsed
      : { addresses: {} };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('BTC monitor state could not be read:', err.message);
    return { addresses: {} };
  }
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryPath, statePath);
}

function remember(addressState, payment) {
  addressState[payment.txid] = {
    satoshis: payment.satoshis,
    notified_at: new Date().toISOString(),
  };
  const txids = Object.keys(addressState);
  if (txids.length <= MAX_REMEMBERED_TXIDS_PER_ADDRESS) return;
  txids
    .sort((left, right) => String(addressState[left].notified_at).localeCompare(String(addressState[right].notified_at)))
    .slice(0, txids.length - MAX_REMEMBERED_TXIDS_PER_ADDRESS)
    .forEach(txid => delete addressState[txid]);
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Blockchain API returned HTTP ${response.status}`);
  return response.json();
}

async function fetchTipHeight(apiUrl, fetchImpl) {
  const response = await fetchImpl(`${apiUrl}/blocks/tip/height`, {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Blockchain API returned HTTP ${response.status}`);
  const height = Number(await response.text());
  if (!Number.isInteger(height)) throw new Error('Blockchain API returned an invalid tip height.');
  return height;
}

async function postDiscord(webhookUrl, address, payment, explorerUrl, fetchImpl) {
  const btc = (payment.satoshis / SATOSHIS_PER_BTC).toFixed(8);
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      username: 'Bitcoin Payment Monitor',
      allowed_mentions: { parse: [] },
      embeds: [{
        title: 'Bitcoin received',
        color: 0xf7931a,
        fields: [
          { name: 'Amount', value: `**${btc} BTC**\n${payment.satoshis.toLocaleString('en-US')} sats`, inline: true },
          { name: 'Confirmations', value: String(payment.confirmations), inline: true },
          { name: 'Address', value: `\`${address}\`` },
          {
            name: 'Transaction ID (TXID)',
            value: `\`${payment.txid}\`\n[View on mempool.space](${explorerUrl}/tx/${payment.txid})`,
          },
        ],
        timestamp: new Date().toISOString(),
      }],
    }),
  });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}

function createBitcoinMonitor(options) {
  const {
    addresses,
    webhookUrl,
    apiUrl = 'https://mempool.space/api',
    explorerUrl = 'https://mempool.space',
    intervalMs = 60_000,
    minConfirmations = 0,
    alertExisting = false,
    statePath = process.env.DATA_DIR
      ? path.join(process.env.DATA_DIR, 'btc-monitor-state.json')
      : (process.env.RENDER || process.env.RENDER_SERVICE_ID ? RENDER_STATE_PATH : DEFAULT_STATE_PATH),
    fetchImpl = fetch,
  } = options || {};

  const watchedAddresses = [...new Set((addresses || []).map(value => String(value).trim()).filter(Boolean))];
  let timer = null;
  let checking = false;
  const state = loadState(statePath);

  async function check() {
    if (checking) return;
    checking = true;
    try {
      const tipHeight = minConfirmations > 1 ? await fetchTipHeight(apiUrl, fetchImpl) : null;

      for (const address of watchedAddresses) {
        const transactions = await fetchJson(`${apiUrl}/address/${encodeURIComponent(address)}/txs`, fetchImpl);
        const payments = extractIncomingPayments(transactions, address, tipHeight, minConfirmations);
        const isFirstCheck = !Object.prototype.hasOwnProperty.call(state.addresses, address);
        const addressState = state.addresses[address] || {};
        state.addresses[address] = addressState;

        if (isFirstCheck && !alertExisting) {
          payments.forEach(payment => remember(addressState, payment));
          saveState(statePath, state);
          console.log(`BTC monitor baseline saved for ${address} (${payments.length} incoming transaction(s)).`);
          continue;
        }

        for (const payment of payments.slice().reverse()) {
          if (addressState[payment.txid]) continue;
          await postDiscord(webhookUrl, address, payment, explorerUrl, fetchImpl);
          remember(addressState, payment);
          saveState(statePath, state);
          console.log(`BTC payment alert sent: ${payment.txid} (${payment.satoshis} sats).`);
        }
      }
    } catch (err) {
      console.error('BTC monitor check failed:', err.message || err);
    } finally {
      checking = false;
    }
  }

  function start() {
    if (!watchedAddresses.length || !webhookUrl) {
      throw new Error('BTC monitor requires at least one address and a Discord webhook URL.');
    }
    if (timer) return;
    void check();
    timer = setInterval(check, Math.max(15_000, Number(intervalMs) || 60_000));
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, check };
}

module.exports = { createBitcoinMonitor, extractIncomingPayments, incomingSatoshis, confirmationsFor };
