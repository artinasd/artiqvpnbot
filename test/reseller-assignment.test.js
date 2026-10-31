const test = require('node:test');
const assert = require('node:assert/strict');
const { assignCustomerToReseller, unassignCustomerReseller } = require('../lib/reseller-assignment');

function fakeStorage() {
  const users = new Map([
    ['123456', { telegramUserId: 123456, firstName: 'Customer' }],
    ['654321', { telegramUserId: 654321, isReseller: true }],
  ]);
  return {
    users,
    async getUserRaw(id) { return users.get(String(id)) || null; },
    async saveUser(user) { users.set(String(user.telegramUserId), user); return user; },
  };
}

test('assigns an existing customer to a verified reseller', async () => {
  const storage = fakeStorage();
  const result = await assignCustomerToReseller(storage, '123456', '654321');
  assert.equal(result.customer.assignedResellerTelegramId, '654321');
});

test('accepts a reseller explicitly listed in bot config', async () => {
  const storage = fakeStorage();
  storage.users.set('777777', { telegramUserId: 777777 });
  const result = await assignCustomerToReseller(storage, '123456', '777777', { resellerTelegramIds: ['777777'] });
  assert.equal(result.resellerTelegramId, '777777');
});

test('rejects invalid IDs, missing customers, and non-reseller targets', async () => {
  const storage = fakeStorage();
  await assert.rejects(assignCustomerToReseller(storage, '12', '654321'), /INVALID_RESELLER_ASSIGNMENT/);
  await assert.rejects(assignCustomerToReseller(storage, '999999', '654321'), /CUSTOMER_NOT_FOUND/);
  await assert.rejects(assignCustomerToReseller(storage, '123456', '123456'), /INVALID_RESELLER_ASSIGNMENT/);
  await assert.rejects(assignCustomerToReseller(storage, '123456', '123457'), /TARGET_IS_NOT_A_RESELLER/);
});

test('unassigns a customer and returns the previous reseller ID', async () => {
  const storage = fakeStorage();
  await assignCustomerToReseller(storage, '123456', '654321');
  const result = await unassignCustomerReseller(storage, '123456');
  assert.equal(result.previousResellerTelegramId, '654321');
  assert.equal(result.customer.assignedResellerTelegramId, null);
});
