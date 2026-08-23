const SERVICES = [
  { id: 'tunnel', name: 'Tunnel', label: '🛡️ Tunnel', emoji: '🛡️', description: 'سرویس اصلی', order: 10, provider: 'pasarguard' },
  { id: 'gaming', name: 'Gaming', label: '🎮 Gaming', emoji: '🎮', description: 'مخصوص بازی', order: 20, provider: 'pasarguard-panel2' },
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
      provider: saved?.provider || service.provider,
      order: Number(saved?.order ?? service.order),
      enabled: saved && typeof saved === 'object' && saved.enabled !== undefined
        ? saved.enabled !== false
        : legacyEnabled !== false,
      testEnabled: saved && typeof saved === 'object' && saved.testEnabled !== undefined
        ? saved.testEnabled !== false
        : true,
      purchaseEnabled: saved && typeof saved === 'object' && saved.purchaseEnabled !== undefined
        ? saved.purchaseEnabled !== false
        : true,
    };
  }).filter((service) => service.enabled !== false).sort((a, b) => a.order - b.order);
}

function getConfiguredService(id, config = {}) {
  return getConfiguredServices(config).find((service) => service.id === String(id)) || null;
}

function isServiceEnabled(id, config = {}) {
  return Boolean(getConfiguredService(id, config));
}

function isServiceTestEnabled(id, config = {}) {
  const service = getConfiguredService(id, config);
  return Boolean(service && service.testEnabled !== false);
}

function isServicePurchaseEnabled(id, config = {}) {
  const service = getConfiguredService(id, config);
  return Boolean(service && service.purchaseEnabled !== false);
}

function serviceLabel(service) {
  if (!service) return '';
  return `${service.emoji || ''} ${service.name || service.id}`.trim();
}

function serviceButtons(prefix, config, mode) {
  const effectiveMode = mode || (String(prefix).startsWith('service_test_')
    ? 'test'
    : String(prefix).startsWith('service_buy_') || String(prefix).startsWith('service_renew_')
      ? 'purchase'
      : undefined);
  return getConfiguredServices(config)
    .filter((service) => effectiveMode !== 'test' || service.testEnabled !== false)
    .filter((service) => effectiveMode !== 'purchase' || service.purchaseEnabled !== false)
    .map((service) => [
      { text: `${serviceLabel(service)}${service.description ? ` — ${service.description}` : ''}`, callback_data: `${prefix}${service.id}` },
    ]);
}

module.exports = {
  SERVICES,
  getService,
  getConfiguredServices,
  getConfiguredService,
  isServiceEnabled,
  isServiceTestEnabled,
  isServicePurchaseEnabled,
  serviceLabel,
  serviceButtons,
};
