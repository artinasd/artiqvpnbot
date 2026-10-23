const registry = require('../lib/panel-registry');
const { testPasarGuardConnection } = require('../lib/panel-connection');
const planStore = require('../lib/plan-store');

const PASSWORD = process.env.ADMIN_CMS_PASSWORD || '';
function authorized(req) {
  return Boolean(PASSWORD) && req.headers['x-admin-password'] === PASSWORD;
}
function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}

module.exports = async function panelsApi(req, res) {
  if (!authorized(req)) return json(res, 401, { error: 'UNAUTHORIZED' });
  try {
    if (req.method === 'GET') {
      const panels = await registry.list();
      const panelId = String(req.query?.panelId || '');
      if (panelId) return json(res, 200, { panels, plans: await planStore.listActiveByPanel(panelId) });
      return json(res, 200, { panels });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const body = req.body || {};
    if (body.action === 'save') return json(res, 200, { panel: await registry.save(body.panel || {}) });
    if (body.action === 'save_plan') {
      const panelId = String(body.panelId || '');
      if (!panelId) return json(res, 400, { error: 'PANEL_REQUIRED' });
      const panel = await registry.getById(panelId);
      if (!panel) return json(res, 404, { error: 'PANEL_NOT_FOUND' });
      const plan = { ...(body.plan || {}), panelId, panelName: panel.name };
      return json(res, 200, { plan: await planStore.save(plan) });
    }
    if (body.action === 'disable_plan') {
      await planStore.remove(String(body.id || ''));
      return json(res, 200, { ok: true });
    }
    if (body.action === 'disable') return json(res, 200, { panel: await registry.setStatus(String(body.id || ''), 'disabled') });
    if (body.action === 'enable') {
      const current = await registry.getById(String(body.id || ''));
      if (!current) return json(res, 404, { error: 'PANEL_NOT_FOUND' });
      return json(res, 200, { panel: await registry.setStatus(current.id, 'pending') });
    }
    if (body.action === 'test') {
      const id = String(body.id || '');
      const panel = await registry.getById(id);
      if (!panel) return json(res, 404, { error: 'PANEL_NOT_FOUND' });
      if (panel.status === 'disabled') return json(res, 400, { error: 'PANEL_DISABLED' });
      const credentials = await registry.getCredentials(id);
      try {
        const result = await testPasarGuardConnection({ ...panel, credentials });
        const updated = await registry.setStatus(id, 'active');
        return json(res, 200, { panel: updated, connection: { ok: true, groupCount: result.groupCount, checkedAt: result.checkedAt } });
      } catch (error) {
        await registry.setStatus(id, 'connection_error').catch(() => {});
        const allowed = new Set(['PANEL_AUTHENTICATION_FAILED', 'PANEL_READ_CHECK_FAILED', 'PANEL_CONNECTION_TIMEOUT', 'PANEL_URL_HOST_NOT_ALLOWED', 'PANEL_REDIRECT_NOT_ALLOWED', 'PANEL_RESPONSE_TOO_LARGE', 'PANEL_INVALID_RESPONSE', 'PANEL_INVALID_GROUPS_RESPONSE', 'PANEL_CREDENTIAL_REQUIRED', 'INVALID_PANEL_URL']);
        return json(res, 400, { error: allowed.has(error.message) ? error.message : 'PANEL_CONNECTION_FAILED' });
      }
    }
    return json(res, 400, { error: 'UNKNOWN_ACTION' });
  } catch (error) {
    const allowed = new Set(['INVALID_PANEL', 'INVALID_PANEL_ID', 'INVALID_PANEL_NAME', 'INVALID_PANEL_URL', 'PANEL_URL_HOST_NOT_ALLOWED', 'UNSUPPORTED_PANEL_TYPE', 'PANEL_CREDENTIAL_REQUIRED', 'PANEL_ENCRYPTION_KEY_MUST_BE_32_BYTES', 'PANEL_NOT_FOUND', 'PANEL_NOT_ACTIVE', 'PANEL_REQUIRED', 'INVALID_PANEL_STATUS', 'INVALID_PANEL_REGISTRY']);
    return json(res, 400, { error: allowed.has(error.message) ? error.message : 'PANEL_REQUEST_FAILED' });
  }
};
