const { getConfiguredService } = require('./services');

function getFulfillment(serviceId, config = {}) {
  const service = getConfiguredService(serviceId, config);
  if (!service) return { ok: false, code: 'SERVICE_UNAVAILABLE', service: null, provider: null };
  if (service.provider === 'pasarguard') return { ok: true, code: 'PASARGUARD', service, provider: service.provider };
  if (service.provider === 'pasarguard-panel2') return { ok: true, code: 'PASARGUARD_PANEL2', service, provider: service.provider };
  if (service.provider === 'pasarguard-direct') return { ok: true, code: 'PASARGUARD_DIRECT', service, provider: service.provider };
  return { ok: false, code: 'SERVICE_PREPARING', service, provider: null };
}
function canFulfill(serviceId, config = {}) { return getFulfillment(serviceId, config).ok; }
module.exports = { getFulfillment, canFulfill };