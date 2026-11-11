process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';
process.env.BOT_TOKEN = '123456:TEST_TOKEN';
process.env.ADMIN_ID = '999999999';
process.env.WEBHOOK_SECRET = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const nativeTelegraf = require('telegraf');
const { Telegraf, Markup } = nativeTelegraf;
const storage = require('../lib/storage');
const requestContext = require('../lib/request-context');
const forceJoin = require('../lib/force-join');
const accountUI = require('../lib/account-ui');
const botConfig = require('../lib/bot-config');

class TestTelegraf extends Telegraf {
  constructor(token) {
    super(token);
    this.apiCalls = [];
    TestTelegraf.instances.push(this);
    this.botInfo = { id: 1, is_bot: true, first_name: 'TestBot', username: 'test_bot' };
    this.telegram.callApi = async (method, payload = {}) => {
      this.apiCalls.push({ method, payload });
      if (method === 'getChatMember') return { status: 'left' };
      if (method === 'sendMessage') {
        return { message_id: this.apiCalls.length, date: 1, chat: { id: payload.chat_id, type: 'private' }, text: payload.text };
      }
      return true;
    };
  }
}
TestTelegraf.instances = [];

let webhookHandler;
const originalLoad = Module._load;
try {
  Module._load = function(request, parent, isMain) {
    if (request === 'telegraf') return { ...nativeTelegraf, Telegraf: TestTelegraf };
    return originalLoad.call(this, request, parent, isMain);
  };
  webhookHandler = require('../api/index');
} finally {
  Module._load = originalLoad;
}

function makeMessageUpdate(updateId, userId, text) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1,
      text,
      chat: { id: userId, type: 'private' },
      from: { id: userId, is_bot: false, first_name: 'Tester' },
    },
  };
}

function makeCallbackUpdate(updateId, userId, data) {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: { id: userId, is_bot: false, first_name: 'Tester' },
      chat_instance: 'test-chat',
      data,
      message: {
        message_id: updateId,
        date: 1,
        text: 'Menu',
        chat: { id: userId, type: 'private' },
      },
    },
  };
}

async function invokeWebhook(update) {
  let statusCode;
  let responseBody;
  const response = {
    status(code) { statusCode = code; return this; },
    send(body) { responseBody = body; return this; },
  };
  await webhookHandler({ method: 'POST', headers: {}, body: update }, response);
  assert.equal(statusCode, 200);
  assert.equal(responseBody, 'OK');
}

function latestUserMessage(calls, userId) {
  return calls.filter((call) => call.method === 'sendMessage' && String(call.payload.chat_id) === String(userId)).at(-1);
}

test('requiring bot modules does not mutate Telegraf.prototype or Markup', () => {
  assert.equal(Telegraf.prototype.__artiqRequestContextPatched, undefined);
  assert.equal(Telegraf.prototype.__artiqForceJoinPatched, undefined);
  assert.equal(Telegraf.prototype.__artiqMainMenuCallbackPatched, undefined);
  assert.equal(Markup.__artiqMainMenuPatched, undefined);
  assert.equal(Markup.__artiqInlineHomePatched, undefined);
  assert.equal(typeof requestContext.middleware, 'function');
  assert.equal(typeof forceJoin.gateMiddleware, 'function');
  assert.equal(typeof accountUI.subscriptionKeyboard, 'function');
});

test('native reply keyboards stay native and the default main menu is a four-row inline keyboard', () => {
  const replyKeyboard = Markup.keyboard([['A'], ['B'], ['C'], ['D'], ['E']]).resize();
  assert.equal(replyKeyboard.reply_markup.keyboard.length, 5);
  assert.equal(replyKeyboard.reply_markup.resize_keyboard, true);

  const inline = botConfig.buildDefaultMainMenuKeyboard({
    test: 'Test',
    buy: 'Buy',
    wallet: 'Wallet',
    account: 'Account',
    support: 'Support',
  });
  assert.deepEqual(inline.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data)), [
    ['main_test'],
    ['main_buy'],
    ['main_wallet', 'main_account'],
    ['main_support'],
  ]);
  assert.deepEqual(inline.reply_markup.inline_keyboard.map((row) => row.map((button) => button.text)), [
    ['Test'],
    ['Buy'],
    ['Wallet', 'Account'],
    ['Support'],
  ]);
});

test('webhook explicitly routes main menu, wallet, support, published menus, and force-join', async () => {
  const userId = 51001;
  const menuState = {
    published: {
      menus: [{
        id: 'published-submenu',
        text: 'Published submenu',
        rows: [{ buttons: [{ label: 'Wallet', action: 'wallet' }] }],
      }],
      screens: {},
    },
  };
  await storage.set('cms:menu-builder', menuState);
  await botConfig.saveConfig({ bot: { maintenanceMode: false, forceJoin: { enabled: false, channels: [] } } });

  await invokeWebhook(makeMessageUpdate(1, userId, '/start'));
  const apiInstance = TestTelegraf.instances.at(-1);
  const startMessage = latestUserMessage(apiInstance.apiCalls, userId);
  assert.ok(startMessage, 'start should send a message to the requesting user');
  assert.deepEqual(startMessage.payload.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data)), [
    ['main_test'],
    ['main_buy'],
    ['main_wallet', 'main_account'],
    ['main_support'],
  ]);

  const cases = [
    ['main_home', (keyboard) => assert.deepEqual(keyboard.map((row) => row.map((button) => button.callback_data)), [
      ['main_test'], ['main_buy'], ['main_wallet', 'main_account'], ['main_support'],
    ])],
    ['main_wallet', (keyboard) => assert.ok(keyboard.flat().some((button) => button.callback_data === 'main_home'))],
    ['main_support', (keyboard) => assert.ok(keyboard.flat().some((button) => button.callback_data === 'main_home'))],
    ['menu_nav:screen_wallet', (keyboard) => assert.ok(keyboard.flat().some((button) => button.callback_data === 'main_home'))],
    ['menu_nav:published-submenu', (keyboard) => {
      assert.equal(keyboard[0][0].callback_data, 'main_wallet');
      assert.ok(keyboard.flat().some((button) => button.callback_data === 'main_home'));
    }],
  ];

  for (let index = 0; index < cases.length; index++) {
    const [action, verify] = cases[index];
    const previousMessages = apiInstance.apiCalls.filter((call) => call.method === 'sendMessage' && String(call.payload.chat_id) === String(userId)).length;
    await invokeWebhook(makeCallbackUpdate(10 + index, userId, action));
    const userMessages = apiInstance.apiCalls.filter((call) => call.method === 'sendMessage' && String(call.payload.chat_id) === String(userId));
    assert.equal(userMessages.length, previousMessages + 1, `${action} should send exactly one message`);
    verify(userMessages.at(-1).payload.reply_markup.inline_keyboard);
  }

  await invokeWebhook(makeCallbackUpdate(30, userId, 'menu_nav:missing_menu'));
  assert.equal(latestUserMessage(apiInstance.apiCalls, userId).payload.text, 'This menu is no longer available.');

  await botConfig.saveConfig({
    bot: {
      forceJoin: {
        enabled: true,
        channels: [{ title: 'Required channel', chatId: '@required_channel', joinUrl: 'https://t.me/required_channel' }],
      },
    },
  });
  const beforeGate = apiInstance.apiCalls.length;
  await invokeWebhook(makeMessageUpdate(31, 51002, '/start'));
  const gateCalls = apiInstance.apiCalls.slice(beforeGate);
  assert.ok(gateCalls.some((call) => call.method === 'getChatMember'));
  const gateMessages = gateCalls.filter((call) => call.method === 'sendMessage' && String(call.payload.chat_id) === '51002');
  assert.equal(gateMessages.length, 1, 'the blocked /start must not reach the command handler');
  const gateMessage = gateMessages[0];
  assert.ok(gateMessage.payload.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === 'force_join_check'));
  assert.equal(gateMessage.payload.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === 'main_test'), false);

  await botConfig.saveConfig({ bot: { forceJoin: { enabled: false, channels: [] } } });
  const independent = new TestTelegraf('123:TEST');
  let observedContext = 'not-called';
  independent.command('probe', async (ctx) => {
    observedContext = requestContext.getContext();
    return ctx.reply('probe');
  });
  const callsBeforeIndependent = independent.apiCalls.length;
  await independent.handleUpdate(makeMessageUpdate(32, 51003, '/probe'));
  assert.equal(observedContext, null);
  assert.equal(independent.apiCalls.slice(callsBeforeIndependent).some((call) => call.method === 'getChatMember'), false);
  assert.equal(independent.apiCalls.at(-1).payload.text, 'probe');
  await storage.del('cms:menu-builder');
});

test('broadcast is registered only by admin-messaging and all edited Group 5 files parse', () => {
  const root = path.join(__dirname, '..');
  const apiSource = fs.readFileSync(path.join(root, 'api/index.js'), 'utf8');
  const adminSource = fs.readFileSync(path.join(root, 'lib/admin-messaging.js'), 'utf8');
  assert.equal((apiSource.match(/bot\.command\(['"]broadcast['"]/g) || []).length, 0);
  assert.equal((adminSource.match(/bot\.command\(['"]broadcast['"]/g) || []).length, 1);

  const files = [
    'api/index.js',
    'lib/request-context.js',
    'lib/force-join.js',
    'lib/account-ui.js',
    'lib/bot-config.js',
    'lib/admin-messaging.js',
    'test/group3-performance.test.js',
    'test/group5-cleanup.test.js',
  ];
  for (const file of files) {
    require('node:child_process').execFileSync(process.execPath, ['-c', path.join(root, file)]);
  }
});
