const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSubscriptionName, buildUsername } = require('../lib/username');

test('telegram username is used directly without prefix or suffix', () => {
  const value = buildUsername({ telegramUsername: '@Ali123', telegramUserId: 987654321 });
  assert.equal(value, 'Ali123');
});

test('custom username is used directly without prefix or suffix', () => {
  const value = buildUsername({ customName: 'MyShop', telegramUserId: 987654321 });
  assert.equal(value, 'MyShop');
});

test('missing telegram username falls back to numeric telegramUserId', () => {
  const value = buildUsername({ telegramUserId: 987654321 });
  assert.equal(value, '987654321');
});

test('collisionRetry adds random suffix only when needed', () => {
  const value = buildUsername({ telegramUsername: '@Ali123', collisionRetry: true });
  assert.match(value, /^Ali123_[A-Za-z0-9]{4}$/);
});

test('TG_ prefix in custom input is preserved without formatting', () => {
  const value = buildUsername({ customName: 'TG_Test' });
  assert.equal(value, 'TG_Test');
});

test('invalid Persian input is rejected', () => {
  assert.throws(() => normalizeSubscriptionName('فروشگاه'), /USERNAME_ENGLISH_ONLY/);
});

test('spaces and unsafe symbols are rejected', () => {
  assert.throws(() => normalizeSubscriptionName('My Shop'), /USERNAME_NO_SPACES/);
  assert.throws(() => normalizeSubscriptionName('my.shop'), /USERNAME_INVALID_CHARACTERS/);
});

test('empty and meaningless names are rejected', () => {
  assert.equal(normalizeSubscriptionName(''), null);
  assert.throws(() => normalizeSubscriptionName('@@@'), /USERNAME_TOO_GENERIC/);
  assert.throws(() => normalizeSubscriptionName('___'), /USERNAME_TOO_GENERIC/);
});
