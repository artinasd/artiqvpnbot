function getConfiguredServices(config = {}) {
  const registryConfig = config.services || {};
  return [];
}
function getConfiguredService(id, config = {}) { return getConfiguredServices(config).find((service) => service.id === String(id)) || null; }
function isServiceEnabled(id, config = {}) { return Boolean(getConfiguredService(id, config)); }
function isServiceTestEnabled(id, config = {}) { const service = getConfiguredService(id, config); return Boolean(service && service.testEnabled !== false); }
function isServicePurchaseEnabled(id, config = {}) { const service = getConfiguredService(id, config); return Boolean(service && service.purchaseEnabled !== false); }
function serviceLabel(service) { if (!service) return ''; return `${service.emoji || ''} ${service.name || service.id}`.trim(); }
function serviceButtons(prefix, config, mode) { return []; }

async function getConfiguredServicesWithPanels(config = {}, { listPanels } = {}) {
  const registry = require('./panel-registry');
  const panels = await (listPanels ? listPanels() : registry.list());
  const settings = config.services || {};
  const dynamic = panels.filter((panel) => panel.status === 'active').map((panel, index) => {
    const saved = settings[`panel_${panel.id}`];
    const hasSavedObject = saved && typeof saved === 'object';
    return {
      id: `panel_${panel.id}`, panelId: panel.id, name: panel.name,
      label: panel.name, emoji: hasSavedObject && saved.emoji ? saved.emoji : '🧩',
      description: hasSavedObject && saved.description ? saved.description : 'پنل مستقل',
      order: Number(hasSavedObject ? (saved.order ?? (100 + index)) : (100 + index)),
      provider: `panel:${panel.id}`, enabled: hasSavedObject ? saved.enabled !== false : true,
      testEnabled: hasSavedObject && saved.testEnabled !== undefined ? saved.testEnabled !== false : true,
      purchaseEnabled: hasSavedObject && saved.purchaseEnabled !== undefined ? saved.purchaseEnabled !== false : true,
    };
  });
  return dynamic.filter((service) => service.enabled !== false).sort((a, b) => a.order - b.order);
}
async function getConfiguredServiceWithPanels(id, config = {}, options = {}) {
  return (await getConfiguredServicesWithPanels(config, options)).find((service) => service.id === String(id)) || null;
}
async function serviceButtonsWithPanels(prefix, config, mode, options = {}) {
  const effectiveMode = mode || (String(prefix).startsWith('service_test_') ? 'test' : String(prefix).startsWith('service_buy_') || String(prefix).startsWith('service_renew_') ? 'purchase' : undefined);
  return (await getConfiguredServicesWithPanels(config, options))
    .filter((service) => effectiveMode !== 'test' || service.testEnabled !== false)
    .filter((service) => effectiveMode !== 'purchase' || service.purchaseEnabled !== false)
    .map((service) => [{ text: service.name, callback_data: `${prefix}${service.id}` }]);
}
module.exports = { SERVICES: [], getService: () => null, getConfiguredServices, getConfiguredService, getConfiguredServicesWithPanels, getConfiguredServiceWithPanels, isServiceEnabled, isServiceTestEnabled, isServicePurchaseEnabled, serviceLabel, serviceButtons, serviceButtonsWithPanels };
