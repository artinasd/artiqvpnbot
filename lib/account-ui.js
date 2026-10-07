const accountService = require('./account-service');
const { Markup } = require('telegraf');
require('./force-join');

// Telegram Bot API now supports native button styles: success (green),
// primary (blue), and danger (red). Telegraf 4.16 does not expose the field
// in its button builder, so add it to the plain button object after building it.
function buttonStyleForCallback(callbackData) {
  const data = String(callbackData || '');

  if (data === 'main_test' || data.startsWith('service_test_') || data.startsWith('test_')) {
    return 'success';
  }

  if (
    data === 'main_buy' ||
    data === 'main_wallet' ||
    data === 'main_account' ||
    data === 'main_support' ||
    data === 'main_home' ||
    data.startsWith('service_buy_') ||
    data.startsWith('account_sub:') ||
    data === 'account_list' ||
    data.startsWith('copy_sub:') ||
    data.startsWith('wallet_') ||
    data.startsWith('payment_') ||
    data.startsWith('qr_sub:') ||
    data.startsWith('back_') ||
    data.startsWith('menu_')
  ) {
    return 'primary';
  }

  if (
    data.startsWith('disable_') ||
    data.startsWith('cancel_') ||
    data.startsWith('delete_') ||
    data.startsWith('reset_hwid:') ||
    data.startsWith('danger_')
  ) {
    return 'danger';
  }

  if (data.startsWith('account_renew:') || data.startsWith('renew_')) {
    return 'success';
  }

  return null;
}

// The main-menu implementation temporarily used colored marker emojis. Restore
// the original emojis while adding Telegram's native button background styles.
if (!Markup.__artiqOriginalMenuEmojiPatched) {
  const nativeCallback = Markup.button.callback;
  Markup.button.callback = function restoreOriginalMenuEmoji(text, ...args) {
    let value = String(text ?? '');
    value = value.replace(/^🟢\s*/, '🎁 ')
      .replace(/^🔵\s*/, '🛒 ')
      .replace(/^🟣\s*/, '👤 ')
      .replace(/^🟡\s*/, '💰 ')
      .replace(/^⚪\s*/, '🎯 ');

    const button = nativeCallback.call(this, value, ...args);
    const style = buttonStyleForCallback(button.callback_data);
    if (style) button.style = style;
    return button;
  };
  Markup.__artiqOriginalMenuEmojiPatched = true;
}

function homeButton() {
  return { text: '🏠 منوی اصلی', callback_data: 'main_home', style: 'primary' };
}

function subscriptionKeyboard(subscriptions, page = 1) {
  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(subscriptions.length / PAGE_SIZE));
  let safePage = Number(page);
  if (isNaN(safePage) || safePage < 1) safePage = 1;
  if (safePage > totalPages) safePage = totalPages;

  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = subscriptions.slice(start, start + PAGE_SIZE);

  const keyboard = pageItems.map((s) => ([{
    text: s.title,
    callback_data: `account_sub:${s.id}`,
    style: 'primary'
  }]));

  if (totalPages > 1) {
    const navRow = [];
    if (safePage > 1) {
      navRow.push({ text: '⬅️ قبلی', callback_data: `account_list:${safePage - 1}`, style: 'primary' });
    }
    if (safePage < totalPages) {
      navRow.push({ text: 'بعدی ➡️', callback_data: `account_list:${safePage + 1}`, style: 'primary' });
    }
    keyboard.push(navRow);
  }

  return keyboard;
}

function detailKeyboard(sub) {
  const rows = [];
  if (sub.subUrl) rows.push([
    { text: '🔗 باز کردن لینک', url: sub.subUrl, style: 'primary' },
    { text: '📋 کپی لینک', callback_data: `copy_sub:${sub.id}`, style: 'primary' }
  ], [
    { text: '🖼️ دریافت بارکد (QR)', callback_data: `qr_sub:${sub.id}`, style: 'primary' },
    { text: '♻️ رفع محدودیت کاربر', callback_data: `reset_hwid:${sub.id}`, style: 'danger' }
  ]);
  if (sub.canRenew) {
    rows.push([
      { text: '🔄 تمدید اشتراک', callback_data: `account_renew:${sub.id}`, style: 'success' },
      { text: '⚡ ارتقا (حجم/زمان)', callback_data: `account_upgrade:${sub.id}`, style: 'primary' }
    ]);
  }
  rows.push([{ text: '⬅️ بازگشت به اشتراک‌ها', callback_data: 'account_list', style: 'primary' }]);
  rows.push([homeButton()]);
  return rows;
}

function formatDetail(sub) {
  const lines = [
    `📦 ${sub.planName || 'اشتراک'}`,
    `سرویس: ${sub.service || 'Tunnel'}`,
    `وضعیت: ${sub.status}`
  ];

  if (sub.liveStatus === 'disabled') {
    lines.push('⚠️ وضعیت در سرور: غیرفعال');
  }

  // Format traffic
  const formatBytes = (bytes) => {
    if (bytes === 0 || bytes === null || bytes === undefined) return 'نامحدود';
    const gb = (bytes / (1024 * 1024 * 1024)).toFixed(2);
    return `${gb} GB`;
  };

  const limitBytes = sub.liveDataLimit !== undefined ? sub.liveDataLimit : sub.traffic;
  const usedBytes = sub.liveUsedTraffic;
  
  if (limitBytes === 0 || limitBytes === null || limitBytes === undefined) {
    lines.push(`ترافیک کل: نامحدود`);
    if (usedBytes !== undefined) lines.push(`مصرف شده: ${formatBytes(usedBytes)}`);
  } else {
    lines.push(`ترافیک کل: ${formatBytes(limitBytes)}`);
    if (usedBytes !== undefined) {
      const remaining = Math.max(0, limitBytes - usedBytes);
      lines.push(`مصرف شده: ${formatBytes(usedBytes)}`);
      lines.push(`باقی‌مانده: ${formatBytes(remaining)}`);
    }
  }

  // Format expiration
  const expire = sub.liveExpiresAt !== undefined ? sub.liveExpiresAt : sub.expiresAt;
  if (expire === 0 || expire === null || expire === undefined || expire === '') {
    lines.push(`انقضا: نامحدود`);
  } else {
    const t = new Date(expire).getTime();
    if (Number.isFinite(t)) {
      const msLeft = t - Date.now();
      const daysLeft = Math.max(0, Math.ceil(msLeft / (86400 * 1000)));
      
      const pDate = new Intl.DateTimeFormat('fa-IR', {
        timeZone: 'Asia/Tehran', year: 'numeric', month: 'long', day: 'numeric'
      }).format(new Date(t));

      lines.push(`انقضا: ${pDate}`);
      if (daysLeft > 0) {
        lines.push(`⏳ زمان باقی‌مانده: ${daysLeft} روز`);
      } else {
        lines.push(`⏳ زمان باقی‌مانده: پایان یافته`);
      }
    } else {
      lines.push(`انقضا: ${expire}`);
    }
  }

  lines.push(`📱 تعداد کاربر (دستگاه): ${sub.hwidLimit ? sub.hwidLimit : 'بدون محدودیت'}`);
  if (sub.canRenew) lines.push('', 'برای تمدید یا ارتقا اشتراک، از دکمه‌های زیر استفاده کنید.');
  return lines.join('\n');
}

async function listForUser(telegramUserId) {
  const orders = await accountService.listSubscriptions(telegramUserId);
  return orders.map(accountService.summary);
}

async function getForUser(telegramUserId, orderId) {
  const order = await accountService.getSubscription(telegramUserId, orderId);
  return order ? accountService.summary(order) : null;
}

module.exports = { subscriptionKeyboard, detailKeyboard, formatDetail, listForUser, getForUser };
