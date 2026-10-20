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


test('listSubscriptions hides account-removed records without deleting order history', async () => {
  const originalListUserOrders = storage.listUserOrders;
  storage.listUserOrders = async () => [
    { orderId: 'visible', pasarguardUserId: 'pg-1' },
    { orderId: 'removed', pasarguardUserId: 'pg-2', accountRemovedAt: '2026-10-20T00:00:00.000Z' },
  ];
  try {
    const result = await accountService.listSubscriptions(12345);
    assert.deepEqual(result.map((order) => order.orderId), ['visible']);
  } finally {
    storage.listUserOrders = originalListUserOrders;
  }
});

test('removeSubscriptionFromAccount deletes panel user and marks Redis record removed', async () => {
  const originalGetOrder = storage.getOrder;
  const originalUpdateOrder = storage.updateOrder;
  const originalGet = pasarguardPanel2.getUserById;
  const originalDelete = pasarguardPanel2.deleteUserById;
  let updatedPatch;
  const order = {
    orderId: 'remove-me',
    telegramUserId: 12345,
    provider: 'pasarguard-panel2',
    pasarguardUserId: 'pg-user-1',
    generatedPasarguardUsername: 'customer_name',
    paymentStatus: 'APPROVED',
  };
  storage.getOrder = async () => order;
  storage.updateOrder = async (id, patch) => {
    assert.equal(id, 'remove-me');
    updatedPatch = patch;
    return { ...order, ...patch };
  };
  pasarguardPanel2.getUserById = async (id) => ({ id });
  pasarguardPanel2.deleteUserById = async (id) => {
    assert.equal(id, 'pg-user-1');
    return { success: true };
  };
  try {
    const result = await accountService.removeSubscriptionFromAccount(12345, 'remove-me');
    assert.equal(result.order.accountRemoved, true);
    assert.equal(result.order.paymentStatus, 'APPROVED');
    assert.equal(updatedPatch.accountRemovalPanelStatus, 'REMOVED');
    assert.ok(updatedPatch.accountRemovedAt);
  } finally {
    storage.getOrder = originalGetOrder;
    storage.updateOrder = originalUpdateOrder;
    pasarguardPanel2.getUserById = originalGet;
    pasarguardPanel2.deleteUserById = originalDelete;
  }
});

test('removeSubscriptionFromAccount rejects a different Telegram owner', async () => {
  const originalGetOrder = storage.getOrder;
  storage.getOrder = async () => ({ orderId: 'private', telegramUserId: 99999 });
  try {
    await assert.rejects(
      accountService.removeSubscriptionFromAccount(12345, 'private'),
      (error) => error.code === 'SUBSCRIPTION_NOT_FOUND'
    );
  } finally {
    storage.getOrder = originalGetOrder;
  }
});
