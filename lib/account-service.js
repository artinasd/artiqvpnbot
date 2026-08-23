const storage = require('./storage');

function isPurchase(order) {
  const type = String(order.type || order.orderType || '').toLowerCase();
  return type !== 'test' && type !== 'trial' && order.isTest !== true;
}

function displayName(order) {
  const plan = order.planName || order.name || 'اشتراک';
  const service = order.serviceName || (order.service === 'gaming' ? '🎮 Gaming' : '🛡️ Tunnel');
  const marker = isPurchase(order) ? '📦' : '🧪';
  return `${marker} ${plan} — ${service}`;
}

function status(order) {
  if (order.status === 'rejected' || order.status === 'failed') return '❌ ناموفق';
  if (order.status === 'pending' || order.status === 'awaiting_receipt') return '⏳ در انتظار';
  if (order.expiresAt) {
    const t = new Date(order.expiresAt).getTime();
    if (Number.isFinite(t) && t < Date.now()) return '⌛ منقضی شده';
  }
  return '✅ فعال';
}

async function listSubscriptions(telegramUserId) {
  const orders = await storage.listUserOrders(telegramUserId, 100);
  return orders.filter(o => o && (o.subUrl || o.subscriptionUrl || o.pasarguardUserId || o.status));
}

async function getSubscription(telegramUserId, orderId) {
  const order = await storage.getOrder(orderId);
  if (!order || String(order.telegramUserId) !== String(telegramUserId)) return null;
  return order;
}

function canRenew(order) {
  return isPurchase(order) && Boolean(order.pasarguardUserId || order.subscriptionUserId) && order.status !== 'rejected' && order.status !== 'failed';
}

function summary(order) {
  return {
    id: order.orderId,
    title: displayName(order),
    status: status(order),
    planName: order.planName || order.name || '',
    service: order.serviceName || order.service || '',
    traffic: order.traffic || order.trafficBytes || null,
    duration: order.duration || order.durationDays || null,
    expiresAt: order.expiresAt || order.expireAt || null,
    subUrl: order.subUrl || order.subscriptionUrl || null,
    canRenew: canRenew(order)
  };
}

module.exports = { listSubscriptions, getSubscription, canRenew, summary, displayName, status };
