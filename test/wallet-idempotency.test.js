const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function createWallet(initialUser) {
  const users = new Map([[String(initialUser.telegramUserId), { ...initialUser }]]);
  const locks = new Set();
  const storage = {
    async getUser(id) { return users.get(String(id)) || null; },
    async saveUser(user) { users.set(String(user.telegramUserId), { ...user }); return { ...user }; },
    async acquireLock(name) { if (locks.has(name)) return false; locks.add(name); return true; },
    async releaseLock(name) { locks.delete(name); },
  };
  const walletModule = { exports: {} };
  const walletFactory = new Function('require', 'module', 'exports', source('lib/wallet.js'));
  walletFactory((name) => {
    assert.equal(name, './storage');
    return storage;
  }, walletModule, walletModule.exports);
  return { wallet: walletModule.exports, users };
}

test('wallet credit is idempotent when the same top-up is approved more than once', async () => {
  const { wallet, users } = createWallet({ telegramUserId: 42, balance: 100 });
  await wallet.creditOnce(42, 50, 'topup:abc');
  await wallet.creditOnce(42, 50, 'topup:abc');
  assert.equal(await wallet.getBalance(42), 150);
  assert.equal(Object.keys(users.get('42').walletTransactions).length, 1);
});

test('wallet debit is idempotent and never charges twice for the same purchase', async () => {
  const { wallet } = createWallet({ telegramUserId: 42, balance: 500 });
  await wallet.debitOnce(42, 200, 'purchase:abc');
  await wallet.debitOnce(42, 200, 'purchase:abc');
  assert.equal(await wallet.getBalance(42), 300);
  assert.equal(await wallet.hasProcessedTransaction(42, 'purchase:abc'), true);
});

test('wallet transaction IDs cannot be reused for a different amount', async () => {
  const { wallet } = createWallet({ telegramUserId: 42, balance: 500 });
  await wallet.debitOnce(42, 200, 'purchase:abc');
  await assert.rejects(wallet.debitOnce(42, 150, 'purchase:abc'), /WALLET_TRANSACTION_MISMATCH/);
  assert.equal(await wallet.getBalance(42), 300);
});

test('checkout does not retry while holding the purchase lock', () => {
  const api = source('api/index.js');
  const checkout = api.slice(api.indexOf('async function showWalletCheckout'), api.indexOf('async function showWalletTopupPayment'));
  assert.ok(checkout.indexOf('await storage.releaseLock(lock)') < checkout.indexOf('if (insufficientAfterLock) return showWalletCheckout'));
  assert.match(checkout, /wallet\.debitOnce/);
  assert.match(checkout, /hasProcessedTransaction/);
  const apiSource = source('api/index.js');
  assert.match(apiSource, /async function requestWalletFundsForOrder/);
  assert.match(apiSource, /stage: 'AWAITING_WALLET_AMOUNT'/);
  assert.match(apiSource, /WALLET_TOPUP_APPROVAL_NOTIFY_FAILED/);
});
