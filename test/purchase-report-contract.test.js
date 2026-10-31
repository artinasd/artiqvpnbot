const test = require('node:test');
const assert = require('node:assert/strict');
const { isReportablePaidDelivery } = require('../lib/purchase-report-contract');

function order(overrides = {}) {
  return { orderId: 'order-1', orderType: 'subscription', planId: 'plan-1', price: 10000, walletCharged: true, walletChargedAmount: 10000, paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'FULFILLED', deliveryStatus: 'DELIVERED', ...overrides };
}

test('paid and delivered subscription qualifies', () => assert.equal(isReportablePaidDelivery(order()), true));
test('paid and delivered renewal qualifies', () => assert.equal(isReportablePaidDelivery(order({ renewal: true })), true));
test('pending or failed customer delivery does not qualify', () => {
  assert.equal(isReportablePaidDelivery(order({ deliveryStatus: 'PENDING' })), false);
  assert.equal(isReportablePaidDelivery(order({ deliveryStatus: 'FAILED' })), false);
});
test('unpaid, refunded, or uncharged orders do not qualify', () => {
  assert.equal(isReportablePaidDelivery(order({ paymentStatus: 'PENDING' })), false);
  assert.equal(isReportablePaidDelivery(order({ paymentStatus: 'WALLET_REFUNDED' })), false);
  assert.equal(isReportablePaidDelivery(order({ walletCharged: false })), false);
});
test('test purchases and wallet top-ups do not qualify', () => {
  assert.equal(isReportablePaidDelivery(order({ planId: 'test' })), false);
  assert.equal(isReportablePaidDelivery(order({ orderType: 'test' })), false);
  assert.equal(isReportablePaidDelivery(order({ orderType: 'wallet_topup' })), false);
});
test('invalid and zero amounts do not qualify', () => {
  assert.equal(isReportablePaidDelivery(order({ walletChargedAmount: 0, price: 0 })), false);
  assert.equal(isReportablePaidDelivery(order({ walletChargedAmount: 'bad' })), false);
});
test('FULFILLED alone is not sufficient', () => assert.equal(isReportablePaidDelivery({ fulfillmentStatus: 'FULFILLED', paymentStatus: 'WALLET_PAID' }), false));
test('malformed input safely returns false', () => {
  assert.equal(isReportablePaidDelivery(null), false);
  assert.equal(isReportablePaidDelivery(undefined), false);
  assert.equal(isReportablePaidDelivery('order'), false);
});
