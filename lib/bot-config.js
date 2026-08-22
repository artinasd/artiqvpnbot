const storage = require('./storage');

const KEY = 'cms:bot-config';

const DEFAULTS = {
  payment: {
    cardNumber: '6219861947080387',
    cardHolder: 'اسعدی',
    bankDetails: '',
    supportUsername: 'Your_Personal_ID',
  },
  limits: {
    testLimitPerDay: 2,
    testTrafficBytes: 150 * 1024 * 1024,
    testDurationDays: 1,
    testHwidLimit: 0,
  },
  services: {
    tunnelEnabled: true,
    gamingEnabled: true,
  },
  messages: {
    start: '👋 به ربات آرتیک خوش آمدید!\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:',
    support: 'ℹ️ برای پشتیبانی و راهنمایی، با ما در ارتباط باشید:\n\n💬 @{support_username}',
    paymentTitle: '💳 <b>پرداخت اشتراک</b>',
    receiptInstructions: '📸 <b>بعد از پرداخت</b>\nعکس یا فایل رسید پرداخت را همینجا ارسال کنید.',
    paymentFooter: '⚡ پس از دریافت رسید، سفارش شما به‌صورت خودکار برای ساخت اشتراک پردازش می‌شود.\n🔒 لطفاً مبلغ و شماره کارت مقصد را قبل از پرداخت بررسی کنید.',
    testProcessing: '⏳ اکانت تست {service_name} شما در حال ساخت خودکار است...',
    testUnavailable: '🛠️ سرویس {service_name} هنوز در حال آماده‌سازی است.',
    invalidService: '❌ سرویس انتخاب‌شده معتبر نیست.',
    noPlans: '📭 برای سرویس {service_name} فعلاً پلنی ثبت نشده است.',
    planPrompt: 'لطفاً بسته مورد نظر را انتخاب کنید:',
  },
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function merge(base, extra) {
  if (!extra || typeof extra !== 'object') return clone(base);
  const out = clone(base);
  for (const [key, value] of Object.entries(extra)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object') out[key] = merge(out[key], value);
    else out[key] = value;
  }
  return out;
}

async function getConfig() {
  return merge(DEFAULTS, await storage.get(KEY));
}

async function saveConfig(patch) {
  const next = merge(DEFAULTS, await storage.get(KEY));
  const merged = merge(next, patch || {});
  await storage.set(KEY, merged);
  return merged;
}

module.exports = { DEFAULTS, getConfig, saveConfig };
