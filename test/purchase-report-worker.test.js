process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';
const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../lib/storage');
const { enqueuePurchaseReport, processPendingPurchaseReports, requeueFailedPurchaseReports } = require('../lib/purchase-report');

function order(id) {
  return {
    orderId: id, orderType: 'subscription', planId: 'plan', planName: 'Plan',
    telegramUserId: 123, price: 5000, walletCharged: true, walletChargedAmount: 5000,
    paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'FULFILLED', deliveryStatus: 'DELIVERED',
  };
}

test('worker sends independently to admin and reseller then clears completed event', async () => {
  const id = `worker-success-${Date.now()}`;
  await enqueuePurchaseReport(order(id), { adminTelegramId: '1001', resellerTelegramId: '2002' });
  const sent = [];
  const result = await processPendingPurchaseReports({
    async sendMessage(chatId, message, options) { sent.push({ chatId, message, options }); return { message_id: sent.length }; },
  }, { limit: 100 });
  const event = await storage.getPurchaseReportEvent(`purchase:${id}:v1`);
  assert.equal(result.sent, 2);
  assert.deepEqual(sent.map((item) => item.chatId).sort(), ['1001', '2002']);
  assert.equal(event.recipients.admin.status, 'SENT');
  assert.equal(event.recipients.reseller.status, 'SENT');
  assert.equal((await storage.listPendingPurchaseReportEvents(100)).some((item) => item.eventId === event.eventId), false);
});

test('admin delivery failure does not block reseller delivery and is scheduled for retry', async () => {
  const id = `worker-isolation-${Date.now()}`;
  await enqueuePurchaseReport(order(id), { adminTelegramId: '3003', resellerTelegramId: '4004' });
  const sent = [];
  const workerNow = Date.now() + 1000;
  const result = await processPendingPurchaseReports({
    async sendMessage(chatId) {
      sent.push(String(chatId));
      if (String(chatId) === '3003') throw new Error('admin unavailable');
      return { message_id: 1 };
    },
  }, { limit: 100, now: new Date(workerNow).toISOString() });
  const event = await storage.getPurchaseReportEvent(`purchase:${id}:v1`);
  assert.equal(result.failed, 1);
  assert.equal(result.sent, 1);
  assert.deepEqual(sent.sort(), ['3003', '4004']);
  assert.equal(event.recipients.admin.status, 'PENDING');
  assert.equal(event.recipients.admin.attempts, 1);
  assert.equal(event.recipients.admin.nextAttemptAt, new Date(workerNow + 60000).toISOString());
  assert.equal(event.recipients.reseller.status, 'SENT');
});

test('worker rejects missing Telegram client', async () => {
  await assert.rejects(processPendingPurchaseReports(null), /TELEGRAM_CLIENT_REQUIRED/);
});

test('admin recovery requeues exhausted recipient deliveries', async () => {
  const id = `worker-requeue-${Date.now()}`;
  await enqueuePurchaseReport(order(id), { adminTelegramId: '5005' });
  await storage.updatePurchaseReportEvent(`purchase:${id}:v1`, {
    recipients: { admin: { chatId: '5005', status: 'FAILED_FINAL', attempts: 8, lastError: 'blocked' } },
  });
  const requeued = await requeueFailedPurchaseReports(100);
  const event = await storage.getPurchaseReportEvent(`purchase:${id}:v1`);
  assert.ok(requeued >= 1);
  assert.equal(event.recipients.admin.status, 'PENDING');
  assert.equal(event.recipients.admin.attempts, 0);
});
