const test = require('node:test');
const assert = require('node:assert/strict');

const wallet = require('../lib/wallet');
const storage = require('../lib/storage');
const plans = require('../lib/plans');
const accountUI = require('../lib/account-ui');
const panelRegistry = require('../lib/panel-registry');
const { getFulfillment } = require('../lib/service-fulfillment');
const { createDynamicPasarGuardProvider } = require('../lib/dynamic-pasarguard');
const { fulfillOrder } = require('../lib/fulfillment');
const { getProvider } = require('../lib/providers');

test('wallet debit and credit reject non-positive amounts and keep recent tx idempotency', async () => {
  const userId = 990001;
  await storage.saveUser({ telegramUserId: userId, balance: 0 });
  await wallet.setBalance(userId, 50000);
  await assert.rejects(() => wallet.debit(userId, -1000), /INVALID_AMOUNT/);
  await assert.rejects(() => wallet.debit(userId, 0), /INVALID_AMOUNT/);
  await assert.rejects(() => wallet.credit(userId, -500), /INVALID_AMOUNT/);
  await assert.rejects(() => wallet.credit(userId, 0), /INVALID_AMOUNT/);

  await wallet.debit(userId, 10000, { walletLastTransaction: 'tx-a' });
  await wallet.debit(userId, 5000, { walletLastTransaction: 'tx-b' });
  // Replaying tx-a even after tx-b must still be idempotent.
  await wallet.debit(userId, 10000, { walletLastTransaction: 'tx-a' });
  assert.equal(await wallet.getBalance(userId), 35000);
});

test('plans.resolveCustomOrderPrice ignores empty string and parseDurationDays accepts bare numbers', () => {
  assert.equal(plans.resolveCustomOrderPrice({ traffic: 10, price: '' }), 40000);
  assert.equal(plans.resolveCustomOrderPrice({ traffic: 10, price: 25000 }), 25000);
  assert.equal(plans.parseDurationDays('30'), 30);
  assert.equal(plans.parseDurationDays('۴۵'), 45);
});

test('accountUI.formatDetail formats traffic bytes and ISO expiry in human-readable Persian', () => {
  const output = accountUI.formatDetail({
    planName: 'Test Plan',
    service: 'Tunnel',
    status: '✅ فعال',
    traffic: 10 * 1024 ** 3,
    duration: 30,
    expiresAt: '2026-12-01T00:00:00.000Z',
    canRenew: true,
  });
  assert.match(output, /10 گیگابایت/);
  assert.doesNotMatch(output, /10737418240/);
  assert.doesNotMatch(output, /2026-12-01T00:00:00\.000Z/);

  const unlimited = accountUI.formatDetail({
    planName: 'Unlimited',
    service: 'Tunnel',
    status: '✅ فعال',
    traffic: 0,
  });
  assert.match(unlimited, /نامحدود/);
});

test('service-fulfillment blocks disabled panels in fallback lookup', async () => {
  const originalGetById = panelRegistry.getById;
  panelRegistry.getById = async (id) => ({ id, name: 'Disabled Panel', status: 'disabled' });
  try {
    const res = await getFulfillment('panel_disabled1', {});
    assert.equal(res.ok, false);
    assert.equal(res.code, 'SERVICE_UNAVAILABLE');
  } finally {
    panelRegistry.getById = originalGetById;
  }
});

test('dynamic-pasarguard rejects protocol-relative subscription_url and null group ids', async () => {
  const sentBodies = [];
  const provider = createDynamicPasarGuardProvider('p1', {
    getPanel: async () => ({ id: 'p1', baseUrl: 'https://panel.example.com', updatedAt: '1' }),
    getCredentials: async () => ({ username: 'admin', password: 'secret' }),
    checkUrl: async () => {},
    fetchImpl: async (url, init) => {
      const u = String(url);
      if (u.endsWith('/api/admin/token')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'tok' }) };
      }
      if (u.endsWith('/api/groups/simple')) {
        return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 1 }, { id: null }, { id: '' }]) };
      }
      if (u.endsWith('/api/user')) {
        sentBodies.push(JSON.parse(init.body));
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: 7, username: 'u', subscription_url: '//evil.example/sub' }) };
      }
      throw new Error(`Unexpected URL ${u}`);
    },
  });

  await assert.rejects(
    () => provider.createUser({ username: 'test_user', trafficBytes: 1024, hwidLimit: 0 }),
    /PANEL_INVALID_SUBSCRIPTION_URL/,
  );
  assert.deepEqual(sentBodies[0].group_ids, [1]);
});

test('paid renewal order is refunded on fulfillment failure', async () => {
  const userId = 990002;
  await storage.saveUser({ telegramUserId: userId, balance: 0 });
  await wallet.setBalance(userId, 10000);
  await wallet.debit(userId, 10000, { walletLastTransaction: 'purchase:TG-RENEW-FAIL-1' });
  assert.equal(await wallet.getBalance(userId), 0);

  const originalGetById = panelRegistry.getById;
  panelRegistry.getById = async (id) => ({ id, name: 'Active Panel', status: 'active', baseUrl: 'https://panel.example.com' });

  await storage.createOrder({
    orderId: 'TG-RENEW-FAIL-1',
    telegramUserId: userId,
    planId: 'p1',
    planName: 'Renewal Plan',
    service: 'panel_active1',
    panelId: 'active1',
    renewal: true,
    renewalPasarguardUserId: null,
    price: 10000,
    walletCharged: true,
    walletChargedAmount: 10000,
    paymentStatus: 'WALLET_PAID',
    fulfillmentStatus: 'RECEIPT_SUBMITTED',
  });

  const fakeTelegram = { sendMessage: async () => ({}) };
  try {
    await new Promise((resolve) => {
      fulfillOrder('TG-RENEW-FAIL-1', fakeTelegram, { onSettled: resolve });
    });
  } finally {
    panelRegistry.getById = originalGetById;
  }

  assert.equal(await wallet.getBalance(userId), 10000);
  const updatedOrder = await storage.getOrder('TG-RENEW-FAIL-1');
  assert.equal(updatedOrder.walletRefunded, true);
  assert.equal(updatedOrder.fulfillmentStatus, 'FAILED_REFUNDED');
});
