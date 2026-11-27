const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createPanelRegistry } = require('../lib/panel-registry');
const { testPanelConnection } = require('../lib/panel-connection');
const { createArtiqMasterProvider } = require('../lib/artiq-master-panel');

const key = crypto.randomBytes(32);

test('panel-registry accepts artiq_master with Bearer token credentials', async () => {
  let stored = null;
  const registry = createPanelRegistry({
    get: async () => stored,
    set: async (_k, v) => { stored = structuredClone(v); return 'OK'; },
    encryptionKey: key,
  });

  const saved = await registry.save({
    name: 'Smart Panel 1',
    type: 'artiq_master',
    baseUrl: 'https://mirza.example.com/api/bot/mirza/',
    credentials: { token: 'bot-secret-token', panelId: 'p99' },
  });
  assert.equal(saved.type, 'artiq_master');
  assert.equal(saved.baseUrl, 'https://mirza.example.com/api/bot/mirza');
  assert.deepEqual(await registry.getCredentials(saved.id), { token: 'bot-secret-token', panelId: 'p99' });
});

test('testPanelConnection tests artiq_master list_panel endpoint with Bearer auth', async () => {
  let seenAuth = '';
  let seenUrl = '';
  const result = await testPanelConnection({
    name: 'Smart Panel',
    type: 'artiq_master',
    baseUrl: 'https://mirza.example.com',
    credentials: { token: 'tok-123' },
  }, {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (url, init) => {
      seenUrl = String(url);
      seenAuth = init.headers.Authorization;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: true, obj: [{ id: '1', name_panel: 'Main (حجمی)' }], msg: 'successful' }),
      };
    },
  });

  assert.equal(seenUrl, 'https://mirza.example.com/api/bot/mirza?actions=list_panel');
  assert.equal(seenAuth, 'Bearer tok-123');
  assert.equal(result.ok, true);
  assert.equal(result.groupCount, 1);
});

test('artiq-master-panel provider handles create, test, get, extend, and delete', async () => {
  const calls = [];
  const provider = createArtiqMasterProvider('am1', {
    getPanel: async () => ({ id: 'am1', type: 'artiq_master', baseUrl: 'https://mirza.example.com' }),
    getCredentials: async () => ({ token: 'tok-xyz', panelId: 'node-1' }),
    checkUrl: async () => {},
    fetchImpl: async (url, init) => {
      const method = init.method || 'GET';
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), method, body, auth: init.headers.Authorization });

      if (method === 'GET' && String(url).includes('actions=get_user_data')) {
        if (String(url).includes('missing_user')) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ status: false, msg: 'User not found' }) };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            status: true,
            obj: {
              user: {
                status: 'active',
                username: 'ng_alloc_1',
                data_limit: 10 * 1024 ** 3,
                expire: 1800000000,
                used_traffic: 0,
                subscription_url: '/sub/abc',
                uuid: 'ng_alloc_1',
              },
            },
          }),
        };
      }
      if (method === 'POST' && body.actions === 'user_create') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: true, obj: { username: 'ng_alloc_1', subscription_url: 'https://mirza.example.com/sub/abc', links: [] } }),
        };
      }
      if (method === 'POST' && body.actions === 'user_test') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ status: true, obj: { username: 'ng_test_1', subscription_url: 'https://mirza.example.com/sub/test', links: [] } }),
        };
      }
      if (method === 'PUT' && body.actions === 'extend_service') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: true, obj: {} }) };
      }
      if (method === 'DELETE' && body.actions === 'user_delete') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: true, obj: { username: 'ng_alloc_1' } }) };
      }
      throw new Error(`Unexpected call: ${method} ${url}`);
    },
  });

  assert.equal(await provider.findUserByUsername('missing_user'), null);

  const created = await provider.createUser({ username: 'TG_ali_1234', trafficBytes: 10 * 1024 ** 3, durationDays: 30 });
  assert.equal(created.username, 'ng_alloc_1');
  assert.equal(calls.find((c) => c.body?.actions === 'user_create').body.panel_id, 'node-1');
  assert.equal(calls.find((c) => c.body?.actions === 'user_create').body.data_limit_gb, 10);

  const testUser = await provider.createUser({ username: 'TG_test_1234', isTest: true });
  assert.equal(testUser.username, 'ng_test_1');

  const renewed = await provider.updateUserById('ng_alloc_1', { status: 'active' }, { addedTrafficBytes: 5 * 1024 ** 3, addedDurationDays: 15 });
  assert.equal(renewed.subscription_url, 'https://mirza.example.com/sub/abc');
  const extendCall = calls.find((c) => c.body?.actions === 'extend_service');
  assert.equal(extendCall.body.data_limit_gb, 5);
  assert.equal(extendCall.body.time_day, 15);

  const deleted = await provider.deleteUserById('ng_alloc_1');
  assert.equal(deleted.username, 'ng_alloc_1');
});

test('public/panels-cms.js includes ArtiqMasterپنل هوشمند option and parses cleanly', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public/panels-cms.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'public/panels-cms.js' }));
  assert.ok(src.includes('artiq_master'));
  assert.ok(src.includes('ArtiqMasterپنل هوشمند'));
});
