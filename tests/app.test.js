const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSubscriptionName, makeUsername } = require('../lib/app');

test('telegram username generation uses TG_ and safe characters', () => {
  const u = makeUsername({ telegramUsername: 'Ali123' });
  assert.match(u, /^TG_Ali123_[A-Za-z0-9]{4}$/);
});

test('custom name is normalized and TG_ cannot be duplicated', () => {
  assert.deepEqual(normalizeSubscriptionName(' MyShop '), { ok: true, value: 'MyShop' });
  assert.deepEqual(normalizeSubscriptionName('TG_MyShop'), { ok: true, value: 'MyShop' });
});

test('unsafe names are rejected', () => {
  assert.equal(normalizeSubscriptionName('فروشگاه').ok, false);
  assert.equal(normalizeSubscriptionName('My Shop').ok, false);
  assert.equal(normalizeSubscriptionName('My-Shop').ok, false);
  assert.equal(normalizeSubscriptionName('😀').ok, false);
  assert.equal(normalizeSubscriptionName('My__Shop').ok, false);
  assert.equal(normalizeSubscriptionName('My_@Shop').ok, false);
});

test('no Telegram username uses the PasarGuard-compatible AtiqVPN fallback', () => {
  const u = makeUsername({});
  assert.match(u, /^TG@AtiqVPN_[A-Za-z0-9]{4}$/);
});

test('custom username cannot become an empty TG marker', () => {
  assert.equal(normalizeSubscriptionName('TG_').ok, false);
  assert.equal(normalizeSubscriptionName('@').ok, false);
});
