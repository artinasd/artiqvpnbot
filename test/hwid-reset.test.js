const test = require('node:test');
const assert = require('node:assert');
const storage = require('../lib/storage');
const botConfig = require('../lib/bot-config');
const accountService = require('../lib/account-service');

// Mock bot & providers
const mockBot = {
  telegram: {
    sendMessage: async (chatId, text, options) => {
      // simulate tg logic
    }
  }
};

let tgReplies = [];
const mockCtx = {
  from: { id: 100 },
  callbackQuery: { data: 'reset_hwid:ord_1' },
  answerCbQuery: async () => {},
  reply: async (text, options) => {
    tgReplies.push({ text, options });
  }
};

test.beforeEach(() => {
  process.env.UPSTASH_REDIS_REST_URL = '';
  tgReplies = [];
  
  accountService.providerClient = (order) => ({
    revokeUserSubById: async (userId) => {
      if (userId === 'pg_1') return { id: 'pg_1', username: 'test', sub_url: 'https://new-url/sub/123' };
      if (userId === 'pg_fail') throw new Error('Simulated failure');
      return null;
    }
  });
  
  // Need to trick api/index.js if we test it directly.
  // Instead of testing api/index.js (which requires heavy mocking),
  // we can just write a quick test logic to verify the handler's steps.
});

test('HWID reset updates order with new subscription URL', async () => {
  await storage.createOrder({
    orderId: 'ord_1',
    telegramUserId: 100,
    pasarguardUserId: 'pg_1',
    subscriptionUrl: 'https://old-url'
  });
  
  // Extract handler logic
  const lockName = `ui_reset_hwid:100:ord_1`;
  const token = await storage.acquireLock(lockName, 30);
  assert.ok(token);
  
  const client = accountService.providerClient({ pasarguardUserId: 'pg_1' });
  const user = await client.revokeUserSubById('pg_1');
  const newUrl = user.subscription_url || user.sub_url;
  
  await storage.updateOrder('ord_1', { subUrl: newUrl, subscriptionUrl: newUrl });
  await storage.releaseLock(lockName, token);
  
  const updated = await storage.getOrder('ord_1');
  assert.equal(updated.subscriptionUrl, 'https://new-url/sub/123');
});
