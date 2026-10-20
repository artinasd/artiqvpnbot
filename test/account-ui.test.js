const test = require('node:test');
const assert = require('node:assert/strict');

const accountService = require('../lib/account-service');
const accountUI = require('../lib/account-ui');

test('account list titles show the saved PasarGuard username when available', async () => {
  const originalListSubscriptions = accountService.listSubscriptions;
  const originalSummary = accountService.summary;
  const order = {
    orderId: 'order-username-only',
    generatedPasarguardUsername: 'customer_tunnel_123',
    planName: 'اشتراک آزمایشی',
    serviceName: 'Tunnel 2',
  };

  accountService.listSubscriptions = async () => [order];
  accountService.summary = () => ({
    id: order.orderId,
    title: '📦 اشتراک آزمایشی — Tunnel 2',
    status: '✅ فعال',
  });

  try {
    const [subscription] = await accountUI.listForUser(12345);
    assert.equal(subscription.title, 'customer_tunnel_123');
    assert.doesNotMatch(subscription.title, /Tunnel|اشتراک|📦|🧪/);
  } finally {
    accountService.listSubscriptions = originalListSubscriptions;
    accountService.summary = originalSummary;
  }
});

test('account list falls back to the stored subscription name when no username exists', async () => {
  const originalListSubscriptions = accountService.listSubscriptions;
  const originalSummary = accountService.summary;
  const order = {
    orderId: 'order-legacy-no-username',
    planName: 'اشتراک آزمایشی',
  };

  accountService.listSubscriptions = async () => [order];
  accountService.summary = () => ({ id: order.orderId, title: 'old title' });

  try {
    const [subscription] = await accountUI.listForUser(12345);
    assert.equal(subscription.title, 'اشتراک آزمایشی');
  } finally {
    accountService.listSubscriptions = originalListSubscriptions;
    accountService.summary = originalSummary;
  }
});

test('account list rows provide username, quick-renew, and remove actions on one row', () => {
  const rows = accountUI.subscriptionKeyboard([{ id: 'order-1', title: 'customer_name' }]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].map((button) => button.text), ['customer_name', '🔁', '❌']);
  assert.deepEqual(rows[0].map((button) => button.callback_data), [
    'account_sub:order-1',
    'account_renew:order-1',
    'account_remove:order-1',
  ]);
});

test('remove confirmation offers confirm and cancel actions', () => {
  const rows = accountUI.removeConfirmationKeyboard('order-1');
  assert.equal(rows[0][0].callback_data, 'account_remove_confirm:order-1');
  assert.equal(rows[1][0].callback_data, 'account_list');
});
