const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createBitcoinMonitor, extractIncomingPayments, confirmationsFor } = require('./btc-monitor');

test('sums only outputs received by the watched address', () => {
  const transactions = [{
    txid: 'abc123',
    status: { confirmed: false },
    vout: [
      { scriptpubkey_address: 'watched', value: 25_000 },
      { scriptpubkey_address: 'change', value: 10_000 },
      { scriptpubkey_address: 'watched', value: 5_000 },
    ],
  }];

  assert.deepEqual(extractIncomingPayments(transactions, 'watched', null, 0), [{
    txid: 'abc123',
    satoshis: 30_000,
    confirmations: 0,
    confirmed: false,
  }]);
});

test('waits for the configured number of confirmations', () => {
  const tx = { status: { confirmed: true, block_height: 100 } };
  assert.equal(confirmationsFor(tx, 102), 3);
  assert.equal(confirmationsFor({ status: { confirmed: false } }, 102), 0);

  const transactions = [{ txid: 'confirmed', status: tx.status, vout: [{ scriptpubkey_address: 'watched', value: 1 }] }];
  assert.equal(extractIncomingPayments(transactions, 'watched', 100, 2).length, 0);
  assert.equal(extractIncomingPayments(transactions, 'watched', 101, 2).length, 1);
});

test('ignores transactions that do not pay the watched address', () => {
  const transactions = [{
    txid: 'outgoing-only',
    status: { confirmed: true, block_height: 100 },
    vout: [{ scriptpubkey_address: 'someone-else', value: 50_000 }],
  }];
  assert.deepEqual(extractIncomingPayments(transactions, 'watched', 100, 0), []);
});

test('baselines old payments and alerts exactly once for a new payment', async () => {
  const statePath = path.join(os.tmpdir(), `btc-monitor-test-${process.pid}-${Date.now()}.json`);
  let transactions = [{
    txid: 'old-payment',
    status: { confirmed: false },
    vout: [{ scriptpubkey_address: 'watched', value: 10_000 }],
  }];
  let webhookCalls = 0;
  const fetchImpl = async (url) => {
    if (url === 'https://discord.test/webhook') {
      webhookCalls += 1;
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify(transactions), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const monitor = createBitcoinMonitor({
    addresses: ['watched'],
    webhookUrl: 'https://discord.test/webhook',
    apiUrl: 'https://mempool.test/api',
    statePath,
    fetchImpl,
  });

  try {
    await monitor.check();
    assert.equal(webhookCalls, 0);

    transactions = [{
      txid: 'new-payment',
      status: { confirmed: false },
      vout: [{ scriptpubkey_address: 'watched', value: 20_000 }],
    }, ...transactions];
    await monitor.check();
    await monitor.check();
    assert.equal(webhookCalls, 1);
  } finally {
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
});
