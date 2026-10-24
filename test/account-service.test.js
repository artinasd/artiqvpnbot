const test = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../lib/storage');
const providers = require('../lib/providers');
const planStore = require('../lib/plan-store');
const panelRegistry = require('../lib/panel-registry');
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


test('legacy subscription is lazily mapped when exactly one CMS panel has its service type', async () => {
  const originals = {
    getOrder: storage.getOrder,
    updateOrder: storage.updateOrder,
    listAll: planStore.listAll,
    getById: panelRegistry.getById,
    getProvider: providers.getProvider,
  };
  const order = {
    orderId: 'legacy-map',
    telegramUserId: 12345,
    planId: 'old-plan-id',
    planName: 'Old 10 GB',
    service: 'tunnel2',
    provider: 'pasarguard-tunnel2',
    pasarguardUserId: 'pg-user-legacy',
    generatedPasarguardUsername: 'legacy_user',
    fulfillmentStatus: 'FULFILLED',
    paymentStatus: 'APPROVED',
  };
  let mappingPatch;
  let requestedProvider;
  const client = {
    getUserById: async (id) => ({ id }),
    deleteUserById: async (id) => { assert.equal(id, 'pg-user-legacy'); },
  };
  storage.getOrder = async () => order;
  storage.updateOrder = async (id, patch) => {
    assert.equal(id, 'legacy-map');
    if (patch.panelId) mappingPatch = patch;
    return { ...order, ...patch };
  };
  planStore.listAll = async () => [{ id: 'new-plan-id', panelId: 'current-tunnel-panel', service: 'tunnel2', name: 'New 10 GB' }];
  panelRegistry.getById = async (id) => ({ id, status: 'active' });
  providers.getProvider = (id) => { requestedProvider = id; return client; };
  try {
    const result = await accountService.removeSubscriptionFromAccount(12345, 'legacy-map');
    assert.equal(requestedProvider, 'panel:current-tunnel-panel');
    assert.equal(mappingPatch.panelId, 'current-tunnel-panel');
    assert.equal(mappingPatch.fulfillmentProvider, 'panel:current-tunnel-panel');
    assert.equal(mappingPatch.service, 'panel_current-tunnel-panel');
    assert.equal(result.order.accountRemoved, true);
  } finally {
    storage.getOrder = originals.getOrder;
    storage.updateOrder = originals.updateOrder;
    planStore.listAll = originals.listAll;
    panelRegistry.getById = originals.getById;
    providers.getProvider = originals.getProvider;
  }
});

test('legacy subscription maps by exact globally unique plan ID even if service label changed', async () => {
  const originals = {
    getOrder: storage.getOrder,
    updateOrder: storage.updateOrder,
    listAll: planStore.listAll,
    getById: panelRegistry.getById,
  };
  const order = {
    orderId: 'legacy-exact-plan',
    telegramUserId: 12345,
    planId: 'stable-plan-id',
    service: 'tunnel2',
    provider: 'pasarguard-tunnel2',
    pasarguardUserId: 'pg-user-1',
  };
  let patch;
  storage.getOrder = async () => order;
  storage.updateOrder = async (id, value) => { assert.equal(id, order.orderId); patch = value; return { ...order, ...value }; };
  planStore.listAll = async () => [{ id: 'stable-plan-id', panelId: 'current-panel', service: 'tunnel' }];
  panelRegistry.getById = async (id) => ({ id, status: 'active' });
  try {
    const mapped = await accountService.resolveOrderPanel(order);
    assert.equal(mapped.panelId, 'current-panel');
    assert.equal(patch.fulfillmentProvider, 'panel:current-panel');
  } finally {
    storage.getOrder = originals.getOrder;
    storage.updateOrder = originals.updateOrder;
    planStore.listAll = originals.listAll;
    panelRegistry.getById = originals.getById;
  }
});

test('legacy subscription is not mapped when multiple CMS panels match its service', async () => {
  const originals = {
    getOrder: storage.getOrder,
    listAll: planStore.listAll,
    getById: panelRegistry.getById,
    getProvider: providers.getProvider,
  };
  storage.getOrder = async () => ({
    orderId: 'ambiguous-legacy',
    telegramUserId: 12345,
    planId: 'missing-old-plan',
    service: 'tunnel2',
    provider: 'pasarguard-tunnel2',
    pasarguardUserId: 'pg-user-1',
  });
  planStore.listAll = async () => [
    { id: 'plan-a', panelId: 'panel-a', service: 'tunnel2' },
    { id: 'plan-b', panelId: 'panel-b', service: 'tunnel2' },
  ];
  panelRegistry.getById = async () => { throw new Error('ambiguous mapping must not query a panel'); };
  providers.getProvider = () => { throw new Error('ambiguous mapping must not contact a panel'); };
  try {
    await assert.rejects(
      accountService.removeSubscriptionFromAccount(12345, 'ambiguous-legacy'),
      (error) => error.code === 'LEGACY_ORDER_REQUIRES_PANEL_MAPPING'
    );
  } finally {
    storage.getOrder = originals.getOrder;
    planStore.listAll = originals.listAll;
    panelRegistry.getById = originals.getById;
    providers.getProvider = originals.getProvider;
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
