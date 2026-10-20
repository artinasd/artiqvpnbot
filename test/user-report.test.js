const test = require('node:test');
const assert = require('node:assert/strict');
const { recordFirstStart, formatJalaliDateTime, gregorianTehranDateKey } = require('../lib/user-report');

function createStorage() {
  const users = new Map();
  const sets = new Map();
  const values = new Map();
  return {
    users,
    sets,
    async getUserRaw(id) { return users.get(String(id)) || null; },
    async set(key, value, options = {}) {
      if (options.nx && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async saveUser(user) {
      users.set(String(user.telegramUserId), user);
      if (!sets.has('bot_users')) sets.set('bot_users', new Set());
      sets.get('bot_users').add(String(user.telegramUserId));
      return user;
    },
    async sadd(key, member) {
      if (!sets.has(key)) sets.set(key, new Set());
      const target = sets.get(key);
      const before = target.size;
      target.add(String(member));
      return target.size === before ? 0 : 1;
    },
    async smembers(key) { return Array.from(sets.get(key) || []); },
  };
}

test('reports a first-time user with profile, counts, and Jalali timestamp', async () => {
  const storage = createStorage();
  const report = await recordFirstStart(storage, {
    id: 1707502454,
    first_name: 'asd',
    username: 'i_artin',
    language_code: 'en',
  }, new Date('2026-10-20T15:20:00+03:30'));

  assert.match(report, /کاربر تازه وارد شد/);
  assert.match(report, /1707502454/);
  assert.match(report, /@i_artin/);
  assert.match(report, /زبان تلگرام: en/);
  assert.match(report, /امروز: ۱/);
  assert.match(report, /مجموع کاربران: ۱/);
  assert.match(report, /۱۴۰۵\/۰۷\/۲۸/);
});

test('does not report or count a user already saved in Redis', async () => {
  const storage = createStorage();
  await storage.saveUser({ telegramUserId: 42, firstName: 'Existing' });
  const report = await recordFirstStart(storage, { id: 42, first_name: 'Existing' });
  assert.equal(report, null);
  assert.equal((await storage.smembers('bot_users')).length, 1);
});

test('escapes user-controlled fields before sending HTML', async () => {
  const storage = createStorage();
  const report = await recordFirstStart(storage, {
    id: 7,
    first_name: '<b>hello</b>',
    username: 'a&b',
  }, new Date('2026-10-20T12:00:00Z'));
  assert.match(report, /&lt;b&gt;hello&lt;\/b&gt;/);
  assert.match(report, /@a&amp;b/);
});

test('uses Tehran local day for daily counters', () => {
  assert.equal(gregorianTehranDateKey(new Date('2026-10-20T00:00:00Z')), '2026-10-20');
  assert.match(formatJalaliDateTime(new Date('2026-10-20T15:20:00+03:30')), /۱۴۰۵\/۰۷\/۲۸/);
});
