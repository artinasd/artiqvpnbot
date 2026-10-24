const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('menu builder API and browser editor have valid JavaScript syntax', () => {
  for (const file of ['api/menu-builder.js', 'public/menu-builder.js']) {
    assert.doesNotThrow(() => new vm.Script(source(file), { filename: file }), file);
  }
});

test('CMS loads the editor and exposes it in the authenticated sidebar', () => {
  assert.match(source('public/admin-cms.js'), /menu-builder\.js/);
  assert.match(source('public/admin-cms.js'), /menu-builder\.css/);
  assert.match(source('public/admin-shell.js'), /#menuBuilderCard/);
  assert.ok(fs.existsSync(path.join(root, 'public/menu-builder.css')));
});

test('published menu renderer supports only registered actions and menu navigation', () => {
  const api = source('api/menu-builder.js');
  const runtime = source('lib/bot-config.js');
  for (const action of ['test_services', 'buy_services', 'wallet', 'account', 'support', 'renew', 'navigate_menu', 'open_url', 'back_home']) {
    assert.ok(api.includes(action), 'missing action registry entry: ' + action);
  }
  assert.match(api, /Only HTTPS links are allowed/);
  assert.match(api, /A menu with ID "main" is required/);
  assert.match(runtime, /getPublishedMenu/);
  assert.match(runtime, /menu_nav:/);
  assert.match(source('api/index.js'), /getMenuKeyboard\('main'\)/);
  assert.match(runtime, /arrangeScreenRows/);
  assert.match(runtime, /formatScreenMessage/);
  assert.match(source('api/index.js'), /plans_buy/);
  assert.match(source('api/index.js'), /account_detail/);
  assert.match(source('lib/account-ui.js'), /options\.confirmLabel/);
  assert.match(source('public/menu-builder.js'), /تنظیمات منوهای پویا/);
  assert.match(source('public/menu-builder.js'), /رنگ دکمه در تلگرام/);
});
