const test = require('node:test');
const assert = require('node:assert');
const fulfillment = require('../lib/fulfillment');
const storage = require('../lib/storage');
const provider = require('../lib/pasarguard');
const wallet = require('../lib/wallet');

process.env.UPSTASH_REDIS_REST_URL = ''; // Force memory mode

test.beforeEach(() => {
  // Clear any previous mocks
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ id: 1, username: 'testuser', subscription_url: 'http://test.com', status: 'active', expire: Date.now() + 86400000, data_limit: 100000 })
  });
  
  // Setup a fake provider for intercepting calls
  provider.createUser = async (opts) => {
    return { id: Math.floor(Math.random() * 10000), username: opts.username, subscription_url: 'http://sub.test', note: opts.note };
  };
  provider.findUserByUsername = async (username) => null;
});

const mockTelegram = { sendMessage: async () => {} };

test('1. FAILED_RETRYABLE order can be retried and succeeds', async () => {
  const orderId = 'ord_1';
  await storage.saveUser({ telegramUserId: 101 });
  await storage.set(`order:${orderId}`, {
    orderId,
    telegramUserId: 101,
    planId: 'p1',
    orderType: 'buy',
    paymentStatus: 'WALLET_PAID',
    fulfillmentStatus: 'FAILED_RETRYABLE',
    walletCharged: true,
    trafficLimitBytes: 10000,
    durationDays: 30,
    generatedPasarguardUsername: 'test_ord1',
    service: 'tunnel'
  });

  const res = await fulfillment.fulfillOrder(orderId, mockTelegram);
  assert.equal(res.started, true);
  
  // Wait for background fulfillment to complete
  await new Promise(r => setTimeout(r, 50));
  
  const o = await storage.getOrder(orderId);
  assert.equal(o.fulfillmentStatus, 'FULFILLED');
});

test('2. Successful retry does not double-provision if user already exists', async () => {
  const orderId = 'ord_2';
  await storage.saveUser({ telegramUserId: 102 });
  await storage.set(`order:${orderId}`, {
    orderId,
    telegramUserId: 102,
    planId: 'p2',
    orderType: 'buy',
    paymentStatus: 'WALLET_PAID',
    fulfillmentStatus: 'FAILED_RETRYABLE',
    walletCharged: true,
    trafficLimitBytes: 10000,
    durationDays: 30,
    generatedPasarguardUsername: 'test_ord2',
    service: 'tunnel'
  });

  let createCalls = 0;
  provider.createUser = async (opts) => {
    createCalls++;
    return { id: 99, username: opts.username, subscription_url: 'http://sub.test', note: opts.note };
  };
  
  // Simulate that the provider already has the user!
  provider.findUserByUsername = async (username) => {
    if (username === 'test_ord2') {
      return { id: 99, username: 'test_ord2', subscription_url: 'http://sub.test', note: `Order: ${orderId}` };
    }
    return null;
  };

  await fulfillment.fulfillOrder(orderId, mockTelegram);
  await new Promise(r => setTimeout(r, 50));
  
  const o = await storage.getOrder(orderId);
  assert.equal(o.fulfillmentStatus, 'FULFILLED');
  assert.equal(createCalls, 0, 'Should not have called createUser because user was recovered');
});

test('3. Renewal retry is idempotent and does not double-renew', async () => {
  const orderId = 'ord_3';
  await storage.saveUser({ telegramUserId: 103, currentPasarguardUserId: 55 });
  await storage.set(`order:${orderId}`, {
    orderId,
    telegramUserId: 103,
    renewal: true,
    renewalPasarguardUserId: 55,
    paymentStatus: 'WALLET_PAID',
    fulfillmentStatus: 'FAILED_RETRYABLE',
    walletCharged: true,
    trafficLimitBytes: 10000,
    durationDays: 30,
    service: 'tunnel'
  });

  let updateCalls = 0;
  provider.getUserById = async (id) => {
    return { id: 55, username: 'renew_user', subscription_url: 'http://sub.test', note: `Renew: ${orderId}`, expire: Date.now() + 86400000, data_limit: 50000 };
  };
  
  provider.updateUserById = async (id, patch) => {
    updateCalls++;
  };

  await fulfillment.fulfillOrder(orderId, mockTelegram);
  await new Promise(r => setTimeout(r, 50));
  
  const o = await storage.getOrder(orderId);
  assert.equal(o.fulfillmentStatus, 'FULFILLED');
  assert.equal(updateCalls, 0, 'Should not have called updateUserById because note proves it was already renewed');
});

test('4. Failed retry stays FAILED_RETRYABLE and does not refund if uncertain', async () => {
  const orderId = 'ord_4';
  await storage.saveUser({ telegramUserId: 104 });
  await storage.updateWallet(104, { balance: 0 }); // They paid already
  await storage.set(`order:${orderId}`, {
    orderId,
    telegramUserId: 104,
    orderType: 'buy',
    paymentStatus: 'WALLET_PAID',
    fulfillmentStatus: 'FAILED_RETRYABLE',
    walletCharged: true,
    price: 5000,
    service: 'tunnel'
  });

  // Make createUser timeout
  provider.createUser = async () => { throw new Error('Timeout'); };

  await fulfillment.fulfillOrder(orderId, mockTelegram);
  await new Promise(r => setTimeout(r, 50));
  
  const o = await storage.getOrder(orderId);
  assert.equal(o.fulfillmentStatus, 'FAILED_RETRYABLE');
  const u = await wallet.getBalance(104);
  assert.equal(u, 0, 'Should not have refunded');
});

test('5. Concurrent retries are serialized', async () => {
  const orderId = 'ord_5';
  await storage.saveUser({ telegramUserId: 105 });
  await storage.set(`order:${orderId}`, {
    orderId,
    telegramUserId: 105,
    orderType: 'buy',
    paymentStatus: 'WALLET_PAID',
    fulfillmentStatus: 'FAILED_RETRYABLE',
    walletCharged: true,
    service: 'tunnel'
  });

  let createCalls = 0;
  provider.createUser = async (opts) => {
    createCalls++;
    await new Promise(r => setTimeout(r, 30));
    return { id: 10, username: opts.username, subscription_url: 'http://sub.test', note: opts.note };
  };

  const p1 = fulfillment.fulfillOrder(orderId, mockTelegram);
  const p2 = fulfillment.fulfillOrder(orderId, mockTelegram);
  
  await Promise.all([p1, p2]);
  await new Promise(r => setTimeout(r, 100)); // wait for background completion
  
  const o = await storage.getOrder(orderId);
  assert.equal(o.fulfillmentStatus, 'FULFILLED');
  assert.equal(createCalls, 1, 'Concurrent calls should only result in 1 creation');
});
