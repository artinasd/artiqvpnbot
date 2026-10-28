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

// Resolve custom-menu placeholders against the requesting Telegram user's saved record.
async function formatPublishedMenuText(menuId, telegramUserId) {
  const menu = await getPublishedMenu(menuId);
  if (!menu) return '';
  const template = String(menu.text || '').replace(/\\+r\\+n/g, '\n').replace(/\\+n/g, '\n');
  if (!template.includes('{debt}')) return template;
  const user = telegramUserId == null ? null : await storage.getUser(telegramUserId);
  const debt = Number(user?.debtAmount || 0);
  const formattedDebt = (Number.isFinite(debt) ? debt : 0).toLocaleString('en-US');
  return template.replace(/\{debt\}/g, formattedDebt);
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
  else if (action === 'select_panel_buy' || action === 'select_panel_test') {
    const serviceId = String(button.params?.serviceId || '');
    if (!/^(?:panel|master)_[a-zA-Z0-9_-]{1,45}$/.test(serviceId)) return null;
    const callback = action === 'select_panel_test' ? 'service_test_' + serviceId : 'service_buy_' + serviceId;
    rendered = Markup.button.callback(label, callback);
  } else {
    const callback = MENU_ACTION_CALLBACKS[action];
    rendered = callback ? Markup.button.callback(label, callback) : null;
  }
  const style = ['primary', 'success', 'danger'].includes(button?.style) ? button.style : null;
  if (rendered && style) rendered.style = style;
  if (rendered && button?.style === 'glass') rendered.__artiqGlass = true;
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
function getPublishedButtonRole(screenId, button) {
  const data = String(button?.callback_data || button?.callbackData || '');
  if (/^service_(test|buy)_/.test(data)) { const serviceId = data.replace(/^service_(?:test|buy)_/, ''); if (serviceId.startsWith('panel_')) return 'panel_' + serviceId.slice('panel_'.length); if (serviceId.startsWith('master_')) return serviceId; return 'services'; }
  if (/^service_renew_/.test(data)) return 'services';
  if (/^(select_plan_|renew_plan_)/.test(data)) return 'plans';
  if (/^select_custom_/.test(data)) return 'custom_plan';
  if (data === 'main_home') return 'home';
  if (screenId === 'account_list' && data.startsWith('account_sub:')) return 'subscription_detail';
  if (screenId === 'account_list' && data.startsWith('account_renew:')) return 'subscription_renew';
  if (screenId === 'account_list' && data.startsWith('account_remove:')) return 'subscription_remove';
  if (screenId === 'account_detail' && button?.url) return 'open_link';
  if (screenId === 'account_detail' && data.startsWith('copy_sub:')) return 'copy_link';
  if (screenId === 'account_detail' && data.startsWith('account_renew:')) return 'renew_subscription';
  if (screenId === 'account_detail' && data === 'account_list') return 'back_to_list';
  if (screenId === 'account_remove' && data.startsWith('account_remove_confirm:')) return 'confirm_remove';
  if (screenId === 'account_remove' && data === 'account_list') return 'cancel_remove';
  return null;
}
async function applyPublishedButtonControls(screenId, rows) {
  const settings = await getPublishedScreen(screenId);
  const controls = settings?.buttonControls || {};
  const configuredRows = Array.isArray(settings?.buttonRows) ? settings.buttonRows : null;
  const transformed = [];
  for (const row of (rows || [])) {
    const nextRow = [];
    for (const original of (row || [])) {
      if (!original) continue;
      const role = getPublishedButtonRole(screenId, original);
      const control = role ? controls[role] : null;
      const panelSpecificRole = ['service_test','service_buy'].includes(screenId) && /^panel_/.test(String(role || ''));
      // Keep the subscription-detail action available: hiding it would leave users
      // with pagination and home navigation but no way to open any subscription.
      // Renew/remove remain fully configurable and can still be disabled.
      if (role && control?.enabled === false && !(screenId === 'account_list' && role === 'subscription_detail')) continue;
      if (!role || !control) {
        nextRow.push({ button: original, role });
        continue;
      }
      // Existing live buttons carry entity-specific callback data or URLs. Never replace
      // those handlers with a generic action; only permit safe presentation changes.
      const originalLabel = String(original.text || 'Button');
      const label = panelSpecificRole ? originalLabel : String(control.label || '{label}').replace(/\{label\}/g, originalLabel).slice(0, 64);
      let rendered = { ...original, text: label };
      // Only the generic home button may change action. Entity-specific live buttons keep
      // their original callbacks/URLs so subscription IDs and service IDs cannot be lost.
      if (role === 'home' && control.action && control.action !== 'original') {
        rendered = renderRegisteredButton({ label, action: control.action, params: control.params || {}, style: control.style }) || rendered;
      }
      if (control.style === 'glass') { delete rendered.style; rendered.__artiqGlass = true; }
      else if (['primary', 'success', 'danger'].includes(control.style)) { delete rendered.__artiqGlass; rendered.style = control.style; }
      else if (control.style === 'default') { delete rendered.style; delete rendered.__artiqGlass; }
      nextRow.push({ button: rendered, role });
    }
    if (nextRow.length) transformed.push(nextRow);
  }
  if (!configuredRows) return transformed.map((row) => row.map((item) => item.button));

  if (['service_test','service_buy'].includes(screenId)) {
    const allItems = transformed.flat();
    const assigned = new Set();
    const arranged = [];
    for (const layoutRow of configuredRows) {
      const roles = Array.isArray(layoutRow?.roles) ? layoutRow.roles : [];
      // Preserve the left-to-right order chosen in Menu Maker. Filtering allItems by membership
      // groups buttons correctly but silently keeps their original panel order.
      const row = roles.flatMap((role) => allItems.filter((item) => item.role === role && !assigned.has(item)));
      row.forEach((item) => assigned.add(item));
      if (row.length) arranged.push(row.map((item) => item.button));
    }
    const leftovers = allItems.filter((item) => !assigned.has(item));
    for (const item of leftovers) arranged.push([item.button]);
    return arranged;
  }

  // Rebuild each original entity row using the editor's row definitions. This preserves
  // subscription-specific IDs while allowing each subscription's buttons to be rearranged.
  const arranged = [];
  for (const sourceRow of transformed) {
    const assigned = new Set();
    for (const layoutRow of configuredRows) {
      const roles = Array.isArray(layoutRow?.roles) ? layoutRow.roles : [];
      const row = sourceRow.filter((item) => item.role && roles.includes(item.role) && !assigned.has(item));
      row.forEach((item) => assigned.add(item));
      if (row.length) arranged.push(row.map((item) => item.button));
    }
    // Preserve any enabled live action omitted from a stale/incomplete row layout.
    // Disabled roles were already filtered above, so this cannot resurrect removed buttons.
    const leftovers = sourceRow.filter((item) => !assigned.has(item));
    if (leftovers.length) arranged.push(leftovers.map((item) => item.button));
  }
  return arranged;
}
async function getScreenExtraRows(screenId) {
  const settings = await getPublishedScreen(screenId);
  const buttons = Array.isArray(settings?.buttons) ? settings.buttons : [];
  const groups = [];
  buttons.forEach((button, index) => {
    const rendered = renderRegisteredButton(button);
    if (!rendered) return;
    const key = button?.rowId || ('legacy:' + (button?.id || index));
    let group = groups.find((item) => item.key === key);
    if (!group) { group = { key, buttons: [] }; groups.push(group); }
    group.buttons.push(rendered);
  });
  // rowId is an explicit layout choice in Menu Maker. Do not split a
  // configured row based on the screen's default column count.
  const rows = groups.map((group) => group.buttons);
  rows.flat().forEach((button) => { if (button) delete button.__artiqGlass; });
  return rows;
}
function preserveAccountDetailButtons(screenId, originalRows, arrangedRows, columns = 1) {
  if (screenId !== 'account_list') return arrangedRows;
  const present = new Set((arrangedRows || []).flat().map((button) => String(button?.callback_data || '')).filter((data) => data.startsWith('account_sub:')));
  const missing = (originalRows || []).flat().filter((button) => {
    const data = String(button?.callback_data || '');
    if (!data.startsWith('account_sub:') || present.has(data)) return false;
    present.add(data);
    return true;
  });
  const result = [...(arrangedRows || [])];
  for (let i = 0; i < missing.length; i += columns) result.push(missing.slice(i, i + columns));
  return result;
}

async function arrangeScreenRows(screenId, rows, { preserveRows = false } = {}) {
  const settings = await getPublishedScreen(screenId);
  const columns = Math.max(1, Math.min(4, Number(settings?.columns || 1)));
  let originalRows = rows || [];
  const hasConfiguredHome = (settings?.buttons || []).some((button) => button.action === 'back_home');
  const hasExistingHome = originalRows.flat().some((button) => String(button?.callback_data || '') === 'main_home');
  if (settings?.homeButton && screenId !== 'main' && !hasConfiguredHome && !hasExistingHome) {
    originalRows = [...originalRows, [Markup.button.callback('🏠 منوی اصلی', 'main_home')]];
  }
  const baseButtons = originalRows.flat().filter(Boolean);
  const style = ['primary', 'success', 'danger'].includes(settings?.buttonStyle) ? settings.buttonStyle : null;
  baseButtons.forEach((button) => { if (button.__artiqGlass || settings?.buttonStyle === 'glass' || settings?.buttonStyle === 'default') delete button.style; else if (style) button.style = style; });
  const controlledRows = await applyPublishedButtonControls(screenId, originalRows);
  const configuredRows = Array.isArray(settings?.buttonRows) ? settings.buttonRows : null;
  const buttons = controlledRows.flat().filter(Boolean);
  const extraGroups = [];
  (Array.isArray(settings?.buttons) ? settings.buttons : []).forEach((button, index) => {
    const rendered = renderRegisteredButton(button);
    if (!rendered) return;
    const key = button?.rowId || ('legacy:' + (button?.id || index));
    let group = extraGroups.find((item) => item.key === key);
    if (!group) { group = { key, buttons: [] }; extraGroups.push(group); }
    group.buttons.push(rendered);
  });
  if (configuredRows) {
    // Custom buttons targeting a managed row are appended to that live row at runtime.
    // Only presentation and the custom action are added; existing live callbacks/URLs stay untouched.
    const arranged = [];
    const attachedGroups = new Set();
    for (const controlledRow of controlledRows) {
      const rowRoles = new Set(controlledRow.map((button) => getPublishedButtonRole(screenId, button)).filter(Boolean));
      const layoutRow = configuredRows.find((candidate) => (candidate.roles || []).some((role) => rowRoles.has(role)));
      const row = controlledRow.slice();
      if (layoutRow) {
        for (const group of extraGroups) {
          if (group.key === layoutRow.id) {
            row.push(...group.buttons);
            attachedGroups.add(group);
          }
        }
      }
      if (row.length) arranged.push(row);
    }
    for (const group of extraGroups) {
      if (attachedGroups.has(group)) continue;
      // Keep each custom row intact; columns only apply to automatically laid-out buttons.
      arranged.push(group.buttons);
    }
    arranged.flat().forEach((button) => { if (button) delete button.__artiqGlass; });
    return preserveAccountDetailButtons(screenId, originalRows, arranged, columns);
  }
  const extraRows = await getScreenExtraRows(screenId);
  if (preserveRows) return preserveAccountDetailButtons(screenId, originalRows, [...controlledRows, ...extraRows], columns);
  const allButtons = [...buttons, ...extraRows.flat()];
  const result = [];
  const rowLayout = Array.isArray(settings?.rowLayout) ? settings.rowLayout.slice(0, 30) : [];
  let offset = 0;
  for (const rowWidth of rowLayout) {
    const width = Math.max(1, Math.min(4, Number(rowWidth) || 1));
    if (offset >= allButtons.length) break;
    result.push(allButtons.slice(offset, offset + width));
    offset += width;
  }
  for (let i = offset; i < allButtons.length; i += columns) result.push(allButtons.slice(i, i + columns));
  result.flat().forEach((button) => { if (button) delete button.__artiqGlass; });
  return preserveAccountDetailButtons(screenId, originalRows, result, columns);
}
async function formatScreenMessage(screenId, fallback, values = {}) {
  const settings = await getPublishedScreen(screenId);
  const template = String(settings?.messageTemplate || '').trim();
  if (!template) return fallback;
  const normalizedTemplate = template.replace(/\\+r\\+n/g, '\n').replace(/\\+n/g, '\n');
  return normalizedTemplate.replace(/\{(service|prompt|title|mode|balance)\}/g, (_, key) => String(values[key] ?? '')).trim();
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
    else if (action === 'select_panel_buy' || action === 'select_panel_test') {
      const panelId = String(button.params?.panelId || '');
      if (!/^[a-zA-Z0-9_-]{1,45}$/.test(panelId)) return null;
      const callback = action === 'select_panel_test' ? 'service_test_panel_' + panelId : 'service_buy_panel_' + panelId;
      rendered = Markup.button.callback(label, callback);
    } else {
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
  return String(text || '');
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
      let data = String(ctx.callbackQuery?.data || '');
      if (data === 'main_home') {
        await ctx.answerCbQuery().catch(() => {});
        const config = await getConfig();
        const b = config.buttons || {};
        const mainMenu = await getPublishedMenu('main');
        const message = mainMenu?.text ? await formatPublishedMenuText('main', ctx.from.id) : await getMessage('start');
        const configuredKeyboard = await getMenuKeyboard('main');
        if (configuredKeyboard) return ctx.reply(message, { ...configuredKeyboard, parse_mode: 'HTML' });
        return ctx.reply(message, { ...Markup.inlineKeyboard([
          [Markup.button.callback(addMainMenuButton('test', b.test || '🎁 دریافت اکانت تست'), 'main_test')],
          [Markup.button.callback(addMainMenuButton('buy', b.buy || '🛒 خرید اشتراک'), 'main_buy')],
          [Markup.button.callback(addMainMenuButton('wallet', b.wallet || '💰 کیف پول من'), 'main_wallet'), Markup.button.callback(addMainMenuButton('account', b.account || '👤 حساب من'), 'main_account')],
          [Markup.button.callback(addMainMenuButton('support', b.support || '🎯 پشتیبانی'), 'main_support')],
        ]), parse_mode: 'HTML' });
      }
      if (data.startsWith('menu_nav:')) {
        await ctx.answerCbQuery().catch(() => {});
        const targetId = data.slice('menu_nav:'.length);
        if (targetId.startsWith('screen_')) {
          const screenActions = {
            service_test: 'main_test',
            service_buy: 'main_buy',
            service_renew: 'renew_choose',
            plans_buy: 'main_buy',
            plans_renew: 'renew_choose',
            account_list: 'main_account',
            account_detail: 'main_account',
            account_remove: 'main_account',
            wallet: 'main_wallet',
            support: 'main_support',
          };
          const screenId = targetId.slice('screen_'.length);
          data = screenActions[screenId] || '';
          if (!data) return ctx.reply('This bot screen is not available.');
          if (ctx.callbackQuery) ctx.callbackQuery.data = data;
        } else {
          const targetMenu = await getPublishedMenu(targetId);
          const targetKeyboard = targetMenu ? await getMenuKeyboard(targetId) : null;
          if (!targetMenu || !targetKeyboard) return ctx.reply('This menu is no longer available.');
          const targetText = targetMenu.text ? await formatPublishedMenuText(targetId, ctx.from.id) : 'Choose an option:';
          return ctx.reply(targetText, { ...targetKeyboard, parse_mode: 'HTML' });
        }
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
        return ctx.reply(title, { ...Markup.inlineKeyboard(rows), parse_mode: 'HTML' });
      }
      if (data === 'main_wallet') {
        await ctx.answerCbQuery().catch(() => {});
        const balance = await wallet.getBalance(ctx.from.id);
        await storage.setState('user', ctx.from.id, { stage: 'AWAITING_WALLET_AMOUNT', orderId: null, requiredAmount: 0, balance });
        const screen = await getPublishedScreen('wallet') || {};
        const fallback = `💰 <b>کیف پول من</b>\n\nموجودی فعلی: <b>${balance.toLocaleString('en-US')} تومان</b>\n\nمبلغی که می‌خواهید کیف پول را شارژ کنید به تومان وارد کنید.\n\nپس از ارسال رسید و تأیید مدیر، مبلغ به موجودی شما اضافه می‌شود.`;
        const message = await formatScreenMessage('wallet', fallback, { title: 'کیف پول من', mode: 'wallet', balance: balance.toLocaleString('en-US') });
        const extraRows = await getScreenExtraRows('wallet');
        const rows = [...extraRows, ...(screen.homeButton === false || (screen.buttons || []).some((button) => button.action === 'back_home') ? [] : [[Markup.button.callback('🏠 منوی اصلی', 'main_home')]])];
        return ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
      }
      if (data === 'main_account') {
        await ctx.answerCbQuery().catch(() => {});
        const subscriptions = await accountUI.listForUser(ctx.from.id);
        const screen = await getPublishedScreen('account_list') || {};
        const hasConfiguredHome = (screen.buttons || []).some((button) => button.action === 'back_home');
        const homeButton = screen.homeButton !== false && !hasConfiguredHome;
        if (!subscriptions.length) {
          const rows = await arrangeScreenRows('account_list', homeButton ? [[Markup.button.callback('🏠 منوی اصلی', 'main_home')]] : []);
          return ctx.reply(await getMessage('accountNoSubscription'), { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
        }
        const pageSize = 20;
        const totalPages = Math.max(1, Math.ceil(subscriptions.length / pageSize));
        const current = subscriptions.slice(0, pageSize);
        const fallback = '👤 <b>حساب من</b>\n\nاشتراک موردنظر را انتخاب کنید:';
        let message = await formatScreenMessage('account_list', fallback, { title: '👤 حساب من' });
        if (totalPages > 1) message += `\n\nصفحه 1 از ${totalPages}`;
        // Render subscription buttons as plain Telegram API objects. The account list
        // must not depend on Menu Maker's row layout or the shared keyboard helper.
        const rows = current.map((subscription) => [{
          text: String(subscription.title || 'اشتراک').slice(0, 64),
          callback_data: `account_sub:${subscription.id}`,
        }, ...(screen.buttonControls?.subscription_renew?.enabled === false ? [] : [{
          text: String(screen.renewLabel || '🔁').slice(0, 64),
          callback_data: `account_renew:${subscription.id}`,
        }]), ...(screen.buttonControls?.subscription_remove?.enabled === false ? [] : [{
          text: String(screen.removeLabel || '❌').slice(0, 64),
          callback_data: `account_remove:${subscription.id}`,
        }])]);
        if (totalPages > 1) rows.push([{ text: 'بعدی ➡️', callback_data: 'account_page:1' }]);
        if (homeButton) rows.push([{ text: '🏠 منوی اصلی', callback_data: 'main_home' }]);
        rows.push(...(await getScreenExtraRows('account_list')));
        return ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
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
        return ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
      }
      return first(ctx, next);
    };
    return nativeOn.call(this, updateTypes, wrapped, ...middlewares.slice(1));
  };
  Telegraf.prototype.__artiqMainMenuCallbackPatched = true;
}

module.exports = { KEY, DEFAULTS, getConfig, saveConfig, getSetting, getMessage, getButton, getPublishedMenu, formatPublishedMenuText, getMenuKeyboard, getPublishedScreen, getScreenExtraRows, arrangeScreenRows, formatScreenMessage, normalize };
