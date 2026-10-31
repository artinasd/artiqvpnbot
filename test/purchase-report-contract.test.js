const test = require('node:test');
const assert = require('node:assert/strict');
const { isReportablePaidDelivery } = require('../lib/purchase-report-contract');

function paidDeliveredOrder(overrides = {}) {
  return {
    orderId: 'TG-20261031-ABCD',
    orderType: 'subscription',
    planId: 'plan-1',
    price: 10000,
    walletCharged: true,
    walletChargedAmount: 10000,
    paymentStatus: 'WALLET_PAID',
    fulfillmentStatus: 'FULFILLED',
    deliveryStatus: 'DELIVERED',
    ...overrides,
  };
}

test('reports a paid subscription only after Telegram delivery is recorded', () => {
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder()), true);
});

test('reports a successfully delivered wallet-paid renewal', () => {
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ renewal: true })), true);
});

test('does not report an order that is provisioned but awaiting delivery', () => {
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ deliveryStatus: 'PENDING' })), false);
});

test('does not report an order whose Telegram delivery failed', () => {
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ deliveryStatus: 'FAILED' })), false);
});

test('does not report unpaid, refunded, or uncharged orders', () => {
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ paymentStatus: 'PENDING' })), false);
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ paymentStatus: 'WALLET_REFUNDED' })), false);
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ walletCharged: false })), false);
});

test('does not report test purchases or wallet top-ups', () => {
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ planId: 'test' })), false);
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ orderType: 'test' })), false);
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ orderType: 'wallet_topup' })), false);
});

test('does not report invalid or zero-value amounts', () => {
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ walletChargedAmount: 0, price: 0 })), false);
  assert.equal(isReportablePaidDelivery(paidDeliveredOrder({ walletChargedAmount: 'not-a-number' })), false);
});

test('does not treat fulfillment status alone as a successful purchase', () => {
  assert.equal(isReportablePaidDelivery({
    fulfillmentStatus: 'FULFILLED',
    paymentStatus: 'WALLET_PAID',
  }), false);
});

test('rejects missing and malformed orders safely', () => {
  assert.equal(isReportablePaidDelivery(null), false);
  assert.equal(isReportablePaidDelivery(undefined), false);
  assert.equal(isReportablePaidDelivery('order'), false);
});
