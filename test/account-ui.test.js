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

test('account list rows provide username, quick-renew, and remove actions on one row plus a home button', () => {
  const rows = accountUI.subscriptionKeyboard([{ id: 'order-1', title: 'customer_name' }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].map((button) => button.text), ['customer_name']);
  assert.deepEqual(rows[0].map((button) => button.callback_data), ['account_sub:order-1']);
  assert.deepEqual(rows[1].map((button) => button.text), ['🔁', '❌']);
  assert.deepEqual(rows[1].map((button) => button.callback_data), ['account_renew:order-1', 'account_remove:order-1']);
  assert.deepEqual(rows[2], [{ text: '🏠 منوی اصلی', callback_data: 'main_home', style: 'primary' }]);
});

test('account list keyboard omits disabled renew and remove actions at source', () => {
  const rows = accountUI.subscriptionKeyboard(
    [{ id: 'order-1', title: 'customer_name' }],
    { buttonControls: {
      subscription_renew: { enabled: false },
      subscription_remove: { enabled: false },
    } }
  );
  assert.deepEqual(rows[0].map((button) => button.callback_data), ['account_sub:order-1']);
  assert.equal(rows.flat().some((button) => button.callback_data?.startsWith('account_renew:')), false);
  assert.equal(rows.flat().some((button) => button.callback_data?.startsWith('account_remove:')), false);
});

test('account list always keeps subscription detail action when published controls disable it', () => {
  const rows = accountUI.subscriptionKeyboard(
    [{ id: 'order-1', title: 'customer_name' }],
    { buttonControls: {
      subscription_detail: { enabled: false },
      subscription_renew: { enabled: false },
      subscription_remove: { enabled: false },
    } }
  );
  assert.deepEqual(rows[0].map((button) => button.callback_data), ['account_sub:order-1']);
});

test('remove confirmation offers confirm and cancel actions', () => {
  const rows = accountUI.removeConfirmationKeyboard('order-1');
  assert.equal(rows[0][0].callback_data, 'account_remove_confirm:order-1');
  assert.equal(rows[1][0].callback_data, 'account_list');
});

test('account list keyboard paginates without exceeding Telegram button limits', () => {
  const subscriptions = Array.from({ length: 8 }, (_, i) => ({ id: `order-${i}`, title: `user_${i}` }));
  const rows = accountUI.subscriptionKeyboard(subscriptions, { homeButton: true, pagination: { page: 0, totalPages: 3 } });
  assert.equal(rows.length, 25);
  assert.equal(rows.flat().length, 33);
  assert.ok(rows.flat().length < 100);
  assert.equal(rows[0].length, 1);
  assert.equal(rows[1].length, 2);
  assert.deepEqual(rows[2].map((button) => button.callback_data), ['account_divider']);
  assert.equal(rows[rows.length - 3][0].callback_data, 'account_remove:order-7');
  assert.deepEqual(rows[rows.length - 2].map((button) => button.callback_data), ['account_page:1']);
  assert.equal(rows.at(-1)[0].callback_data, 'main_home');
  const lastPage = accountUI.subscriptionKeyboard([{ id: 'last', title: 'last_user' }], { pagination: { page: 2, totalPages: 3 } });
  assert.deepEqual(lastPage[lastPage.length - 2].map((button) => button.callback_data), ['account_page:1']);
});
