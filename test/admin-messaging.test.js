const test = require('node:test');
const assert = require('node:assert');
const { registerAdminMessaging, processActiveBroadcasts } = require('../lib/admin-messaging');
const storage = require('../lib/storage');

const mem = new Map();

let bot;
let telegramSends = [];
let telegramErrors = {};

test.beforeEach(() => {
  mem.clear();
  process.env.UPSTASH_REDIS_REST_URL = ''; // Local memory mode
  
  telegramSends = [];
  telegramErrors = {};

  bot = {
    commands: {},
    command: (cmd, handler) => {
      bot.commands[cmd] = handler;
    },
    telegram: {
      sendMessage: async (id, text) => {
        if (telegramErrors[id]) {
          const err = new Error(telegramErrors[id].message);
          err.code = telegramErrors[id].code;
          err.description = telegramErrors[id].message;
          throw err;
        }
        telegramSends.push({ id, text });
      }
    }
  };

  registerAdminMessaging(bot, { storage, isAdmin: () => true, log: () => {} });
});

let replies = [];

async function simulateBroadcastRequest(messageText, fromId = 999) {
  const ctx = {
    from: { id: fromId },
    message: { text: `/broadcast ${messageText}` },
    reply: async (text) => { replies.push(text); return text; }
  };
  await bot.commands['broadcast'](ctx);
  return replies[replies.length - 1];
}

test('1. broadcast job creation & duplicate protection & sendto', async () => {
  // Test /sendto
  const sendtoCtx = {
    from: { id: 999 },
    message: { text: '/sendto 111 hello there' },
    reply: async () => {}
  };
  await bot.commands['sendto'](sendtoCtx);
  assert.equal(telegramSends.length, 1);
  assert.equal(telegramSends[0].id, '111');
  assert.equal(telegramSends[0].text, 'hello there');
  telegramSends = [];

  // Setup users
  await storage.saveUser({ telegramUserId: 101, botStatus: 'active' });
  await storage.saveUser({ telegramUserId: 102, botStatus: 'active' });

  // 1. broadcast job creation
  const res1 = await simulateBroadcastRequest('test msg');
  assert.match(res1, /در صف ارسال برای 2 کاربر/);

  // 13. duplicate admin request does not create duplicate job
  const res2 = await simulateBroadcastRequest('test msg');
  assert.match(res2, /اخیراً در صف/);

  const active = await storage.smembers('active_broadcasts');
  assert.equal(active.length, 1);
});

test('2-11. Worker processing, failures, concurrency, resume', async () => {
  // Setup 5 users
  for (let i = 1; i <= 5; i++) {
    await storage.saveUser({ telegramUserId: 100 + i, botStatus: 'active' });
  }

  // 101: ok
  // 102: 429
  // 103: blocked
  // 104: ok
  // 105: ok

  telegramErrors['102'] = { code: 429, message: 'retry_after' };
  telegramErrors['103'] = { code: 403, message: 'Forbidden: bot was blocked by the user' };

  await simulateBroadcastRequest('batch msg');
  await new Promise(r => setTimeout(r, 200)); // Wait for background waitUntil to finish batch

  const active = await storage.smembers('active_broadcasts');
  let broadcastId;
  for (const id of active) {
    const job = await storage.get(`broadcast_job:${id}`);
    if (job && job.messageText === 'batch msg') {
      broadcastId = id;
      break;
    }
  }

  // 5. Concurrent workers
  const p1 = processActiveBroadcasts(bot, { storage, log: () => {} });
  const p2 = processActiveBroadcasts(bot, { storage, log: () => {} });
  await Promise.all([p1, p2]);

  // It should have stopped at 102 (429)
  let job = await storage.get(`broadcast_job:${broadcastId}`);
  assert.equal(job.status, 'queued');
  assert.equal(job.failed, 0);

  // Now clear 429 and resume
  telegramErrors['102'] = null; // 429 resolved
  
  // 4. Resume
  console.log('--- CALLING RESUME ---');
  await processActiveBroadcasts(bot, { storage, log: () => {} });
  console.log('--- RESUME FINISHED ---');

  job = await storage.get(`broadcast_job:${broadcastId}`);
  console.log('JOB AFTER RESUME', job);
  console.log('TELEGRAM SENDS', telegramSends);
  assert.equal(job.status, 'completed');
  assert.equal(job.success, 4); // 4 out of 5 succeeded
  assert.equal(job.failed, 1); // 103 blocked

  // 10. Permanently blocked user marked failed without stopping
  const u103 = await storage.getUser(103);
  assert.equal(u103.botStatus, 'blocked');
});

test('12. Simulated "Telegram succeeded but persistence failed" (Documented Limitation)', async () => {
  const broadcastId = `bcast_crash_${Date.now()}`;
  await storage.saveUser({ telegramUserId: 201, botStatus: 'active' });
  
  // Create job manually to simulate a state where the worker crashed
  const job = {
    id: broadcastId,
    adminId: 999,
    messageText: 'crash msg',
    recipients: ['201'],
    cursor: 0,
    success: 0,
    failed: 0,
    status: 'queued',
    createdAt: new Date().toISOString()
  };
  await storage.set(`broadcast_job:${broadcastId}`, job);
  await storage.sadd('active_broadcasts', broadcastId);
  
  // Manually send (simulate worker crashed right after this)
  await bot.telegram.sendMessage(201, 'crash msg');
  telegramSends.length = 0; // clear tracking
  
  // Worker retries
  await processActiveBroadcasts(bot, { storage, log: () => {} });
  
  // It sent it again!
  const userMessage = telegramSends.find(m => m.id === '201' || m.id === 201);
  assert.ok(userMessage);
  assert.equal(userMessage.text, 'crash msg');
});
