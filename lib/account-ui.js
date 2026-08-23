const accountService = require('./account-service');

function subscriptionKeyboard(subscriptions) {
  return subscriptions.map((s) => ([{
    text: s.title,
    callback_data: `account_sub:${s.id}`
  }]));
}

function detailKeyboard(sub) {
  const rows = [];
  if (sub.subUrl) rows.push([
    { text: '🔗 باز کردن لینک', url: sub.subUrl },
    { text: '📋 کپی لینک', callback_data: `copy_sub:${sub.id}` }
  ]);
  if (sub.canRenew) rows.push([{ text: '🔄 تمدید اشتراک', callback_data: `account_renew:${sub.id}` }]);
  rows.push([{ text: '⬅️ بازگشت به اشتراک‌ها', callback_data: 'account_list' }]);
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
  return orders.map(accountService.summary);
}

async function getForUser(telegramUserId, orderId) {
  const order = await accountService.getSubscription(telegramUserId, orderId);
  return order ? accountService.summary(order) : null;
}

module.exports = { subscriptionKeyboard, detailKeyboard, formatDetail, listForUser, getForUser };
