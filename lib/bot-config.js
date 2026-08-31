const storage = require('./storage');

const KEY = 'cms:bot-config';

const DEFAULTS = {
  payment: { cardNumber: '6219861947080387', cardHolder: 'اسعدی', bankDetails: '', supportUsername: 'Your_Personal_ID', currency: 'تومان' },
  limits: { testLimitPerDay: 2, testTrafficBytes: 150 * 1024 * 1024, testDurationDays: 1, testHwidLimit: 0 },
  resellerTelegramIds: [],
  services: {
    directEnabled: false,
    direct2Enabled: false,
    tunnel: { name: 'Tunnel', emoji: '🛡️', description: 'سرویس اصلی', order: 10, enabled: true, testEnabled: true, purchaseEnabled: true },
    gaming: { name: 'Gaming', emoji: '🎮', description: 'مخصوص بازی', order: 20, enabled: true, testEnabled: true, purchaseEnabled: true },
    direct: { name: 'Direct', emoji: '🎯', description: 'سرویس Direct', order: 30, enabled: false, testEnabled: false, purchaseEnabled: false },
    direct2: { name: 'Direct 2', emoji: '🎯', description: 'سرویس Direct 2', order: 40, enabled: false, testEnabled: false, purchaseEnabled: false, provider: 'pasarguard-direct2' },
  },
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
  const rawServices = raw.services && typeof raw.services === 'object' ? raw.services : {};
  if (!rawServices.direct2) {
    const legacyKey = Object.keys(out.services).find((key) => key !== 'direct2' && out.services[key] && (out.services[key].name === 'Direct 2' || out.services[key].provider === 'pasarguard-direct2'));
    if (legacyKey) { out.services.direct2 = out.services[legacyKey]; delete out.services[legacyKey]; }
  }
  out.resellerTelegramIds = Array.from(new Set((Array.isArray(out.resellerTelegramIds) ? out.resellerTelegramIds : []).map(value => String(value).trim()).filter(value => /^\d+$/.test(value))));
  for (const id of ['tunnel', 'gaming', 'direct', 'direct2']) { const service = out.services[id]; service.name = String(service.name || DEFAULTS.services[id].name).trim() || DEFAULTS.services[id].name; service.emoji = String(service.emoji || DEFAULTS.services[id].emoji).trim() || DEFAULTS.services[id].emoji; service.description = String(service.description ?? DEFAULTS.services[id].description).trim(); service.order = Number.isFinite(Number(service.order)) ? Number(service.order) : DEFAULTS.services[id].order; service.enabled = service.enabled !== false; service.testEnabled = service.testEnabled !== false; service.purchaseEnabled = service.purchaseEnabled !== false; }
  out.services.directEnabled = out.services.direct.enabled;
  out.services.direct2Enabled = out.services.direct2.enabled;
  delete out.services.tunnelEnabled;
  delete out.services.gamingEnabled;
  out.limits.testLimitPerDay = Math.max(0, Number(out.limits.testLimitPerDay) || 0); out.limits.testTrafficBytes = Math.max(0, Number(out.limits.testTrafficBytes) || 0); out.limits.testDurationDays = Math.max(1, Number(out.limits.testDurationDays) || 1); out.limits.testHwidLimit = Math.max(0, Number(out.limits.testHwidLimit) || 0); out.bot.maintenanceMode = Boolean(out.bot.maintenanceMode); out.bot.qrBackground = String(out.bot.qrBackground || 'bg.png').split(/[\\/]/).pop() || 'bg.png'; return out;
}
async function getConfig() { return normalize(await storage.get(KEY)); }
async function saveConfig(patch) { const next = normalize(await storage.get(KEY)); const merged = normalize(merge(next, patch || {})); await storage.set(KEY, merged); return merged; }
async function getSetting(path, fallback) { const config = await getConfig(); const value = String(path || '').split('.').filter(Boolean).reduce((current, key) => current == null ? undefined : current[key], config); return value === undefined ? fallback : value; }
async function getMessage(key, variables = {}) { const config = await getConfig(); let message = config.messages?.[key]; if (message == null) message = DEFAULTS.messages[key] || ''; return String(message).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(variables[name] ?? `{${name}}`)); }
async function getButton(key, fallback = '') { const config = await getConfig(); return String(config.buttons?.[key] ?? DEFAULTS.buttons[key] ?? fallback); }
module.exports = { KEY, DEFAULTS, getConfig, saveConfig, getSetting, getMessage, getButton, normalize };
