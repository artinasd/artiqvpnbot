const test = require('node:test');
const assert = require('node:assert/strict');
const { validMasterUrl, postMaster } = require('../lib/master-panel-fulfillment');

test('master URL validation accepts HTTPS only', () => {
  assert.equal(validMasterUrl('https://sub.example.com/link'), 'https://sub.example.com/link');
  assert.equal(validMasterUrl('http://sub.example.com/link'), null);
  assert.equal(validMasterUrl('not a URL'), null);
});

test('master API posts the documented payload with bearer auth and validates response', async (t) => {
  const oldFetch = global.fetch;
  const oldSecret = process.env.MASTER_PANEL_API_SECRET;
  t.after(() => {
    global.fetch = oldFetch;
    if (oldSecret === undefined) delete process.env.MASTER_PANEL_API_SECRET;
    else process.env.MASTER_PANEL_API_SECRET = oldSecret;
  });
  process.env.MASTER_PANEL_API_SECRET = 'test-secret';
  let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ success: true, master_url: 'https://master.example.com/sub/abc' }) };
  };
  const url = await postMaster({
    username: 'user_10482', panelAUrl: 'https://a.example/sub/a',
    panelBUrl: 'https://b.example/sub/b', quotaBytes: 100 * (1024 ** 3), durationDays: 30,
  });
  assert.equal(url, 'https://master.example.com/sub/abc');
  assert.equal(request.url, 'https://artiq-network.vercel.app/api/bot/subscriptions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret');
  assert.deepEqual(request.body, {
    username: 'user_10482', panel_a_url: 'https://a.example/sub/a',
    panel_b_url: 'https://b.example/sub/b', quota_gb: 100, duration_days: 30,
  });
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true, master_url: 'http://unsafe.example/sub' }) });
  await assert.rejects(postMaster({
    username: 'user_10482', panelAUrl: 'https://a.example/sub/a',
    panelBUrl: 'https://b.example/sub/b', quotaBytes: 1, durationDays: 1,
  }), /MASTER_API_INVALID_URL/);
});
