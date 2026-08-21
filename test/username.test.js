const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSubscriptionName, buildSubscriptionUsername, isBotUsername } = require('../lib/username');

test('telegram username gets TG_ prefix and random 4-char suffix', () => {
  const r = buildSubscriptionUsername({ telegramUsername: 'Ali123' });
  assert.equal(r.ok, true);
  assert.match(r.username, /^TG_Ali123_[A-Za-z0-9]{4}$/);
});

test('custom name gets TG_ prefix', () => {
  const r = buildSubscriptionUsername({ customName: 'MyShop' });
  assert.equal(r.username.startsWith('TG_MyShop_'), true);
  assert.match(r.username, /^TG_MyShop_[A-Za-z0-9]{4}$/);
});

test('no telegram username uses fixed AtiqVPN attribution without _@', () => {
  const r = buildSubscriptionUsername({});
  assert.match(r.username, /^TG@AtiqVPN_[A-Za-z0-9]{4}$/);
  assert.equal(r.username.includes('_@'), false);
});

test('invalid Persian name is rejected', () => assert.equal(normalizeSubscriptionName('فروشگاه من').ok, false));
test('spaces are rejected', () => assert.equal(normalizeSubscriptionName('My Shop').ok, false));
test('unsupported punctuation is rejected', () => assert.equal(normalizeSubscriptionName('My.Shop').ok, false));
test('TG_ is reserved', () => assert.equal(normalizeSubscriptionName('TG_Test').reason, 'reserved_prefix'));
test('empty input is rejected', () => assert.equal(normalizeSubscriptionName('   ').reason, 'empty'));
test('bot usernames are identifiable', () => { assert.equal(isBotUsername('TG_Ali_X7k2'), true); assert.equal(isBotUsername('TG@AtiqVPN_X7k2'), true); });
test('generated usernames use no spaces or unicode', () => { for (let i=0;i<100;i++){ const r=buildSubscriptionUsername({customName:'My_Shop@1'}); assert.match(r.username,/^[A-Za-z0-9_@]+$/); assert.equal(/\s/.test(r.username),false); } });
