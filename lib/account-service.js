const storage = require('./storage');
const planStore = require('./plan-store');
const panelRegistry = require('./panel-registry');
const providers = require('./providers');

function isTest(order) { const type = String(order.type || order.orderType || '').toLowerCase(); return type === 'test' || type === 'trial' || order.isTest === true || order.planId === 'test'; }
function isPurchase(order) { return !isTest(order); }
function providerId(order) {
  const explicit = String(order?.fulfillmentProvider || order?.provider || order?.backend || order?.panelProvider || '');
  if (explicit.startsWith('panel:')) return explicit;
  if (order?.panelId) return `panel:${String(order.panelId)}`;
  const service = String(order?.service || '');
  if (service.startsWith('panel_')) return `panel:${service.slice('panel_'.length)}`;
  return '';
}
function providerClient(order) {
  const id = providerId(order);
  if (id) return providers.getProvider(id);
  const error = new Error('LEGACY_ORDER_REQUIRES_PANEL_MAPPING');
  error.code = 'LEGACY_ORDER_REQUIRES_PANEL_MAPPING';
  throw error;
}
function legacyServiceType(order) {
  const provider = String(order?.provider || order?.backend || order?.panelProvider || order?.fulfillmentProvider || '').toLowerCase();
  const service = String(order?.service || order?.serviceName || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  // These explicit legacy provider IDs correspond to the former dedicated panels.
  if (['pasarguard-panel2', 'panel2', 'pasarguard_2'].includes(provider)) return 'gaming';
  if (['pasarguard-direct2', 'pasarguard_4'].includes(provider)) return 'direct2';
  if (['pasarguard-tunnel2', 'pasarguard-direct', 'tunnel2', 'direct', 'pasarguard_3'].includes(provider)) return 'tunnel2';
  if (service.includes('gaming')) return 'gaming';
  if (service === 'direct2' || service.includes('direct 2')) return 'direct2';
  if (service === 'tunnel2' || service === 'direct' || service.includes('tunnel 2')) return 'tunnel2';
  if (service === 'tunnel' || service.includes('tunnel')) return 'tunnel';
  return null;
}
function uniquePanelId(plans) {
  const ids = [...new Set(plans.map((plan) => String(plan.panelId || '')).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

// Historical provider IDs identify the actual panel more reliably than legacy plan IDs:
// custom_* IDs were reused across multiple services before the CMS registry existed.
const LEGACY_PROVIDER_PANEL_IDS = Object.freeze({
  'pasarguard': 'fe761556-9e64-4430-855d-ddfea79ed555',
  'pasarguard-tunnel2': '6d890f87-db21-4b02-ad34-728629587097',
  'pasarguard-direct': '6b0be681-6078-4d78-b651-265b9890fe8d',
  'pasarguard-direct2': '6b0be681-6078-4d78-b651-265b9890fe8d',
  'pasarguard-panel2': '8f05bb35-569d-4212-9d55-318d640a6652',
});

// Specific legacy plans with missing provider metadata, confirmed by the operator.
const LEGACY_PLAN_PANEL_IDS = Object.freeze({
  'custom_99g_30d': '6d890f87-db21-4b02-ad34-728629587097',
});
async function resolveOrderPanel(order, { persist = true } = {}) {
  if (!order) return order;
  const explicitProvider = String(order.fulfillmentProvider || order.provider || order.backend || order.panelProvider || '');
  let panelId = explicitProvider.startsWith('panel:') ? explicitProvider.slice('panel:'.length) : String(order.panelId || '');
  if (!panelId && String(order.service || '').startsWith('panel_')) panelId = String(order.service).slice('panel_'.length);

  const plans = panelId ? [] : await planStore.listAll();
  const serviceType = legacyServiceType(order);
  if (!panelId) {
    const legacyProvider = String(order.fulfillmentProvider || order.provider || order.backend || order.panelProvider || '').trim().toLowerCase();
    const mappedPanelId = LEGACY_PROVIDER_PANEL_IDS[legacyProvider];
    // Only trust an explicit legacy provider mapping when its target still exists in CMS.
    if (mappedPanelId && await panelRegistry.getById(mappedPanelId)) panelId = mappedPanelId;
  }
  if (!panelId && order.planId) {
    const legacyPlanPanelId = LEGACY_PLAN_PANEL_IDS[String(order.planId)];
    if (legacyPlanPanelId && await panelRegistry.getById(legacyPlanPanelId)) panelId = legacyPlanPanelId;
  }
  if (!panelId && order.planId) {
    // Plan IDs are globally unique in the CMS. An exact ID match is stronger
    // evidence than a legacy service label, which may have changed during cutover.
    const matchingId = plans.filter((plan) => String(plan.id) === String(order.planId));
    panelId = uniquePanelId(matchingId);
  }
  if (!panelId) {
    const name = String(order.planName || order.name || '').trim().toLowerCase();
    if (name) {
      // Historical orders sometimes stored the menu/button label rather than the
      // canonical plan name. Prefer a service-compatible match, then allow an exact
      // name/label match only if it identifies one panel unambiguously.
      const matchingName = plans.filter((plan) => plan.panelId && [
        plan.name, plan.buttonText
      ].some((value) => String(value || '').trim().toLowerCase() === name));
      panelId = uniquePanelId(matchingName.filter((plan) => !serviceType || String(plan.service || '').toLowerCase() === serviceType));
      if (!panelId) panelId = uniquePanelId(matchingName);
    }
  }
  if (!panelId && serviceType) {
    panelId = uniquePanelId(plans.filter((plan) => plan.panelId && String(plan.service || '').toLowerCase() === serviceType));
  }
  if (!panelId) return order;

  // A legacy record is mapped only when a current CMS plan provides a unique match,
  // or when the order already contains an explicit CMS panel identifier.
  const knownPanel = await panelRegistry.getById(panelId);
  if (!knownPanel && !order.panelId && !explicitProvider.startsWith('panel:') && !String(order.service || '').startsWith('panel_')) return order;

  const patch = {
    panelId,
    fulfillmentProvider: `panel:${panelId}`,
    service: `panel_${panelId}`,
    legacyService: order.legacyService || (String(order.service || '').startsWith('panel_') ? undefined : order.service),
  };
  const updated = { ...order, ...patch };
  if (persist && order.orderId && (
    String(order.panelId || '') !== panelId ||
    String(order.fulfillmentProvider || '') !== patch.fulfillmentProvider ||
    String(order.service || '') !== patch.service
  )) {
    return storage.updateOrder(order.orderId, patch);
  }
  return updated;
}
function displayName(order) { const plan = order.planName || order.name || 'اشتراک'; const service = order.serviceName || (order.service === 'gaming' ? '🎮 Gaming' : order.service === 'direct2' ? '🎯 Direct 2' : (order.service === 'tunnel2' || order.service === 'direct') ? '🛡️ Tunnel 2' : '🛡️ Tunnel'); const marker = isPurchase(order) ? '📦' : '🧪'; return `${marker} ${plan} — ${service}`; }
function status(order) { if (order.paymentStatus === 'REJECTED' || order.fulfillmentStatus === 'FAILED_RETRYABLE' || order.status === 'rejected' || order.status === 'failed') return '❌ ناموفق'; if (order.paymentStatus === 'AWAITING_PAYMENT' || order.paymentStatus === 'AWAITING_RECEIPT' || order.fulfillmentStatus === 'DRAFT' || order.fulfillmentStatus === 'PROVISIONING' || order.status === 'pending' || order.status === 'awaiting_receipt') return '⏳ در انتظار'; if (order.expiresAt || order.expireAt) { const t = new Date(order.expiresAt || order.expireAt).getTime(); if (Number.isFinite(t) && t < Date.now()) return '⌛ منقضی شده'; } return order.fulfillmentStatus === 'FULFILLED' || order.subUrl || order.subscriptionUrl ? '✅ فعال' : '⏳ در انتظار'; }
async function existsInPasarGuard(order) { if (!order?.pasarguardUserId) return false; try { const mapped = await resolveOrderPanel(order); const user = await providerClient(mapped).getUserById(mapped.pasarguardUserId); return Boolean(user && (user.id != null || user.username != null)); } catch (error) { if (Number(error?.status) === 404 || /_HTTP_404$/.test(String(error?.message || ''))) return false; throw error; } }
async function listSubscriptions(telegramUserId) {
  const orders = await storage.listUserOrders(telegramUserId, 100);
  /* Listing uses stored records rather than live panel health checks. Resolve uniquely
     identifiable legacy orders lazily so subsequent detail, renewal, and removal flows
     use the CMS panel provider. */
  const visible = orders.filter(order => order && order.pasarguardUserId && !order.accountRemovedAt && order.accountRemoved !== true);
  return Promise.all(visible.map(async (order) => {
    try { return await resolveOrderPanel(order); } catch (error) {
      console.error(JSON.stringify({ event: 'LEGACY_ORDER_PANEL_MAPPING_FAILED', order_id: order.orderId, error: error?.message || String(error) }));
      return order;
    }
  }));
}
async function getSubscription(telegramUserId, orderId) {
  let order = await storage.getOrder(orderId);
  if (!order || String(order.telegramUserId) !== String(telegramUserId) || order.accountRemovedAt || order.accountRemoved === true) return null;
  order = await resolveOrderPanel(order);
  if (!(await existsInPasarGuard(order))) return null;
  const plan = order.planId ? await planStore.get(order.planId) : null;
  return plan ? { ...order, price: plan.price } : order;
}
async function removeSubscriptionFromAccount(telegramUserId, orderId) {
  let order = await storage.getOrder(orderId);
  if (!order || String(order.telegramUserId) !== String(telegramUserId)) {
    const error = new Error('SUBSCRIPTION_NOT_FOUND');
    error.code = 'SUBSCRIPTION_NOT_FOUND';
    throw error;
  }
  if (order.accountRemovedAt || order.accountRemoved === true) return { alreadyRemoved: true, order };
  order = await resolveOrderPanel(order);

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
module.exports = { listSubscriptions, getSubscription, removeSubscriptionFromAccount, canRenew, summary, displayName, status, isTest, isPurchase, existsInPasarGuard, providerId, legacyServiceType, resolveOrderPanel };
