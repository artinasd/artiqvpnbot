const { createTenant, listTenants, updateTenant, getTenant } = require('../lib/tenant-model');

const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || process.env.ADMIN_CMS_PASSWORD || '';
function authorized(req) { return Boolean(PASSWORD) && req.headers['x-platform-admin-password'] === PASSWORD; }
function json(res, status, body) { res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8'); return res.end(JSON.stringify(body)); }

module.exports = async function(req, res) {
  if (!authorized(req)) return json(res, 401, { error: 'UNAUTHORIZED_PLATFORM_ADMIN' });

  try {
    if (req.method === 'GET') {
      const { id } = req.query;
      if (id) {
        const tenant = await getTenant(id);
        return tenant ? json(res, 200, { tenant }) : json(res, 404, { error: 'TENANT_NOT_FOUND' });
      } else {
        const tenants = await listTenants(100);
        return json(res, 200, { tenants });
      }
    }

    if (req.method === 'POST') {
      const { action, tenant } = req.body || {};
      
      if (action === 'create') {
        if (!tenant || !tenant.name) return json(res, 400, { error: 'INVALID_TENANT_DATA' });
        const created = await createTenant(tenant);
        return json(res, 201, { tenant: created });
      }
      
      if (action === 'update') {
        if (!tenant || !tenant.tenantId) return json(res, 400, { error: 'MISSING_TENANT_ID' });
        const updated = await updateTenant(tenant.tenantId, tenant);
        return json(res, 200, { tenant: updated });
      }
      
      return json(res, 400, { error: 'UNKNOWN_ACTION' });
    }

    return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    return json(res, 400, { error: error.message || String(error) });
  }
};
