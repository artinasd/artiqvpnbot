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
    data.startsWith('back_') ||
    data.startsWith('menu_')
  ) {
    return 'primary';
  }

  if (
    data.startsWith('disable_') ||
    data.startsWith('cancel_') ||
    data.startsWith('delete_') ||
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

function subscriptionKeyboard(subscriptions, options = {}) {
  const label = (template, title) => String(template || '{title}').replace(/\\{title\\}/g, String(title || 'اشتراک')).slice(0, 64);
  const rows = subscriptions.map((s) => ([
    { text: label(options.detailLabel, s.title), callback_data: `account_sub:${s.id}`, style: 'primary' },
    { text: String(options.renewLabel || '🔁').slice(0, 64), callback_data: `account_renew:${s.id}`, style: 'success' },
    { text: String(options.removeLabel || '❌').slice(0, 64), callback_data: `account_remove:${s.id}`, style: 'danger' }
  ]));
  if (options.homeButton !== false) rows.push([homeButton()]);
  return rows;
}

function removeConfirmationKeyboard(orderId, options = {}) {
  return [
    [{ text: String(options.confirmLabel || '🗑️ بله، حذف اشتراک').slice(0, 64), callback_data: `account_remove_confirm:${orderId}`, style: 'danger' }],
    [{ text: String(options.cancelLabel || '↩️ انصراف').slice(0, 64), callback_data: 'account_list', style: 'primary' }]
  ];
}

function detailKeyboard(sub, options = {}) {
  const rows = [];
  if (sub.subUrl) rows.push([
    { text: String(options.openLabel || '🔗 باز کردن لینک').slice(0, 64), url: sub.subUrl, style: 'primary' },
    { text: String(options.copyLabel || '📋 کپی لینک').slice(0, 64), callback_data: `copy_sub:${sub.id}`, style: 'primary' }
  ]);
  if (sub.canRenew) rows.push([{ text: String(options.renewLabel || '🔄 تمدید اشتراک').slice(0, 64), callback_data: `account_renew:${sub.id}`, style: 'success' }]);
  rows.push([{ text: String(options.backLabel || '⬅️ بازگشت به اشتراک‌ها').slice(0, 64), callback_data: 'account_list', style: 'primary' }]);
  if (options.homeButton !== false) rows.push([homeButton()]);
  return rows;
}

function formatDetail(sub) {
  const lines = [
    `📦 ${sub.planName || 'اشتراک'}`,
    `سرویس: ${sub.service || 'Tunnel'}`,
    `وضعیت: ${sub.status}`
  ];
  if (sub.traffic != null) lines.push(`ترافیک: ${sub.traffic}`);
  if (sub.duration != null) lines.push(`مدت: ${sub.duration} روز`);
  if (sub.expiresAt) lines.push(`انقضا: ${sub.expiresAt}`);
  if (sub.canRenew) lines.push('', 'برای تمدید همین اشتراک، دکمه تمدید را بزنید.');
  return lines.join('\n');
}

async function listForUser(telegramUserId) {
  const orders = await accountService.listSubscriptions(telegramUserId);
  return orders.map((order) => ({
    ...accountService.summary(order),
    // Username is persisted under generatedPasarguardUsername in Redis.
    // Keep listing fast: don't make live PasarGuard requests here.
    title: order.generatedPasarguardUsername || order.username || order.pasarguardUsername || order.subscriptionUsername || order.planName || order.name || 'اشتراک'
  }));
}

async function getForUser(telegramUserId, orderId) {
  const order = await accountService.getSubscription(telegramUserId, orderId);
  return order ? accountService.summary(order) : null;
}

module.exports = { subscriptionKeyboard, removeConfirmationKeyboard, detailKeyboard, formatDetail, listForUser, getForUser };
