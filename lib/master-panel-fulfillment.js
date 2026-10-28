const registry = require('./panel-registry');
const masterRegistry = require('./master-panel-registry');
const { createDynamicPasarGuardProvider } = require('./dynamic-pasarguard');
const storage = require('./storage');

const API_URL = 'https://artiq-network.vercel.app/api/bot/subscriptions';

// Master Panel-only diagnostics. Never log credentials, usernames, subscription URLs,
// request bodies, or raw provider responses.
function diagnostic(event, fields = {}) {
  console.log(JSON.stringify({ scope: 'master-panel-fulfillment', event, at: new Date().toISOString(), ...fields }));
}
async function timedStage(stage, fields, operation) {
  const started = Date.now();
  diagnostic('stage_start', { stage, ...fields });
  try {
    const result = await operation();
    diagnostic('stage_success', { stage, duration_ms: Date.now() - started, ...fields });
    return result;
  } catch (error) {
    diagnostic('stage_failure', {
      stage, duration_ms: Date.now() - started, ...fields,
      error: String(error?.message || error).slice(0, 160),
      status: Number(error?.status) || undefined,
      operation: error?.operation ? String(error.operation).slice(0, 80) : undefined,
      error_name: error?.name ? String(error.name).slice(0, 60) : undefined,
    });
    throw error;
  }
}
function instrumentSourceProvider(provider, source) {
  const wrapped = {};
  for (const method of ['health', 'getGroups', 'findUserByUsername', 'createUser', 'getUserById', 'updateUserById', 'deleteUserById', 'disableUser']) {
    if (typeof provider[method] !== 'function') continue;
    wrapped[method] = (...args) => timedStage('source_panel.' + source + '.' + method, {}, () => provider[method](...args));
  }
  return wrapped;
}
function validMasterUrl(value) {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
}
function safeName(value, suffix) {
  const base = String(value || 'user').replace(/[^a-zA-Z0-9_@-]/g, '_').slice(0, 45) || 'user';
  return (base + '_' + suffix).slice(0, 64);
}
async function postMaster({ username, panelAUrl, panelBUrl, quotaBytes, durationDays }) {
  const secret = process.env.MASTER_PANEL_API_SECRET;
  if (!secret) throw new Error('MASTER_PANEL_API_SECRET_MISSING');
  const started = Date.now();
  diagnostic('master_api_request_start', { endpoint: '/api/bot/subscriptions' });
  let response;
  try {
    response = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      username, panel_a_url: panelAUrl, panel_b_url: panelBUrl,
      quota_gb: Number(quotaBytes || 0) === 0 ? 0 : Number((Number(quotaBytes) / (1024 ** 3)).toFixed(3)),
      duration_days: durationDays == null || durationDays === '' ? 0 : Number(durationDays),
    }),
    signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    diagnostic('master_api_request_failure', {
      endpoint: '/api/bot/subscriptions', duration_ms: Date.now() - started,
      error: String(error?.message || error).slice(0, 160),
      error_name: error?.name ? String(error.name).slice(0, 60) : undefined,
    });
    throw error;
  }
  diagnostic('master_api_response', {
    endpoint: '/api/bot/subscriptions', duration_ms: Date.now() - started,
    status: response.status, ok: response.ok,
  });
  const data = await response.json().catch((error) => {
    diagnostic('master_api_json_parse_failure', {
      endpoint: '/api/bot/subscriptions', duration_ms: Date.now() - started,
      error: String(error?.message || error).slice(0, 160),
    });
    return null;
  });
  if (!response.ok || !data || data.success !== true) {
    const error = new Error('MASTER_API_REQUEST_FAILED');
    error.status = response.status;
    throw error;
  }
  const masterUrl = validMasterUrl(data.master_url);
  if (!masterUrl) throw new Error('MASTER_API_INVALID_URL');
  return masterUrl;
}
function createMasterPanelProvider(masterPanelId) {
  async function context() {
    const master = await masterRegistry.getById(masterPanelId);
    if (!master || master.status !== 'active') throw new Error('MASTER_PANEL_NOT_ACTIVE');
    const [panelA, panelB] = await timedStage('load_source_panel_configs', {}, () => Promise.all([registry.getById(master.panelAId), registry.getById(master.panelBId)]));
    if (!panelA || !panelB || panelA.status !== 'active' || panelB.status !== 'active' || panelA.type !== 'pasarguard' || panelB.type !== 'pasarguard') throw new Error('MASTER_SOURCE_PANEL_NOT_ACTIVE');
    return {
      providerA: instrumentSourceProvider(createDynamicPasarGuardProvider(panelA.id), 'A'),
      providerB: instrumentSourceProvider(createDynamicPasarGuardProvider(panelB.id), 'B'),
    };
  }
  async function orderForId(id) {
    const orderId = String(id || '').replace(/^master-user:/, '');
    const order = await storage.getOrder(orderId);
    if (!order || String(order.masterPanelId || '') !== String(masterPanelId)) throw new Error('MASTER_ORDER_NOT_FOUND');
    return order;
  }
  async function buildMasterUrl(order, sourceA, sourceB, quotaBytes, durationDays) {
    const masterUrl = await postMaster({
      username: order.generatedPasarguardUsername || order.requestedName || 'user',
      panelAUrl: sourceA.subscription_url, panelBUrl: sourceB.subscription_url,
      quotaBytes, durationDays,
    });
    await storage.updateOrder(order.orderId, { masterSubscriptionUrl: masterUrl, masterApiUpdatedAt: new Date().toISOString() });
    return masterUrl;
  }
  return {
    async health() { await context(); return true; },
    async findUserByUsername(username) {
      const lookupStarted = Date.now();
      diagnostic('find_user_lookup_start', {});
      const orders = await storage.listOrdersFast(500);
      diagnostic('find_user_lookup_orders_loaded', { duration_ms: Date.now() - lookupStarted, order_count: Array.isArray(orders) ? orders.length : null });
      const order = orders.find((item) => String(item.masterPanelId || '') === String(masterPanelId) && String(item.generatedPasarguardUsername || '') === String(username) && item.masterPanelAUserId && item.masterPanelBUserId && item.masterSubscriptionUrl);
      diagnostic('find_user_lookup_complete', { duration_ms: Date.now() - lookupStarted, found: Boolean(order) });
      return order ? { id: 'master-user:' + order.orderId, username, subscription_url: order.masterSubscriptionUrl, note: 'Order: ' + order.orderId } : null;
    },
    async createUser({ username, trafficBytes, expire, hwidLimit, note }) {
      const createStarted = Date.now();
      diagnostic('create_user_start', {});
      const { providerA, providerB } = await timedStage('load_provider_context', {}, () => context());
      const match = String(note || '').match(/Order:\\s*([A-Za-z0-9_-]+)/);
      if (!match) throw new Error('MASTER_ORDER_ID_MISSING');
      const orderId = match[1];
      let order = await storage.getOrder(orderId);
      if (!order) throw new Error('ORDER_NOT_FOUND');
      let userA = null;
      let userB = null;
      try {
        if (order.masterPanelAUserId) {
          try { userA = await providerA.getUserById(order.masterPanelAUserId); } catch (error) { if (Number(error?.status) !== 404) throw error; }
        }
        if (order.masterPanelBUserId) {
          try { userB = await providerB.getUserById(order.masterPanelBUserId); } catch (error) { if (Number(error?.status) !== 404) throw error; }
        }
        if (!userA) userA = await providerA.createUser({ username: safeName(username, 'a'), trafficBytes, expire, hwidLimit, note: note + ' Master source A' });
        if (!userB) userB = await providerB.createUser({ username: safeName(username, 'b'), trafficBytes, expire, hwidLimit, note: note + ' Master source B' });
        if (!userA?.subscription_url) userA = await providerA.getUserById(userA.id);
        if (!userB?.subscription_url) userB = await providerB.getUserById(userB.id);
        if (!userA?.subscription_url || !userB?.subscription_url) throw new Error('MASTER_SOURCE_URL_MISSING');
        order = await storage.updateOrder(orderId, {
          masterPanelId, masterPanelAUserId: userA.id, masterPanelBUserId: userB.id,
          masterPanelAUrl: userA.subscription_url, masterPanelBUrl: userB.subscription_url,
        });
        const masterUrl = await timedStage('build_master_subscription', { order_id: orderId }, () => buildMasterUrl(order, userA, userB, trafficBytes, order.durationDays || 0));
        diagnostic('create_user_success', { order_id: orderId, duration_ms: Date.now() - createStarted });
        return { id: 'master-user:' + orderId, username, subscription_url: masterUrl, status: 'active', data_limit: trafficBytes || 0, expire };
      } catch (error) {
        diagnostic('create_user_failure', {
          order_id: orderId, duration_ms: Date.now() - createStarted,
          error: String(error?.message || error).slice(0, 160),
          status: Number(error?.status) || undefined,
          operation: error?.operation ? String(error.operation).slice(0, 80) : undefined,
        });
        await timedStage('source_cleanup', { order_id: orderId }, () => Promise.allSettled([
          userA?.id ? providerA.deleteUserById(userA.id) : Promise.resolve(),
          userB?.id ? providerB.deleteUserById(userB.id) : Promise.resolve(),
        ]));
        await storage.updateOrder(orderId, {
          masterPanelAUserId: null, masterPanelBUserId: null, masterPanelAUrl: null,
          masterPanelBUrl: null, masterSubscriptionUrl: null,
        }).catch(() => {});
        throw error;
      }
    },
    async getUserById(id) {
      const { providerA, providerB } = await context();
      const order = await orderForId(id);
      const [a, b] = await Promise.all([
        order.masterPanelAUserId ? providerA.getUserById(order.masterPanelAUserId) : null,
        order.masterPanelBUserId ? providerB.getUserById(order.masterPanelBUserId) : null,
      ]);
      return {
        id: 'master-user:' + order.orderId, username: order.generatedPasarguardUsername,
        subscription_url: order.masterSubscriptionUrl, status: 'active',
        data_limit: Math.max(Number(a?.data_limit || 0), Number(b?.data_limit || 0)),
        expire: a?.expire || b?.expire, source_a: a, source_b: b,
      };
    },
    async updateUserById(id, patch) {
      const { providerA, providerB } = await context();
      const order = await orderForId(id);
      const [a, b] = await Promise.all([
        providerA.getUserById(order.masterPanelAUserId), providerB.getUserById(order.masterPanelBUserId),
      ]);
      const snapshot = (user) => {
        const result = {};
        for (const key of ['status', 'data_limit', 'data_limit_reset_strategy', 'hwid_limit', 'expire']) {
          if (Object.prototype.hasOwnProperty.call(user || {}, key)) result[key] = user[key];
        }
        return result;
      };
      const rollback = async () => {
        const results = await Promise.allSettled([
          providerA.updateUserById(order.masterPanelAUserId, snapshot(a)),
          providerB.updateUserById(order.masterPanelBUserId, snapshot(b)),
        ]);
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length) console.error(JSON.stringify({
          event: 'MASTER_RENEWAL_ROLLBACK_FAILED', order_id: order.orderId, panel_count: failures.length,
        }));
      };
      try {
        const updates = await Promise.allSettled([
          providerA.updateUserById(order.masterPanelAUserId, patch),
          providerB.updateUserById(order.masterPanelBUserId, patch),
        ]);
        const updateFailure = updates.find((result) => result.status === 'rejected');
        if (updateFailure) throw updateFailure.reason;
        const [updatedA, updatedB] = await Promise.all([
          providerA.getUserById(order.masterPanelAUserId), providerB.getUserById(order.masterPanelBUserId),
        ]);
        if (!updatedA?.subscription_url || !updatedB?.subscription_url) throw new Error('MASTER_SOURCE_URL_MISSING');
        const bytes = Number(updatedA.data_limit ?? updatedB.data_limit ?? 0);
        const durationDays = updatedA.expire ? Math.max(1, Math.ceil((new Date(updatedA.expire).getTime() - Date.now()) / 86400000)) : 0;
        const masterUrl = await buildMasterUrl(order, updatedA, updatedB, bytes, durationDays);
        await storage.updateOrder(order.orderId, { masterPanelAUrl: updatedA.subscription_url, masterPanelBUrl: updatedB.subscription_url });
        return {
          id: 'master-user:' + order.orderId, username: order.generatedPasarguardUsername,
          subscription_url: masterUrl, status: 'active', data_limit: bytes,
          expire: updatedA.expire || updatedB.expire,
        };
      } catch (error) {
        await rollback();
        throw error;
      }
    },
    async deleteUserById(id) {
      const { providerA, providerB } = await context();
      const order = await orderForId(id);
      const results = await Promise.allSettled([
        order.masterPanelAUserId ? providerA.deleteUserById(order.masterPanelAUserId) : Promise.resolve(),
        order.masterPanelBUserId ? providerB.deleteUserById(order.masterPanelBUserId) : Promise.resolve(),
      ]);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
      await storage.updateOrder(order.orderId, {
        masterPanelAUserId: null, masterPanelBUserId: null,
        masterPanelAUrl: null, masterPanelBUrl: null,
      });
      return true;
    },
    async disableUser(userId) { return this.updateUserById(userId, { status: 'disabled' }); },
  };
}
module.exports = { createMasterPanelProvider, postMaster, validMasterUrl };
