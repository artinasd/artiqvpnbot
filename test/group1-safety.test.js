process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../lib/storage');
const wallet = require('../lib/wallet');

let sequence = 0;
function userId() { sequence += 1; return `group1-test-${process.pid}-${sequence}`; }

test('distributed lock release is token-safe', async () => {
  const name = `group1-lock-${userId()}`;
  const first = await storage.acquireLock(name, 60);
  assert.equal(typeof first, 'string');
  assert.equal(await storage.acquireLock(name, 60), null);
  assert.equal(await storage.releaseLock(name, 'not-the-owner'), false);
  assert.equal(await storage.releaseLock(name, first), true);
  const second = await storage.acquireLock(name, 60);
  assert.equal(typeof second, 'string');
  assert.equal(await storage.releaseLock(name, first), false);
  assert.equal(await storage.releaseLock(name, second), true);
});

test('concurrent wallet credits are serialized and idempotent', async () => {
  const id = userId();
  await storage.saveUser({ telegramUserId: id, balance: 0, username: 'before' });
  const creditMeta = { walletLastCredit: `topup:${id}`, walletLastCreditAt: new Date().toISOString() };
  await Promise.all([
    wallet.credit(id, 75, creditMeta),
    wallet.credit(id, 75, creditMeta),
    storage.saveUser({ telegramUserId: id, username: 'after' }),
  ]);
  const user = await storage.getUserRaw(id);
  assert.equal(Number(user.balance), 75);
  assert.equal(user.username, 'after');
  assert.equal(user.walletLastCredit, `topup:${id}`);
});

test('admin balance and debt mutations preserve concurrent profile fields', async () => {
  const id = userId();
  await storage.saveUser({ telegramUserId: id, balance: 20, debtAmount: 5, username: 'initial' });
  await Promise.all([
    wallet.setBalance(id, 120, { walletUpdatedBy: 'cms' }),
    wallet.setDebt(id, 35, { debtUpdatedBy: 'cms' }),
    storage.saveUser({ telegramUserId: id, username: 'latest-profile' }),
  ]);
  const user = await storage.getUserRaw(id);
  assert.equal(Number(user.balance), 120);
  assert.equal(Number(user.debtAmount), 35);
  assert.equal(user.username, 'latest-profile');
});

test('order listings sort the complete set before applying the limit', async () => {
  const prefix = userId();
  for (let i = 0; i < 200; i += 1) {
    const createdAt = new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString();
    await storage.createOrder({
      orderId: `${prefix}-${String(i).padStart(3, '0')}`,
      telegramUserId: prefix,
      createdAt,
      updatedAt: createdAt,
    });
  }
  const expected = Array.from({ length: 5 }, (_, index) => `${prefix}-${String(199 - index).padStart(3, '0')}`);
  assert.deepEqual((await storage.listOrders(5)).map((order) => order.orderId), expected);
  assert.deepEqual((await storage.listOrdersFast(5)).map((order) => order.orderId), expected);
});
