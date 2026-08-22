const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSubscriptionName, buildUsername, isBotUsername } = require('../lib/username');

function assertAllowed(value) {
  assert.match(value, /^(?:TG_|TG@)[A-Za-z0-9_@]+_[A-Za-z0-9]{4}$/);
  assert.doesNotMatch(value, /[\s\u0600-\u06FF\u{1F300}-\u{1FAFF}]/u);
}

test('telegram username', () => {
  const value = buildUsername({ telegramUsername: '@Ali123' });
  assert.match(value, /^TG_Ali123_[A-Za-z0-9]{4}$/);
  assertAllowed(value);
});

test('custom username', () => {
  const value = buildUsername({ customName: 'MyShop' });
  assert.match(value, /^TG_MyShop_[A-Za-z0-9]{4}$/);
  assertAllowed(value);
});

test('fallback attribution avoids underscore before @', () => {
  const value = buildUsername({});
  assert.match(value, /^TG@AtiqVPN_[A-Za-z0-9]{4}$/);
  assertAllowed(value);
  assert.equal(isBotUsername(value), true);
});

test('reserved TG prefix is not duplicated', () => {
  const value = buildUsername({ customName: 'TG_Test' });
  assert.match(value, /^TG_Test_[A-Za-z0-9]{4}$/);
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
  assert.throws(() => normalizeSubscriptionName('TG_'), /USERNAME_TOO_GENERIC/);
  assert.throws(() => normalizeSubscriptionName('___'), /USERNAME_TOO_GENERIC/);
});
