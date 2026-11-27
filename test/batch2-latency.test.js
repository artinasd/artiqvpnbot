const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../lib/storage');
const botConfig = require('../lib/bot-config');
const forceJoin = require('../lib/force-join');
const requestContext = require('../lib/request-context');

test('storage.scard counts set members and requestContext memoizes user/state reads', async () => {
  await storage.sadd('batch2:set', 'a');
  await storage.sadd('batch2:set', 'b');
  assert.equal(await storage.scard('batch2:set'), 2);
  assert.equal(await storage.scard('batch2:empty'), 0);

  await requestContext.runWithUpdate({ message: { from: { id: 88001 } } }, async () => {
    await storage.set('user:88001', { telegramUserId: 88001, name: 'v1' });
    const first = await storage.get('user:88001');
    const second = await storage.get('user:88001');
    assert.strictEqual(first, second);

    await storage.set('state:user:88001', { stage: 'TEST' });
    const s1 = await storage.get('state:user:88001');
    const s2 = await storage.get('state:user:88001');
    assert.strictEqual(s1, s2);

    await storage.del('state:user:88001');
    assert.equal(await storage.get('state:user:88001'), null);
  });
});

test('botConfig.getConfig memoizes normalized config per request and invalidates on saveConfig', async () => {
  await requestContext.runWithUpdate({ message: { from: { id: 88001 } } }, async () => {
    const c1 = await botConfig.getConfig();
    const c2 = await botConfig.getConfig();
    assert.strictEqual(c1, c2);

    await botConfig.saveConfig({ bot: { maintenanceMode: false } });
    const c3 = await botConfig.getConfig();
    assert.notStrictEqual(c1, c3);
  });
});

test('forceJoin.createGateMiddleware answers blocked callback queries and delegates verified main menu', async () => {
  await botConfig.saveConfig({
    bot: {
      forceJoin: {
        enabled: true,
        message: 'Join first',
        channels: [{ title: 'Ch1', chatId: '@ch1', joinUrl: 'https://t.me/ch1' }],
      },
    },
  });

  let answered = false;
  let prompted = false;
  const gate = forceJoin.createGateMiddleware({
    sendMainMenu: async (ctx) => ctx.reply('CUSTOM_MAIN_MENU'),
  });

  await gate({
    from: { id: 77001 },
    chat: { type: 'private' },
    callbackQuery: { data: 'main_buy' },
    telegram: { getChatMember: async () => ({ status: 'left' }) },
    answerCbQuery: async () => { answered = true; },
    reply: async () => { prompted = true; },
  }, async () => {});

  assert.equal(answered, true);
  assert.equal(prompted, true);

  let sentText = null;
  await gate({
    from: { id: 77001 },
    chat: { type: 'private' },
    callbackQuery: { data: 'force_join_check' },
    telegram: { getChatMember: async () => ({ status: 'member' }) },
    answerCbQuery: async () => {},
    reply: async (text) => { sentText = text; },
  }, async () => {});

  assert.equal(sentText, 'CUSTOM_MAIN_MENU');

  await botConfig.saveConfig({ bot: { forceJoin: { enabled: false, channels: [] } } });
});
