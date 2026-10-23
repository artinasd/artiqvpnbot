const storage = require('./storage');
const pasarguard = require('./pasarguard');
const pasarguardPanel2 = require('./pasarguard-panel2');
const pasarguardTunnel2 = require('./pasarguard-tunnel2');
const pasarguardDirect2 = require('./pasarguard-direct2');
const planStore = require('./plan-store');
const { getProvider } = require('./providers');

function isTest(order) { const type = String(order.type || order.orderType || '').toLowerCase(); return type === 'test' || type === 'trial' || order.isTest === true || order.planId === 'test'; }
function isPurchase(order) { return !isTest(order); }
function providerId(order) { const provider = String(order.provider || order.backend || order.panelProvider || order.fulfillmentProvider || '').toLowerCase(); const service = String(order.service || order.serviceName || '').toLowerCase(); if (provider === 'pasarguard-panel2' || provider === 'panel2' || provider === 'pasarguard_2' || service === 'gaming' || service.includes('gaming')) return 'pasarguard-panel2'; if (provider === 'pasarguard-direct2' || provider === 'direct2' || provider === 'pasarguard_4' || service === 'direct2' || service.includes('direct 2') || service.includes('direct2')) return 'pasarguard-direct2'; if (provider === 'pasarguard-tunnel2' || provider === 'pasarguard-direct' || provider === 'tunnel2' || provider === 'direct' || provider === 'pasarguard_3' || service === 'tunnel2' || service === 'direct' || service.includes('tunnel 2')) return 'pasarguard-tunnel2'; return 'pasarguard'; }
function providerClient(order) { const dynamicProvider = String(order?.fulfillmentProvider || order?.provider || order?.backend || ''); if (dynamicProvider.startsWith('panel:')) return getProvider(dynamicProvider); const id = providerId(order); if (id === 'pasarguard-panel2') return pasarguardPanel2; if (id === 'pasarguard-direct2') return pasarguardDirect2; if (id === 'pasarguard-tunnel2') return pasarguardTunnel2; return pasarguard; }
function displayName(order) { const plan = order.planName || order.name || 'اشتراک'; const service = order.serviceName || (order.service === 'gaming' ? '🎮 Gaming' : order.service === 'direct2' ? '🎯 Direct 2' : (order.service === 'tunnel2' || order.service === 'direct') ? '🛡️ Tunnel 2' : '🛡️ Tunnel'); const marker = isPurchase(order) ? '📦' : '🧪'; return `${marker} ${plan} — ${service}`; }
function status(order) { if (order.paymentStatus === 'REJECTED' || order.fulfillmentStatus === 'FAILED_RETRYABLE' || order.status === 'rejected' || order.status === 'failed') return '❌ ناموفق'; if (order.paymentStatus === 'AWAITING_PAYMENT' || order.paymentStatus === 'AWAITING_RECEIPT' || order.fulfillmentStatus === 'DRAFT' || order.fulfillmentStatus === 'PROVISIONING' || order.status === 'pending' || order.status === 'awaiting_receipt') return '⏳ در انتظار'; if (order.expiresAt || order.expireAt) { const t = new Date(order.expiresAt || order.expireAt).getTime(); if (Number.isFinite(t) && t < Date.now()) return '⌛ منقضی شده'; } return order.fulfillmentStatus === 'FULFILLED' || order.subUrl || order.subscriptionUrl ? '✅ فعال' : '⏳ در انتظار'; }
async function existsInPasarGuard(order) { if (!order?.pasarguardUserId) return false; try { const user = await providerClient(order).getUserById(order.pasarguardUserId); return Boolean(user && (user.id != null || user.username != null)); } catch (error) { if (Number(error?.status) === 404 || /_HTTP_404$/.test(String(error?.message || ''))) return false; throw error; } }
async function listSubscriptions(telegramUserId) { const orders = await storage.listUserOrders(telegramUserId, 100); /* The account menu is a listing, not a live health check. Use persisted order records here so a slow or unavailable PasarGuard panel cannot block the menu. Live existence checks remain in getSubscription() before showing subscription details or allowing renewal. */ return orders.filter(order => order && order.pasarguardUserId && !order.accountRemovedAt && order.accountRemoved !== true); }
async function getSubscription(telegramUserId, orderId) { const order = await storage.getOrder(orderId); if (!order || String(order.telegramUserId) !== String(telegramUserId) || order.accountRemovedAt || order.accountRemoved === true) return null; if (!(await existsInPasarGuard(order))) return null; const plan = order.planId ? await planStore.get(order.planId) : null; return plan ? { ...order, price: plan.price } : order; }
async function removeSubscriptionFromAccount(telegramUserId, orderId) {
  const order = await storage.getOrder(orderId);
  if (!order || String(order.telegramUserId) !== String(telegramUserId)) {
    const error = new Error('SUBSCRIPTION_NOT_FOUND');
    error.code = 'SUBSCRIPTION_NOT_FOUND';
    throw error;
  }
  if (order.accountRemovedAt || order.accountRemoved === true) return { alreadyRemoved: true, order };

  const client = providerClient(order);
  const username = order.generatedPasarguardUsername || order.username || order.pasarguardUsername || order.subscriptionUsername;
  let userId = order.pasarguardUserId;

  if (userId) {
    try {
      await client.getUserById(userId);
    } catch (error) {
      if (!(Number(error?.status) === 404 || /HTTP_404$/.test(String(error?.message || '')))) throw error;
      userId = null;
    }
  }
  if (!userId) {
    if (!username) {
      const error = new Error('ACCOUNT_REMOVAL_NO_PANEL_IDENTIFIER');
      error.code = 'ACCOUNT_REMOVAL_NO_PANEL_IDENTIFIER';
      throw error;
    }
    const user = await client.findUserByUsername(username);
    userId = user?.id ?? user?.user_id ?? null;
    if (!userId) {
      const updated = await storage.updateOrder(orderId, {
        accountRemoved: true,
        accountRemovedAt: new Date().toISOString(),
        accountRemovalPanelStatus: 'ALREADY_ABSENT'
      });
      return { alreadyAbsent: true, order: updated };
    }
  }

  try {
    await client.deleteUserById(userId);
  } catch (error) {
    if (!(Number(error?.status) === 404 || /HTTP_404$/.test(String(error?.message || '')))) throw error;
  }
  const updated = await storage.updateOrder(orderId, {
    accountRemoved: true,
    accountRemovedAt: new Date().toISOString(),
    accountRemovalPanelStatus: 'REMOVED'
  });
  return { alreadyAbsent: false, order: updated };
}
function canRenew(order) { return isPurchase(order) && order.renewal !== true && Boolean(order.pasarguardUserId) && order.fulfillmentStatus === 'FULFILLED' && order.paymentStatus !== 'REJECTED'; }
function summary(order) { return { id: order.orderId, title: displayName(order), status: status(order), planName: order.planName || order.name || '', service: order.serviceName || order.service || '', traffic: order.traffic || order.trafficLimitBytes || order.trafficBytes || null, duration: order.duration || order.durationDays || null, expiresAt: order.expiresAt || order.expireAt || null, subUrl: order.subUrl || order.subscriptionUrl || null, canRenew: canRenew(order) }; }
module.exports = { listSubscriptions, getSubscription, removeSubscriptionFromAccount, canRenew, summary, displayName, status, isTest, isPurchase, existsInPasarGuard, providerId };