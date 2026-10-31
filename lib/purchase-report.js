const storage = require('./storage');
const { isReportablePaidDelivery } = require('./purchase-report-contract');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  })[character]);
}

function createPurchaseReportEvent(order, options = {}) {
  if (!isReportablePaidDelivery(order)) return null;
  const adminTelegramId = String(options.adminTelegramId || '').trim();
  if (!/^\d+$/.test(adminTelegramId)) throw new Error('PURCHASE_REPORT_ADMIN_ID_REQUIRED');

  const resellerTelegramId = String(options.resellerTelegramId || '').trim();
  const recipients = {
    admin: { chatId: adminTelegramId, status: 'PENDING', attempts: 0 },
  };
  if (/^\d+$/.test(resellerTelegramId) && resellerTelegramId !== adminTelegramId) {
    recipients.reseller = { chatId: resellerTelegramId, status: 'PENDING', attempts: 0 };
  }

  return {
    eventId: `purchase:${String(order.orderId)}:v1`,
    orderId: String(order.orderId),
    createdAt: new Date(options.now || Date.now()).toISOString(),
    deliveredAt: order.deliveredAt || order.updatedAt || null,
    orderCreatedAt: order.createdAt || null,
    customer: {
      telegramId: String(order.telegramUserId || ''),
      username: order.telegramUsername || null,
      firstName: order.firstName || null,
      lastName: order.lastName || null,
    },
    product: {
      planName: order.planName || order.planId || 'اشتراک',
      serviceName: order.serviceName || order.service || 'نامشخص',
      panelId: order.panelId || order.masterPanelId || null,
      renewal: order.renewal === true,
    },
    payment: {
      amount: Number(order.walletChargedAmount ?? order.price),
      currency: order.currency || 'تومان',
      method: 'کیف پول',
    },
    resellerTelegramId: /^\d+$/.test(resellerTelegramId) ? resellerTelegramId : null,
    recipients,
  };
}

function formatPurchaseReport(event) {
  const amount = Number(event.payment?.amount || 0);
  const customerName = [event.customer?.firstName, event.customer?.lastName].filter(Boolean).join(' ') || 'بدون نام';
  const username = event.customer?.username ? `@${escapeHtml(event.customer.username)}` : 'ندارد';
  return [
    event.product?.renewal ? '🔄 <b>تمدید موفق اشتراک</b>' : '🛒 <b>خرید موفق اشتراک</b>',
    '',
    `🧾 سفارش: <code>${escapeHtml(event.orderId)}</code>`,
    `👤 مشتری: ${escapeHtml(customerName)}`,
    `🔗 نام کاربری: ${username}`,
    `🆔 آیدی تلگرام: <code>${escapeHtml(event.customer?.telegramId || '')}</code>`,
    `📦 پلن: ${escapeHtml(event.product?.planName || 'نامشخص')}`,
    `🖥 سرویس: ${escapeHtml(event.product?.serviceName || 'نامشخص')}`,
    `💰 مبلغ: ${amount.toLocaleString('en-US')} ${escapeHtml(event.payment?.currency || 'تومان')}`,
    `💳 روش پرداخت: ${escapeHtml(event.payment?.method || 'کیف پول')}`,
    `🧑‍💼 ریسلر: ${escapeHtml(event.resellerTelegramId || 'ندارد')}`,
  ].join('\n');
}

async function enqueuePurchaseReport(order, options = {}) {
  const event = createPurchaseReportEvent(order, options);
  if (!event) return { queued: false, reason: 'ORDER_NOT_REPORTABLE' };
  const created = await storage.createPurchaseReportEvent(event);
  return { queued: created, duplicate: !created, eventId: event.eventId };
}

module.exports = { createPurchaseReportEvent, formatPurchaseReport, enqueuePurchaseReport, escapeHtml };
