const { getConfiguredService, getConfiguredServiceWithPanels } = require('./services');

async function getFulfillment(serviceId, config = {}) {
  const service = String(serviceId).startsWith('panel_')
    ? await getConfiguredServiceWithPanels(serviceId, config)
    : getConfiguredService(serviceId, config);
  if (!service) return { ok: false, code: 'SERVICE_UNAVAILABLE', service: null, provider: null };
  if (String(service.provider || '').startsWith('panel:')) return { ok: true, code: 'PASARGUARD_DYNAMIC_PANEL', service, provider: service.provider };
  if (service.provider === 'pasarguard') return { ok: true, code: 'PASARGUARD', service, provider: service.provider };
  if (service.provider === 'pasarguard-panel2') return { ok: true, code: 'PASARGUARD_PANEL2', service, provider: service.provider };
  if (service.provider === 'pasarguard-tunnel2') return { ok: true, code: 'PASARGUARD_TUNNEL2', service, provider: service.provider };
  if (service.provider === 'pasarguard-direct2') return { ok: true, code: 'PASARGUARD_DIRECT2', service, provider: service.provider };
  return { ok: false, code: 'SERVICE_PREPARING', service, provider: null };
}
async function canFulfill(serviceId, config = {}) { return (await getFulfillment(serviceId, config)).ok; }
module.exports = { getFulfillment, canFulfill };
