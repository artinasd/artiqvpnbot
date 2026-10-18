const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../lib/storage');
const pasarguard = require('../lib/pasarguard');
const pasarguardPanel2 = require('../lib/pasarguard-panel2');
const pasarguardTunnel2 = require('../lib/pasarguard-tunnel2');
const pasarguardDirect2 = require('../lib/pasarguard-direct2');
const accountService = require('../lib/account-service');

test('listSubscriptions uses stored orders without making live PasarGuard requests', async () => {
  const originalListUserOrders = storage.listUserOrders;
  const clients = [pasarguard, pasarguardPanel2, pasarguardTunnel2, pasarguardDirect2];
  const originalGetUserById = clients.map((client) => client.getUserById);
  let providerCalls = 0;

  const storedOrders = [
    { orderId: 'order-1', pasarguardUserId: 'pg-user-1', subUrl: 'https://example.invalid/sub-1' },
    { orderId: 'order-2', fulfillmentStatus: 'PROVISIONING' },
    { orderId: 'order-3', pasarguardUserId: 'pg-user-3', fulfillmentStatus: 'FULFILLED' },
    null,
  ];

  storage.listUserOrders = async (telegramUserId, limit) => {
    assert.equal(String(telegramUserId), '12345');
    assert.equal(limit, 100);
    return storedOrders;
  };

  clients.forEach((client) => {
    client.getUserById = async () => {
      providerCalls += 1;
      throw new Error('listSubscriptions must not call PasarGuard');
    };
  });

  try {
    const result = await accountService.listSubscriptions(12345);
    assert.deepEqual(result, [storedOrders[0], storedOrders[2]]);
    assert.equal(providerCalls, 0);
  } finally {
    storage.listUserOrders = originalListUserOrders;
    clients.forEach((client, index) => {
      client.getUserById = originalGetUserById[index];
    });
  }
});
