const storage = require('./storage');
const wallet = require('./wallet');

const ADMIN_ID = String(process.env.ADMIN_ID || '');
function dateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function money(value) { return Number(value || 0).toLocaleString('en-US') + ' تومان'; }
function safe(value) { return String(value ?? '-').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function change(current, previous) {
  if (!previous) return current ? 'بدون سابقه روز قبل' : '۰٪';
  const pct = ((current - previous) / previous) * 100;
  return (pct > 0 ? '+' : '') + pct.toFixed(1) + '٪';
}
function customerName(order) {
  const name = [order.firstName, order.lastName].filter(Boolean).join(' ').trim();
  return name || (order.telegramUsername ? '@' + order.telegramUsername : String(order.telegramUserId));
}
async function reportStats(orders, ownerId = null) {
  const paid = orders.filter(o => o && o.orderType !== 'wallet_topup' && o.fulfillmentStatus === 'FULFILLED' && o.paymentStatus === 'WALLET_PAID');
  const today = dateKey(new Date());
  const yesterdayDate = new Date(Date.now() - 86400000);
  const yesterday = dateKey(yesterdayDate);
  const todayOrders = paid.filter(o => dateKey(new Date(o.fulfilledAt || o.updatedAt || o.createdAt)) === today);
  const yesterdayOrders = paid.filter(o => dateKey(new Date(o.fulfilledAt || o.updatedAt || o.createdAt)) === yesterday);
  const revenue = list => list.reduce((sum, o) => sum + Number(o.price || 0), 0);
  let balance = 0;
  if (ownerId !== null) balance = await wallet.getBalance(ownerId);
  else {
    const users = await storage.listBotUsers(Number.MAX_SAFE_INTEGER);
    const balances = await Promise.all(users.map(u => wallet.getBalance(u.telegramUserId)));
    balance = balances.reduce((sum, n) => sum + Number(n || 0), 0);
  }
  return { total: paid.length, today: todayOrders.length, todayRevenue: revenue(todayOrders), yesterday: yesterdayOrders.length, yesterdayRevenue: revenue(yesterdayOrders), totalRevenue: revenue(paid), balance };
}
function reportText(scope, stats, order, ownerId = null) {
  const title = scope === 'admin' ? '📊 گزارش فروش کل ربات' : '📊 گزارش فروش اختصاصی شما';
  return [
    title, '',
    '🛒 سفارش جدید: ' + safe(order.planName || 'اشتراک'),
    '👤 مشتری: ' + safe(customerName(order)),
    '🆔 شناسه مشتری: ' + safe(order.telegramUserId),
    '💳 مبلغ سفارش: ' + money(order.price),
    order.renewal ? '🔁 نوع سفارش: تمدید' : '🆕 نوع سفارش: خرید',
    '',
    '📈 آمار امروز (به وقت تهران)',
    'تعداد خرید امروز: ' + stats.today.toLocaleString('fa-IR'),
    'فروش امروز: ' + money(stats.todayRevenue),
    'تغییر فروش نسبت به دیروز: ' + change(stats.todayRevenue, stats.yesterdayRevenue),
    'تعداد سفارش دیروز: ' + stats.yesterday.toLocaleString('fa-IR'),
    '',
    '📚 آمار کل',
    'مجموع سفارش‌های موفق: ' + stats.total.toLocaleString('fa-IR'),
    'مجموع فروش: ' + money(stats.totalRevenue),
    'موجودی کیف پول ' + (scope === 'admin' ? 'همه کاربران' : 'شما') + ': ' + money(stats.balance),
  ].join('\n');
}
async function notifySuccessfulPurchase(telegram, orderId) {
  const lock = 'purchase-report:' + orderId;
  if (!(await storage.acquireLock(lock, 45))) return;
  try {
    if (await storage.get('purchase-report-sent:' + orderId)) return;
    const order = await storage.getOrder(orderId);
    if (!order || order.fulfillmentStatus !== 'FULFILLED' || order.paymentStatus !== 'WALLET_PAID' || order.orderType === 'wallet_topup') return;
    const allOrders = await storage.listAllOrders();
    const adminStats = await reportStats(allOrders);
    if (ADMIN_ID) await telegram.sendMessage(ADMIN_ID, reportText('admin', adminStats, order), { parse_mode: 'HTML' }).catch(error => console.error(JSON.stringify({ event: 'ADMIN_PURCHASE_REPORT_SEND_FAILED', order_id: orderId, error: error?.message || String(error) })));
    const customer = await storage.getUserRaw(order.telegramUserId);
    const resellerId = customer?.resellerTelegramId ? String(customer.resellerTelegramId) : '';
    if (resellerId && resellerId !== ADMIN_ID) {
      const users = await storage.listBotUsers(Number.MAX_SAFE_INTEGER);
      const ownerByCustomer = new Map(users.map(user => [String(user.telegramUserId), String(user.resellerTelegramId || '')]));
      const scopedOrders = allOrders.filter(candidate => ownerByCustomer.get(String(candidate.telegramUserId)) === resellerId);
      const stats = await reportStats(scopedOrders, resellerId);
      await telegram.sendMessage(resellerId, reportText('reseller', stats, order, resellerId), { parse_mode: 'HTML' }).catch(error => console.error(JSON.stringify({ event: 'RESELLER_PURCHASE_REPORT_SEND_FAILED', order_id: orderId, reseller_id: resellerId, error: error?.message || String(error) })));
    }
    await storage.set('purchase-report-sent:' + orderId, { sentAt: new Date().toISOString() });
  } finally {
    await storage.releaseLock(lock);
  }
}
module.exports = { notifySuccessfulPurchase };
