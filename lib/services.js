function getConfiguredServices(config = {}) {
  const registryConfig = config.services || {};
  return [];
}
function getConfiguredService(id, config = {}) { return getConfiguredServices(config).find((service) => service.id === String(id)) || null; }
function isServiceEnabled(id, config = {}) { return Boolean(getConfiguredService(id, config)); }
function isServiceTestEnabled(id, config = {}) { const service = getConfiguredService(id, config); return Boolean(service && service.testEnabled !== false); }
function isServicePurchaseEnabled(id, config = {}) { const service = getConfiguredService(id, config); return Boolean(service && service.purchaseEnabled !== false); }
function serviceName(service) { if (!service) return ''; return String(service.name || service.id || ''); }
function serviceLabel(service) { if (!service) return ''; return `${service.emoji || ''} ${serviceName(service)}`.trim(); }
function serviceButtons(prefix, config, mode) { return []; }

async function getConfiguredServicesWithPanels(config = {}, { listPanels, listMasterPanels } = {}) {
  const registry = require('./panel-registry');
  const masterRegistry = require('./master-panel-registry');
  const [panels, masters] = await Promise.all([listPanels ? listPanels() : registry.list(), listMasterPanels ? listMasterPanels() : masterRegistry.list()]);
  const settings = config.services || {};
  const records = [...panels.filter((p) => p.status === 'active').map((panel) => ({ panel, kind: 'panel' })), ...masters.filter((p) => p.status === 'active').map((panel) => ({ panel, kind: 'master' }))];
  return records.map(({ panel, kind }, index) => {
    const saved = settings[`${kind}_${panel.id}`], hasSavedObject = saved && typeof saved === 'object';
    return { id: `${kind}_${panel.id}`, panelId: panel.id, masterPanelId: kind === 'master' ? panel.id : null, panelAId: panel.panelAId || null, panelBId: panel.panelBId || null, name: panel.name, label: panel.name,
      emoji: hasSavedObject && saved.emoji ? saved.emoji : (kind === 'master' ? '🔗' : '🧩'), description: hasSavedObject && saved.description ? saved.description : (kind === 'master' ? 'Master Panel' : 'پنل مستقل'),
      order: Number(hasSavedObject ? (saved.order ?? (100 + index)) : (100 + index)), provider: `${kind}:${panel.id}`, enabled: hasSavedObject ? saved.enabled !== false : true,
      testEnabled: kind === 'master' ? false : (hasSavedObject && saved.testEnabled !== undefined ? saved.testEnabled !== false : true), purchaseEnabled: hasSavedObject && saved.purchaseEnabled !== undefined ? saved.purchaseEnabled !== false : true };
  }).filter((s) => s.enabled !== false).sort((a, b) => a.order - b.order);
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
module.exports = { SERVICES: [], getService: () => null, getConfiguredServices, getConfiguredService, getConfiguredServicesWithPanels, getConfiguredServiceWithPanels, isServiceEnabled, isServiceTestEnabled, isServicePurchaseEnabled, serviceName, serviceLabel, serviceButtons, serviceButtonsWithPanels };
