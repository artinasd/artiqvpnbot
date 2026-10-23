const { getConfiguredService, getConfiguredServiceWithPanels } = require('./services');
const panelRegistry = require('./panel-registry');

async function getFulfillment(serviceId, config = {}) {
  let service = String(serviceId).startsWith('panel_')
    ? await getConfiguredServiceWithPanels(serviceId, config)
    : getConfiguredService(serviceId, config);
  // Existing orders retain their panel route even if the panel is disabled in the CMS.
  // New purchases are still blocked because the Telegram service resolver omits disabled panels.
  if (!service && String(serviceId).startsWith('panel_')) {
    const panelId = String(serviceId).slice('panel_'.length);
    const panel = await panelRegistry.getById(panelId);
    if (panel) service = { id: String(serviceId), panelId, name: panel.name, provider: `panel:${panelId}`, enabled: false };
  }
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
