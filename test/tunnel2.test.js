const test = require('node:test');
const assert = require('node:assert');
const { getService, getConfiguredService } = require('../lib/services');
const { getProvider } = require('../lib/providers');
const { getFulfillment } = require('../lib/service-fulfillment');
const { getConfig } = require('../lib/bot-config');
const { displayName, providerId } = require('../lib/account-service');
const planStore = require('../lib/plan-store');

test('Tunnel 2 service exists and is configured correctly', () => {
  const service = getService('tunnel2');
  assert.ok(service);
  assert.equal(service.id, 'tunnel2');
  assert.equal(service.name, 'Tunnel 2');
  assert.equal(service.provider, 'pasarguard-tunnel2');

  // Backward compatibility alias for direct
  const legacyDirect = getService('direct');
  assert.ok(legacyDirect);
  assert.equal(legacyDirect.id, 'tunnel2');
});

test('Providers returns Tunnel 2 client for pasarguard-tunnel2', () => {
  const provider = getProvider('pasarguard-tunnel2');
  assert.ok(provider);
  assert.equal(typeof provider.createUser, 'function');
  assert.equal(typeof provider.health, 'function');

  // Legacy direct maps to tunnel2 provider
  const legacyProvider = getProvider('pasarguard-direct');
  assert.strictEqual(provider, legacyProvider);
});

test('Fulfillment identifies Tunnel 2', () => {
  const config = {
    services: {
      tunnel2: { enabled: true, provider: 'pasarguard-tunnel2' },
    },
  };
  const fulfillment = getFulfillment('tunnel2', config);
  assert.equal(fulfillment.ok, true);
  assert.equal(fulfillment.code, 'PASARGUARD_TUNNEL2');
});

test('Account display name formats Tunnel 2 correctly', () => {
  const order = {
    planName: 'Tunnel 2 30GB',
    service: 'tunnel2',
  };
  const title = displayName(order);
  assert.match(title, /🛡️ Tunnel 2/);
  assert.equal(providerId(order), 'pasarguard-tunnel2');

  const legacyOrder = {
    planName: 'Direct 1 30GB',
    service: 'direct',
  };
  assert.equal(providerId(legacyOrder), 'pasarguard-tunnel2');
});

test('Plan store normalizes Direct 1 to Tunnel 2', async () => {
  const saved = await planStore.save({
    id: 'test_tunnel2_plan',
    name: 'Direct 1 30GB',
    buttonText: 'Direct 1 30GB',
    price: 50000,
    service: 'direct',
    durationDays: 30,
    trafficBytes: 30 * 1024 * 1024 * 1024,
    type: 'traffic',
  });

  assert.equal(saved.service, 'tunnel2');
  assert.equal(saved.name, 'Tunnel 2 30GB');
  assert.equal(saved.buttonText, 'Tunnel 2 30GB');
});
