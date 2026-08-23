const SERVICES = [
  { id: 'tunnel', name: 'Tunnel', label: '🛡️ Tunnel', emoji: '🛡️', description: 'سرویس اصلی', order: 10 },
  { id: 'gaming', name: 'Gaming', label: '🎮 Gaming', emoji: '🎮', description: 'مخصوص بازی', order: 20 },
];

function getService(id) {
  return SERVICES.find((service) => service.id === String(id)) || null;
}

function getConfiguredServices(config = {}) {
  const settings = config.services || {};
  return SERVICES
    .map((service) => {
      const saved = settings[service.id];
      const legacyEnabled = settings[`${service.id}Enabled`];
      return {
        ...service,
        ...(saved && typeof saved === 'object' ? saved : {}),
        enabled: saved && typeof saved === 'object' && saved.enabled !== undefined
          ? saved.enabled !== false
          : legacyEnabled !== false,
      };
    })
    .filter((service) => service.enabled !== false)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function getConfiguredService(id, config = {}) {
  return getConfiguredServices(config).find((service) => service.id === String(id)) || null;
}

function serviceLabel(service) {
  if (!service) return '';
  const prefix = service.label || `${service.emoji || ''} ${service.name || ''}`.trim();
  return service.description ? `${prefix} — ${service.description}` : prefix;
}

function serviceButtons(prefix, config) {
  return getConfiguredServices(config).map((service) => [
    { text: serviceLabel(service), callback_data: `${prefix}${service.id}` },
  ]);
}

module.exports = { SERVICES, getService, getConfiguredServices, getConfiguredService, serviceLabel, serviceButtons };
