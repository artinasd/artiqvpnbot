const test = require('node:test');
const assert = require('node:assert/strict');
const { isResellerCustomer, createPurchaseReportEvent, formatPurchaseReport } = require('../lib/purchase-report');

const eligibleOrder = {
  orderId: 'order-42',
  orderType: 'subscription',
  planId: 'plan-42',
  planName: 'پلن ۱۰ گیگ',
  serviceName: 'پنل اصلی',
  telegramUserId: 123456,
  telegramUsername: 'customer',
  firstName: '<Ali>',
  lastName: 'Test',
  price: 250000,
  walletCharged: true,
  walletChargedAmount: 250000,
  paymentStatus: 'WALLET_PAID',
  fulfillmentStatus: 'FULFILLED',
  deliveryStatus: 'DELIVERED',
  createdAt: '2026-10-31T08:00:00.000Z',
};

test('recognizes reseller customers by their account flag or CMS reseller list', () => {
  assert.equal(isResellerCustomer({ telegramUserId: 123456, isReseller: true }, {}, 123456), true);
  assert.equal(isResellerCustomer({ telegramUserId: 123456 }, { resellerTelegramIds: ['123456'] }, 123456), true);
  assert.equal(isResellerCustomer({ telegramUserId: 123456 }, { resellerTelegramIds: [] }, 123456), false);
});

test('creates a stable report event with admin and optional reseller recipients', () => {
  const event = createPurchaseReportEvent(eligibleOrder, {
    adminTelegramId: '1000',
    resellerTelegramId: '2000',
    now: '2026-10-31T08:30:00.000Z',
  });
  assert.equal(event.eventId, 'purchase:order-42:v1');
  assert.equal(event.recipients.admin.chatId, '1000');
  assert.equal(event.recipients.reseller.chatId, '2000');
  assert.equal(event.customer.telegramId, '123456');
  assert.equal(event.payment.amount, 250000);
});

test('uses reseller attribution already snapshotted on the order by the CMS flow', () => {
  const event = createPurchaseReportEvent({ ...eligibleOrder, resellerTelegramId: '2000' }, { adminTelegramId: '1000' });
  assert.equal(event.resellerTelegramId, '2000');
  assert.equal(event.recipients.reseller.chatId, '2000');
});

test('does not route a reseller report to an unrelated stored reseller ID', () => {
  const event = createPurchaseReportEvent({ ...eligibleOrder, resellerTelegramId: '9999' }, {
    adminTelegramId: '1000',
    resellerTelegramId: null,
  });
  assert.equal(event.recipients.reseller, undefined);
});

test('does not create an event for undelivered orders', () => {
  assert.equal(createPurchaseReportEvent({ ...eligibleOrder, deliveryStatus: 'FAILED' }, { adminTelegramId: '1000' }), null);
});

test('requires a valid admin recipient and rejects malformed reseller IDs', () => {
  assert.throws(() => createPurchaseReportEvent(eligibleOrder, {}), /PURCHASE_REPORT_ADMIN_ID_REQUIRED/);
  const event = createPurchaseReportEvent(eligibleOrder, { adminTelegramId: '1000', resellerTelegramId: 'not-an-id' });
  assert.equal(event.recipients.reseller, undefined);
  assert.equal(event.resellerTelegramId, null);
});

test('formats report text and escapes customer-controlled HTML', () => {
  const event = createPurchaseReportEvent(eligibleOrder, { adminTelegramId: '1000' });
  const message = formatPurchaseReport(event);
  assert.match(message, /&lt;Ali&gt;/);
  assert.match(message, /@customer/);
  assert.match(message, /250,000/);
  assert.doesNotMatch(message, /<Ali>/);
});

test('labels renewals distinctly', () => {
  const event = createPurchaseReportEvent({ ...eligibleOrder, renewal: true }, { adminTelegramId: '1000' });
  assert.match(formatPurchaseReport(event), /تمدید موفق اشتراک/);
});
