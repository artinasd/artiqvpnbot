const { escapeHtml } = require('./html');
const storage = require('./storage');
const { isReportablePaidDelivery } = require('./purchase-report-contract');
function isResellerCustomer(customer, config, telegramId) {
  const id = String(telegramId ?? customer?.telegramUserId ?? '').trim();
  const configuredResellers = Array.isArray(config?.resellerTelegramIds)
    ? config.resellerTelegramIds.map((value) => String(value).trim())
    : [];
  return customer?.isReseller === true || customer?.reseller === true || (Boolean(id) && configuredResellers.includes(id));
}


function tehranDateKey(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function computeResellerStats(orders, walletBalance, now = Date.now()) {
  const todayKey = tehranDateKey(now);
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayKey = tehranDateKey(yesterday);
  const paidOrders = (Array.isArray(orders) ? orders : []).filter(isReportablePaidDelivery);
  const inDay = (order, key) => tehranDateKey(order.deliveredAt || order.updatedAt || order.createdAt || now) === key;
  const today = paidOrders.filter((order) => inDay(order, todayKey));
  const yesterdayOrders = paidOrders.filter((order) => inDay(order, yesterdayKey));
  return {
    todayCount: today.length,
    todayRevenue: today.reduce((sum, order) => sum + Number(order.walletChargedAmount ?? order.price ?? 0), 0),
    yesterdayRevenue: yesterdayOrders.reduce((sum, order) => sum + Number(order.walletChargedAmount ?? order.price ?? 0), 0),
    walletBalance: Math.max(0, Number(walletBalance) || 0),
  };
}
function persianDigits(value) { return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]); }
function formatMoney(value) { return persianDigits(Math.round(Number(value) || 0).toLocaleString('en-US')); }
function formatPurchaseDate(value) {
  if (!value) return 'نامشخص';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'نامشخص';
  return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatTraffic(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return 'نامشخص';
  const gb = value / (1024 ** 3);
  const amount = Number.isInteger(gb) ? gb : Number(gb.toFixed(1));
  return `${persianDigits(amount)} گیگابایت`;
}
function formatPurchaseReport(event) {
  const amount = Number(event.payment?.amount || 0);
  const customerName = [event.customer?.firstName, event.customer?.lastName].filter(Boolean).join(' ') || 'بدون نام';
  const username = event.customer?.username ? `@${escapeHtml(event.customer.username)}` : 'ندارد';
  const duration = Number(event.product?.durationDays);
  const durationText = Number.isFinite(duration) && duration > 0 ? `${persianDigits(duration)} روزه` : 'نامشخص';
  const stats = event.resellerStats || {};
  const yesterdayRevenue = Number(stats.yesterdayRevenue || 0);
  const todayRevenue = Number(stats.todayRevenue || 0);
  let change = '—';
  if (yesterdayRevenue > 0) {
    const percent = Math.round(((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100);
    change = percent > 0 ? `📈 رشد ${persianDigits(percent)}٪` : percent < 0 ? `📉 ${persianDigits(Math.abs(percent))}٪ کاهش` : '➡️ بدون تغییر';
  } else if (todayRevenue > 0) change = '✨ شروع فروش';

  const divider = '<code>━━━━━━━━━━━━━━━━━━━━</code>';
  const transactionDetails = [
    `👤 <b>مشتری:</b> ${escapeHtml(customerName)}`,
    `🔗 <b>نام کاربری:</b> ${username}`,
    `🆔 <b>شناسه تلگرام:</b> <code>${escapeHtml(event.customer?.telegramId || '')}</code>`,
    `📦 <b>محصول:</b> ${escapeHtml(event.product?.planName || 'اشتراک')}`,
    `🖥 <b>سرویس:</b> ${escapeHtml(event.product?.serviceName || 'نامشخص')}`,
    `📊 <b>حجم:</b> ${escapeHtml(formatTraffic(event.product?.trafficLimitBytes))}`,
    `⏳ <b>مدت اعتبار:</b> ${escapeHtml(durationText)}`,
    `💳 <b>مبلغ پرداختی:</b> <b>${formatMoney(amount)} ${escapeHtml(event.payment?.currency || 'تومان')}</b>`,
    `💰 <b>روش پرداخت:</b> ${escapeHtml(event.payment?.method || 'کیف پول')}`,
    `🔖 <b>شناسه سفارش:</b> <code>${escapeHtml(event.orderId)}</code>`,
    `🕒 <b>زمان خرید:</b> ${escapeHtml(formatPurchaseDate(event.orderCreatedAt || event.deliveredAt))}`,
  ].join('\n');

  const statsSection = event.resellerStats ? [
    '',
    divider,
    '<b>📈 عملکرد فروش امروز</b>',
    '<i>آمار اختصاصی حساب همکار فروش</i>',
    '',
    '<blockquote>',
    `🛍 <b>خریدهای موفق امروز:</b> ${persianDigits(stats.todayCount || 0)}`,
    `💰 <b>فروش امروز:</b> ${formatMoney(todayRevenue)} تومان`,
    `👛 <b>موجودی کیف پول:</b> ${formatMoney(stats.walletBalance)} تومان`,
    `📊 <b>تغییر نسبت به دیروز:</b> ${change}`,
    '</blockquote>',
    yesterdayRevenue > 0
      ? `<i>مبنای مقایسه: فروش روز گذشته (${formatMoney(yesterdayRevenue)} تومان)</i>`
      : '<i>برای مقایسه روزانه، فروش روز قبل هنوز ثبت نشده است.</i>',
  ] : [];

  return [
    '<b>✨ گزارش اختصاصی فروش</b>',
    '<i>پنل حرفه‌ای همکاران فروش</i>',
    divider,
    '',
    event.product?.renewal ? '🔄 <b>تمدید موفق اشتراک</b>' : '🎉 <b>خرید موفق اشتراک</b>',
    '',
    divider,
    '<b>🧾 جزئیات تراکنش</b>',
    '<blockquote>',
    transactionDetails,
    '</blockquote>',
    ...statsSection,
    '',
    divider,
    '<i>این گزارش به‌صورت خودکار پس از ثبت خرید موفق به‌روزرسانی می‌شود.</i>',
  ].join('\n');
}
function createPurchaseReportEvent(order, options = {}) {
  if (!isReportablePaidDelivery(order)) return null;
  const adminTelegramId = String(options.adminTelegramId || '').trim();
  if (!/^\d+$/.test(adminTelegramId)) throw new Error('PURCHASE_REPORT_ADMIN_ID_REQUIRED');
  const resellerValue = Object.prototype.hasOwnProperty.call(options, 'resellerTelegramId') ? options.resellerTelegramId : order.resellerTelegramId;
  const resellerTelegramId = String(resellerValue ?? '').trim();
  const recipients = { admin: { chatId: adminTelegramId, status: 'PENDING', attempts: 0 } };
  if (/^\d+$/.test(resellerTelegramId) && resellerTelegramId !== adminTelegramId) recipients.reseller = { chatId: resellerTelegramId, status: 'PENDING', attempts: 0 };
  return {
    eventId: `purchase:${String(order.orderId)}:v1`, orderId: String(order.orderId),
    createdAt: new Date(options.now || Date.now()).toISOString(),
    deliveredAt: order.deliveredAt || order.updatedAt || null, orderCreatedAt: order.createdAt || null,
    customer: { telegramId: String(order.telegramUserId || ''), username: order.telegramUsername || null, firstName: order.firstName || null, lastName: order.lastName || null },
    product: { planName: order.planName || order.planId || 'اشتراک', serviceName: order.serviceName || order.service || 'نامشخص', panelId: order.panelId || order.masterPanelId || null, renewal: order.renewal === true, trafficLimitBytes: Number(order.trafficLimitBytes || 0), durationDays: Number(order.durationDays || 0) },
    payment: { amount: Number(order.walletChargedAmount ?? order.price), currency: order.currency || 'تومان', method: 'کیف پول' },
    resellerTelegramId: /^\d+$/.test(resellerTelegramId) ? resellerTelegramId : null, resellerStats: options.resellerStats || null, recipients,
  };
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
    const lockToken = await storage.acquireLock(lockName, 55);
    if (!lockToken) { result.locked++; continue; }
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
    } finally { await storage.releaseLock(lockName, lockToken); }
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

module.exports = { isResellerCustomer, computeResellerStats, createPurchaseReportEvent, formatPurchaseReport, enqueuePurchaseReport, processPendingPurchaseReports, requeueFailedPurchaseReports, retryDelayMs, escapeHtml };
