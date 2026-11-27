const { isAuthorizedAdmin, sendJson } = require('../lib/cms-auth');
const storage = require('../lib/storage');
const botConfigModule = require('../lib/bot-config');
const { getConfig } = botConfigModule;
const { getConfiguredServicesWithPanels } = require('../lib/services');

const KEY = 'cms:menu-builder';
const ACTIONS = Object.freeze({
  test_services: { label: 'نمایش سرویس‌های اکانت تست', params: [] },
  buy_services: { label: 'نمایش سرویس‌های خرید', params: [] },
  wallet: { label: 'باز کردن کیف پول', params: [] },
  account: { label: 'نمایش اشتراک‌های من', params: [] },
  support: { label: 'نمایش اطلاعات پشتیبانی', params: [] },
  renew: { label: 'شروع فرایند تمدید', params: [] },
  navigate_menu: { label: 'باز کردن منوی دیگر', params: ['menuId'] },
  select_panel_buy: { label: 'انتخاب پنل مشخص برای خرید', params: ['serviceId'] },
  select_panel_test: { label: 'انتخاب پنل مشخص برای اکانت تست', params: ['serviceId'] },
  open_url: { label: 'باز کردن لینک HTTPS', params: ['url'] },
  back_home: { label: 'بازگشت به منوی اصلی', params: [] },
});
const DEFAULT_DOCUMENT = {
  version: 1,
  screens: {
    service_test: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'glass', buttonControls: {}, buttons: [] },
    service_buy: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'glass', buttonControls: {}, buttons: [] },
    service_renew: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'success', buttonControls: {}, buttons: [] },
    plans_buy: { columns: 1, messageTemplate: '', customPlanButton: true, customPlanLabel: '🛠 ساخت بسته دلخواه (حجم و زمان)', customPlanByService: {}, homeButton: true, buttonStyle: 'primary', buttonControls: {}, buttons: [] },
    plans_renew: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'success', buttonControls: {}, buttons: [] },
    account_list: { columns: 3, messageTemplate: '', homeButton: true, detailLabel: '{title}', renewLabel: '🔁', removeLabel: '❌', buttonControls: {}, buttons: [] },
    account_detail: { columns: 2, messageTemplate: '', openLabel: '🔗 باز کردن لینک', copyLabel: '📋 کپی لینک', renewLabel: '🔄 تمدید اشتراک', backLabel: '⬅️ بازگشت به اشتراک‌ها', homeButton: true, buttonControls: {}, buttons: [] },
    account_remove: { columns: 2, messageTemplate: '', confirmLabel: '🗑️ بله، حذف اشتراک', cancelLabel: '↩️ انصراف', buttonControls: {}, buttons: [] },
    wallet: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    support: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    subscription_name: { columns: 1, messageTemplate: '', homeButton: false, buttonControls: {}, buttons: [] },
    wallet_checkout: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    wallet_topup: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    subscription_delivery: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    renewal_delivery: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    copy_sub: { columns: 1, messageTemplate: '', homeButton: false, buttonControls: {}, buttons: [] },
    account_empty: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    custom_traffic: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    custom_duration: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    force_join: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
  },
  systemMessages: {},
  menus: [{
    id: 'main',
    name: 'Main menu',
    text: '',
    rows: [
      { id: 'row-1', buttons: [{ id: 'test', label: '🎁 دریافت اکانت تست', action: 'test_services', params: {} }] },
      { id: 'row-2', buttons: [{ id: 'buy', label: '🛒 خرید اشتراک', action: 'buy_services', params: {} }] },
      { id: 'row-3', buttons: [
        { id: 'wallet', label: '💰 کیف پول من', action: 'wallet', params: {} },
        { id: 'account', label: '👤 حساب من', action: 'account', params: {} },
      ] },
      { id: 'row-4', buttons: [{ id: 'support', label: '🎯 پشتیبانی', action: 'support', params: {} }] },
    ],
  }],
};
function containsPanelSelection(document) {
  const actionIsPanelSelection = (item) => item && (item.action === 'select_panel_buy' || item.action === 'select_panel_test');
  if ((document.menus || []).some((menu) => (menu.rows || []).some((row) => (row.buttons || []).some(actionIsPanelSelection)))) return true;
  return Object.values(document.screens || {}).some((screen) =>
    (screen.buttons || []).some(actionIsPanelSelection) ||
    Object.values(screen.buttonControls || {}).some(actionIsPanelSelection)
  );
}
async function validateDocumentWithPanels(document) {
  const checked = validateDocument(document);
  if (checked.errors.length || !containsPanelSelection(document)) return checked;
  const panels = await getConfiguredServicesWithPanels(await getConfig());
  return validateDocument(document, panels.map((panel) => ({
    id: String(panel.id),
    testEnabled: panel.testEnabled !== false,
    purchaseEnabled: panel.purchaseEnabled !== false,
  })));
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
const BUILTIN_SCREEN_IDS = [
  'service_test', 'service_buy', 'service_renew', 'plans_buy', 'plans_renew',
  'account_list', 'account_detail', 'account_remove', 'wallet', 'support',
  'subscription_name', 'wallet_checkout', 'wallet_topup', 'subscription_delivery',
  'renewal_delivery', 'copy_sub', 'account_empty', 'custom_traffic', 'custom_duration', 'force_join',
];
const SCREEN_ALLOWED_ROLES = {
  service_test: ['services', 'home'],
  service_buy: ['services', 'home'],
  service_renew: ['services', 'home'],
  plans_buy: ['plans', 'custom_plan', 'home'],
  plans_renew: ['plans', 'home'],
  account_list: ['subscription_detail', 'subscription_renew', 'subscription_remove', 'home'],
  account_detail: ['open_link', 'copy_link', 'renew_subscription', 'back_to_list', 'home'],
  account_remove: ['confirm_remove', 'cancel_remove'],
  wallet: ['home'],
  support: ['home'],
  subscription_name: ['auto_name', 'home'],
  wallet_checkout: ['charge', 'home'],
  wallet_topup: ['copy_card', 'home'],
  subscription_delivery: ['copy_sub', 'open_sub', 'home'],
  renewal_delivery: ['copy_sub', 'open_sub', 'home'],
  copy_sub: ['copy_link', 'back_to_detail'],
  account_empty: ['home'],
  custom_traffic: ['home'],
  custom_duration: ['home'],
  force_join: ['join_channel', 'check_join', 'home'],
};
function isNavigationTarget(target, menuIds) {
  const value = String(target || '');
  return menuIds.has(value) || (value.startsWith('screen_') && BUILTIN_SCREEN_IDS.includes(value.slice('screen_'.length)));
}
function validateDocument(input, panelCatalog = null) {
  const errors = [];
  function validatePanelTarget(action, params, context) {
    if (action !== 'select_panel_buy' && action !== 'select_panel_test') return;
    const serviceId = String(params.serviceId || '');
    if (!/^(?:panel|master)_[a-zA-Z0-9_-]{1,45}$/.test(serviceId)) {
      errors.push(context + ' requires a valid panel selection.');
      return;
    }
    if (Array.isArray(panelCatalog)) {
      const panel = panelCatalog.find((item) => String(item.id) === serviceId);
      const enabled = action === 'select_panel_test' ? panel?.testEnabled !== false : panel?.purchaseEnabled !== false;
      if (!panel || !enabled) errors.push(context + ' selected panel is unavailable for this action: ' + serviceId);
    }
  }
  if (!input || typeof input !== 'object' || !Array.isArray(input.menus)) return { errors: ['A menu document is required.'] };
  if (input.menus.length < 1 || input.menus.length > 12) errors.push('Create between 1 and 12 menus.');
  const ids = new Set();
  let buttonCount = 0;
  if (input.screens !== undefined && (!input.screens || typeof input.screens !== 'object' || Array.isArray(input.screens))) errors.push('Screen settings must be an object.');
  for (const [screenId, screen] of Object.entries(input.screens || {})) {
    if (!BUILTIN_SCREEN_IDS.includes(screenId)) errors.push('Unknown dynamic screen: ' + screenId);
    if (!screen || typeof screen !== 'object' || Array.isArray(screen)) { errors.push('Invalid settings for screen: ' + screenId); continue; }
    if (!Number.isInteger(Number(screen.columns || 1)) || Number(screen.columns || 1) < 1 || Number(screen.columns || 1) > 4) errors.push('Screen columns must be between 1 and 4: ' + screenId);
    if (screen.rowLayout !== undefined && (!Array.isArray(screen.rowLayout) || screen.rowLayout.length > 30 || screen.rowLayout.some((width) => !Number.isInteger(Number(width)) || Number(width) < 1 || Number(width) > 4))) errors.push('Screen row layout must contain up to 30 row widths between 1 and 4: ' + screenId);
    const allowedRowRoles = SCREEN_ALLOWED_ROLES[screenId] || [];
    if (screen.buttonRows !== undefined) {
      if (!Array.isArray(screen.buttonRows) || screen.buttonRows.length > 30) errors.push('Button rows must be an array with at most 30 rows: ' + screenId);
      else {
        const seenRoles = new Set();
        for (const row of screen.buttonRows) {
          if (!row || typeof row !== 'object' || !/^[a-zA-Z0-9_-]{1,80}$/.test(String(row.id || '')) || !Array.isArray(row.roles) || row.roles.length > 8) { errors.push('Invalid managed button row: ' + screenId); continue; }
          for (const role of row.roles) {
            const isPanelRole = ['service_test', 'service_buy', 'service_renew'].includes(screenId) && /^(?:panel|master)_[a-zA-Z0-9_-]{1,48}$/.test(String(role));
            if (!allowedRowRoles.includes(role) && !isPanelRole) errors.push('Unknown managed button role: ' + screenId + '/' + String(role));
            if (seenRoles.has(role)) errors.push('Duplicate managed button role: ' + screenId + '/' + String(role));
            seenRoles.add(role);
          }
        }
      }
    }
    for (const key of ['messageTemplate', 'customPlanLabel', 'detailLabel', 'renewLabel', 'removeLabel', 'openLabel', 'copyLabel', 'backLabel', 'confirmLabel', 'cancelLabel']) if (screen[key] !== undefined && (typeof screen[key] !== 'string' || screen[key].length > (key === 'messageTemplate' ? 3500 : 500))) errors.push('Invalid ' + key + ' for screen: ' + screenId);
    for (const key of ['homeButton', 'customPlanButton']) if (screen[key] !== undefined && typeof screen[key] !== 'boolean') errors.push(key + ' must be true or false for screen: ' + screenId);
    if (screen.customPlanByService !== undefined) {
      if (!screen.customPlanByService || typeof screen.customPlanByService !== 'object' || Array.isArray(screen.customPlanByService)) errors.push('Per-service custom package settings must be an object.');
      else for (const [serviceId, setting] of Object.entries(screen.customPlanByService)) {
        if (!/^[a-zA-Z0-9_-]{1,48}$/.test(serviceId)) errors.push('Invalid custom package service ID: ' + serviceId);
        if (!setting || typeof setting !== 'object' || Array.isArray(setting)) { errors.push('Invalid custom package settings: ' + serviceId); continue; }
        if (setting.enabled !== undefined && typeof setting.enabled !== 'boolean') errors.push('Custom package enabled must be true or false: ' + serviceId);
        for (const key of ['minTrafficGb', 'maxTrafficGb', 'maxDays']) if (setting[key] !== undefined && setting[key] !== null && (!Number.isInteger(Number(setting[key])) || Number(setting[key]) < 1 || Number(setting[key]) > (key === 'maxDays' ? 150 : 1000))) errors.push('Invalid ' + key + ' for custom package service: ' + serviceId);
        const minTraffic = setting.minTrafficGb == null ? 1 : Number(setting.minTrafficGb);
        const maxTraffic = setting.maxTrafficGb == null ? 1000 : Number(setting.maxTrafficGb);
        if (minTraffic > maxTraffic) errors.push('Minimum traffic cannot exceed maximum traffic: ' + serviceId);
      }
    }
    if (screen.buttonStyle !== undefined && !['default', 'glass', 'primary', 'success', 'danger'].includes(screen.buttonStyle)) errors.push('Unsupported Telegram button style for screen: ' + screenId);
    if (screen.buttonControls !== undefined && (!screen.buttonControls || typeof screen.buttonControls !== 'object' || Array.isArray(screen.buttonControls))) errors.push('Button controls must be an object: ' + screenId);
    for (const [controlId, control] of Object.entries(screen.buttonControls || {})) {
      const allowedControls = SCREEN_ALLOWED_ROLES[screenId] || [];
      const isPanelControl = ['service_test', 'service_buy', 'service_renew'].includes(screenId) && /^(?:panel|master)_[a-zA-Z0-9_-]{1,48}$/.test(String(controlId));
      if (!allowedControls.includes(controlId) && !isPanelControl) errors.push('Unknown built-in button control: ' + screenId + '/' + controlId);
      if (!control || typeof control !== 'object' || Array.isArray(control)) { errors.push('Invalid built-in button control: ' + controlId); continue; }
      if (control.enabled !== undefined && typeof control.enabled !== 'boolean') errors.push('Button enabled must be true or false: ' + controlId);
      if (control.label !== undefined && (typeof control.label !== 'string' || control.label.length > 64 || !control.label.trim())) errors.push('Button label must contain 1–64 characters: ' + controlId);
      if (control.action !== undefined && control.action !== 'original' && !Object.prototype.hasOwnProperty.call(ACTIONS, control.action)) errors.push('Unregistered built-in button action: ' + String(control.action));
      if (control.style !== undefined && !['default', 'glass', 'primary', 'success', 'danger'].includes(control.style)) errors.push('Unsupported built-in button style: ' + controlId);
      const params = control.params && typeof control.params === 'object' ? control.params : {};
      validatePanelTarget(control.action, params, 'Built-in button ' + controlId);
      if (control.action === 'navigate_menu' && !/^[a-zA-Z0-9_-]{1,32}$/.test(String(params.menuId || ''))) errors.push('Built-in button navigation requires a valid target menu ID: ' + controlId);
      if (control.action === 'open_url') { try { const url = new URL(String(params.url || '')); if (url.protocol !== 'https:') errors.push('Only HTTPS links are allowed.'); } catch (_) { errors.push('Built-in open URL actions require a valid HTTPS URL.'); } }
    }
    if (screen.buttons !== undefined && (!Array.isArray(screen.buttons) || screen.buttons.length > 20)) errors.push('Screen buttons must be an array with at most 20 entries: ' + screenId);
    for (const button of (Array.isArray(screen.buttons) ? screen.buttons : [])) {
      buttonCount++;
      if (!button || !/^[a-zA-Z0-9_-]{1,40}$/.test(String(button.id || ''))) errors.push('Every screen button needs a valid ID: ' + screenId);
      if (!String(button.label || '').trim() || String(button.label).length > 64) errors.push('Screen button labels must contain 1–64 characters: ' + screenId);
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, button.action)) { errors.push('Unregistered screen action: ' + String(button.action || '')); continue; }
      if (button.style !== undefined && !['default', 'glass', 'primary', 'success', 'danger'].includes(button.style)) errors.push('Unsupported Telegram button style for screen button: ' + String(button.id || ''));
      const params = button.params && typeof button.params === 'object' ? button.params : {};
      validatePanelTarget(button.action, params, 'Screen button ' + screenId);
      if (button.action === 'navigate_menu' && !/^[a-zA-Z0-9_-]{1,32}$/.test(String(params.menuId || ''))) errors.push('Screen navigation requires a valid target menu ID: ' + screenId);
      if (button.action === 'open_url') {
        try { const url = new URL(String(params.url || '')); if (url.protocol !== 'https:') errors.push('Only HTTPS links are allowed.'); }
        catch (_) { errors.push('Screen open URL actions require a valid HTTPS URL.'); }
      }
    }
  }
  for (const menu of input.menus) {
    if (!menu || !/^[a-zA-Z0-9_-]{1,32}$/.test(String(menu.id || ''))) { errors.push('Every menu needs a valid ID.'); continue; }
    if (ids.has(menu.id)) errors.push('Duplicate menu ID: ' + menu.id);
    ids.add(menu.id);
    if (String(menu.name || '').length > 64 || String(menu.text || '').length > 3500) errors.push('Menu names must be <=64 and message text <=3500 characters.');
    if (!Array.isArray(menu.rows) || menu.rows.length > 30) { errors.push('Each menu can contain up to 30 rows.'); continue; }
    if (!menu.rows.some((row) => Array.isArray(row?.buttons) && row.buttons.length > 0)) errors.push('Every menu must contain at least one button.');
    for (const row of menu.rows) {
      if (!row || !Array.isArray(row.buttons) || row.buttons.length > 8) { errors.push('Each row can contain up to 8 buttons.'); continue; }
      for (const button of row.buttons) {
        buttonCount++;
        if (!button || !/^[a-zA-Z0-9_-]{1,40}$/.test(String(button.id || ''))) errors.push('Every button needs a valid ID.');
        if (!String(button.label || '').trim() || String(button.label).length > 64) errors.push('Button labels must contain 1–64 characters.');
        if (button.style !== undefined && !['default', 'glass', 'primary', 'success', 'danger'].includes(button.style)) errors.push('Unsupported Telegram button style for button: ' + String(button.id || ''));
        if (!Object.prototype.hasOwnProperty.call(ACTIONS, button.action)) { errors.push('Unregistered action: ' + String(button.action || '')); continue; }
        const params = button.params && typeof button.params === 'object' ? button.params : {};
        validatePanelTarget(button.action, params, 'Menu button');
        if (button.action === 'navigate_menu' && !/^[a-zA-Z0-9_-]{1,32}$/.test(String(params.menuId || ''))) errors.push('Menu navigation requires a valid target menu ID.');
        if (button.action === 'open_url') {
          try { const url = new URL(String(params.url || '')); if (url.protocol !== 'https:') errors.push('Only HTTPS links are allowed.'); }
          catch (_) { errors.push('Open URL actions require a valid HTTPS URL.'); }
        }
      }
    }
  }
  if (buttonCount > 100) errors.push('A document can contain at most 100 buttons.');
  for (const [screenId, screen] of Object.entries(input.screens || {})) {
    for (const [controlId, control] of Object.entries(screen?.buttonControls || {})) {
      if (control?.action === 'navigate_menu' && !isNavigationTarget((control.params && control.params.menuId), ids)) errors.push('Built-in button navigation target does not exist: ' + String((control.params && control.params.menuId) || ''));
    }
    for (const button of (Array.isArray(screen?.buttons) ? screen.buttons : [])) {
      if (button?.action === 'navigate_menu' && !isNavigationTarget((button.params && button.params.menuId), ids)) errors.push('Screen navigation target does not exist: ' + String((button.params && button.params.menuId) || ''));
    }
  }
  for (const menu of input.menus) {
    if (!menu || typeof menu !== 'object' || !Array.isArray(menu.rows)) continue;
    for (const row of menu.rows) {
      if (!row || !Array.isArray(row.buttons)) continue;
      for (const button of row.buttons) {
        if (button && button.action === 'navigate_menu' && !isNavigationTarget((button.params && button.params.menuId), ids)) errors.push('Navigation target does not exist: ' + String((button.params && button.params.menuId) || ''));
      }
    }
  }
  if (input.systemMessages !== undefined) {
    if (!input.systemMessages || typeof input.systemMessages !== 'object' || Array.isArray(input.systemMessages)) {
      errors.push('System messages must be an object.');
    } else {
      for (const [key, val] of Object.entries(input.systemMessages)) {
        if (!/^[a-zA-Z0-9_]{1,64}$/.test(key)) errors.push('Invalid system message key: ' + key);
        if (val !== undefined && (typeof val !== 'string' || val.length > 3500)) errors.push('Invalid system message value for: ' + key);
      }
    }
  }
  if (!ids.has('main')) errors.push('A menu with ID "main" is required.');
  return { errors };
}
module.exports = async function menuBuilderApi(req, res) {
  if (!isAuthorizedAdmin(req, process.env.ADMIN_CMS_PASSWORD)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
  try {
    const state = await storage.get(KEY) || { draft: clone(DEFAULT_DOCUMENT), published: null, history: [] };
    if (req.method === 'GET') {
      const botConfig = await getConfig();
      const panels = await getConfiguredServicesWithPanels(botConfig);
      const rawPlans = await storage.get('cms:plans');
      const activePlans = (Array.isArray(rawPlans) ? rawPlans : []).filter((p) => p && p.active !== false).map((p) => ({
        id: String(p.id),
        name: String(p.name || p.buttonText || ''),
        buttonText: String(p.buttonText || p.name || ''),
        price: p.price,
        panelId: p.panelId ? String(p.panelId) : null,
        service: p.service || 'tunnel',
        type: p.type || 'traffic',
      }));
      return sendJson(res, 200, {
        actions: ACTIONS,
        draft: state.draft || clone(DEFAULT_DOCUMENT),
        published: state.published || null,
        history: (state.history || []).slice(0, 10),
        botTexts: botConfig.messages || {},
        systemMessageDefaults: botConfigModule.DEFAULTS?.messages || {},
        botButtons: botConfig.buttons || {},
        supportUsername: botConfig.payment?.supportUsername || '',
        plans: activePlans,
        panels: panels.filter((panel) => !String(panel.id).startsWith('master_')).map((panel) => ({ id: panel.id, panelId: String(panel.panelId), name: panel.name, testEnabled: panel.testEnabled !== false, purchaseEnabled: panel.purchaseEnabled !== false })),
      });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const body = req.body || {};
    if (body.action === 'save_draft') {
      const checked = await validateDocumentWithPanels(body.document);
      if (checked.errors.length) return sendJson(res, 400, { error: 'VALIDATION_FAILED', errors: checked.errors });
      state.draft = clone(body.document);
      const draftVersion = Number(state.draft.version);
      state.draft.version = Number.isFinite(draftVersion) && draftVersion > 0 ? draftVersion : 1;
      await storage.set(KEY, state);
      return sendJson(res, 200, { ok: true, draft: state.draft });
    }
    if (body.action === 'publish') {
      const checked = await validateDocumentWithPanels(state.draft);
      if (checked.errors.length) return sendJson(res, 400, { error: 'VALIDATION_FAILED', errors: checked.errors });
      if (state.published) state.history = [{ ...clone(state.published), archivedAt: new Date().toISOString() }, ...(state.history || [])].slice(0, 10);
      const highestVersion = Math.max(Number(state.published?.version || 0), ...(state.history || []).map((item) => Number(item.version || 0)));
      state.published = { ...clone(state.draft), version: highestVersion + 1, publishedAt: new Date().toISOString() };
      await storage.set(KEY, state);
      return sendJson(res, 200, { ok: true, published: state.published });
    }
    if (body.action === 'rollback') {
      const targetVersion = Number(body.version);
      const previous = (state.history || []).find(item => Number(item.version) === targetVersion);
      if (!previous) return sendJson(res, 404, { error: 'VERSION_NOT_FOUND' });
      if (state.published) state.history = [{ ...clone(state.published), archivedAt: new Date().toISOString() }, ...(state.history || [])].slice(0, 10);
      state.published = { ...clone(previous), publishedAt: new Date().toISOString(), rolledBackFrom: targetVersion };
      delete state.published.archivedAt;
      await storage.set(KEY, state);
      return sendJson(res, 200, { ok: true, published: state.published });
    }
    return sendJson(res, 400, { error: 'UNKNOWN_ACTION' });
  } catch (error) {
    console.error('MENU_BUILDER_API_ERROR', error?.message || String(error));
    return sendJson(res, 500, { error: 'INTERNAL_ERROR' });
  }
};
