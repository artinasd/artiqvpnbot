process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';
process.env.ADMIN_CMS_PASSWORD = '';
process.env.BOT_TOKEN = '123456:GROUP6_TEST_TOKEN';
process.env.ADMIN_ID = '999999999';
process.env.WEBHOOK_SECRET = 'group6-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const crypto = require('node:crypto');

const cmsAuth = require('../lib/cms-auth');
const network = require('../lib/panel-network');
const panelRegistry = require('../lib/panel-registry');
const panelConnection = require('../lib/panel-connection');
const { createDynamicPasarGuardProvider } = require('../lib/dynamic-pasarguard');
const { normalizeDigits, parseDurationDays } = require('../lib/plans');

function responseMock() {
  return {
    statusCode: 200, headers: {}, body: '',
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
  };
}

test('CMS secrets use timing-safe digest comparison and reject empty or non-string values', () => {
  assert.equal(cmsAuth.secretsEqual('secret', 'secret'), true);
  assert.equal(cmsAuth.secretsEqual('secret', 'secreu'), false);
  assert.equal(cmsAuth.secretsEqual('secret', 'secret-long'), false);
  assert.equal(cmsAuth.secretsEqual('', ''), false);
  assert.equal(cmsAuth.secretsEqual('secret', ''), false);
  assert.equal(cmsAuth.secretsEqual('secret', ['secret']), false);
  assert.equal(cmsAuth.secretsEqual(['secret'], 'secret'), false);

  assert.equal(cmsAuth.isAuthorizedAdmin({ headers: { 'x-admin-password': 'secret' } }, 'secret'), true);
  assert.equal(cmsAuth.isAuthorizedAdmin({ headers: { 'X-Admin-Password': 'secret' } }, 'secret'), true);
  assert.equal(cmsAuth.isAuthorizedAdmin({ headers: { 'x-admin-password': ['secret'] } }, 'secret'), false);
  const previous = process.env.ADMIN_CMS_PASSWORD;
  delete process.env.ADMIN_CMS_PASSWORD;
  assert.equal(cmsAuth.isAuthorizedAdmin({ headers: { 'x-admin-password': 'anything' } }), false);
  if (previous !== undefined) process.env.ADMIN_CMS_PASSWORD = previous;
});

test('sendJson sets JSON content type and private no-store cache policy', () => {
  const res = responseMock();
  const returned = cmsAuth.sendJson(res, 201, { ok: true });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['Cache-Control'], 'no-store, private');
  assert.equal(res.body, '{"ok":true}');
  assert.equal(returned, res);
});

test('CMS variables, legacy report, and wallet APIs reject unauthenticated GET and POST requests', async () => {
  const endpoints = [
    require('../api/admin-variables'),
    require('../api/admin-legacy-plan-report'),
    require('../api/admin-wallet'),
  ];
  for (const handler of endpoints) {
    for (const method of ['GET', 'POST']) {
      const res = responseMock();
      await handler({ method, headers: {}, query: {}, body: {} }, res);
      assert.equal(res.statusCode, 401, method);
      assert.equal(JSON.parse(res.body).error, 'UNAUTHORIZED');
      assert.equal(res.headers['Cache-Control'], 'no-store, private');
      assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
    }
  }
});

test('shared panel network guards reject local and mapped-private destinations but allow public IPv6', async () => {
  const rejected = [
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:169.254.169.254]',
    'https://[::ffff:10.0.0.1]',
    'https://localhost',
    'https://node.local',
  ];
  for (const value of rejected) {
    await assert.rejects(network.assertPublicHttpsUrl(value), { message: 'PANEL_URL_HOST_NOT_ALLOWED' });
    assert.throws(() => panelRegistry.validatePanelInput({ name: 'Panel', type: 'pasarguard', baseUrl: value }), { message: 'PANEL_URL_HOST_NOT_ALLOWED' });
  }
  await network.assertPublicHttpsUrl('https://[::ffff:8.8.8.8]');
  await network.assertPublicHttpsUrl('https://[2606:4700:4700::1111]');
  assert.doesNotThrow(() => panelRegistry.validatePanelInput({ name: 'Public mapped IPv4', type: 'pasarguard', baseUrl: 'https://[::ffff:8.8.8.8]' }));
  assert.doesNotThrow(() => panelRegistry.validatePanelInput({ name: 'Public IPv6', type: 'pasarguard', baseUrl: 'https://[2606:4700:4700::1111]' }));
  assert.equal(network.isPrivateAddress('2606:4700:4700::1111'), false);
  assert.equal(network.isPrivateAddress('::ffff:7f00:1'), true);
  assert.equal(network.isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(network.isDisallowedHostname('[LOCALHOST]'), true);
  assert.equal(typeof panelConnection.testPasarGuardConnection, 'function');
});

test('readTextBounded preserves UTF-8 split across chunks and enforces byte limit', async () => {
  const bytes = Buffer.from('سلام، دنیا', 'utf8');
  const chunks = [bytes.subarray(0, 2), bytes.subarray(2, 5), bytes.subarray(5)];
  let index = 0;
  const response = { body: { getReader: () => ({
    async read() { return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }; },
    async cancel() {},
  }) } };
  assert.equal(await network.readTextBounded(response, 100), 'سلام، دنیا');

  let cancelled = false;
  const tooLarge = { body: { getReader: () => ({
    async read() { return { done: false, value: Buffer.from('oversized') }; },
    async cancel() { cancelled = true; },
  }) } };
  await assert.rejects(network.readTextBounded(tooLarge, 2), { message: 'PANEL_RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, true);
  await assert.rejects(network.readTextBounded({ text: async () => 'بیش از حد' }, 1), { message: 'PANEL_RESPONSE_TOO_LARGE' });
});

test('dynamic PasarGuard authentication maps malformed token responses to PANEL_INVALID_RESPONSE', async () => {
  const provider = createDynamicPasarGuardProvider('panel-test', {
    getPanel: async () => ({ id: 'panel-test', baseUrl: 'https://8.8.8.8', updatedAt: 'v1' }),
    getCredentials: async () => ({ username: 'tester', password: 'secret' }),
    checkUrl: async () => {},
    fetchImpl: async () => ({
      status: 200, ok: true, body: null,
      async text() { return '<html>not JSON</html>'; },
    }),
  });
  await assert.rejects(provider.health(), { message: 'PANEL_INVALID_RESPONSE' });
});

test('Persian and Arabic-Indic digits normalize before duration parsing', () => {
  assert.equal(normalizeDigits('۳۰ روزه'), '30 روزه');
  assert.equal(normalizeDigits('١٥ روزه'), '15 روزه');
  assert.equal(parseDurationDays('۳۰ روزه'), 30);
  assert.equal(parseDurationDays('١٥ روزه'), 15);
});

test('webhook validates secret and payload shape, and per-update replies receive HTML parse mode', async () => {
  const nativeTelegraf = require('telegraf');
  class TestTelegraf extends nativeTelegraf.Telegraf {
    constructor(token, options = {}) {
      let owner;
      class TestContext extends nativeTelegraf.Context {
        constructor(update, tg, botInfo) {
          tg.callApi = (method, payload = {}, ...args) => owner.telegram.callApi(method, payload, ...args);
          super(update, tg, botInfo);
        }
      }
      super(token, { ...options, contextType: TestContext });
      owner = this;
      this.apiCalls = [];
      TestTelegraf.instances.push(this);
      this.botInfo = { id: 1, is_bot: true, first_name: 'TestBot', username: 'test_bot' };
      this.telegram.callApi = async (method, payload = {}) => {
        this.apiCalls.push({ method, payload });
        if (method === 'sendMessage') return {
          message_id: this.apiCalls.length, date: 1,
          chat: { id: payload.chat_id, type: 'private' }, text: payload.text,
        };
        if (method === 'getChatMember') return { status: 'left' };
        return true;
      };
    }
  }
  TestTelegraf.instances = [];
  const originalLoad = Module._load;
  let webhook;
  try {
    Module._load = function(request, parent, isMain) {
      if (request === 'telegraf') return { ...nativeTelegraf, Telegraf: TestTelegraf };
      return originalLoad.call(this, request, parent, isMain);
    };
    webhook = require('../api/index');
  } finally {
    Module._load = originalLoad;
  }
  const bot = TestTelegraf.instances[0];
  assert.ok(bot);

  const wrongSecret = responseMock();
  await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, body: {} }, wrongSecret);
  assert.equal(wrongSecret.statusCode, 403);
  for (const body of [[], 'not-an-object']) {
    const invalid = responseMock();
    await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'group6-secret' }, body }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body, 'Invalid update payload');
  }

  const senderless = {
    update_id: 7001,
    message: { message_id: 7001, date: 1, text: 'hello', chat: { id: 7001, type: 'private' } },
  };
  const senderlessResponse = responseMock();
  await webhook({ method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'group6-secret' }, body: senderless }, senderlessResponse);
  assert.equal(senderlessResponse.statusCode, 200);
  await assert.doesNotReject(() => require('../lib/request-context').runWithUpdate(senderless, () => bot.handleUpdate(senderless)));

  bot.on('message', async (ctx) => ctx.reply('<b>سلام</b>'));
  const htmlUpdate = {
    update_id: 7002,
    message: {
      message_id: 7002, date: 1, text: 'html-check',
      chat: { id: 7002, type: 'private' },
      from: { id: 7002, is_bot: false, first_name: 'Tester' },
    },
  };
  await require('../lib/request-context').runWithUpdate(htmlUpdate, () => bot.handleUpdate(htmlUpdate));
  const sent = bot.apiCalls.filter((call) => call.method === 'sendMessage' && call.payload.text === '<b>سلام</b>').at(-1);
  assert.ok(sent);
  assert.equal(sent.payload.parse_mode, 'HTML');
});

test('Group 6 JavaScript files have valid syntax', () => {
  const files = [
    'api/admin.js', 'api/panels.js', 'api/menu-builder.js',
    'api/admin-active-users.js', 'api/admin-wallet.js', 'api/admin-debt.js',
    'api/admin-variables.js', 'api/admin-legacy-plan-report.js',
    'api/admin-direct2.js', 'api/admin-tunnel2.js', 'api/index.js',
    'lib/cms-auth.js', 'lib/panel-network.js', 'lib/panel-connection.js',
    'lib/panel-registry.js', 'lib/dynamic-pasarguard.js', 'lib/html.js',
    'lib/account-ui.js', 'lib/user-report.js', 'lib/purchase-report.js',
    'lib/plans.js', 'test/menu-builder.test.js', 'test/group6-security.test.js',
  ];
  const root = path.join(__dirname, '..');
  for (const file of files) execFileSync(process.execPath, ['-c', path.join(root, file)]);
});
