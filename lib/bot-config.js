const storage = require('./storage');

const KEY = 'cms:bot-config';

const DEFAULTS = {
  payment: { cardNumber: '6219861947080387', cardHolder: 'اسعدی', bankDetails: '', supportUsername: 'Your_Personal_ID', currency: 'تومان' },
  limits: { testLimitPerDay: 2, testTrafficBytes: 150 * 1024 * 1024, testDurationDays: 1, testHwidLimit: 0 },
  resellerTelegramIds: [],
  pricing: { normalPerGb: 4000, resellerPerGb: null }, pricingByPanel: {},
  services: {},
  bot: { subscriptionBaseUrl: '', maintenanceMode: false, qrBackground: 'bg.png' },
  buttons: {
    test: '🎁 دریافت اکانت تست', buy: '🛒 خرید اشتراک', account: '👤 حساب من', support: '🎯 پشتیبانی', autoName: '⚡ نام خودکار',
    copyCard: '📋 کپی شماره کارت', copySubscription: '📋 کپی لینک اشتراک', openSubscription: '🔗 باز کردن لینک اشتراک', renew: '🔄 تمدید اشتراک',
  },
  messages: {
    start: '👋 به ربات آرتیک خوش آمدید!\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:',
    support: 'ℹ️ برای پشتیبانی و راهنمایی، با ما در ارتباط باشید:\n\n💬 @{support_username}',
    paymentTitle: '💳 <b>پرداخت اشتراک</b>', receiptInstructions: '📸 <b>بعد از پرداخت</b>\nعکس یا فایل رسید پرداخت را همینجا ارسال کنید.',
    paymentFooter: '⚡ پس از دریافت رسید، سفارش شما به‌صورت خودکار برای ساخت اشتراک پردازش می‌شود.\n🔒 لطفاً مبلغ و شماره کارت مقصد را قبل از پرداخت بررسی کنید.',
    testProcessing: '⏳ اکانت تست {service_name} شما در حال ساخت خودکار است...', testUnavailable: '🛠️ سرویس {service_name} هنوز در حال آماده‌سازی است.',
    serviceUnavailable: '🛠️ سرویس {service_name} فعلاً در دسترس نیست.', invalidService: '❌ سرویس انتخاب‌شده معتبر نیست.', noPlans: '📭 برای سرویس {service_name} فعلاً پلنی ثبت نشده است.',
    planPrompt: 'لطفاً بسته مورد نظر را انتخاب کنید:', testLimitReached: '🎁 سقف روزانه اکانت تست شما تکمیل شده است.', testAlreadyExists: '🎁 شما قبلاً از اکانت تست استفاده کرده‌اید.',
    testFailure: '❌ ساخت اکانت تست انجام نشد. مشکل فنی ثبت شد و می‌توانید دوباره تلاش کنید.', testProcessingLock: '⏳ درخواست تست شما در حال پردازش است.',
    serviceSelectionTest: '🎁 سرویس مورد نظر برای اکانت تست را انتخاب کنید:', serviceSelectionBuy: '🛒 ابتدا سرویس مورد نظر را انتخاب کنید:', serviceSelectionRenew: '🔄 سرویس مورد نظر برای تمدید را انتخاب کنید:',
    subscriptionSuccess: '🎉 <b>اشتراک شما با موفقیت ساخته شد!</b>\n\n╭──────────────\n📦 <b>سرویس:</b> {plan_name}\n📊 <b>حجم:</b> {traffic}\n⏳ <b>اعتبار:</b> {duration}\n👤 <b>نام اشتراک:</b> <code>{username}</code>\n╰──────────────\n\n🔗 <b>لینک اشتراک:</b>\n<code>{sub_url}</code>\n\n📋 برای کپی سریع لینک، دکمه زیر را بزنید 👇',
    renewalSuccess: '🎉 <b>اشتراک شما تمدید شد!</b>\n\n╭──────────────\n📦 <b>سرویس:</b> {plan_name}\n👤 <b>نام اشتراک:</b> <code>{username}</code>\n⏳ <b>اعتبار جدید:</b> {expire}\n╰──────────────\n\n🔗 <b>لینک اشتراک:</b>\n<code>{sub_url}</code>\n\n📋 برای کپی سریع لینک، دکمه زیر را بزنید 👇',
    subscriptionDeliveryFallback: '🎉 اشتراک شما ساخته شد.\n\n🔗 لینک اشتراک:\n{sub_url}',
    fulfillmentTemporaryFailure: '⏳ ساخت اشتراک با یک مشکل موقت مواجه شد. سفارش شما ثبت شده و می‌توانید دوباره تلاش کنید.', receiptReceived: '✅ رسید دریافت شد. اشتراک شما بدون نیاز به تأیید دستی در حال ساخت خودکار است.',
    maintenance: '🛠️ ربات موقتاً در حال بروزرسانی است. لطفاً کمی بعد دوباره تلاش کنید.', accountNoSubscription: '👤 هنوز اشتراک فعالی برای حساب شما ثبت نشده است.', accountStatusFailure: '❌ دریافت وضعیت اشتراک در حال حاضر ممکن نیست. لطفاً کمی بعد دوباره تلاش کنید.',
    renewalNoSubscription: '❌ اشتراک فعالی برای تمدید پیدا نشد.', renewalPlanUnavailable: '❌ این پلن فعال نیست یا اشتراک شما پیدا نشد.', planUnavailable: '❌ این پلن دیگر فعال نیست. لطفاً فهرست پلن‌ها را دوباره باز کنید.',
    customTrafficPrompt: '🛠 حجم مورد نیاز را فقط به صورت عدد و بر حسب گیگابایت وارد کنید.\n\nمثلاً: 15', customTrafficInvalid: '❌ حجم نامعتبر است. عددی بین ۱ تا ۱۰۰۰ گیگابایت وارد کنید.',
    customTrafficAccepted: '✅ حجم {traffic} گیگابایت ثبت شد.\n💳 قیمت: {price} تومان\n\nمدت را به صورت «۳۰ روزه» یا «۱ ماهه» وارد کنید. حداکثر ۱۵۰ روز.', customDurationInvalid: '❌ مدت نامعتبر است. بین ۱ تا ۱۵۰ روز وارد کنید.',
    subscriptionNamePrompt: '👤 نام اشتراک\n\nاگر می‌خواهید نام دلخواهی برای اشتراک خود انتخاب کنید، آن را وارد کنید؛ در غیر این صورت نام به صورت خودکار ساخته می‌شود.\n\nفقط حروف انگلیسی، اعداد، @ و _ مجاز است و نام نباید فاصله یا کاراکتر دیگری داشته باشد.', subscriptionNameRequired: '❌ لطفاً نام اشتراک را به صورت متن انگلیسی ارسال کنید یا «نام خودکار» را انتخاب کنید.', subscriptionNameNotFound: '❌ سفارش پیدا نشد. لطفاً دوباره از خرید شروع کنید.',
    receiptRequired: '❌ لطفاً تصویر رسید یا فایل رسید را ارسال کنید.', orderNotFound: '❌ سفارش پیدا نشد.', paymentLaterInvalidated: '❌ پرداخت این سفارش بعداً نامعتبر تشخیص داده شد و اشتراک غیرفعال شد. برای پیگیری با پشتیبانی تماس بگیرید.',
    subscriptionDisabled: '❌ اشتراک {username} غیرفعال شد.', subscriptionDisableFailure: '❌ غیرفعال‌سازی اشتراک انجام نشد؛ لاگ فنی ثبت شد.', invalidReceipt: '❌ رسید این سفارش معتبر نیست.',
    usernameEnglishOnly: '❌ نام اشتراک فقط باید با حروف انگلیسی باشد. حروف فارسی/عربی و ایموجی مجاز نیست.', usernameNoSpaces: '❌ نام اشتراک نباید فاصله داشته باشد.', usernameInvalidCharacters: '❌ فقط حروف انگلیسی، اعداد، @ و _ مجاز هستند.', usernameTooGeneric: '❌ این نام برای اشتراک مناسب نیست. یک نام معنادار انگلیسی انتخاب کنید.', usernameInvalid: '❌ نام اشتراک نامعتبر است.',
  },
};
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function merge(base, extra) { if (!extra || typeof extra !== 'object') return clone(base); const out = clone(base); for (const [key, value] of Object.entries(extra)) { if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object') out[key] = merge(out[key], value); else out[key] = value; } return out; }
function normalize(config) {
  const raw = config && typeof config === 'object' ? config : {};
  const out = merge(DEFAULTS, raw);
  out.services = Object.fromEntries(Object.entries(out.services || {}).filter(([key, value]) => /^panel_[a-zA-Z0-9_-]{2,64}$/.test(key) && value && typeof value === 'object' && !Array.isArray(value)));
  out.resellerTelegramIds = Array.from(new Set((Array.isArray(out.resellerTelegramIds) ? out.resellerTelegramIds : []).map(value => String(value).trim()).filter(value => /^\d+$/.test(value))));
  const normalRate = Number(out.pricing?.normalPerGb); out.pricing.normalPerGb = Number.isFinite(normalRate) && normalRate >= 0 ? normalRate : 4000;
  const resellerRate = out.pricing?.resellerPerGb; out.pricing.resellerPerGb = resellerRate === null || resellerRate === undefined || resellerRate === '' ? null : (Number.isFinite(Number(resellerRate)) && Number(resellerRate) >= 0 ? Number(resellerRate) : null);
  const panelPricing = out.pricingByPanel && typeof out.pricingByPanel === 'object' && !Array.isArray(out.pricingByPanel) ? out.pricingByPanel : {}; out.pricingByPanel = Object.fromEntries(Object.entries(panelPricing).filter(([id, value]) => /^[a-zA-Z0-9_-]{2,64}$/.test(id) && value && typeof value === 'object').map(([id, value]) => { const normal = Number(value.normalPerGb); const reseller = value.resellerPerGb; return [id, { normalPerGb: Number.isFinite(normal) && normal >= 0 ? normal : 4000, resellerPerGb: reseller === null || reseller === undefined || reseller === '' ? null : (Number.isFinite(Number(reseller)) && Number(reseller) >= 0 ? Number(reseller) : null) }]; }));
  out.limits.testLimitPerDay = Math.max(0, Number(out.limits.testLimitPerDay) || 0); out.limits.testTrafficBytes = Math.max(0, Number(out.limits.testTrafficBytes) || 0); out.limits.testDurationDays = Math.max(1, Number(out.limits.testDurationDays) || 1); out.limits.testHwidLimit = Math.max(0, Number(out.limits.testHwidLimit) || 0); out.bot.maintenanceMode = Boolean(out.bot.maintenanceMode); out.bot.qrBackground = String(out.bot.qrBackground || 'bg.png').split(/[\\/]/).pop() || 'bg.png'; return out;
}
async function getConfig() { return normalize(await storage.get(KEY)); }
async function saveConfig(patch) { const next = normalize(await storage.get(KEY)); const merged = normalize(merge(next, patch || {})); await storage.set(KEY, merged); return merged; }
async function getSetting(path, fallback) { const config = await getConfig(); const value = String(path || '').split('.').filter(Boolean).reduce((current, key) => current == null ? undefined : current[key], config); return value === undefined ? fallback : value; }
async function getMessage(key, variables = {}) { const config = await getConfig(); let message = config.messages?.[key]; if (message == null || String(message).trim() === '') message = DEFAULTS.messages[key] || ''; return String(message).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(variables[name] ?? `{${name}}`)); }
async function getButton(key, fallback = '') { const config = await getConfig(); return String(config.buttons?.[key] ?? DEFAULTS.buttons[key] ?? fallback); }

const MENU_ACTION_CALLBACKS = Object.freeze({
  test_services: 'main_test',
  buy_services: 'main_buy',
  wallet: 'main_wallet',
  account: 'main_account',
  support: 'main_support',
  renew: 'renew_choose',
  back_home: 'main_home',
});
async function getPublishedMenu(menuId = 'main') {
  const state = await storage.get('cms:menu-builder');
  const menus = state?.published?.menus;
  if (!Array.isArray(menus)) return null;
  return menus.find((item) => item && item.id === menuId) || null;
}
async function getPublishedScreen(screenId) {
  const state = await storage.get('cms:menu-builder');
  return state?.published?.screens?.[screenId] || null;
}
function renderRegisteredButton(button) {
  const label = String(button?.label || 'Button').slice(0, 64);
  const action = String(button?.action || '');
  let rendered;
  if (action === 'open_url') rendered = Markup.button.url(label, String(button.params?.url || 'https://example.com'));
  else if (action === 'navigate_menu') rendered = Markup.button.callback(label, 'menu_nav:' + String(button.params?.menuId || 'main'));
  else {
    const callback = MENU_ACTION_CALLBACKS[action];
    rendered = callback ? Markup.button.callback(label, callback) : null;
  }
  const style = ['primary', 'success', 'danger'].includes(button?.style) ? button.style : null;
  if (rendered && style) rendered.style = style;
  return rendered;
}
function applyBuiltInButtonControls(screenId, rows) {
  return (rows || []).map((row) => (row || []).map((button) => {
    if (!button) return null;
    const data = String(button.callback_data || button.callbackData || '');
    let group = null;
    if (/^(service_(test|buy|renew)_)/.test(data)) group = 'services';
    else if (/^(select_plan_|renew_plan_)/.test(data)) group = 'plans';
    else if (/^select_custom_/.test(data)) group = 'custom_plan';
    if (!group) return button;
    const settingsPromise = null;
    return { ...button, __artiqControlGroup: group };
  }).filter(Boolean));
}
async function applyPublishedButtonControls(screenId, rows) {
  const settings = await getPublishedScreen(screenId);
  const controls = settings?.buttonControls || {};
  const output = [];
  for (const row of (rows || [])) {
    const nextRow = [];
    for (const original of (row || [])) {
      if (!original) continue;
      const data = String(original.callback_data || original.callbackData || '');
      let id = null;
      if (/^service_(test|buy|renew)_/.test(data)) id = 'services';
      else if (/^(select_plan_|renew_plan_)/.test(data)) id = 'plans';
      else if (/^select_custom_/.test(data)) id = 'custom_plan';
      else if (screenId === 'account_list' && data.startsWith('account_sub:')) id = 'subscription_detail';
      else if (screenId === 'account_list' && data.startsWith('account_renew:')) id = 'subscription_renew';
      else if (screenId === 'account_list' && data.startsWith('account_remove:')) id = 'subscription_remove';
      else if (screenId === 'account_detail' && original.url) id = 'open_link';
      else if (screenId === 'account_detail' && data.startsWith('copy_sub:')) id = 'copy_link';
      else if (screenId === 'account_detail' && data.startsWith('account_renew:')) id = 'renew_subscription';
      else if (screenId === 'account_detail' && data === 'account_list') id = 'back_to_list';
      else if (screenId === 'account_remove' && data.startsWith('account_remove_confirm:')) id = 'confirm_remove';
      else if (screenId === 'account_remove' && data === 'account_list') id = 'cancel_remove';
      else if (data === 'main_home') id = 'home';
      const c = id ? controls[id] : null;
      if (c?.enabled === false) continue;
      if (!c) { nextRow.push(original); continue; }
      const label = String(c.label || '{label}').replace(/\\{label\\}/g, String(original.text || 'Button')).slice(0, 64);
      let rendered = c.action && c.action !== 'original' ? renderRegisteredButton({ label, action: c.action, params: c.params || {}, style: c.style }) : { ...original, text: label };
      if (!rendered) continue;
      if (c.style === 'default') delete rendered.style;
      else if (['primary', 'success', 'danger'].includes(c.style)) rendered.style = c.style;
      nextRow.push(rendered);
    }
    if (nextRow.length) output.push(nextRow);
  }
  return output;
}
async function getScreenExtraRows(screenId) {
  const settings = await getPublishedScreen(screenId);
  const columns = Math.max(1, Math.min(4, Number(settings?.columns || 1)));
  const buttons = (Array.isArray(settings?.buttons) ? settings.buttons : []).map(renderRegisteredButton).filter(Boolean);
  const rows = [];
  for (let i = 0; i < buttons.length; i += columns) rows.push(buttons.slice(i, i + columns));
  return rows;
}
async function arrangeScreenRows(screenId, rows, { preserveRows = false } = {}) {
  const settings = await getPublishedScreen(screenId);
  const columns = Math.max(1, Math.min(4, Number(settings?.columns || 1)));
  const extraRows = await getScreenExtraRows(screenId);
  let originalRows = rows || [];
  const hasConfiguredHome = (settings?.buttons || []).some((button) => button.action === 'back_home');
  const hasExistingHome = originalRows.flat().some((button) => String(button?.callback_data || '') === 'main_home');
  if (settings?.homeButton && screenId !== 'main' && !hasConfiguredHome && !hasExistingHome) {
    originalRows = [...originalRows, [Markup.button.callback('🏠 منوی اصلی', 'main_home')]];
  }
  const baseButtons = originalRows.flat().filter(Boolean);
  const style = ['default', 'primary', 'success', 'danger'].includes(settings?.buttonStyle) ? settings.buttonStyle : null;
  baseButtons.forEach((button) => { if (style && style !== 'default') button.style = style; else if (style === 'default') delete button.style; });
  const controlledRows = await applyPublishedButtonControls(screenId, originalRows);
  const buttons = [...controlledRows.flat().filter(Boolean), ...extraRows.flat()];
  if (preserveRows) return [...controlledRows, ...extraRows];
  const result = [];
  const rowLayout = Array.isArray(settings?.rowLayout) ? settings.rowLayout.slice(0, 30) : [];
  let offset = 0;
  for (const rowWidth of rowLayout) {
    const width = Math.max(1, Math.min(4, Number(rowWidth) || 1));
    if (offset >= buttons.length) break;
    result.push(buttons.slice(offset, offset + width));
    offset += width;
  }
  for (let i = offset; i < buttons.length; i += columns) result.push(buttons.slice(i, i + columns));
  return result;
}
async function formatScreenMessage(screenId, fallback, values = {}) {
  const settings = await getPublishedScreen(screenId);
  const template = String(settings?.messageTemplate || '').trim();
  if (!template) return fallback;
  return template.replace(/\{(service|prompt|title|mode)\}/g, (_, key) => String(values[key] ?? ''));
}
async function getMenuKeyboard(menuId = 'main') {
  const menu = await getPublishedMenu(menuId);
  if (!menu) return null;
  const rows = (menu.rows || []).map((row) => (row.buttons || []).map((button) => {
    const label = String(button.label || 'Button').slice(0, 64);
    const action = String(button.action || '');
    let rendered;
    if (action === 'open_url') rendered = Markup.button.url(label, String(button.params?.url || 'https://example.com'));
    else if (action === 'navigate_menu') rendered = Markup.button.callback(label, 'menu_nav:' + String(button.params?.menuId || 'main'));
    else {
      const callback = MENU_ACTION_CALLBACKS[action];
      rendered = callback ? Markup.button.callback(label, callback) : null;
    }
    const style = ['primary', 'success', 'danger'].includes(button.style) ? button.style : null;
    if (rendered && style) rendered.style = style;
    return rendered;
  }).filter(Boolean)).filter((row) => row.length);
  const hasHome = (menu.rows || []).some((row) => (row.buttons || []).some((button) => button.action === 'back_home'));
  if (menuId !== 'main' && !hasHome) rows.push([Markup.button.callback('🏠 منوی اصلی', 'main_home')]);
  return Markup.inlineKeyboard(rows);
}

const { Markup, Telegraf } = require('telegraf');
const wallet = require('./wallet');
const accountUI = require('./account-ui');
const { serviceButtonsWithPanels } = require('./services');

// Telegram inline keyboards support native primary, success, and danger button styles.
// Keep the default style omitted so Telegram applies its standard appearance.
function addMainMenuButton(key, text) {
  const value = String(text || '');
  if (key === 'test') return `🟢 ${value.replace(/^🎁\s*/, '')}`;
  if (key === 'buy') return `🔵 ${value.replace(/^🛒\s*/, '')}`;
  if (key === 'account') return `🟣 ${value.replace(/^👤\s*/, '')}`;
  if (key === 'wallet') return `🟡 ${value.replace(/^💰\s*/, '')}`;
  if (key === 'support') return `⚪ ${value.replace(/^🎯\s*/, '')}`;
  return value;
}

if (!Markup.__artiqMainMenuPatched) {
  const nativeKeyboard = Markup.keyboard.bind(Markup);
  Markup.keyboard = function patchedKeyboard(buttons, ...args) {
    const rows = Array.isArray(buttons) ? buttons : [];
    const isMainMenu = rows.length === 5 && rows.every((row) => Array.isArray(row) && row.length === 1);
    if (!isMainMenu) return nativeKeyboard(buttons, ...args);
    const labels = rows.map((row) => String(row[0] ?? ''));
    return {
      resize() {
        return Markup.inlineKeyboard([
          [Markup.button.callback(addMainMenuButton('test', labels[0]), 'main_test')],
          [Markup.button.callback(addMainMenuButton('buy', labels[1]), 'main_buy')],
          [Markup.button.callback(addMainMenuButton('wallet', labels[2]), 'main_wallet'), Markup.button.callback(addMainMenuButton('account', labels[3]), 'main_account')],
          [Markup.button.callback(addMainMenuButton('support', labels[4]), 'main_support')],
        ]);
      },
    };
  };
  Markup.__artiqMainMenuPatched = true;
}

if (!Markup.__artiqInlineHomePatched) {
  const nativeInlineKeyboard = Markup.inlineKeyboard.bind(Markup);
  Markup.inlineKeyboard = function patchedInlineKeyboard(buttons, ...args) {
    const rows = Array.isArray(buttons) ? buttons.map((row) => Array.isArray(row) ? row : [row]) : [];
    const hasHome = rows.some((row) => row.some((button) => String(button?.callback_data || button?.callbackData || '') === 'main_home'));
    const isMainMenu = rows.some((row) => row.some((button) => /^main_(test|buy|wallet|account|support)$/.test(String(button?.callback_data || button?.callbackData || ''))));
    if (hasHome || isMainMenu) return nativeInlineKeyboard(buttons, ...args);
    return nativeInlineKeyboard([...buttons, [Markup.button.callback('🏠 منوی اصلی', 'main_home')]], ...args);
  };
  Markup.__artiqInlineHomePatched = true;
}

if (!Telegraf.prototype.__artiqMainMenuCallbackPatched) {
  const nativeOn = Telegraf.prototype.on;
  Telegraf.prototype.on = function patchedOn(updateTypes, ...middlewares) {
    const types = Array.isArray(updateTypes) ? updateTypes : [updateTypes];
    if (!types.includes('callback_query') || !middlewares.length) return nativeOn.call(this, updateTypes, ...middlewares);
    const first = middlewares[0];
    const wrapped = async (ctx, next) => {
      const data = String(ctx.callbackQuery?.data || '');
      if (data === 'main_home') {
        await ctx.answerCbQuery().catch(() => {});
        const config = await getConfig();
        const b = config.buttons || {};
        const mainMenu = await getPublishedMenu('main');
        const message = mainMenu?.text || await getMessage('start');
        const configuredKeyboard = await getMenuKeyboard('main');
        if (configuredKeyboard) return ctx.reply(message, configuredKeyboard);
        return ctx.reply(message, Markup.inlineKeyboard([
          [Markup.button.callback(addMainMenuButton('test', b.test || '🎁 دریافت اکانت تست'), 'main_test')],
          [Markup.button.callback(addMainMenuButton('buy', b.buy || '🛒 خرید اشتراک'), 'main_buy')],
          [Markup.button.callback(addMainMenuButton('wallet', b.wallet || '💰 کیف پول من'), 'main_wallet'), Markup.button.callback(addMainMenuButton('account', b.account || '👤 حساب من'), 'main_account')],
          [Markup.button.callback(addMainMenuButton('support', b.support || '🎯 پشتیبانی'), 'main_support')],
        ]));
      }
      if (data.startsWith('menu_nav:')) {
        await ctx.answerCbQuery().catch(() => {});
        const targetId = data.slice('menu_nav:'.length);
        const targetMenu = await getPublishedMenu(targetId);
        const targetKeyboard = targetMenu ? await getMenuKeyboard(targetId) : null;
        if (!targetMenu || !targetKeyboard) return ctx.reply('This menu is no longer available.');
        const targetText = targetMenu.text || 'Choose an option:';
        return ctx.reply(targetText, targetKeyboard);
      }
      if (data === 'main_test' || data === 'main_buy') {
        const config = await getConfig();
        const mode = data === 'main_test' ? 'test' : 'buy';
        const titleKey = mode === 'test' ? 'serviceSelectionTest' : 'serviceSelectionBuy';
        const screenId = mode === 'test' ? 'service_test' : 'service_buy';
        const prefix = mode === 'test' ? 'service_test_' : 'service_buy_';
        const buttons = await serviceButtonsWithPanels(prefix, config, mode === 'test' ? 'test' : 'purchase');
        await ctx.answerCbQuery().catch(() => {});
        if (!buttons.length) return ctx.reply((await getMessage('serviceUnavailable', { service_name: '' })) || '🛠️ در حال حاضر سرویسی برای این عملیات فعال نیست.');
        const fallbackTitle = (await getMessage(titleKey)) || (mode === 'test' ? '🎁 سرویس مورد نظر برای اکانت تست را انتخاب کنید:' : '🛒 ابتدا سرویس مورد نظر را انتخاب کنید:');
        const title = await formatScreenMessage(screenId, fallbackTitle, { title: fallbackTitle, mode });
        const rows = await arrangeScreenRows(screenId, buttons);
        return ctx.reply(title, Markup.inlineKeyboard(rows));
      }
      if (data === 'main_wallet') {
        await ctx.answerCbQuery().catch(() => {});
        const balance = await wallet.getBalance(ctx.from.id);
        await storage.setState('user', ctx.from.id, { stage: 'AWAITING_WALLET_AMOUNT', orderId: null, requiredAmount: 0, balance });
        const screen = await getPublishedScreen('wallet') || {};
        const fallback = `💰 <b>کیف پول من</b>\\n\\nموجودی فعلی: <b>${balance.toLocaleString('en-US')} تومان</b>\\n\\nمبلغی که می‌خواهید کیف پول را شارژ کنید به تومان وارد کنید.\\n\\nپس از ارسال رسید و تأیید مدیر، مبلغ به موجودی شما اضافه می‌شود.`;
        const message = await formatScreenMessage('wallet', fallback, { title: 'کیف پول من', mode: 'wallet' });
        const extraRows = await getScreenExtraRows('wallet');
        const rows = [...extraRows, ...(screen.homeButton === false || (screen.buttons || []).some((button) => button.action === 'back_home') ? [] : [[Markup.button.callback('🏠 منوی اصلی', 'main_home')]])];
        return ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
      }
      if (data === 'main_account') {
        await ctx.answerCbQuery().catch(() => {});
        const subscriptions = await accountUI.listForUser(ctx.from.id);
        const screen = await getPublishedScreen('account_list') || {};
        if (!subscriptions.length) {
          const extraRows = await getScreenExtraRows('account_list');
          const rows = [...extraRows, ...(screen.homeButton === false || (screen.buttons || []).some((button) => button.action === 'back_home') ? [] : [[Markup.button.callback('🏠 منوی اصلی', 'main_home')]])];
          return ctx.reply(await getMessage('accountNoSubscription'), { reply_markup: { inline_keyboard: rows } });
        }
        const fallback = '👤 <b>حساب من</b>\\n\\nاشتراک موردنظر را انتخاب کنید:';
        const message = await formatScreenMessage('account_list', fallback, { title: '👤 حساب من' });
        return ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [...accountUI.subscriptionKeyboard(subscriptions, screen), ...(await getScreenExtraRows('account_list'))] } });
      }
      if (data === 'main_support') {
        await ctx.answerCbQuery().catch(() => {});
        const config = await getConfig();
        const supportUsername = config.payment.supportUsername || 'Your_Personal_ID';
        const fallback = await getMessage('support', { support_username: supportUsername });
        const screen = await getPublishedScreen('support') || {};
        const message = await formatScreenMessage('support', fallback, { title: 'پشتیبانی', mode: 'support' });
        const extraRows = await getScreenExtraRows('support');
        const rows = [...extraRows, ...(screen.homeButton === false || (screen.buttons || []).some((button) => button.action === 'back_home') ? [] : [[Markup.button.callback('🏠 منوی اصلی', 'main_home')]])];
        return ctx.reply(message, { reply_markup: { inline_keyboard: rows } });
      }
      return first(ctx, next);
    };
    return nativeOn.call(this, updateTypes, wrapped, ...middlewares.slice(1));
  };
  Telegraf.prototype.__artiqMainMenuCallbackPatched = true;
}

module.exports = { KEY, DEFAULTS, getConfig, saveConfig, getSetting, getMessage, getButton, getPublishedMenu, getMenuKeyboard, getPublishedScreen, getScreenExtraRows, arrangeScreenRows, formatScreenMessage, normalize };
