const test = require('node:test');
const assert = require('node:assert');
const storage = require('../lib/storage');
const { checkHealth, isProviderHealthy } = require('../lib/provider-health');

test.beforeEach(async () => {
  process.env.UPSTASH_REDIS_REST_URL = '';
  await storage.set('provider_health_status', null);
});

test('checkHealth marks provider as down if it throws', async () => {
  const { getProvider } = require('../lib/providers');
  
  // mock providers
  const tunnel = getProvider('pasarguard');
  const oldTunnelHealth = tunnel.health;
  
  try {
    tunnel.health = async () => { throw new Error('Simulated crash'); };
    
    const statuses = await checkHealth();
    assert.equal(statuses['pasarguard'], false);
    
    // Test the wrapper
    const isHealthy = await isProviderHealthy('pasarguard');
    assert.equal(isHealthy, false);
    
    // Other providers might not be enabled or healthy depending on config mock
  } finally {
    tunnel.health = oldTunnelHealth;
  }
});

test('isProviderHealthy returns true if no data', async () => {
  const isHealthy = await isProviderHealthy('pasarguard');
  assert.equal(isHealthy, true);
});
