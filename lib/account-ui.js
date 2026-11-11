const accountService = require('./account-service');
const { Markup } = require('telegraf');

// Do not apply implicit colors globally: screen/menu configuration must decide
// whether a button has a native Telegram style. Omitted style means glass/default.
function homeButton(options = {}) {
  return applyConfiguredStyle({ text: '🏠 منوی اصلی', callback_data: 'main_home', style: 'primary' }, options, 'home');
}

function applyConfiguredStyle(button, options, role) {
  const control = options?.buttonControls?.[role];
  if (!control) return button;
  if (Object.prototype.hasOwnProperty.call(control, 'style')) {
    if (control.style === 'glass' || control.style === 'default') delete button.style;
    else if (['primary', 'success', 'danger'].includes(control.style)) button.style = control.style;
  }
  if (typeof control.label === 'string' && control.label.trim()) {
    button.text = control.label.replace(/\{label\}/g, String(button.text || '')).slice(0, 64);
  }
  return button;
}

function subscriptionKeyboard(subscriptions, options = {}) {
  const label = (template, title) => String(template || '{title}').replace(/\{title\}/g, String(title || 'اشتراک')).slice(0, 64);
  const rows = subscriptions.flatMap((s, index) => {
    const detailButton = applyConfiguredStyle({
      text: label(options.detailLabel, s.title),
      callback_data: `account_sub:${s.id}`,
      style: 'primary',
    }, options, 'subscription_detail');
    const actionButtons = [
      ...(options.buttonControls?.subscription_renew?.enabled === false ? [] : [applyConfiguredStyle({
        text: String(options.renewLabel || '🔁').slice(0, 64),
        callback_data: `account_renew:${s.id}`,
        style: 'success',
      }, options, 'subscription_renew')]),
      ...(options.buttonControls?.subscription_remove?.enabled === false ? [] : [applyConfiguredStyle({
        text: String(options.removeLabel || '❌').slice(0, 64),
        callback_data: `account_remove:${s.id}`,
        style: 'danger',
      }, options, 'subscription_remove')]),
    ];
    return [
      ...(index > 0 ? [[{ text: '┄┄┄┄┄┄┄┄┄┄', callback_data: 'account_divider' }]] : []),
      [detailButton],
      ...(actionButtons.length ? [actionButtons] : []),
    ];
  });
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
  if (options.homeButton !== false) rows.push([homeButton(options)]);
  return rows;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
}

function formatDetail(sub) {
  const lines = [
    `📦 ${escapeHtml(sub.planName || 'اشتراک')}`,
    `سرویس: ${escapeHtml(sub.service || 'Tunnel')}`,
    `وضعیت: ${escapeHtml(sub.status || '')}`
  ];
  if (sub.traffic != null) lines.push(`ترافیک: ${escapeHtml(sub.traffic)}`);
  if (sub.duration != null) lines.push(`مدت: ${escapeHtml(sub.duration)} روز`);
  if (sub.expiresAt) lines.push(`انقضا: ${escapeHtml(sub.expiresAt)}`);
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
