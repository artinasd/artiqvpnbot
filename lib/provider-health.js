const storage = require('./storage');
const { getProvider } = require('./providers');
const { getConfig } = require('./bot-config');

const HEALTH_KEY = 'provider_health_status';

async function checkHealth(log) {
  const config = await getConfig();
  const statuses = {};
  
  for (const serviceKey of ['tunnel', 'gaming', 'tunnel2', 'direct2', 'direct']) {
    const serviceConfig = config.services[serviceKey];
    if (!serviceConfig || !serviceConfig.enabled) continue;
    
    // Convert service to provider string manually to match our codebase logic
    let providerId = 'pasarguard';
    if (serviceKey === 'gaming') providerId = 'pasarguard-panel2';
    if (serviceKey === 'tunnel2' || serviceKey === 'direct' || serviceConfig.provider === 'pasarguard-tunnel2') providerId = 'pasarguard-tunnel2';
    if (serviceKey === 'direct2' || serviceConfig.provider === 'pasarguard-direct2') providerId = 'pasarguard-direct2';
    
    // We already checked this provider in this loop run?
    if (statuses[providerId] !== undefined) continue;

    const provider = getProvider(providerId);
    try {
      const isUp = await provider.health();
      statuses[providerId] = isUp;
    } catch (e) {
      statuses[providerId] = false;
      if (log) log('PROVIDER_HEALTH_CHECK_FAILED', { providerId, error: e.message || String(e) });
    }
  }

  await storage.set(HEALTH_KEY, statuses, { exSeconds: 300 }); // cache for 5 minutes
  return statuses;
}

async function isProviderHealthy(providerId) {
  const statuses = await storage.get(HEALTH_KEY);
  if (!statuses) return true; // optimistic if no check run yet
  return statuses[providerId] !== false;
}

module.exports = { checkHealth, isProviderHealthy };
