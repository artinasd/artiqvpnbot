process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { serviceName, serviceLabel, getConfiguredServicesWithPanels } = require('../lib/services');

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function createMenuApi(panelCatalog = []) {
  const values = new Map();
  const storage = {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, structuredClone(value)); },
  };
  const mod = { exports: {} };
  const runModule = new Function('require', 'module', 'process', source('api/menu-builder.js'));
  runModule((id) => {
    if (id === '../lib/cms-auth') return require('../lib/cms-auth');
    if (id === '../lib/storage') return storage;
    if (id === '../lib/bot-config') return { getConfig: async () => ({}) };
    if (id === '../lib/services') return { getConfiguredServicesWithPanels: async () => panelCatalog };
    throw new Error('Unexpected module: ' + id);
  }, mod, { env: { ADMIN_CMS_PASSWORD: 'test-password' } });
  async function request({ method = 'POST', action, document, version, password = 'test-password' } = {}) {
    const req = {
      method,
      headers: { 'x-admin-password': password },
      body: { action, ...(document === undefined ? {} : { document }), ...(version === undefined ? {} : { version }) },
    };
    const res = {
      statusCode: 200, headers: {}, body: '',
      status(code) { this.statusCode = code; return this; },
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { this.body = body; return this; },
    };
    await mod.exports(req, res);
    return { status: res.statusCode, body: JSON.parse(res.body) };
  }
  return { request };
}

test('menu builder API and browser editor have valid JavaScript syntax', () => {
  for (const file of ['api/menu-builder.js', 'public/menu-builder.js', 'lib/bot-config.js', 'api/index.js']) {
    try { new vm.Script(source(file), { filename: file }); }
    catch (error) { throw new Error(file + ': ' + error.stack); }
  }
});

test('CMS loads the editor and exposes it in the authenticated sidebar', () => {
  assert.match(source('public/admin-cms.js'), /menu-builder\.js/);
  assert.match(source('public/admin-cms.js'), /menu-builder\.css/);
  assert.match(source('public/admin-shell.js'), /#menuBuilderCard/);
  assert.ok(fs.existsSync(path.join(root, 'public/menu-builder.css')));
});

test('menu API requires authentication and rejects unsafe or invalid menu documents', async () => {
  const { request } = createMenuApi();
  assert.equal((await request({ method: 'GET', password: '' })).status, 401);

  const initial = await request({ method: 'GET' });
  const badUrl = structuredClone(initial.body.draft);
  badUrl.menus[0].rows[0].buttons[0] = {
    id: 'bad-link', label: 'Link', action: 'open_url', params: { url: 'http://example.com' },
  };
  const urlResult = await request({ action: 'save_draft', document: badUrl });
  assert.equal(urlResult.status, 400);
  assert.ok(urlResult.body.errors.some((error) => error.includes('Only HTTPS links are allowed')));

  const badStyle = structuredClone(initial.body.draft);
  badStyle.menus[0].rows[0].buttons[0].style = 'rainbow';
  const styleResult = await request({ action: 'save_draft', document: badStyle });
  assert.equal(styleResult.status, 400);
  assert.ok(styleResult.body.errors.some((error) => error.includes('Unsupported Telegram button style')));

  const badScreenButton = structuredClone(initial.body.draft);
  badScreenButton.screens.support.buttons = [{ id: 'unsafe', label: 'bad', action: 'open_url', params: { url: 'http://example.com' } }];
  const screenButtonResult = await request({ action: 'save_draft', document: badScreenButton });
  assert.equal(screenButtonResult.status, 400);
  assert.ok(screenButtonResult.body.errors.some((error) => error.includes('Only HTTPS links are allowed')));

  const badTarget = structuredClone(initial.body.draft);
  badTarget.menus[0].rows[0].buttons[0] = {
    id: 'nav', label: 'Go', action: 'navigate_menu', params: { menuId: 'missing' },
  };
  const targetResult = await request({ action: 'save_draft', document: badTarget });
  assert.equal(targetResult.status, 400);
  assert.ok(targetResult.body.errors.some((error) => error.includes('Navigation target does not exist')));
});

test('menu API publishes valid navigation targets and rolls back published versions', async () => {
  const { request } = createMenuApi();
  const initial = await request({ method: 'GET' });
  const draft = structuredClone(initial.body.draft);
  draft.menus[0].rows[0].buttons[0] = {
    id: 'to-help', label: 'راهنما', action: 'navigate_menu', params: { menuId: 'help' }, style: 'primary',
  };
  draft.menus.push({
    id: 'help', name: 'راهنما', text: 'راهنمای ربات',
    rows: [{ id: 'help-row', buttons: [{ id: 'home', label: 'بازگشت', action: 'back_home', params: {} }] }],
  });
  assert.equal((await request({ action: 'save_draft', document: draft })).status, 200);
  const firstPublish = await request({ action: 'publish' });
  assert.equal(firstPublish.status, 200);
  assert.equal(firstPublish.body.published.version, 1);
  assert.equal(firstPublish.body.published.menus[0].rows[0].buttons[0].params.menuId, 'help');

  const secondDraft = structuredClone(firstPublish.body.published);
  secondDraft.menus[0].text = 'Updated main menu';
  assert.equal((await request({ action: 'save_draft', document: secondDraft })).status, 200);
  const secondPublish = await request({ action: 'publish' });
  assert.equal(secondPublish.status, 200);
  assert.equal(secondPublish.body.published.version, 2);

  const rollback = await request({ action: 'rollback', version: 1 });
  assert.equal(rollback.status, 200);
  assert.equal(rollback.body.published.menus[0].text, draft.menus[0].text);
  assert.equal(rollback.body.published.rolledBackFrom, 1);
});

test('published runtime routes registered actions and rejects missing submenu targets', () => {
  const api = source('api/menu-builder.js');
  const runtime = source('lib/bot-config.js');
  const index = source('api/index.js');
  for (const action of ['test_services', 'buy_services', 'wallet', 'account', 'support', 'renew', 'navigate_menu', 'open_url', 'back_home']) {
    assert.ok(api.includes(action), 'missing action registry entry: ' + action);
  }
  assert.match(runtime, /getPublishedMenu/);
  assert.match(runtime, /menu_nav:/);
  assert.match(index, /if \(data\.startsWith\('menu_nav:'\)\)/);
  assert.match(index, /if \(!targetMenu \|\| !targetKeyboard\)/);
  assert.match(runtime, /rendered\.style = style/);
  assert.match(api, /Unsupported Telegram button style for button/);
  assert.match(source('public/menu-builder.js'), /رنگ دکمه در تلگرام/);
  assert.match(source('public/menu-builder.js'), /style: button\.style \|\| 'glass'/);
  assert.match(index, /getMenuKeyboard\('main'\)/);
  assert.match(runtime, /arrangeScreenRows/);
  assert.match(runtime, /getScreenExtraRows/);
  assert.match(runtime, /const rows = groups\.map\(\(group\) => group\.buttons\)/);
  assert.match(runtime, /arranged\.push\(group\.buttons\)/);
  assert.match(runtime, /renderRegisteredButton/);
  assert.match(api, /Screen buttons must be an array/);
  assert.match(source('public/menu-builder.js'), /دکمه‌های اضافی این منو/);
  assert.match(runtime, /formatScreenMessage/);
  assert.match(index, /plans_buy/);
  assert.match(index, /account_detail/);
  assert.match(index, /accountUI\.subscriptionKeyboard\(current, \{/);
  assert.match(index, /arrangeScreenRows\('account_list',/);
  assert.match(index, /const rows = \[\.\.\.generatedRows, \.\.\.extraRows\];/);
  assert.doesNotMatch(runtime, /const rows = current\.map\(\(subscription\) => \[\{/);
  assert.doesNotMatch(index, /const rows = current\.map\(\(subscription\) => \[\{/);

  assert.match(source('lib/account-ui.js'), /options\.confirmLabel/);
  assert.match(source('public/menu-builder.js'), /تنظیمات منوهای پویا/);
  assert.match(source('public/menu-builder.js'), /رنگ دکمه در تلگرام/);
});


test('available-plan service placeholder uses the exact CMS name without emoji decoration', () => {
  const service = { id: 'panel_abcd', name: 'My VPN Panel', emoji: '🧩' };
  assert.equal(serviceName(service), 'My VPN Panel');
  assert.equal(serviceLabel(service), '🧩 My VPN Panel');
  const index = source('api/index.js');
  assert.match(index, /const displayServiceName = serviceName\(service\);/);
  assert.match(index, /\{ service: displayServiceName, prompt, mode:/);
});



test('Menu Maker supports selecting a specific enabled panel for purchase or test', async () => {
  const apiSource = source('api/menu-builder.js');
  const ui = source('public/menu-builder.js');
  const runtime = source('lib/bot-config.js');
  assert.match(apiSource, /select_panel_buy: \{ label: 'انتخاب پنل مشخص برای خرید'/);
  assert.match(apiSource, /select_panel_test: \{ label: 'انتخاب پنل مشخص برای اکانت تست'/);
  assert.match(ui, /function panelActionField/);
  assert.match(ui, /پنل مقصد برای اکانت تست/);
  assert.match(runtime, /service_buy_panel_/);
  assert.match(runtime, /service_test_panel_/);

  const { request } = createMenuApi([
    { id: 'panel_panelA', panelId: 'panelA', testEnabled: false, purchaseEnabled: true },
    { id: 'master_masterB', panelId: 'masterB', testEnabled: false, purchaseEnabled: true },
  ]);
  const initial = await request({ method: 'GET' });
  const draft = structuredClone(initial.body.draft);
  draft.menus[0].rows[0].buttons[0] = {
    id: 'buy-panel-a', label: 'خرید از پنل A', action: 'select_panel_buy', params: { serviceId: 'panel_panelA' },
  };
  assert.equal((await request({ action: 'save_draft', document: draft })).status, 200);

  draft.menus[0].rows[0].buttons[0] = {
    id: 'test-panel-a', label: 'تست از پنل A', action: 'select_panel_test', params: { serviceId: 'panel_panelA' },
  };
  const disabledTestPanel = await request({ action: 'save_draft', document: draft });
  assert.equal(disabledTestPanel.status, 400);
  assert.ok(disabledTestPanel.body.errors.some((error) => error.includes('selected panel is unavailable')));

  draft.menus[0].rows[0].buttons[0] = {
    id: 'buy-master-b', label: 'خرید از مستر B', action: 'select_panel_buy', params: { serviceId: 'master_masterB' },
  };
  assert.equal((await request({ action: 'save_draft', document: draft })).status, 200);
});

test('Menu Maker adds newly configured Master Panel buttons to existing purchase/test screens', () => {
  const ui = source('public/menu-builder.js');
  assert.match(ui, /if \(id === 'service_test' \|\| id === 'service_buy'\)/);
  assert.match(ui, /roleDefs\.filter\(function \(role\) \{ return role\.panelButton; \}\)\.forEach/);
  assert.match(ui, /Object\.prototype\.hasOwnProperty\.call\(cfg\.buttonControls, role\.id\)/);
  assert.match(ui, /if \(!alreadyPlaced\) cfg\.buttonRows\.push\(\{ id: 'managed_row_' \+ role\.id, roles: \[role\.id\] \}\)/);
});

test('menu navigation selectors persist the default target menu ID', () => {
  const ui = source('public/menu-builder.js');
  assert.match(ui, /if \(!button\.params\.menuId && menuSelect\.options\.length\) button\.params\.menuId = menuSelect\.value;/);
  assert.match(ui, /if \(!control\.params\.menuId && targetSelect\.options\.length\) control\.params\.menuId = targetSelect\.value;/);
});


test('Master Panels support test accounts by default and respect an explicit testEnabled setting', async () => {
  const listPanels = async () => [{ id: 'source_a', name: 'Source A', type: 'pasarguard', status: 'active' }];
  const listMasterPanels = async () => [{ id: 'master_abc', name: 'Master A+B', type: 'master', panelAId: 'source_a', panelBId: 'source_b', status: 'active' }];
  const defaults = await getConfiguredServicesWithPanels({}, { listPanels, listMasterPanels });
  const master = defaults.find((service) => service.id === 'master_master_abc');
  assert.ok(master);
  assert.equal(master.testEnabled, true);
  assert.equal(master.purchaseEnabled, true);

  const disabled = await getConfiguredServicesWithPanels({ services: { master_master_abc: { testEnabled: false } } }, { listPanels, listMasterPanels });
  assert.equal(disabled.find((service) => service.id === 'master_master_abc').testEnabled, false);
});


test('Menu Maker stores per-service custom-package settings and rejects invalid ranges', async () => {
  const { request } = createMenuApi([
    { id: 'panel_alpha', name: 'Alpha', purchaseEnabled: true, testEnabled: true },
    { id: 'master_beta', name: 'Beta', purchaseEnabled: true, testEnabled: true },
  ]);
  const initial = await request({ method: 'GET' });
  const draft = structuredClone(initial.body.draft);
  draft.screens.plans_buy.customPlanByService = {
    panel_alpha: { enabled: false, minTrafficGb: 5, maxTrafficGb: 80, maxDays: 45 },
    master_beta: { enabled: true, minTrafficGb: 2, maxTrafficGb: 200, maxDays: null },
  };
  const saved = await request({ action: 'save_draft', document: draft });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.draft.screens.plans_buy.customPlanByService.panel_alpha.enabled, false);
  assert.equal(saved.body.draft.screens.plans_buy.customPlanByService.master_beta.maxTrafficGb, 200);

  draft.screens.plans_buy.customPlanByService.panel_alpha.minTrafficGb = 100;
  draft.screens.plans_buy.customPlanByService.panel_alpha.maxTrafficGb = 10;
  const invalid = await request({ action: 'save_draft', document: draft });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.errors.some((error) => error.includes('Minimum traffic cannot exceed maximum traffic')));

  draft.screens.plans_buy.customPlanByService.panel_alpha.minTrafficGb = 5;
  draft.screens.plans_buy.customPlanByService.panel_alpha.maxTrafficGb = 80;
  draft.screens.plans_buy.customPlanByService.panel_alpha.maxDays = 151;
  const invalidDuration = await request({ action: 'save_draft', document: draft });
  assert.equal(invalidDuration.status, 400);
  assert.ok(invalidDuration.body.errors.some((error) => error.includes('Invalid maxDays')));
});

test('Custom package limits are service-specific and enforced by the Telegram flow', () => {
  const runtime = source('api/index.js');
  const ui = source('public/menu-builder.js');
  assert.ok(runtime.includes('customPlanByService && screen.customPlanByService[service.id]'));
  assert.ok(runtime.includes('customSetting.enabled !== false'));
  assert.ok(runtime.includes('state.minTrafficGb'));
  assert.ok(runtime.includes('state.maxTrafficGb'));
  assert.ok(runtime.includes('state.customMaxDays'));
  assert.match(ui, /تنظیم ساخت بسته دلخواه برای هر سرویس/);
  assert.ok(ui.includes('حداقل حجم (گیگابایت)'));
  assert.ok(ui.includes('حداکثر حجم (گیگابایت)'));
  assert.ok(ui.includes('حداکثر مدت (روز)'));
});
