const SERVICES = [
  { id: 'tunnel', name: 'Tunnel', label: '🛡️ Tunnel', emoji: '🛡️', description: 'سرویس اصلی', order: 10, provider: 'pasarguard' },
  { id: 'gaming', name: 'Gaming', label: '🎮 Gaming', emoji: '🎮', description: 'مخصوص بازی', order: 20, provider: 'pasarguard-panel2' },
  { id: 'direct', name: 'Direct', label: '🎯 Direct', emoji: '🎯', description: 'سرویس مستقیم', order: 30, provider: 'pasarguard-direct', defaultEnabled: false, defaultTestEnabled: false, defaultPurchaseEnabled: false },
  { id: 'tunnel2', name: 'Direct 2', label: '🎯 Direct 2', emoji: '🎯', description: 'سرویس Direct 2', order: 40, provider: 'pasarguard-direct2', defaultEnabled: false, defaultTestEnabled: false, defaultPurchaseEnabled: false },
];

function getService(id) { return SERVICES.find((service) => service.id === String(id)) || null; }
function getConfiguredServices(config = {}) {
  const settings = config.services || {};
  return SERVICES.map((service) => {
    const saved = settings[service.id];
    const hasSavedObject = saved && typeof saved === 'object';
    const enabled = hasSavedObject ? saved.enabled !== false : (service.defaultEnabled !== false);
    const testEnabled = hasSavedObject && saved.testEnabled !== undefined ? saved.testEnabled !== false : (service.defaultTestEnabled !== false);
    const purchaseEnabled = hasSavedObject && saved.purchaseEnabled !== undefined ? saved.purchaseEnabled !== false : (service.defaultPurchaseEnabled !== false);
    return { ...service, ...(hasSavedObject ? saved : {}), id: service.id, name: hasSavedObject && saved.name ? saved.name : service.name, emoji: hasSavedObject && saved.emoji ? saved.emoji : service.emoji, description: hasSavedObject && saved.description ? saved.description : service.description, provider: hasSavedObject && saved.provider ? saved.provider : service.provider, order: Number(hasSavedObject ? (saved.order ?? service.order) : service.order), enabled, testEnabled, purchaseEnabled };
  }).filter((service) => service.enabled !== false).sort((a, b) => a.order - b.order);
}
function getConfiguredService(id, config = {}) { return getConfiguredServices(config).find((service) => service.id === String(id)) || null; }
function isServiceEnabled(id, config = {}) { return Boolean(getConfiguredService(id, config)); }
function isServiceTestEnabled(id, config = {}) { const service = getConfiguredService(id, config); return Boolean(service && service.testEnabled !== false); }
function isServicePurchaseEnabled(id, config = {}) { const service = getConfiguredService(id, config); return Boolean(service && service.purchaseEnabled !== false); }
function serviceLabel(service) { if (!service) return ''; return `${service.emoji || ''} ${service.name || service.id}`.trim(); }
function serviceButtons(prefix, config, mode) { const effectiveMode = mode || (String(prefix).startsWith('service_test_') ? 'test' : String(prefix).startsWith('service_buy_') || String(prefix).startsWith('service_renew_') ? 'purchase' : undefined); return getConfiguredServices(config).filter((service) => effectiveMode !== 'test' || service.testEnabled !== false).filter((service) => effectiveMode !== 'purchase' || service.purchaseEnabled !== false).map((service) => [{ text: `${serviceLabel(service)}${service.description ? ` — ${service.description}` : ''}`, callback_data: `${prefix}${service.id}` }]); }
module.exports = { SERVICES, getService, getConfiguredServices, getConfiguredService, isServiceEnabled, isServiceTestEnabled, isServicePurchaseEnabled, serviceLabel, serviceButtons };
