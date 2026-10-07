const test = require('node:test');
const assert = require('node:assert');
const storage = require('../lib/storage');
const accountService = require('../lib/account-service');
const api = require('../api/index');
const { UPGRADES } = require('../lib/upgrades');
const pasarguard = require('../lib/pasarguard');

pasarguard.getUserById = async (id) => ({ id, username: 'testuser' });


const { Telegram } = require('telegraf');
Telegram.prototype.callApi = async () => ({});

global.fetch = async (url) => {
  return { ok: true, json: async () => ({ ok: true, result: {} }) };
};

test.beforeEach(() => {
  process.env.UPSTASH_REDIS_REST_URL = ''; // local memory mode
});

async function simulateCallback(userId, data) {
  const req = {
    method: 'POST',
    body: {
      update_id: Date.now(),
      callback_query: {
        id: 'cb_' + Date.now(),
        from: { id: userId, username: 'testuser' },
        message: { message_id: 1, chat: { id: userId } },
        data: data
      }
    }
  };
  const res = { status: () => res, send: () => {} };
  await api(req, res);
}

test('1. Own subscription -> upg_checkout creates the correct order', async () => {
  await storage.saveUser({ telegramUserId: 100, reseller: false });
  const sourceOrder = {
    orderId: 'sub_valid',
    telegramUserId: 100,
    planId: 'plan1',
    planName: 'Plan 1',
    pasarguardUserId: 'pg_123',
    fulfillmentStatus: 'FULFILLED'
  };
  await storage.createOrder(sourceOrder);

  await simulateCallback(100, 'upg_checkout:sub_valid:upg_50g');

  const orders = await storage.listOrders(100);
  const upgOrder = orders.find(o => o.upgrade === true && o.upgradeSourceOrderId === 'sub_valid');
  assert.ok(upgOrder, 'Upgrade order should be created');
  assert.equal(upgOrder.upgradePasarguardUserId, 'pg_123');
  assert.equal(upgOrder.upgradeTrafficBytes, 50 * 1024 ** 3);
  assert.equal(upgOrder.price, 120000); // regular price
  assert.equal(upgOrder.telegramUserId, 100);
});

test("2. User attempts another user's subscription -> rejected", async () => {
  const sourceOrder = {
    orderId: 'sub_other',
    telegramUserId: 999, // Owned by another user
    pasarguardUserId: 'pg_999',
    fulfillmentStatus: 'FULFILLED'
  };
  await storage.createOrder(sourceOrder);

  await simulateCallback(100, 'upg_checkout:sub_other:upg_50g');

  const orders = await storage.listOrders(100);
  const upgOrder = orders.find(o => o.upgradeSourceOrderId === 'sub_other');
  assert.ok(!upgOrder, 'Upgrade order should NOT be created for another users subscription');
});

test('3. Invalid upgrade ID -> rejected', async () => {
  const sourceOrder = {
    orderId: 'sub_invalid_upg',
    telegramUserId: 100,
    pasarguardUserId: 'pg_123',
    fulfillmentStatus: 'FULFILLED'
  };
  await storage.createOrder(sourceOrder);

  await simulateCallback(100, 'upg_checkout:sub_invalid_upg:upg_fake_id');

  const orders = await storage.listOrders(100);
  const upgOrder = orders.find(o => o.upgradeSourceOrderId === 'sub_invalid_upg');
  assert.ok(!upgOrder, 'Upgrade order should NOT be created for invalid upgrade id');
});

test('4. Reseller pricing still correct', async () => {
  await storage.saveUser({ telegramUserId: 100, reseller: true });
  const sourceOrder = {
    orderId: 'sub_reseller',
    telegramUserId: 100,
    pasarguardUserId: 'pg_123',
    fulfillmentStatus: 'FULFILLED'
  };
  await storage.createOrder(sourceOrder);

  await simulateCallback(100, 'upg_checkout:sub_reseller:upg_50g');

  const orders = await storage.listOrders(100);
  const upgOrder = orders.find(o => o.upgrade === true && o.upgradeSourceOrderId === 'sub_reseller');
  assert.ok(upgOrder, 'Upgrade order should be created');
  assert.equal(upgOrder.price, 100000); // reseller price
});

test('5. account_upgrade shows menu (ownership check)', async () => {
  const sourceOrder = {
    orderId: 'sub_show_menu',
    telegramUserId: 100,
    pasarguardUserId: 'pg_123',
    fulfillmentStatus: 'FULFILLED'
  };
  await storage.createOrder(sourceOrder);

  await simulateCallback(100, 'account_upgrade:sub_show_menu');
  // It shouldn't crash, and should not create orders
  const orders = await storage.listOrders(100);
  const upgOrder = orders.find(o => o.upgradeSourceOrderId === 'sub_show_menu');
  assert.ok(!upgOrder);
});
