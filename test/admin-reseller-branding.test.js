const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_CMS_PASSWORD = 'branding-test-password';
const storage = require('../lib/storage');
const handler = require('../api/admin-resellers');

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    end(body) { this.body = JSON.parse(body); return this; },
  };
}
async function post(body, password = 'branding-test-password') {
  const res = response();
  await handler({ method: 'POST', headers: password ? { 'x-admin-password': password } : {}, body }, res);
  return res;
}

test('reseller branding requires CMS admin authorization and a registered reseller', async () => {
  const ordinaryId = '880000001';
  const resellerId = '880000002';
  await storage.saveUser({ telegramUserId: ordinaryId, isReseller: false });
  await storage.saveUser({ telegramUserId: resellerId, isReseller: true });

  const unauthorized = await post({ action: 'set-brand', telegramId: resellerId, brandName: 'Brand X' }, '');
  assert.equal(unauthorized.statusCode, 401);

  const ordinary = await post({ action: 'set-brand', telegramId: ordinaryId, brandName: 'Brand X' });
  assert.equal(ordinary.statusCode, 403);
  assert.equal((await storage.getUserRaw(ordinaryId)).brandName, undefined);

  const assigned = await post({ action: 'set-brand', telegramId: resellerId, brandName: 'Brand X' });
  assert.equal(assigned.statusCode, 200);
  assert.equal(assigned.body.complete, true);
  assert.equal((await storage.getUserRaw(resellerId)).brandName, 'Brand X');
  assert.equal(assigned.body.sync.brandName, 'Brand X');
});

test('reseller brand synchronization reports failures and retries against owned Master orders', async (t) => {
  const id = '880000003';
  const oldFetch = global.fetch;
  const oldSecret = process.env.MASTER_PANEL_API_SECRET;
  t.after(() => {
    global.fetch = oldFetch;
    if (oldSecret === undefined) delete process.env.MASTER_PANEL_API_SECRET;
    else process.env.MASTER_PANEL_API_SECRET = oldSecret;
  });
  process.env.MASTER_PANEL_API_SECRET = 'master-test-secret';
  await storage.saveUser({ telegramUserId: id, isReseller: true, brandName: null });
  await storage.createOrder({
    orderId: 'brand_sync_order_1', telegramUserId: id, fulfillmentStatus: 'FULFILLED',
    masterPanelId: 'master-panel-1', masterSubscriptionUrl: 'https://master.example/sub/owned',
    generatedPasarguardUsername: 'owned_user', expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  let shouldFail = true;
  let sent;
  global.fetch = async (url, options) => {
    sent = JSON.parse(options.body);
    return shouldFail
      ? { ok: false, status: 503, json: async () => ({ error: { code: 'UPSTREAM_DOWN' } }) }
      : { ok: true, status: 200, json: async () => ({ success: true }) };
  };

  const first = await post({ action: 'set-brand', telegramId: id, brandName: 'Retry Brand' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.complete, false);
  assert.equal(first.body.sync.failed.length, 1);
  assert.equal(sent.username, 'owned_user');
  assert.equal(sent.telegram_user_id, id);
  assert.equal(sent.brand_name, 'Retry Brand');

  shouldFail = false;
  const retry = await post({ action: 'retry-brand-sync', telegramId: id });
  assert.equal(retry.body.complete, true);
  assert.equal(retry.body.sync.synced, 1);
});


test('custom reseller rates are generated from active configured purchase services', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const apiSource = fs.readFileSync(path.join(__dirname, '../api/admin-resellers.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(__dirname, '../public/reseller-cms.js'), 'utf8');
  assert.ok(apiSource.includes("getConfiguredServicesWithPanels(config)"));
  assert.ok(apiSource.includes("UNKNOWN_CUSTOM_RESELLER_RATE_SERVICE"));
  assert.ok(apiSource.includes("services,brandSync"));
  assert.ok(uiSource.includes("renderCustomRates(d.customResellerRates||{},d.services||[])"));
  assert.ok(uiSource.includes("input.dataset.serviceId=service.id"));
  assert.ok(uiSource.includes("rates[input.dataset.serviceId]=input.value.trim()"));
  for (const legacyId of ['customRateTunnel', 'customRateGaming', 'customRateTunnel2', 'customRateDirect2']) {
    assert.ok(!uiSource.includes(legacyId), 'legacy hardcoded field should be removed: ' + legacyId);
  }
});
