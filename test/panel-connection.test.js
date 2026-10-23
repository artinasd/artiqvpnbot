const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress, assertPublicHttpsUrl, testPasarGuardConnection } = require('../lib/panel-connection');

test('public-address guard rejects private and special-use IP ranges', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '172.20.1.1', '192.168.1.5', '169.254.10.2', '::1', 'fc00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('DNS guard rejects a hostname resolving to a private address', async () => {
  await assert.rejects(
    assertPublicHttpsUrl('https://panel.example.com', async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.2', family: 4 }]),
    /PANEL_URL_HOST_NOT_ALLOWED/,
  );
});

test('connection test authenticates and performs only a read-only groups request', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method, redirect: options.redirect });
    if (String(url).endsWith('/api/admin/token')) {
      return new Response(JSON.stringify({ access_token: 'never-return-this' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await testPasarGuardConnection({
    name: 'Test panel', type: 'pasarguard', baseUrl: 'https://panel.example.com',
    credentials: { username: 'admin', password: 'secret' },
  }, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.groupCount, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET']);
  assert.ok(calls.every((call) => call.redirect === 'manual'));
});

test('connection test rejects redirects and failed authentication', async () => {
  await assert.rejects(testPasarGuardConnection({
    name: 'Test panel', type: 'pasarguard', baseUrl: 'https://panel.example.com',
    credentials: { username: 'admin', password: 'secret' },
  }, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }),
  }), /PANEL_REDIRECT_NOT_ALLOWED/);

  await assert.rejects(testPasarGuardConnection({
    name: 'Test panel', type: 'pasarguard', baseUrl: 'https://panel.example.com',
    credentials: { username: 'admin', password: 'secret' },
  }, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    fetchImpl: async () => new Response('{}', { status: 401 }),
  }), /PANEL_AUTHENTICATION_FAILED/);
});
