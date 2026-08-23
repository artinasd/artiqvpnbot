const SERVICES = [
  { id: 'tunnel', name: 'Tunnel', label: '🛡️ Tunnel', emoji: '🛡️', description: 'سرویس اصلی', order: 10 },
  { id: 'gaming', name: 'Gaming', label: '🎮 Gaming', emoji: '🎮', description: 'مخصوص بازی', order: 20 },
];

function getService(id) {
  return SERVICES.find((service) => service.id === String(id)) || null;
}

function getConfiguredServices(config = {}) {
  const settings = config.services || {};
  return SERVICES.map((service) => {
    const saved = settings[service.id];
    const legacyEnabled = settings[`${service.id}Enabled`];
    return {
      ...service,
      ...(saved && typeof saved === 'object' ? saved : {}),
      id: service.id,
      name: saved?.name || service.name,
      emoji: saved?.emoji || service.emoji,
      description: saved?.description || service.description,
      order: Number(saved?.order ?? service.order),
      enabled: saved && typeof saved === 'object' && saved.enabled !== undefined
        ? saved.enabled !== false
        : legacyEnabled !== false,
    };
  }).filter((service) => service.enabled !== false).sort((a, b) => a.order - b.order);
}

function getConfiguredService(id, config = {}) {
  return getConfiguredServices(config).find((service) => service.id === String(id)) || null;
}

function serviceLabel(service) {
  if (!service) return '';
  return `${service.emoji || ''} ${service.name || service.id}`.trim();
}

function serviceButtons(prefix, config) {
  return getConfiguredServices(config).map((service) => [
    { text: `${serviceLabel(service)}${service.description ? ` — ${service.description}` : ''}`, callback_data: `${prefix}${service.id}` },
  ]);
}

module.exports = { SERVICES, getService, getConfiguredServices, getConfiguredService, serviceLabel, serviceButtons };
