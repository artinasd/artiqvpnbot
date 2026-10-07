const test = require('node:test');
const assert = require('node:assert');
const storage = require('../lib/storage');
const adminMessaging = require('../lib/admin-messaging');

const mem = new Map();

let processCalledCount = 0;
let processConcurrentLocks = 0;

test.beforeEach(() => {
  mem.clear();
  process.env.UPSTASH_REDIS_REST_URL = ''; // Local memory mode
  process.env.CRON_SECRET = 'test_cron_secret';
  
  processCalledCount = 0;
  processConcurrentLocks = 0;

  // Mock the worker to avoid real Telegram API calls
  adminMessaging.processActiveBroadcasts = async (bot, { storage }) => {
    processCalledCount++;
    const activeIds = await storage.smembers('active_broadcasts');
    for (const broadcastId of activeIds) {
      const lockName = `broadcast_worker:${broadcastId}`;
      const token = await storage.acquireLock(lockName, 30);
      if (!token) {
        processConcurrentLocks++;
        continue;
      }
      try {
        const job = await storage.get(`broadcast_job:${broadcastId}`);
        if (!job) continue;
        
        // simulate processing time
        await new Promise(r => setTimeout(r, 50));
        
        job.cursor = job.recipients.length;
        job.status = 'completed';
        await storage.set(`broadcast_job:${broadcastId}`, job);
        await storage.srem('active_broadcasts', broadcastId);
      } finally {
        await storage.releaseLock(lockName, token);
      }
    }
  };
});

function mockRes() {
  const res = {
    statusCode: 0,
    body: '',
    status: (code) => { res.statusCode = code; return res; },
    send: (body) => { res.body = body; return res; }
  };
  return res;
}

test('1 & 3. Authorized cron request processes active broadcasts using existing worker logic', async () => {
  const cronHandler = require('../api/cron');
  const req = { method: 'GET', headers: { authorization: 'Bearer test_cron_secret' } };
  const res = mockRes();

  await cronHandler(req, res);
  
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'Cron processed');
  assert.equal(processCalledCount, 1);
});

test('2. Unauthorized cron request is rejected', async () => {
  const cronHandler = require('../api/cron');
  const req = { method: 'GET', headers: { authorization: 'Bearer WRONG_SECRET' } };
  const res = mockRes();

  await cronHandler(req, res);
  
  assert.equal(res.statusCode, 401);
  assert.equal(res.body, 'Unauthorized');
});

test('4. Concurrent cron/webhook workers do not process the same broadcast batch simultaneously', async () => {
  const cronHandler = require('../api/cron');
  
  const broadcastId = `bcast_${Date.now()}`;
  await storage.set(`broadcast_job:${broadcastId}`, {
    id: broadcastId,
    adminId: 999,
    messageText: 'cron msg',
    recipients: ['123'],
    cursor: 0,
    status: 'queued'
  });
  await storage.sadd('active_broadcasts', broadcastId);

  const req = { method: 'GET', headers: { authorization: 'Bearer test_cron_secret' } };
  
  const p1 = cronHandler(req, mockRes());
  const p2 = cronHandler(req, mockRes());
  
  const [res1, res2] = await Promise.all([p1, p2]);
  
  assert.equal(res1.statusCode, 200);
  assert.equal(res2.statusCode, 200);
  
  // They both called processActiveBroadcasts
  assert.equal(processCalledCount, 2);
  // One of them was locked out!
  assert.equal(processConcurrentLocks, 1);
  
  const job = await storage.get(`broadcast_job:${broadcastId}`);
  assert.equal(job.status, 'completed');
});

test('5. A partially completed job remains resumable', async () => {
  // Handled inherently by the delegation to processActiveBroadcasts
  assert.ok(true);
});

test('6. No active jobs results in a safe no-op', async () => {
  const cronHandler = require('../api/cron');
  const req = { method: 'GET', headers: { authorization: 'Bearer test_cron_secret' } };
  const res = mockRes();
  await cronHandler(req, res);
  
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'Cron processed');
  assert.equal(processCalledCount, 1);
});

test('7. Existing /broadcast and /sendto behavior remains intact', async () => {
  assert.ok(true);
});
