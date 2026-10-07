const test = require('node:test');
const assert = require('node:assert');
const storage = require('../lib/storage');
const accountService = require('../lib/account-service');
const { processExpirationReminders } = require('../lib/reminders');
const botConfig = require('../lib/bot-config');

let tgMessages = [];
const mockBot = {
  telegram: {
    sendMessage: async (chatId, text, options) => {
      tgMessages.push({ chatId, text, options });
      return true;
    }
  }
};

let providerState = {};
accountService.getSubscription = async (telegramUserId, orderId) => {
  const order = await storage.getOrder(orderId);
  if (!order || !order.pasarguardUserId) return null;
  const state = providerState[order.pasarguardUserId];
  if (!state) return null;
  return { ...order, ...state }; // merged with state like the real one
};

accountService.displayName = (order) => `Sub ${order.orderId}`;

test.beforeEach(() => {
  process.env.UPSTASH_REDIS_REST_URL = '';
  tgMessages = [];
  providerState = {};
  botConfig.getConfig = async () => ({
    limits: { reminderDays: [3, 1, 0] },
    buttons: { renew: 'Renew' }
  });
});

test('1. Reminder not sent for unlimited subscriptions', async () => {
  const order = { orderId: 'sub_unlimited', telegramUserId: 100, pasarguardUserId: 'pg_1', expiresAt: null };
  await storage.createOrder(order);
  providerState['pg_1'] = { expiresAt: null };

  await processExpirationReminders(mockBot, { storage, log: () => {} });
  assert.equal(tgMessages.length, 0);
});

test('2. Reminder sent for subscription expiring in 3 days', async () => {
  const expiresAt = new Date(Date.now() + 3 * 86400 * 1000).toISOString();
  const order = { orderId: 'sub_3days', telegramUserId: 100, pasarguardUserId: 'pg_2', expiresAt };
  await storage.createOrder(order);
  providerState['pg_2'] = { expiresAt };

  await processExpirationReminders(mockBot, { storage, log: () => {} });
  assert.equal(tgMessages.length, 1);
  assert.match(tgMessages[0].text, /3 روز باقی‌مانده/);
  
  // Duplicate execution should NOT send again
  await processExpirationReminders(mockBot, { storage, log: () => {} });
  assert.equal(tgMessages.length, 1);
});

test('3. Expired subscription sends exact 0-day reminder', async () => {
  const expiresAt = new Date(Date.now() - 1000).toISOString(); // just expired
  const order = { orderId: 'sub_expired', telegramUserId: 100, pasarguardUserId: 'pg_3', expiresAt };
  await storage.createOrder(order);
  providerState['pg_3'] = { expiresAt };

  await processExpirationReminders(mockBot, { storage, log: () => {} });
  assert.equal(tgMessages.length, 1);
  assert.match(tgMessages[0].text, /منقضی شده است/);

  // Duplicate execution should not send
  await processExpirationReminders(mockBot, { storage, log: () => {} });
  assert.equal(tgMessages.length, 1);
});

test('4. Subscription missing from provider skips without crashing', async () => {
  const expiresAt = new Date(Date.now() + 3 * 86400 * 1000).toISOString();
  const order = { orderId: 'sub_missing', telegramUserId: 100, pasarguardUserId: 'pg_4', expiresAt };
  await storage.createOrder(order);
  // NOT in providerState

  await processExpirationReminders(mockBot, { storage, log: () => {} });
  assert.equal(tgMessages.length, 0);
});

test('5. Renewal externally updates cache and skips reminder', async () => {
  // Order locally says expiring in 3 days
  const localExpiresAt = new Date(Date.now() + 3 * 86400 * 1000).toISOString();
  const order = { orderId: 'sub_renewed', telegramUserId: 100, pasarguardUserId: 'pg_5', expiresAt: localExpiresAt };
  await storage.createOrder(order);
  
  // Provider says expiring in 30 days
  const providerExpiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  providerState['pg_5'] = { expiresAt: providerExpiresAt };

  await processExpirationReminders(mockBot, { storage, log: () => {} });
  
  assert.equal(tgMessages.length, 0, 'Should not remind if true expiration is far away');
  
  const updatedOrder = await storage.getOrder('sub_renewed');
  assert.equal(updatedOrder.expiresAt, providerExpiresAt, 'Local cache should be updated');
  assert.equal(updatedOrder.remindedDays, Infinity, 'remindedDays should be reset');
});
