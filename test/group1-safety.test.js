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


const Module = require('node:module');
const path = require('node:path');

function loadWithMocks(relativePath, mocks) {
  const filename = require.resolve(relativePath);
  delete require.cache[filename];
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(filename); }
  finally { Module._load = originalLoad; }
}

function mockResponse() {
  return {
    statusCode: 200, headers: {}, body: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = JSON.parse(body); return this; },
  };
}

test('purchase report releases the exact acquired lock token after processing', async () => {
  const original = {
    list: storage.listPendingPurchaseReportEvents,
    get: storage.getPurchaseReportEvent,
    update: storage.updatePurchaseReportEvent,
    acquire: storage.acquireLock,
    release: storage.releaseLock,
  };
  const event = {
    eventId: `purchase:lock-token-${userId()}`, orderId: 'report-order',
    customer: { telegramId: '100', firstName: 'Test' },
    product: { planName: 'Plan', serviceName: 'VPN', trafficLimitBytes: 1, durationDays: 1 },
    payment: { amount: 10, currency: 'تومان', method: 'کیف پول' },
    recipients: { admin: { chatId: '100', status: 'PENDING', attempts: 0 } },
  };
  let acquiredToken = null;
  let releasedToken = null;
  let released = false;
  try {
    storage.listPendingPurchaseReportEvents = async () => [{ eventId: event.eventId }];
    storage.getPurchaseReportEvent = async () => event;
    storage.updatePurchaseReportEvent = async (_id, patch) => Object.assign(event, patch);
    storage.acquireLock = async (name, ttl) => {
      assert.equal(name, `purchase-report-event:${event.eventId}`);
      assert.equal(ttl, 55);
      acquiredToken = await original.acquire(name, ttl);
      return acquiredToken;
    };
    storage.releaseLock = async (name, token) => {
      releasedToken = token;
      released = await original.release(name, token);
      return released;
    };
    const { processPendingPurchaseReports } = require('../lib/purchase-report');
    const result = await processPendingPurchaseReports({ sendMessage: async () => true }, { limit: 1 });
    assert.equal(result.sent, 1);
    assert.ok(acquiredToken);
    assert.equal(releasedToken, acquiredToken);
    assert.equal(released, true);
  } finally {
    storage.listPendingPurchaseReportEvents = original.list;
    storage.getPurchaseReportEvent = original.get;
    storage.updatePurchaseReportEvent = original.update;
    storage.acquireLock = original.acquire;
    storage.releaseLock = original.release;
  }
});

test('admin active-user status updates preserve wallet and test usage fields', async () => {
  const id = String(700000000 + sequence + 1);
  await storage.saveUser({ telegramUserId: id, balance: 100, debtAmount: 23, testUsageDate: '2026-11-11', testUsageCount: 2, botStatus: 'active' });
  const original = { list: storage.listBotUsers, save: storage.saveUser };
  const saveUser = storage.saveUser;
  try {
    storage.listBotUsers = async () => [await storage.getUserRaw(id)];
    storage.saveUser = async (patch) => {
      if (String(patch.telegramUserId) === id) await wallet.credit(id, 7, { walletLastTransaction: `active-race:${id}` });
      return saveUser(patch);
    };
    process.env.ADMIN_CMS_PASSWORD = 'group1-test-password';
    process.env.BOT_TOKEN = 'mock-token';
    const handler = loadWithMocks('../api/admin-active-users.js', {
      telegraf: {
        Telegraf: class MockTelegraf {
          constructor() {
            this.telegram = { getChat: async () => {
              await wallet.credit(id, 11, { walletLastTransaction: `active-chat:${id}` });
              const error = new Error('chat not found');
              error.response = { error_code: 400, description: 'chat not found' };
              throw error;
            } };
          }
        },
      },
    });
    const res = mockResponse();
    await handler({ method: 'GET', headers: { 'x-admin-password': 'group1-test-password' }, query: { refresh: '1' } }, res);
    assert.equal(res.statusCode, 200);
    const updated = await storage.getUserRaw(id);
    assert.equal(Number(updated.balance), 118);
    assert.equal(Number(updated.debtAmount), 23);
    assert.equal(Number(updated.testUsageCount), 2);
    assert.equal(updated.botStatus, 'inactive');
  } finally {
    storage.listBotUsers = original.list;
    storage.saveUser = original.save;
    delete require.cache[require.resolve('../api/admin-active-users.js')];
    delete process.env.ADMIN_CMS_PASSWORD;
    delete process.env.BOT_TOKEN;
  }
});

test('admin reseller and brand patch updates preserve concurrent wallet changes', async () => {
  const resellerId = String(710000000 + sequence + 1);
  const brandId = String(720000000 + sequence + 1);
  for (const id of [resellerId, brandId]) {
    await storage.saveUser({ telegramUserId: id, balance: 200, debtAmount: 31, testUsageDate: '2026-11-11', testUsageCount: 4, isReseller: true, brandName: 'Existing' });
  }
  const originalSave = storage.saveUser;
  try {
    storage.saveUser = async (patch) => {
      if ([resellerId, brandId].includes(String(patch.telegramUserId))) {
        await wallet.credit(patch.telegramUserId, 13, { walletLastTransaction: `reseller-race:${patch.telegramUserId}` });
      }
      return originalSave(patch);
    };
    process.env.ADMIN_CMS_PASSWORD = 'group1-test-password';
    const config = { resellerTelegramIds: [] };
    const handler = loadWithMocks('../api/admin-resellers.js', {
      '../lib/plan-store': { listAll: async () => [], get: async () => null, save: async (value) => value },
      '../lib/bot-config': { getConfig: async () => config, saveConfig: async () => config },
      '../lib/services': { getConfiguredServicesWithPanels: async () => [] },
    });
    const invoke = async (body) => {
      const res = mockResponse();
      await handler({ method: 'POST', headers: { 'x-admin-password': 'group1-test-password' }, body }, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      return res.body;
    };
    await invoke({ action: 'set-user', telegramId: resellerId, isReseller: false });
    await invoke({ action: 'set-brand', telegramId: brandId, brandName: 'New Brand' });
    for (const id of [resellerId, brandId]) {
      const updated = await storage.getUserRaw(id);
      assert.equal(Number(updated.balance), 213);
      assert.equal(Number(updated.debtAmount), 31);
      assert.equal(Number(updated.testUsageCount), 4);
    }
    assert.equal((await storage.getUserRaw(resellerId)).isReseller, false);
    assert.equal((await storage.getUserRaw(brandId)).brandName, 'New Brand');
  } finally {
    storage.saveUser = originalSave;
    delete require.cache[require.resolve('../api/admin-resellers.js')];
    delete process.env.ADMIN_CMS_PASSWORD;
  }
});

test('fulfillment recovery logs cleanup and refund failures without ReferenceError', async () => {
  const order = {
    orderId: 'group1-recovery-order', telegramUserId: '730000001', service: 'vpn',
    planId: 'paid-plan', fulfillmentStatus: 'RECEIPT_SUBMITTED', walletCharged: true,
    walletChargedAmount: 100, pasarguardUserId: 'pasarguard-user', renewal: false,
    trafficLimitBytes: 1024, durationDays: 30, hwidLimit: 1,
  };
  const releaseCalls = [];
  const mockStorage = {
    getOrder: async () => order,
    updateOrder: async (_id, patch) => {
      if (patch.fulfillmentStatus === 'PROVISIONING') throw new Error('SIMULATED_PROVISIONING_ERROR');
      return { ...order, ...patch };
    },
    saveUser: async () => order,
    setState: async () => true,
    acquireLock: async (name) => `${name}-token`,
    releaseLock: async (name, token) => { releaseCalls.push({ name, token }); return true; },
    getUserRaw: async () => null,
    listUserOrders: async () => [],
  };
  const mocks = {
    './username': { buildUsername: () => 'test-user' },
    './storage': mockStorage,
    './providers': { getProvider: () => ({ updateUserById: async () => { throw new Error('SIMULATED_CLEANUP_ERROR'); } }) },
    './wallet': { credit: async () => { throw new Error('SIMULATED_REFUND_ERROR'); } },
    './qr': { createSubscriptionQr: async () => null },
    './bot-config': { getConfig: async () => ({}), getMessage: async () => 'message' },
    './service-fulfillment': { getFulfillment: async () => ({ ok: true, provider: 'mock' }) },
    './purchase-report': { isResellerCustomer: () => false, computeResellerStats: () => ({}), enqueuePurchaseReport: async () => ({}), processPendingPurchaseReports: async () => ({}) },
    '@vercel/functions': { waitUntil: () => { throw new Error('NO_REQUEST_CONTEXT'); } },
  };
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const fulfillment = loadWithMocks('../lib/fulfillment.js', mocks);
    await assert.rejects(
      fulfillment.fulfillOrder(order.orderId, { sendMessage: async () => true }),
      /SIMULATED_PROVISIONING_ERROR/,
    );
    assert.ok(logged.some((entry) => entry.includes('FULFILLMENT_CLEANUP_FAILED')));
    assert.ok(logged.some((entry) => entry.includes('WALLET_REFUND_FAILED')));
    assert.ok(!logged.some((entry) => entry.includes('ReferenceError')));
    assert.ok(releaseCalls.some((entry) => entry.name === `fulfill:${order.orderId}` && entry.token === `fulfill:${order.orderId}-token`));
  } finally {
    console.error = originalError;
    delete require.cache[require.resolve('../lib/fulfillment.js')];
  }
});
