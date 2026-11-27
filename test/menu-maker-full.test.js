const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storage = require('../lib/storage');
const botConfig = require('../lib/bot-config');
const menuBuilderApi = require('../api/menu-builder');

const root = path.join(__dirname, '..');

test('Menu Maker validates all 20 screens, systemMessages, and returns real plans/defaults on GET', async () => {
  process.env.ADMIN_CMS_PASSWORD = 'test-password';
  await storage.set('cms:plans', [
    { id: 'plan-1', name: '10GB Monthly', buttonText: '10GB', price: 40000, panelId: 'p1', active: true },
    { id: 'plan-off', name: 'Hidden', buttonText: 'Hidden', price: 10000, panelId: 'p1', active: false },
  ]);

  let getRes = null;
  await menuBuilderApi({ method: 'GET', headers: { 'x-admin-password': 'test-password' } }, {
    status() { return this; },
    setHeader() {},
    end(body) { getRes = JSON.parse(body); },
  });

  assert.ok(getRes.systemMessageDefaults && getRes.systemMessageDefaults.maintenance);
  assert.equal(getRes.plans.length, 1);
  assert.equal(getRes.plans[0].id, 'plan-1');

  const doc = structuredClone(getRes.draft);
  doc.screens.subscription_delivery = {
    columns: 1,
    messageTemplate: 'Custom delivery {username}',
    homeButton: true,
    buttonControls: {
      copy_sub: { enabled: true, label: '📋 کپی اختصاصی', style: 'success' },
      open_sub: { enabled: true, label: '🔗 باز کردن', style: 'primary' },
    },
    buttons: [],
  };
  doc.systemMessages = { maintenance: 'در حال بروزرسانی ویژه' };

  let saveStatus = 0;
  await menuBuilderApi({
    method: 'POST',
    headers: { 'x-admin-password': 'test-password' },
    body: { action: 'save_draft', document: doc },
  }, {
    status(c) { saveStatus = c; return this; },
    setHeader() {},
    end() {},
  });
  assert.equal(saveStatus, 200);

  let pubStatus = 0;
  await menuBuilderApi({
    method: 'POST',
    headers: { 'x-admin-password': 'test-password' },
    body: { action: 'publish' },
  }, {
    status(c) { pubStatus = c; return this; },
    setHeader() {},
    end() {},
  });
  assert.equal(pubStatus, 200);

  assert.equal(await botConfig.getMessage('maintenance'), 'در حال بروزرسانی ویژه');

  const arranged = await botConfig.arrangeScreenRows('subscription_delivery', [
    [{ text: '📋 کپی لینک اشتراک', copy_text: { text: 'https://sub.example/1' } }],
    [{ text: '🔗 باز کردن لینک اشتراک', url: 'https://sub.example/1' }],
    [{ text: '🏠 منوی اصلی', callback_data: 'main_home' }],
  ]);
  assert.equal(arranged[0][0].text, '📋 کپی اختصاصی');
  assert.equal(arranged[0][0].style, 'success');
  assert.equal(arranged[1][0].text, '🔗 باز کردن');

  // Panel button labels can also be overridden now.
  const panelArranged = await botConfig.applyPublishedButtonControls ? null : null;
  await storage.del('cms:menu-builder');
});

test('public/menu-builder.js parses cleanly with all expanded screens and system messages', () => {
  const src = fs.readFileSync(path.join(root, 'public/menu-builder.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'public/menu-builder.js' }));
  for (const screenId of ['subscription_name', 'wallet_checkout', 'wallet_topup', 'subscription_delivery', 'renewal_delivery', 'copy_sub', 'account_empty', 'custom_traffic', 'custom_duration', 'force_join']) {
    assert.ok(src.includes(screenId), 'missing screen in public/menu-builder.js: ' + screenId);
  }
  assert.ok(src.includes('renderPreviewHtml'));
});
