const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../lib/storage');

test('purchase report event creation is idempotent and indexes pending event', async () => {
  const eventId = `test-event-${Date.now()}-${Math.random()}`;
  const event = { eventId, orderId: eventId, recipients: { admin: { status: 'PENDING' } } };
  const created = await storage.createPurchaseReportEvent(event);
  const duplicate = await storage.createPurchaseReportEvent({ ...event, marker: 'duplicate' });
  assert.equal(created, true);
  assert.equal(duplicate, false);
  assert.deepEqual(await storage.getPurchaseReportEvent(eventId), event);
  const pending = await storage.listPendingPurchaseReportEvents(100);
  assert.ok(pending.some((item) => item.eventId === eventId));
});

test('purchase report recipient completion removes the event from pending index', async () => {
  const eventId = `test-complete-${Date.now()}-${Math.random()}`;
  await storage.createPurchaseReportEvent({
    eventId,
    orderId: eventId,
    recipients: { admin: { status: 'PENDING' }, reseller: { status: 'PENDING' } },
  });
  await storage.updatePurchaseReportEvent(eventId, {
    recipients: { admin: { status: 'SENT' }, reseller: { status: 'SKIPPED' } },
  });
  const pending = await storage.listPendingPurchaseReportEvents(100);
  assert.equal(pending.some((item) => item.eventId === eventId), false);
});

test('retry events are hidden until their next-attempt time', async () => {
  const eventId = `test-due-${Date.now()}-${Math.random()}`;
  const base = Date.now();
  await storage.createPurchaseReportEvent({
    eventId,
    orderId: eventId,
    recipients: { admin: { status: 'PENDING', attempts: 1 } },
  });
  await storage.updatePurchaseReportEvent(eventId, {
    recipients: { admin: { status: 'PENDING', attempts: 1, nextAttemptAt: new Date(base + 60000).toISOString() } },
  });
  assert.equal((await storage.listPendingPurchaseReportEvents(100, base + 30000)).some((item) => item.eventId === eventId), false);
  assert.equal((await storage.listPendingPurchaseReportEvents(100, base + 90000)).some((item) => item.eventId === eventId), true);
});
