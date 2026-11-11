process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const plans = require('../lib/plans');


test('api/index.js imports resolveCustomOrderPrice and passes Node syntax validation', () => {
  const apiPath = path.join(__dirname, '..', 'api', 'index.js');
  const source = fs.readFileSync(apiPath, 'utf8');
  const importLine = source.split('\\n').slice(0, 5).find((line) => (
    line.includes('resolveCustomOrderPrice') && line.includes("require('../lib/plans')")
  ));
  assert.ok(importLine, 'api/index.js must import resolveCustomOrderPrice from ../lib/plans');
  execFileSync(process.execPath, ['-c', apiPath], { stdio: 'pipe' });
});

test('configured resellers remain identified when daily test limits are disabled', () => {
  const script = `
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    process.env.TEST_LIMIT_ENABLED = 'false';
    const storage = require('./lib/storage');
    (async () => {
      const id = 'group2-configured-reseller';
      await storage.set('cms:bot-config', { resellerTelegramIds: [id] });
      await storage.saveUser({ telegramUserId: id, balance: 100 });
      const user = await storage.getUser(id);
      process.stdout.write(JSON.stringify({ reseller: user.reseller, testUsed: user.testUsed }));
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', TEST_LIMIT_ENABLED: 'false' },
  });
  assert.deepEqual(JSON.parse(output), { reseller: true, testUsed: false });
});

test('reseller custom traffic rate never exceeds ordinary volume-discounted rate', () => {
  assert.equal(plans.resolveCustomTrafficRate({
    isReseller: true, customRate: null, normalRate: 4000, discountedRate: 2500,
  }), 2500);
  assert.equal(plans.resolveCustomTrafficRate({
    isReseller: true, customRate: 3200, normalRate: 4000, discountedRate: 2500,
  }), 2500);
  assert.equal(plans.resolveCustomTrafficRate({
    isReseller: true, customRate: 1800, normalRate: 4000, discountedRate: 2500,
  }), 1800);
  assert.equal(plans.resolveCustomTrafficRate({
    isReseller: false, customRate: null, normalRate: 4000, discountedRate: 2500,
  }), 2500);
});


test('custom reseller order preserves the discounted price quoted before duration selection', () => {
  const customRate = 3200;
  const normalRate = 4000;
  const discountedRate = 2500;
  const effectiveRate = plans.resolveCustomTrafficRate({
    isReseller: true, customRate, normalRate, discountedRate,
  });
  const state = { traffic: 100, customRate, price: 100 * effectiveRate };
  const finalPlanPrice = plans.resolveCustomOrderPrice(state);

  assert.equal(state.price, 250000);
  assert.equal(finalPlanPrice, 250000);
  assert.notEqual(finalPlanPrice, 100 * customRate);
});

function loadWithMocks(relativePath, mocks) {
  const filename = require.resolve(relativePath);
  delete require.cache[filename];
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require(filename); }
  finally { Module._load = originalLoad; }
}

test('saving reseller price preserves a dynamic per-GB plan price of null', async () => {
  const plan = {
    id: 'dynamic-volume-plan', name: 'Dynamic volume', price: 40000,
    priceOverride: null, originalPrice: 40000, type: 'traffic', trafficBytes: 10 * 1024 ** 3,
  };
  let savedPlan;
  const planStore = {
    get: async (id) => { assert.equal(id, plan.id); return plan; },
    save: async (value) => { savedPlan = value; return value; },
  };
  const mocks = {
    '../lib/storage': { get: async () => null, set: async () => true, smembers: async () => [], getUserRaw: async () => null },
    '../lib/plan-store': planStore,
    '../lib/bot-config': { getConfig: async () => ({}), saveConfig: async (value) => value },
    '../lib/services': { getConfiguredServicesWithPanels: async () => [] },
  };
  const previousPassword = process.env.ADMIN_CMS_PASSWORD;
  process.env.ADMIN_CMS_PASSWORD = 'group2-test-password';
  try {
    const handler = loadWithMocks('../api/admin-resellers.js', mocks);
    const res = {
      statusCode: 200, headers: {}, body: null,
      status(code) { this.statusCode = code; return this; },
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { this.body = JSON.parse(body); return this; },
    };
    await handler({
      method: 'POST',
      headers: { 'x-admin-password': 'group2-test-password' },
      body: { action: 'set-price', planId: plan.id, resellerPrice: 19000 },
    }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(savedPlan.price, null);
    assert.equal(savedPlan.resellerPrice, 19000);
  } finally {
    delete require.cache[require.resolve('../api/admin-resellers.js')];
    if (previousPassword === undefined) delete process.env.ADMIN_CMS_PASSWORD;
    else process.env.ADMIN_CMS_PASSWORD = previousPassword;
  }
});
