const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../lib/storage');
const providers = require('../lib/providers');
const accountService = require('../lib/account-service');

test('listSubscriptions uses stored orders without making live PasarGuard requests', async () => {
  const originalListUserOrders = storage.listUserOrders;
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
  try {
    const result = await accountService.listSubscriptions(12345);
    assert.deepEqual(result, [storedOrders[0], storedOrders[2]]);
  } finally {
    storage.listUserOrders = originalListUserOrders;
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

test('removeSubscriptionFromAccount deletes a CMS panel user and marks the order removed', async () => {
  const originalGetOrder = storage.getOrder;
  const originalUpdateOrder = storage.updateOrder;
  const originalGetProvider = providers.getProvider;
  let updatedPatch;
  let requestedProvider;
  const order = {
    orderId: 'remove-me',
    telegramUserId: 12345,
    fulfillmentProvider: 'panel:test-panel',
    panelId: 'test-panel',
    pasarguardUserId: 'pg-user-1',
    generatedPasarguardUsername: 'customer_name',
    paymentStatus: 'APPROVED',
  };
  const client = {
    getUserById: async (id) => ({ id }),
    deleteUserById: async (id) => { assert.equal(id, 'pg-user-1'); return { success: true }; },
  };
  storage.getOrder = async () => order;
  storage.updateOrder = async (id, patch) => {
    assert.equal(id, 'remove-me');
    updatedPatch = patch;
    return { ...order, ...patch };
  };
  providers.getProvider = (id) => { requestedProvider = id; return client; };
  try {
    const result = await accountService.removeSubscriptionFromAccount(12345, 'remove-me');
    assert.equal(requestedProvider, 'panel:test-panel');
    assert.equal(result.order.accountRemoved, true);
    assert.equal(result.order.paymentStatus, 'APPROVED');
    assert.equal(updatedPatch.accountRemovalPanelStatus, 'REMOVED');
    assert.ok(updatedPatch.accountRemovedAt);
  } finally {
    storage.getOrder = originalGetOrder;
    storage.updateOrder = originalUpdateOrder;
    providers.getProvider = originalGetProvider;
  }
});

test('legacy orders without a CMS panel mapping fail safely instead of targeting the wrong panel', async () => {
  const originalGetOrder = storage.getOrder;
  const originalGetProvider = providers.getProvider;
  storage.getOrder = async () => ({
    orderId: 'legacy-order',
    telegramUserId: 12345,
    provider: 'pasarguard-tunnel2',
    pasarguardUserId: 'pg-user-1',
  });
  providers.getProvider = () => { throw new Error('must not call provider for an unmapped legacy order'); };
  try {
    await assert.rejects(
      accountService.removeSubscriptionFromAccount(12345, 'legacy-order'),
      (error) => error.code === 'LEGACY_ORDER_REQUIRES_PANEL_MAPPING'
    );
  } finally {
    storage.getOrder = originalGetOrder;
    providers.getProvider = originalGetProvider;
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
