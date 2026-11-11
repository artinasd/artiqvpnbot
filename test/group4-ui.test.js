process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Markup } = require('telegraf');
const storage = require('../lib/storage');
const botConfig = require('../lib/bot-config');
const accountUI = require('../lib/account-ui');

async function publishMenus(menus) {
  await storage.set('cms:menu-builder', { published: { menus } });
}

test('Menu Builder panel selectors resolve serviceId and legacy panelId for buy and test', async () => {
  const buttons = [
    { label: 'Buy serviceId', action: 'select_panel_buy', params: { serviceId: 'panel_abc' } },
    { label: 'Test serviceId', action: 'select_panel_test', params: { serviceId: 'panel_abc' } },
    { label: 'Buy legacy', action: 'select_panel_buy', params: { panelId: 'abc' } },
    { label: 'Test legacy', action: 'select_panel_test', params: { panelId: 'abc' } },
  ];
  try {
    await publishMenus([{ id: 'main', rows: buttons.map((button) => ({ buttons: [button] })) }]);
    const keyboard = await botConfig.getMenuKeyboard('main');
    assert.deepEqual(keyboard.reply_markup.inline_keyboard.map((row) => row[0].callback_data), [
      'service_buy_panel_abc',
      'service_test_panel_abc',
      'service_buy_panel_abc',
      'service_test_panel_abc',
    ]);
    assert.ok(keyboard.reply_markup.inline_keyboard.every((row) => !row[0].__artiqGlass));
  } finally {
    await storage.del('cms:menu-builder');
  }
});

test('inline keyboards are not globally modified; Menu Builder homeButton false/true is respected', async () => {
  const admin = Markup.inlineKeyboard([[Markup.button.callback('Approve', 'wallet_approve_order')]]);
  assert.deepEqual(admin.reply_markup.inline_keyboard.map((row) => row.map((button) => button.callback_data)), [['wallet_approve_order']]);

  try {
    await publishMenus([
      { id: 'main', rows: [{ buttons: [{ label: 'Custom', action: 'support' }] }] },
      { id: 'no-home', homeButton: false, rows: [{ buttons: [{ label: 'Support', action: 'support' }] }] },
      { id: 'with-home', rows: [{ buttons: [{ label: 'Support', action: 'support' }] }] },
    ]);
    const main = await botConfig.getMenuKeyboard('main');
    const noHome = await botConfig.getMenuKeyboard('no-home');
    const withHome = await botConfig.getMenuKeyboard('with-home');
    assert.equal(main.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === 'main_home'), false);
    assert.equal(noHome.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === 'main_home'), false);
    assert.equal(withHome.reply_markup.inline_keyboard.flat().some((button) => button.callback_data === 'main_home'), true);
  } finally {
    await storage.del('cms:menu-builder');
  }
});

test('account detail escapes HTML metacharacters in every dynamic field and preserves newlines', () => {
  const message = accountUI.formatDetail({
    planName: '<plan & name>',
    service: 'svc <&>',
    status: 'active <&>',
    traffic: '10 <&> GB',
    duration: '30 <&>',
    expiresAt: '2030<&>',
    canRenew: false,
  });
  assert.match(message, /&lt;plan &amp; name&gt;/);
  assert.match(message, /svc &lt;&amp;&gt;/);
  assert.match(message, /active &lt;&amp;&gt;/);
  assert.match(message, /10 &lt;&amp;&gt; GB/);
  assert.match(message, /30 &lt;&amp;&gt; روز/);
  assert.match(message, /2030&lt;&amp;&gt;/);
  assert.ok(message.includes('\n'));
  assert.doesNotMatch(message, /<(?:plan|&)/);
});

test('Node syntax checks all edited Group 4 JavaScript files', () => {
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  for (const file of ['api/index.js', 'lib/account-ui.js', 'lib/bot-config.js', 'test/group4-ui.test.js']) {
    execFileSync(process.execPath, ['-c', path.join(__dirname, '..', file)]);
  }
});

test('account_remove fallback uses real paragraph breaks, not double-escaped newlines', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
  const handlerStart = apiSource.indexOf("if(data.startsWith('account_remove:'))");
  assert.notEqual(handlerStart, -1, 'account_remove handler must exist');
  const detailStart = apiSource.indexOf("if(data.startsWith('account_sub:')", handlerStart);
  const handler = apiSource.slice(handlerStart, detailStart === -1 ? undefined : detailStart);
  const fallbackMatch = handler.match(/const fallback = `([\s\S]*?)`;/);
  assert.ok(fallbackMatch, 'account_remove fallback template must exist');
  assert.doesNotMatch(fallbackMatch[1], /\\\\n/, 'fallback must not contain double-escaped newline sequences');
});
