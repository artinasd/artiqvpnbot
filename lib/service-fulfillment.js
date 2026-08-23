const { getConfiguredService } = require('./services');

/**
 * Central policy for deciding whether a selected service can actually be
 * fulfilled. UI availability and fulfillment availability are intentionally
 * separate: a service may be selectable in CMS while its backend is still
 * being prepared.
 */
function getFulfillment(serviceId, config = {}) {
  const service = getConfiguredService(serviceId, config);
  if (!service) {
    return { ok: false, code: 'SERVICE_UNAVAILABLE', service: null };
  }

  // Tunnel is the only service with a production fulfillment backend today.
  if (service.id === 'tunnel') {
    return { ok: true, code: 'PASARGUARD', service };
  }

  // Gaming is intentionally visible/selectable but has no fulfillment API yet.
  if (service.id === 'gaming') {
    return { ok: false, code: 'SERVICE_PREPARING', service };
  }

  // Future services must opt into a real fulfillment implementation here.
  return { ok: false, code: 'SERVICE_PREPARING', service };
}

function canFulfill(serviceId, config = {}) {
  return getFulfillment(serviceId, config).ok;
}

module.exports = { getFulfillment, canFulfill };
