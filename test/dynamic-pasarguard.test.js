const test = require('node:test');
const assert = require('node:assert/strict');
const { createDynamicPasarGuardProvider } = require('../lib/dynamic-pasarguard');

function setup(fetchImpl) {
  return createDynamicPasarGuardProvider('panel-test', {
    fetchImpl,
    getPanel: async () => ({ id: 'panel-test', baseUrl: 'https://panel.example.com/base', status: 'active' }),
    getCredentials: async () => ({ username: 'admin', password: 'not-logged' }),
    checkUrl: async () => {},
  });
}

test('dynamic provider authenticates and requests groups on the selected panel only', async () => {
  const calls = [];
  const provider = setup(async (url, options) => {
    calls.push({ url: String(url), method: options.method, headers: options.headers });
    if (String(url).endsWith('/api/admin/token')) {
      return new Response(JSON.stringify({ access_token: 'ephemeral-token' }), { status: 200 });
    }
    return new Response(JSON.stringify([{ id: 4 }, { id: 7 }]), { status: 200 });
  });
  const groups = await provider.getGroups();
  assert.equal(groups.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://panel.example.com/base/api/admin/token');
  assert.equal(calls[1].url, 'https://panel.example.com/base/api/groups/simple');
  assert.equal(calls[1].headers.Authorization, 'Bearer ephemeral-token');
  assert.ok(calls.every((call) => call.method === 'POST' || call.method === 'GET'));
});

test('dynamic provider normalizes relative subscription URLs and refuses missing panels', async () => {
  const provider = setup(async (url) => {
    if (String(url).endsWith('/api/admin/token')) return new Response(JSON.stringify({ access_token: 'ephemeral-token' }), { status: 200 });
    return new Response(JSON.stringify({ id: 12, username: 'customer', subscription_url: '/sub/abc' }), { status: 200 });
  });
  const user = await provider.getUserById(12);
  assert.equal(user.subscription_url, 'https://panel.example.com/sub/abc');

  const missing = createDynamicPasarGuardProvider('gone', {
    getPanel: async () => null,
    getCredentials: async () => null,
    checkUrl: async () => {},
    fetchImpl: async () => { throw new Error('must not fetch'); },
  });
  await assert.rejects(missing.getGroups(), /PANEL_NOT_FOUND/);
});
