const { isAuthorizedAdmin, sendJson } = require('../lib/cms-auth');
const storage = require('../lib/storage');
const panelRegistry = require('../lib/panel-registry');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

module.exports = async function handler(req, res) {
  if (!isAuthorizedAdmin(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  }


  try {
    const [orders, plans, panels] = await Promise.all([
      storage.listAllOrders(),
      storage.get('cms:plans'),
      panelRegistry.list(),
    ]);
    const currentPlanRecords = Array.isArray(plans) ? plans : [];
    const currentIds = new Set(currentPlanRecords.map((plan) => String(plan.id)));
    const panelNames = new Map(panels.map((panel) => [String(panel.id), String(panel.name || panel.id)]));
    const groups = new Map();

    for (const order of orders) {
      const oldPlanId = clean(order.planId) || '(missing planId)';
      const oldPlanName = clean(order.planName || order.name) || '(missing plan name)';
      const key = JSON.stringify([oldPlanId, oldPlanName]);
      if (!groups.has(key)) {
        groups.set(key, {
          oldPlanId,
          oldPlanName,
          orderCount: 0,
          subscriptionCount: 0,
          serviceValues: new Set(),
          providerValues: new Set(),
          currentPlanIdExists: oldPlanId !== '(missing planId)' && currentIds.has(oldPlanId),
        });
      }
      const group = groups.get(key);
      group.orderCount += 1;
      if (order.pasarguardUserId && !order.accountRemovedAt && order.accountRemoved !== true) group.subscriptionCount += 1;
      const service = clean(order.service || order.serviceName);
      const provider = clean(order.fulfillmentProvider || order.provider || order.backend || order.panelProvider);
      if (service) group.serviceValues.add(service);
      if (provider) group.providerValues.add(provider);
    }

    const legacyPlans = [...groups.values()]
      .filter((group) => !group.currentPlanIdExists)
      .map((group) => ({
        oldPlanId: group.oldPlanId,
        oldPlanName: group.oldPlanName,
        orderCount: group.orderCount,
        subscriptionCount: group.subscriptionCount,
        serviceValues: [...group.serviceValues].sort(),
        providerValues: [...group.providerValues].sort(),
      }))
      .sort((a, b) => a.oldPlanId.localeCompare(b.oldPlanId) || a.oldPlanName.localeCompare(b.oldPlanName));

    const currentPlans = currentPlanRecords.map((plan) => ({
      id: String(plan.id),
      name: String(plan.name || ''),
      buttonText: String(plan.buttonText || ''),
      service: String(plan.service || ''),
      panelId: plan.panelId ? String(plan.panelId) : null,
      panelName: plan.panelId ? (panelNames.get(String(plan.panelId)) || String(plan.panelId)) : null,
      active: plan.active !== false,
    }));

    return sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      totals: {
        ordersScanned: orders.length,
        legacyPlanGroups: legacyPlans.length,
        legacyOrders: legacyPlans.reduce((sum, group) => sum + group.orderCount, 0),
      },
      legacyPlans,
      currentPlans,
      note: 'Read-only report. No orders or subscriptions were changed.',
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'LEGACY_PLAN_REPORT_FAILED', error: error?.message || String(error) }));
    return sendJson(res, 500, { error: 'REPORT_FAILED' });
  }
};
