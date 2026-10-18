const test = require('node:test');
const assert = require('node:assert/strict');

const accountService = require('../lib/account-service');
const accountUI = require('../lib/account-ui');

test('account list titles show only the subscription name', async () => {
  const originalListSubscriptions = accountService.listSubscriptions;
  const originalSummary = accountService.summary;
  const order = {
    orderId: 'order-name-only',
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
    assert.equal(subscription.title, 'اشتراک آزمایشی');
    assert.doesNotMatch(subscription.title, /Tunnel|📦|🧪/);
  } finally {
    accountService.listSubscriptions = originalListSubscriptions;
    accountService.summary = originalSummary;
  }
});
