process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Telegraf } = require('telegraf');
const storage = require('../lib/storage');
const requestContext = require('../lib/request-context');
const { createDynamicPasarGuardProvider } = require('../lib/dynamic-pasarguard');
const forceJoin = require('../lib/force-join');
const botConfig = require('../lib/bot-config');
const qr = require('../lib/qr');
const sharp = require('sharp');

test('storage.mget preserves key order and in-memory expiration behavior', async () => {
  await storage.set('g3:mget:a', { value: 1 });
  await storage.set('g3:mget:b', { value: 2 }, { exSeconds: 30 });
  assert.deepEqual(await storage.mget(['g3:mget:b', 'g3:mget:missing', 'g3:mget:a']), [
    { value: 2 }, null, { value: 1 },
  ]);
  await storage.del('g3:mget:a');
  await storage.del('g3:mget:b');
});

test('CMS memoization is request-scoped, deduplicates reads, and invalidates immediately on set/del', async () => {
  await storage.set('cms:plans', [{ id: 'before' }]);
  const bot = new Telegraf('123456:TEST_TOKEN');
  bot.botInfo = { id: 123456, is_bot: true, first_name: 'Test', username: 'test_bot' };
  const observed = [];
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== 5001) return next();
    const first = await storage.get('cms:plans');
    const second = await storage.get('cms:plans');
    observed.push(first === second);
    requestContext.setUserId('changed-within-update');
    observed.push(requestContext.getUserId());
    await storage.set('cms:plans', [{ id: 'after-set' }]);
    observed.push((await storage.get('cms:plans'))[0].id);
    await storage.del('cms:plans');
    observed.push(await storage.get('cms:plans'));
  });
  const update = (id) => ({
    update_id: id,
    message: {
      message_id: id, date: 1, text: 'test',
      chat: { id: 1000 + id, type: 'private' },
      from: { id: 5000 + id, is_bot: false, first_name: 'Tester' },
    },
  });
  await bot.handleUpdate(update(1));
  assert.deepEqual(observed, [true, 'changed-within-update', 'after-set', null]);

  await storage.set('cms:plans', [{ id: 'next-request' }]);
  let nextValue;
  bot.use(async () => { nextValue = await storage.get('cms:plans'); });
  await bot.handleUpdate(update(2));
  assert.equal(nextValue[0].id, 'next-request');
  await storage.del('cms:plans');
});

test('persistUser skips only fresh active unchanged users and persists stale/profile/status changes', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
  const match = source.match(/async function persistUser\(ctx\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'persistUser must remain defined in api/index.js');
  const persistUser = new Function('storage', 'userSnapshot', `return (${match[0]});`);
  const snapshot = { telegramUserId: 7, username: 'same', firstName: 'Same', lastName: null };
  const ctx = { from: { id: 7 } };
  const recent = { ...snapshot, botStatus: 'active', lastSeenAt: new Date(Date.now() - 60_000).toISOString() };
  let saves = 0;
  let current = recent;
  const mockStorage = {
    getUserRaw: async () => current,
    saveUser: async (user) => { saves++; return user; },
  };
  const makeSnapshot = () => ({ ...snapshot });
  await persistUser(mockStorage, makeSnapshot)(ctx);
  assert.equal(saves, 0);

  current = { ...recent, lastSeenAt: new Date(Date.now() - 16 * 60_000).toISOString() };
  await persistUser(mockStorage, makeSnapshot)(ctx);
  assert.equal(saves, 1);

  current = recent;
  await persistUser(mockStorage, () => ({ ...snapshot, firstName: 'Changed' }))(ctx);
  assert.equal(saves, 2);

  current = { ...recent, botStatus: 'blocked' };
  await persistUser(mockStorage, makeSnapshot)(ctx);
  assert.equal(saves, 3);
});

test('dynamic PasarGuard createUser reuses one authentication for groups and creation', async () => {
  let authCalls = 0;
  const calls = [];
  const provider = createDynamicPasarGuardProvider('panel-single-login', {
    getPanel: async () => ({ id: 'panel-single-login', baseUrl: 'https://panel.example.test', updatedAt: 'v1' }),
    getCredentials: async () => ({ username: 'admin', password: 'secret' }),
    checkUrl: async () => {},
    fetchImpl: async (url, options) => {
      const target = String(url);
      calls.push({ target, authorization: options.headers?.Authorization });
      if (target.endsWith('/api/admin/token')) {
        authCalls++;
        return new Response(JSON.stringify({ access_token: 'token-one' }), { status: 200 });
      }
      if (target.endsWith('/api/groups/simple')) return new Response(JSON.stringify([{ id: 3 }]), { status: 200 });
      return new Response(JSON.stringify({ id: 9, username: 'new-user' }), { status: 200 });
    },
  });
  const created = await provider.createUser({ username: 'new-user', trafficBytes: 1000, hwidLimit: 1 });
  assert.equal(created.id, 9);
  assert.equal(authCalls, 1);
  assert.equal(calls.filter((call) => call.authorization === 'Bearer token-one').length, 2);
});

test('dynamic PasarGuard refreshes an expired token once after HTTP 401', async () => {
  let authCalls = 0;
  let apiCalls = 0;
  const provider = createDynamicPasarGuardProvider('panel-refresh', {
    getPanel: async () => ({ id: 'panel-refresh', baseUrl: 'https://panel.example.test' }),
    getCredentials: async () => ({ username: 'admin', password: 'secret' }),
    checkUrl: async () => {},
    fetchImpl: async (url, options) => {
      if (String(url).endsWith('/api/admin/token')) {
        authCalls++;
        return new Response(JSON.stringify({ access_token: `token-${authCalls}` }), { status: 200 });
      }
      apiCalls++;
      if (options.headers.Authorization === 'Bearer token-1') return new Response(JSON.stringify({ detail: 'expired' }), { status: 401 });
      return new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
    },
  });
  const groups = await provider.getGroups();
  assert.equal(groups.length, 1);
  assert.equal(authCalls, 2);
  assert.equal(apiCalls, 2);
});

test('force-join checks channels concurrently and caches positive membership only', async () => {
  const originalGetConfig = botConfig.getConfig;
  let config = { bot: { forceJoin: { enabled: true, channels: [
    { title: 'A', chatId: '@a', joinUrl: 'https://t.me/a' },
    { title: 'B', chatId: '@b', joinUrl: 'https://t.me/b' },
  ] } } };
  botConfig.getConfig = async () => config;
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const ctx = {
    from: { id: 7001 },
    telegram: {
      getChatMember: async () => {
        calls++;
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return { status: 'member' };
      },
    },
  };
  try {
    const first = await forceJoin.membershipStatus(ctx);
    assert.equal(first.joined, true);
    assert.equal(maximumActive, 2);
    assert.equal(calls, 2);
    const cached = await forceJoin.membershipStatus(ctx);
    assert.equal(cached.cached, true);
    assert.equal(calls, 2);

    config = { bot: { forceJoin: { enabled: true, channels: [
      { title: 'A', chatId: '@a', joinUrl: 'https://t.me/a' },
      { title: 'C', chatId: '@c', joinUrl: 'https://t.me/c' },
    ] } } };
    const changed = await forceJoin.membershipStatus(ctx);
    assert.equal(changed.joined, true);
    assert.equal(calls, 4);
  } finally {
    botConfig.getConfig = originalGetConfig;
    await storage.del('force-join:ok:7001');
  }
});

test('force-join never caches negative results and handleCheck bypasses positive cache', async () => {
  const originalGetConfig = botConfig.getConfig;
  botConfig.getConfig = async () => ({ buttons: {}, bot: { forceJoin: { enabled: true, channels: [
    { title: 'A', chatId: '@a', joinUrl: 'https://t.me/a' },
  ] } } });
  let calls = 0;
  const ctx = {
    from: { id: 7002 },
    telegram: { getChatMember: async () => { calls++; return { status: calls === 1 ? 'left' : 'member' }; } },
    answerCbQuery: async () => {},
    reply: async () => {},
  };
  try {
    assert.equal((await forceJoin.membershipStatus(ctx)).joined, false);
    assert.equal((await forceJoin.membershipStatus(ctx)).joined, true);
    assert.equal(calls, 2);
    await forceJoin.handleCheck(ctx);
    assert.equal(calls, 3);
  } finally {
    botConfig.getConfig = originalGetConfig;
    await storage.del('force-join:ok:7002');
  }
});

test('QR output is a valid PNG and reuses one prepared template for repeated calls', async () => {
  const first = await qr.createSubscriptionQr('https://example.com/sub/first');
  const before = qr.getTemplateCacheSize();
  const second = await qr.createSubscriptionQr('https://example.com/sub/second');
  assert.deepEqual(first.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.deepEqual(second.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const metadata = await sharp(first).metadata();
  assert.ok(metadata.width > 0 && metadata.height > 0);
  assert.equal(qr.getTemplateCacheSize(), before);
});

test('all Group 3 production files pass Node syntax checks', () => {
  const files = [
    'api/index.js',
    'lib/request-context.js',
    'lib/storage.js',
    'lib/plan-store.js',
    'lib/dynamic-pasarguard.js',
    'lib/force-join.js',
    'lib/qr.js',
  ];
  for (const file of files) execFileSync(process.execPath, ['-c', path.join(__dirname, '..', file)]);
});
