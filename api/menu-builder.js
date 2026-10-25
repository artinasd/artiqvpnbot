const storage = require('../lib/storage');
const { getConfig } = require('../lib/bot-config');

const PASSWORD = process.env.ADMIN_CMS_PASSWORD || '';
const KEY = 'cms:menu-builder';
const ACTIONS = Object.freeze({
  test_services: { label: 'نمایش سرویس‌های اکانت تست', params: [] },
  buy_services: { label: 'نمایش سرویس‌های خرید', params: [] },
  wallet: { label: 'باز کردن کیف پول', params: [] },
  account: { label: 'نمایش اشتراک‌های من', params: [] },
  support: { label: 'نمایش اطلاعات پشتیبانی', params: [] },
  renew: { label: 'شروع فرایند تمدید', params: [] },
  navigate_menu: { label: 'باز کردن منوی دیگر', params: ['menuId'] },
  open_url: { label: 'باز کردن لینک HTTPS', params: ['url'] },
  back_home: { label: 'بازگشت به منوی اصلی', params: [] },
});
const DEFAULT_DOCUMENT = {
  version: 1,
  screens: {
    service_test: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'success', buttonControls: {}, buttons: [] },
    service_buy: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'primary', buttonControls: {}, buttons: [] },
    service_renew: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'success', buttonControls: {}, buttons: [] },
    plans_buy: { columns: 1, messageTemplate: '', customPlanButton: true, customPlanLabel: '🛠 ساخت بسته دلخواه (حجم و زمان)', homeButton: true, buttonStyle: 'primary', buttonControls: {}, buttons: [] },
    plans_renew: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'success', buttonControls: {}, buttons: [] },
    account_list: { columns: 3, messageTemplate: '', homeButton: true, detailLabel: '{title}', renewLabel: '🔁', removeLabel: '❌', buttonControls: {}, buttons: [] },
    account_detail: { columns: 2, messageTemplate: '', openLabel: '🔗 باز کردن لینک', copyLabel: '📋 کپی لینک', renewLabel: '🔄 تمدید اشتراک', backLabel: '⬅️ بازگشت به اشتراک‌ها', homeButton: true, buttonControls: {}, buttons: [] },
    account_remove: { columns: 2, messageTemplate: '', confirmLabel: '🗑️ بله، حذف اشتراک', cancelLabel: '↩️ انصراف', buttonControls: {}, buttons: [] },
    wallet: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
    support: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {}, buttons: [] },
  },
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
function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}
function authorized(req) {
  return Boolean(PASSWORD) && req.headers['x-admin-password'] === PASSWORD;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function validateDocument(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || !Array.isArray(input.menus)) return { errors: ['A menu document is required.'] };
  if (input.menus.length < 1 || input.menus.length > 12) errors.push('Create between 1 and 12 menus.');
  const ids = new Set();
  let buttonCount = 0;
  if (input.screens !== undefined && (!input.screens || typeof input.screens !== 'object' || Array.isArray(input.screens))) errors.push('Screen settings must be an object.');
  for (const [screenId, screen] of Object.entries(input.screens || {})) {
    if (!['service_test', 'service_buy', 'service_renew', 'plans_buy', 'plans_renew', 'account_list', 'account_detail', 'account_remove', 'wallet', 'support'].includes(screenId)) errors.push('Unknown dynamic screen: ' + screenId);
    if (!screen || typeof screen !== 'object' || Array.isArray(screen)) { errors.push('Invalid settings for screen: ' + screenId); continue; }
    if (!Number.isInteger(Number(screen.columns || 1)) || Number(screen.columns || 1) < 1 || Number(screen.columns || 1) > 4) errors.push('Screen columns must be between 1 and 4: ' + screenId);
    if (screen.rowLayout !== undefined && (!Array.isArray(screen.rowLayout) || screen.rowLayout.length > 30 || screen.rowLayout.some((width) => !Number.isInteger(Number(width)) || Number(width) < 1 || Number(width) > 4))) errors.push('Screen row layout must contain up to 30 row widths between 1 and 4: ' + screenId);
    for (const key of ['messageTemplate', 'customPlanLabel', 'detailLabel', 'renewLabel', 'removeLabel', 'openLabel', 'copyLabel', 'backLabel', 'confirmLabel', 'cancelLabel']) if (screen[key] !== undefined && (typeof screen[key] !== 'string' || screen[key].length > 500)) errors.push('Invalid ' + key + ' for screen: ' + screenId);
    for (const key of ['homeButton', 'customPlanButton']) if (screen[key] !== undefined && typeof screen[key] !== 'boolean') errors.push(key + ' must be true or false for screen: ' + screenId);
    if (screen.buttonStyle !== undefined && !['default', 'primary', 'success', 'danger'].includes(screen.buttonStyle)) errors.push('Unsupported Telegram button style for screen: ' + screenId);
    if (screen.buttonControls !== undefined && (!screen.buttonControls || typeof screen.buttonControls !== 'object' || Array.isArray(screen.buttonControls))) errors.push('Button controls must be an object: ' + screenId);
    for (const [controlId, control] of Object.entries(screen.buttonControls || {})) {
      const allowedControls = { service_test: ['services'], service_buy: ['services'], service_renew: ['services'], plans_buy: ['plans', 'custom_plan'], plans_renew: ['plans'], account_list: ['subscription_detail', 'subscription_renew', 'subscription_remove', 'home'], account_detail: ['open_link', 'copy_link', 'renew_subscription', 'back_to_list', 'home'], account_remove: ['confirm_remove', 'cancel_remove'] }[screenId] || [];
      if (!allowedControls.includes(controlId)) errors.push('Unknown built-in button control: ' + screenId + '/' + controlId);
      if (!control || typeof control !== 'object' || Array.isArray(control)) { errors.push('Invalid built-in button control: ' + controlId); continue; }
      if (control.enabled !== undefined && typeof control.enabled !== 'boolean') errors.push('Button enabled must be true or false: ' + controlId);
      if (control.label !== undefined && (typeof control.label !== 'string' || control.label.length > 64 || !control.label.trim())) errors.push('Button label must contain 1–64 characters: ' + controlId);
      if (control.action !== undefined && control.action !== 'original' && !Object.prototype.hasOwnProperty.call(ACTIONS, control.action)) errors.push('Unregistered built-in button action: ' + String(control.action));
      if (control.style !== undefined && !['default', 'primary', 'success', 'danger'].includes(control.style)) errors.push('Unsupported built-in button style: ' + controlId);
      const params = control.params && typeof control.params === 'object' ? control.params : {};
      if (control.action === 'navigate_menu' && !/^[a-zA-Z0-9_-]{1,32}$/.test(String(params.menuId || ''))) errors.push('Built-in button navigation requires a valid target menu ID: ' + controlId);
      if (control.action === 'open_url') { try { const url = new URL(String(params.url || '')); if (url.protocol !== 'https:') errors.push('Only HTTPS links are allowed.'); } catch (_) { errors.push('Built-in open URL actions require a valid HTTPS URL.'); } }
    }
    if (screen.buttons !== undefined && (!Array.isArray(screen.buttons) || screen.buttons.length > 20)) errors.push('Screen buttons must be an array with at most 20 entries: ' + screenId);
    for (const button of (Array.isArray(screen.buttons) ? screen.buttons : [])) {
      buttonCount++;
      if (!button || !/^[a-zA-Z0-9_-]{1,40}$/.test(String(button.id || ''))) errors.push('Every screen button needs a valid ID: ' + screenId);
      if (!String(button.label || '').trim() || String(button.label).length > 64) errors.push('Screen button labels must contain 1–64 characters: ' + screenId);
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, button.action)) { errors.push('Unregistered screen action: ' + String(button.action || '')); continue; }
      if (button.style !== undefined && !['default', 'primary', 'success', 'danger'].includes(button.style)) errors.push('Unsupported Telegram button style for screen button: ' + String(button.id || ''));
      const params = button.params && typeof button.params === 'object' ? button.params : {};
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
        if (button.style !== undefined && !['default', 'primary', 'success', 'danger'].includes(button.style)) errors.push('Unsupported Telegram button style for button: ' + String(button.id || ''));
        if (!Object.prototype.hasOwnProperty.call(ACTIONS, button.action)) { errors.push('Unregistered action: ' + String(button.action || '')); continue; }
        const params = button.params && typeof button.params === 'object' ? button.params : {};
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
      if (control?.action === 'navigate_menu' && !ids.has(String((control.params && control.params.menuId) || ''))) errors.push('Built-in button navigation target does not exist: ' + String((control.params && control.params.menuId) || ''));
    }
    for (const button of (Array.isArray(screen?.buttons) ? screen.buttons : [])) {
      if (button?.action === 'navigate_menu' && !ids.has(String((button.params && button.params.menuId) || ''))) errors.push('Screen navigation target does not exist: ' + String((button.params && button.params.menuId) || ''));
    }
  }
  for (const menu of input.menus) {
    if (!menu || typeof menu !== 'object' || !Array.isArray(menu.rows)) continue;
    for (const row of menu.rows) {
      if (!row || !Array.isArray(row.buttons)) continue;
      for (const button of row.buttons) {
        if (button && button.action === 'navigate_menu' && !ids.has(String((button.params && button.params.menuId) || ''))) errors.push('Navigation target does not exist: ' + String((button.params && button.params.menuId) || ''));
      }
    }
  }
  if (!ids.has('main')) errors.push('A menu with ID "main" is required.');
  return { errors };
}
module.exports = async function menuBuilderApi(req, res) {
  if (!authorized(req)) return json(res, 401, { error: 'UNAUTHORIZED' });
  try {
    const state = await storage.get(KEY) || { draft: clone(DEFAULT_DOCUMENT), published: null, history: [] };
    if (req.method === 'GET') {
      const botConfig = await getConfig();
      return json(res, 200, { actions: ACTIONS, draft: state.draft || clone(DEFAULT_DOCUMENT), published: state.published || null, history: (state.history || []).slice(0, 10), botTexts: botConfig.messages || {}, botButtons: botConfig.buttons || {} });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const body = req.body || {};
    if (body.action === 'save_draft') {
      const checked = validateDocument(body.document);
      if (checked.errors.length) return json(res, 400, { error: 'VALIDATION_FAILED', errors: checked.errors });
      state.draft = clone(body.document);
      state.draft.version = Number(state.draft.version || 1);
      await storage.set(KEY, state);
      return json(res, 200, { ok: true, draft: state.draft });
    }
    if (body.action === 'publish') {
      const checked = validateDocument(state.draft);
      if (checked.errors.length) return json(res, 400, { error: 'VALIDATION_FAILED', errors: checked.errors });
      if (state.published) state.history = [{ ...clone(state.published), archivedAt: new Date().toISOString() }, ...(state.history || [])].slice(0, 10);
      const highestVersion = Math.max(Number(state.published?.version || 0), ...(state.history || []).map((item) => Number(item.version || 0)));
      state.published = { ...clone(state.draft), version: highestVersion + 1, publishedAt: new Date().toISOString() };
      await storage.set(KEY, state);
      return json(res, 200, { ok: true, published: state.published });
    }
    if (body.action === 'rollback') {
      const targetVersion = Number(body.version);
      const previous = (state.history || []).find(item => Number(item.version) === targetVersion);
      if (!previous) return json(res, 404, { error: 'VERSION_NOT_FOUND' });
      if (state.published) state.history = [{ ...clone(state.published), archivedAt: new Date().toISOString() }, ...(state.history || [])].slice(0, 10);
      state.published = { ...clone(previous), publishedAt: new Date().toISOString(), rolledBackFrom: targetVersion };
      delete state.published.archivedAt;
      await storage.set(KEY, state);
      return json(res, 200, { ok: true, published: state.published });
    }
    return json(res, 400, { error: 'UNKNOWN_ACTION' });
  } catch (error) {
    return json(res, 500, { error: error.message || 'INTERNAL_ERROR' });
  }
};
