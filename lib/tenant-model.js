const storage = require('./storage');
const { getTenantId } = require('./request-context');

const PLATFORM_PREFIX = 'platform:';

// Generates a unique ID
function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Ensure the storage call bypasses tenant isolation for platform keys
function pKey(key) {
  return `${PLATFORM_PREFIX}${key}`;
}

async function createTenant(data) {
  const tenantId = data.tenantId || generateId();
  const tenant = {
    tenantId,
    name: data.name || `Tenant ${tenantId}`,
    status: data.status || 'active', // 'active', 'suspended'
    domain: data.domain || null,
    botToken: data.botToken || null,
    botUsername: data.botUsername || null,
    adminTelegramIds: data.adminTelegramIds || [], // Array of telegram user IDs for tenant admins
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...data
  };

  // Check if already exists
  const existing = await storage.getRaw(pKey(`tenant:${tenantId}`));
  if (existing) {
    throw new Error('TENANT_ALREADY_EXISTS');
  }

  await storage.setRaw(pKey(`tenant:${tenantId}`), tenant);
  await storage.saddRaw(pKey('tenants:ids'), tenantId);
  return tenant;
}

async function getTenant(tenantId) {
  return await storage.getRaw(pKey(`tenant:${tenantId}`));
}

async function updateTenant(tenantId, patch) {
  const existing = await getTenant(tenantId);
  if (!existing) {
    throw new Error('TENANT_NOT_FOUND');
  }
  const updated = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await storage.setRaw(pKey(`tenant:${tenantId}`), updated);
  return updated;
}

async function listTenants(limit = 100) {
  const ids = await storage.smembersRaw(pKey('tenants:ids'));
  const tenants = [];
  for (const id of ids.slice(0, limit * 3)) {
    const tenant = await getTenant(id);
    if (tenant) {
      tenants.push(tenant);
    }
  }
  return tenants.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}

// Find a tenant by bot token (useful for webhook resolution)
async function findTenantByBotToken(token) {
  if (!token) return null;
  // For now, scan all tenants. A secondary index should be used in production.
  const tenants = await listTenants(1000);
  return tenants.find(t => t.botToken === token) || null;
}

module.exports = {
  createTenant,
  getTenant,
  updateTenant,
  listTenants,
  findTenantByBotToken
};
