const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const storage = require('../lib/storage');
const { performFulfillment } = require('../lib/fulfillment');
const wallet = require('../lib/wallet');
const botConfig = require('../lib/bot-config');
const realProvider = require('../lib/pasarguard');

const mockTelegram = {
  sendMessage: async () => true,
  sendPhoto: async () => true,
};

let providerState = {};

realProvider.getUserById = async (id) => {
  if (!providerState[id]) throw { status: 404, message: 'Not found' };
  return providerState[id];
};
realProvider.updateUserById = async (id, patch) => {
  if (!providerState[id]) throw { status: 404, message: 'Not found' };
  providerState[id] = { ...providerState[id], ...patch };
  return providerState[id];
};

let configMock = { bot: {}, buttons: {} };
botConfig.getConfig = async () => configMock;
require('../lib/service-fulfillment').getFulfillment = () => ({ ok: true, provider: 'pasarguard' });

global.fetch = async () => ({
  ok: true,
  json: async () => ({})
});

async function setup() {
  process.env.UPSTASH_REDIS_REST_URL = ''; // force memory mode
  providerState = {
    'sub_finite': { id: 'sub_finite', data_limit: 10 * 1024 ** 3, expire: new Date(Date.now() + 10 * 86400 * 1000).toISOString(), note: 'test', subscription_url: 'http://test' },
    'sub_unlimited_traffic': { id: 'sub_unlimited_traffic', data_limit: 0, expire: new Date(Date.now() + 10 * 86400 * 1000).toISOString(), note: 'test', subscription_url: 'http://test' },
    'sub_unlimited_duration': { id: 'sub_unlimited_duration', data_limit: 10 * 1024 ** 3, expire: 0, note: 'test', subscription_url: 'http://test' },
    'sub_unlimited_both': { id: 'sub_unlimited_both', data_limit: 0, expire: 0, note: 'test', subscription_url: 'http://test' },
  };
}

function makeOrderId() {
  return `TG-UPG-${crypto.randomBytes(4).toString('hex')}`;
}

test('1. Valid traffic upgrade (Finite)', async () => {
  await setup();
  const orderId = makeOrderId();
  await storage.set(`order:${orderId}`, {
    orderId, telegramUserId: 1, upgrade: true, upgradePasarguardUserId: 'sub_finite', service: 'tunnel',
    upgradeTrafficBytes: 50 * 1024 ** 3, upgradeDurationDays: 0, walletCharged: true, paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'PROVISIONING'
  });
  
  await performFulfillment(orderId, mockTelegram);
  
  
  const updated = providerState['sub_finite'];
  assert.equal(updated.data_limit, 60 * 1024 ** 3); // 10 + 50
  assert.ok(updated.note.includes(`Upgrade: ${orderId}`));
});

test('2. Valid duration upgrade (Finite)', async () => {
  await setup();
  const orderId = makeOrderId();
  const initialExpire = new Date(providerState['sub_finite'].expire).getTime();
  
  await storage.set(`order:${orderId}`, {
    orderId, telegramUserId: 1, upgrade: true, upgradePasarguardUserId: 'sub_finite', service: 'tunnel',
    upgradeTrafficBytes: 0, upgradeDurationDays: 30, walletCharged: true, paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'PROVISIONING'
  });
  
  await performFulfillment(orderId, mockTelegram);
  
  
  const updated = providerState['sub_finite'];
  assert.equal(updated.data_limit, 10 * 1024 ** 3); // unchanged
  const newExpire = new Date(updated.expire).getTime();
  assert.ok(newExpire > initialExpire + 29 * 86400 * 1000); // added 30 days
});

test('3. Combined upgrade (Finite)', async () => {
  await setup();
  const orderId = makeOrderId();
  await storage.set(`order:${orderId}`, {
    orderId, telegramUserId: 1, upgrade: true, upgradePasarguardUserId: 'sub_finite', service: 'tunnel',
    upgradeTrafficBytes: 50 * 1024 ** 3, upgradeDurationDays: 30, walletCharged: true, paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'PROVISIONING'
  });
  
  await performFulfillment(orderId, mockTelegram);
  
  const updated = providerState['sub_finite'];
  assert.equal(updated.data_limit, 60 * 1024 ** 3);
});

test('4. Finite -> Unlimited duration', async () => {
  await setup();
  const orderId = makeOrderId();
  await storage.set(`order:${orderId}`, {
    orderId, telegramUserId: 1, upgrade: true, upgradePasarguardUserId: 'sub_finite', service: 'tunnel',
    upgradeTrafficBytes: 0, upgradeToUnlimited: true, walletCharged: true, paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'PROVISIONING'
  });
  
  await performFulfillment(orderId, mockTelegram);
  
  const updated = providerState['sub_finite'];
  assert.equal(updated.expire, 0); // unlimited
});

test('5. Unlimited duration -> Finite is rejected', async () => {
  await setup();
  const orderId = makeOrderId();
  await storage.set(`order:${orderId}`, {
    orderId, telegramUserId: 1, upgrade: true, upgradePasarguardUserId: 'sub_unlimited_duration', service: 'tunnel',
    upgradeTrafficBytes: 0, upgradeDurationDays: 30, walletCharged: true, paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'PROVISIONING'
  });
  
  try {
    await performFulfillment(orderId, mockTelegram);
  } catch (err) {}

  const o = await storage.getOrder(orderId);
  assert.equal(o.fulfillmentStatus, 'FAILED_RETRYABLE');
  assert.equal(o.failureReason, 'CANNOT_UPGRADE_DURATION_OF_UNLIMITED');
});

test('6. Upgrade traffic on unlimited traffic plan does not lose unlimited', async () => {
  await setup();
  const orderId = makeOrderId();
  await storage.set(`order:${orderId}`, {
    orderId, telegramUserId: 1, upgrade: true, upgradePasarguardUserId: 'sub_unlimited_traffic', service: 'tunnel',
    upgradeTrafficBytes: 50 * 1024 ** 3, upgradeDurationDays: 0, walletCharged: true, paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'PROVISIONING'
  });
  
  await performFulfillment(orderId, mockTelegram);
  
  const updated = providerState['sub_unlimited_traffic'];
  // data_limit should remain 0
  assert.equal(updated.data_limit, 0);
});

test('7. Provider Idempotency: retry does not double apply', async () => {
  await setup();
  const orderId = makeOrderId();
  await storage.set(`order:${orderId}`, {
    orderId, telegramUserId: 1, upgrade: true, upgradePasarguardUserId: 'sub_finite', service: 'tunnel',
    upgradeTrafficBytes: 10 * 1024 ** 3, upgradeDurationDays: 0, walletCharged: true, paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'PROVISIONING'
  });
  
  // First time
  await performFulfillment(orderId, mockTelegram);
  
  assert.equal(providerState['sub_finite'].data_limit, 20 * 1024 ** 3);
  
  // Simulate network failure but provider succeeded, order still PROVISIONING
  await storage.updateOrder(orderId, { fulfillmentStatus: 'PROVISIONING' });
  
  // Second time (retry)
  await performFulfillment(orderId, mockTelegram);
  
  
  // Should still be 20GB because the note marker prevented double application
  assert.equal(providerState['sub_finite'].data_limit, 20 * 1024 ** 3);
});

test('8. Missing account in provider goes to FAILED_RETRYABLE / REFUND', async () => {
  await setup();
  const orderId = makeOrderId();
  await storage.saveUser({ telegramUserId: 1 });
  await storage.set(`order:${orderId}`, {
    orderId, telegramUserId: 1, upgrade: true, upgradePasarguardUserId: 'sub_does_not_exist', service: 'tunnel',
    upgradeTrafficBytes: 10 * 1024 ** 3, upgradeDurationDays: 0, walletCharged: true, walletChargedAmount: 1000, paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'PROVISIONING'
  });
  // fund the wallet to receive the refund
  await wallet.credit(1, 1000, { note: 'test' });
  
  try {
    await performFulfillment(orderId, mockTelegram);
  } catch (err) {}

  
  const updated = await storage.getOrder(orderId);
  assert.equal(updated.fulfillmentStatus, 'FAILED_RETRYABLE');
  assert.equal(updated.walletRefunded, undefined);
});
