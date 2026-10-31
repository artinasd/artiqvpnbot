const storage = require('./storage');
const { isReportablePaidDelivery } = require('./purchase-report-contract');
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function createPurchaseReportEvent(order, options = {}) {
  if (!isReportablePaidDelivery(order)) return null;
  const adminTelegramId = String(options.adminTelegramId || '').trim();
  if (!/^\d+$/.test(adminTelegramId)) throw new Error('PURCHASE_REPORT_ADMIN_ID_REQUIRED');
  const resellerTelegramId = String(options.resellerTelegramId || '').trim();
  const recipients = { admin: { chatId: adminTelegramId, status: 'PENDING', attempts: 0 } };
  if (/^\d+$/.test(resellerTelegramId) && resellerTelegramId !== adminTelegramId) recipients.reseller = { chatId: resellerTelegramId, status: 'PENDING', attempts: 0 };
  return {
    eventId: `purchase:${String(order.orderId)}:v1`, orderId: String(order.orderId),
    createdAt: new Date(options.now || Date.now()).toISOString(),
    deliveredAt: order.deliveredAt || order.updatedAt || null, orderCreatedAt: order.createdAt || null,
    customer: { telegramId: String(order.telegramUserId || ''), username: order.telegramUsername || null, firstName: order.firstName || null, lastName: order.lastName || null },
    product: { planName: order.planName || order.planId || 'اشتراک', serviceName: order.serviceName || order.service || 'نامشخص', panelId: order.panelId || order.masterPanelId || null, renewal: order.renewal === true },
    payment: { amount: Number(order.walletChargedAmount ?? order.price), currency: order.currency || 'تومان', method: 'کیف پول' },
    resellerTelegramId: /^\d+$/.test(resellerTelegramId) ? resellerTelegramId : null, recipients,
  };
}
function formatPurchaseReport(event) {
  const amount = Number(event.payment?.amount || 0);
  const customerName = [event.customer?.firstName, event.customer?.lastName].filter(Boolean).join(' ') || 'بدون نام';
  const username = event.customer?.username ? `@${escapeHtml(event.customer.username)}` : 'ندارد';
  return [
    event.product?.renewal ? '🔄 <b>تمدید موفق اشتراک</b>' : '🛒 <b>خرید موفق اشتراک</b>', '',
    `🧾 سفارش: <code>${escapeHtml(event.orderId)}</code>`,
    `👤 مشتری: ${escapeHtml(customerName)}`, `🔗 نام کاربری: ${username}`,
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
function retryDelayMs(attempts) {
  const schedule = [60000, 300000, 900000, 3600000, 21600000];
  return schedule[Math.min(Math.max(0, attempts - 1), schedule.length - 1)];
}
async function processPendingPurchaseReports(telegram, options = {}) {
  if (!telegram || typeof telegram.sendMessage !== 'function') throw new Error('TELEGRAM_CLIENT_REQUIRED');
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const events = await storage.listPendingPurchaseReportEvents(limit, now);
  const result = { events: events.length, sent: 0, failed: 0, skipped: 0, locked: 0 };
  for (const candidate of events) {
    const lockName = `purchase-report-event:${candidate.eventId}`;
    if (!(await storage.acquireLock(lockName, 55))) { result.locked++; continue; }
    try {
      let event = await storage.getPurchaseReportEvent(candidate.eventId);
      if (!event) continue;
      for (const [recipientKey, recipient] of Object.entries(event.recipients || {})) {
        if (!recipient || recipient.status !== 'PENDING') continue;
        const due = recipient.nextAttemptAt ? new Date(recipient.nextAttemptAt).getTime() : 0;
        if (Number.isFinite(due) && due > now) { result.skipped++; continue; }
        const attempts = Number(recipient.attempts || 0) + 1;
        try {
          await telegram.sendMessage(recipient.chatId, formatPurchaseReport(event), { parse_mode: 'HTML' });
          event = await storage.updatePurchaseReportEvent(event.eventId, { recipients: { ...event.recipients, [recipientKey]: { ...recipient, status: 'SENT', attempts, sentAt: new Date(now).toISOString(), lastError: null, nextAttemptAt: null } } });
          result.sent++;
        } catch (error) {
          const finalFailure = attempts >= 8;
          const updated = { ...recipient, status: finalFailure ? 'FAILED_FINAL' : 'PENDING', attempts, lastError: String(error?.description || error?.message || error).slice(0, 300), nextAttemptAt: finalFailure ? null : new Date(now + retryDelayMs(attempts)).toISOString(), lastAttemptAt: new Date(now).toISOString() };
          event = await storage.updatePurchaseReportEvent(event.eventId, { recipients: { ...event.recipients, [recipientKey]: updated } });
          result.failed++;
        }
      }
    } finally { await storage.releaseLock(lockName); }
  }
  return result;
}
async function requeueFailedPurchaseReports(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const ids = (await storage.smembers('purchase-report:pending')).slice(0, safeLimit);
  let requeued = 0;
  for (const id of ids) {
    const event = await storage.getPurchaseReportEvent(id);
    if (!event) continue;
    const recipients = { ...(event.recipients || {}) };
    let changed = false;
    for (const [key, recipient] of Object.entries(recipients)) {
      if (recipient?.status !== 'FAILED_FINAL') continue;
      recipients[key] = { ...recipient, status: 'PENDING', attempts: 0, nextAttemptAt: null };
      changed = true;
    }
    if (changed) {
      await storage.updatePurchaseReportEvent(id, { recipients });
      requeued++;
    }
  }
  return requeued;
}

module.exports = { createPurchaseReportEvent, formatPurchaseReport, enqueuePurchaseReport, processPendingPurchaseReports, requeueFailedPurchaseReports, retryDelayMs, escapeHtml };
