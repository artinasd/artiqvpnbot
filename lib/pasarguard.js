const BASE_URL = (process.env.PASARGUARD_BASE_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.PASARGUARD_API_KEY;
const API_KEY_HEADER = process.env.PASARGUARD_API_KEY_HEADER || 'X-API-Key';
const REQUEST_TIMEOUT_MS = Number(process.env.PASARGUARD_TIMEOUT_MS || 12000);

class PasarGuardError extends Error {
  constructor(message, { status = 0, operation = '', transient = false, details = null } = {}) {
    super(message);
    this.name = 'PasarGuardError';
    this.status = status;
    this.operation = operation;
    this.transient = transient;
    this.details = details;
  }
}

function ensureConfigured() {
  if (!BASE_URL || !API_KEY) throw new PasarGuardError('PASARGUARD_NOT_CONFIGURED', { operation: 'config' });
}

function isTransient(status, error) {
  if (error?.name === 'AbortError') return true;
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function request(path, { method = 'GET', body, operation = path, retry = true } = {}) {
  ensureConfigured();
  const headers = { Accept: 'application/json', [API_KEY_HEADER]: API_KEY };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  for (let attempt = 0; attempt < (retry ? 3 : 1); attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      if (response.ok) return data;
      const transient = isTransient(response.status);
      if (transient && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
        continue;
      }
      throw new PasarGuardError(`PASARGUARD_HTTP_${response.status}`, {
        status: response.status,
        operation,
        transient,
        details: sanitizeError(data),
      });
    } catch (error) {
      if (error instanceof PasarGuardError) throw error;
      const transient = isTransient(0, error);
      if (transient && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
        continue;
      }
      throw new PasarGuardError('PASARGUARD_NETWORK_ERROR', { operation, transient: true });
    } finally {
      clearTimeout(timer);
    }
  }
}

function sanitizeError(value) {
  if (typeof value === 'string') return value.slice(0, 500);
  if (!value || typeof value !== 'object') return null;
  const copy = { ...value };
  for (const key of Object.keys(copy)) {
    if (/token|password|secret|api.?key|authorization/i.test(key)) delete copy[key];
  }
  return copy;
}

async function getGroups() {
  const result = await request('/api/groups/simple', { operation: 'get_groups' });
  return Array.isArray(result) ? result : (result?.groups || []);
}

async function findUserByUsername(username) {
  try {
    return await request(`/api/user/${encodeURIComponent(username)}`, { operation: 'find_user' });
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function createUser({ username, trafficBytes, expire, hwidLimit, note }) {
  const groups = await getGroups();
  const groupIds = groups.filter((g) => g && Number.isInteger(Number(g.id))).map((g) => Number(g.id));
  if (groupIds.length === 0) throw new PasarGuardError('PASARGUARD_NO_GROUPS', { operation: 'get_groups' });

  return request('/api/user', {
    method: 'POST',
    operation: 'create_user',
    body: {
      username,
      status: 'active',
      data_limit: trafficBytes,
      data_limit_reset_strategy: 'no_reset',
      expire,
      hwid_limit: hwidLimit,
      note: note || undefined,
      group_ids: groupIds,
      proxy_settings: {},
    },
  });
}

async function getUserById(userId) {
  return request(`/api/user/by-id/${encodeURIComponent(userId)}`, { operation: 'get_user_by_id' });
}

async function updateUserById(userId, patch) {
  return request(`/api/user/by-id/${encodeURIComponent(userId)}`, {
    method: 'PUT', operation: 'update_user_by_id', body: patch,
  });
}

async function deleteUserById(userId) {
  return request(`/api/user/by-id/${encodeURIComponent(userId)}`, {
    method: 'DELETE', operation: 'delete_user_by_id',
  });
}

async function disableUser(userId) {
  return updateUserById(userId, { status: 'disabled' });
}

async function health() {
  const result = await request('/api/system', { operation: 'health' });
  return Boolean(result);
}

module.exports = {
  PasarGuardError,
  getGroups,
  findUserByUsername,
  createUser,
  getUserById,
  updateUserById,
  deleteUserById,
  disableUser,
  health,
};
