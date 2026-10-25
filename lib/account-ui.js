const accountService = require('./account-service');
const { Markup } = require('telegraf');
require('./force-join');

// Do not apply implicit colors globally: screen/menu configuration must decide
// whether a button has a native Telegram style. Omitted style means glass/default.
function homeButton(options = {}) {
  return applyConfiguredStyle({ text: '🏠 منوی اصلی', callback_data: 'main_home' }, options, 'home');
}

function applyConfiguredStyle(button, options, role) {
  const control = options?.buttonControls?.[role];
  if (!control || !Object.prototype.hasOwnProperty.call(control, 'style')) return button;
  if (control.style === 'glass' || control.style === 'default') delete button.style;
  else if (['primary', 'success', 'danger'].includes(control.style)) button.style = control.style;
  return button;
}

function subscriptionKeyboard(subscriptions, options = {}) {
  const label = (template, title) => String(template || '{title}').replace(/\{title\}/g, String(title || 'اشتراک')).slice(0, 64);
  const rows = subscriptions.map((s) => ([
    applyConfiguredStyle({ text: label(options.detailLabel, s.title), callback_data: `account_sub:${s.id}`, style: 'primary' }, options, 'subscription_detail'),
    applyConfiguredStyle({ text: String(options.renewLabel || '🔁').slice(0, 64), callback_data: `account_renew:${s.id}`, style: 'success' }, options, 'subscription_renew'),
    applyConfiguredStyle({ text: String(options.removeLabel || '❌').slice(0, 64), callback_data: `account_remove:${s.id}`, style: 'danger' }, options, 'subscription_remove')
  ]));
  if (options.pagination && options.pagination.totalPages > 1) {
    const page = Number(options.pagination.page) || 0;
    const totalPages = Number(options.pagination.totalPages) || 1;
    const navigation = [];
    if (page > 0) navigation.push({ text: '⬅️ قبلی', callback_data: `account_page:${page - 1}` });
    if (page + 1 < totalPages) navigation.push({ text: 'بعدی ➡️', callback_data: `account_page:${page + 1}` });
    if (navigation.length) rows.push(navigation);
  }
  if (options.homeButton !== false) rows.push([homeButton(options)]);
  return rows;
}

function removeConfirmationKeyboard(orderId, options = {}) {
  return [
    [applyConfiguredStyle({ text: String(options.confirmLabel || '🗑️ بله، حذف اشتراک').slice(0, 64), callback_data: `account_remove_confirm:${orderId}`, style: 'danger' }, options, 'confirm_remove')],
    [applyConfiguredStyle({ text: String(options.cancelLabel || '↩️ انصراف').slice(0, 64), callback_data: 'account_list', style: 'primary' }, options, 'cancel_remove')]
  ];
}

function detailKeyboard(sub, options = {}) {
  const rows = [];
  if (sub.subUrl) rows.push([
    applyConfiguredStyle({ text: String(options.openLabel || '🔗 باز کردن لینک').slice(0, 64), url: sub.subUrl, style: 'primary' }, options, 'open_link'),
    applyConfiguredStyle({ text: String(options.copyLabel || '📋 کپی لینک').slice(0, 64), callback_data: `copy_sub:${sub.id}`, style: 'primary' }, options, 'copy_link')
  ]);
  if (sub.canRenew) rows.push([applyConfiguredStyle({ text: String(options.renewLabel || '🔄 تمدید اشتراک').slice(0, 64), callback_data: `account_renew:${sub.id}`, style: 'success' }, options, 'renew_subscription')]);
  rows.push([applyConfiguredStyle({ text: String(options.backLabel || '⬅️ بازگشت به اشتراک‌ها').slice(0, 64), callback_data: 'account_list', style: 'primary' }, options, 'back_to_list')]);
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
