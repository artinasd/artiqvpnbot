const crypto = require('node:crypto');
const registry = require('./panel-registry');
const { assertPublicHttpsUrl, endpoint, readTextBounded } = require('./panel-network');

const TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

const warmTokens = new Map();
const warmUrlChecks = new Map();
const warmGroups = new Map();
const TOKEN_TTL_MS = 5 * 60 * 1000;
const URL_CHECK_TTL_MS = 30 * 1000;
const GROUPS_TTL_MS = 5 * 60 * 1000;

function pruneMap(map, maxEntries = 100) {
  const now = Date.now();
  for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key);
  while (map.size > maxEntries) map.delete(map.keys().next().value);
}

function createDynamicPasarGuardProvider(panelId, { fetchImpl = fetch, getPanel = registry.getById, getCredentials = registry.getCredentials, checkUrl = assertPublicHttpsUrl } = {}) {
  const defaultFetch = fetchImpl === fetch;
  const defaultUrlCheck = checkUrl === assertPublicHttpsUrl;
  let contextPromise = null;
  let accessToken = null;
  let tokenPromise = null;
  let tokenCacheKey = null;

  async function context() {
    if (!contextPromise) {
      contextPromise = (async () => {
        const panel = await getPanel(panelId);
        if (!panel) throw new Error('PANEL_NOT_FOUND');
        const credentials = await getCredentials(panelId);
        const url = new URL(panel.baseUrl);
        if (defaultUrlCheck) {
          pruneMap(warmUrlChecks);
          const cached = warmUrlChecks.get(url.origin);
          if (cached && cached.expiresAt > Date.now()) {
            // A recent positive public-hostname check is safe to reuse briefly.
          } else {
            await checkUrl(panel.baseUrl);
            warmUrlChecks.set(url.origin, { expiresAt: Date.now() + URL_CHECK_TTL_MS });
            pruneMap(warmUrlChecks);
          }
        } else {
          await checkUrl(panel.baseUrl);
        }
        return { panel, credentials };
      })().catch((error) => {
        contextPromise = null;
        throw error;
      });
    }
    return contextPromise;
  }

  function buildTokenCacheKey(panel, credentials) {
    const passwordHash = crypto.createHash('sha256').update(String(credentials.password || '')).digest('hex');
    return `${panelId}:${panel.updatedAt || ''}:${panel.baseUrl}:${credentials.username}:${passwordHash}`;
  }

  async function authenticate(panel, credentials) {
    const authController = new AbortController();
    const authTimer = setTimeout(() => authController.abort(), TIMEOUT_MS);
    try {
      const authResponse = await fetchImpl(endpoint(panel.baseUrl, '/api/admin/token'), {
        method: 'POST', redirect: 'manual', signal: authController.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: credentials.username, password: credentials.password }).toString(),
      });
      if (authResponse.status >= 300 && authResponse.status < 400) throw new Error('PANEL_REDIRECT_NOT_ALLOWED');
      const authText = await readTextBounded(authResponse, 64 * 1024);
      let authData;
      try { authData = JSON.parse(authText || '{}'); }
      catch { throw new Error('PANEL_INVALID_RESPONSE'); }
      if (!authResponse.ok || !authData.access_token) throw new Error('PANEL_AUTHENTICATION_FAILED');
      return authData.access_token;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('PANEL_CONNECTION_TIMEOUT');
      throw error;
    } finally { clearTimeout(authTimer); }
  }

  async function getAccessToken(panel, credentials, forceRefresh = false) {
    const key = buildTokenCacheKey(panel, credentials);
    if (tokenCacheKey !== key) {
      accessToken = null;
      tokenPromise = null;
      tokenCacheKey = key;
    }
    if (!forceRefresh && accessToken) return accessToken;
    if (!forceRefresh && defaultFetch) {
      pruneMap(warmTokens);
      const cached = warmTokens.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        accessToken = cached.token;
        return accessToken;
      }
    }
    if (tokenPromise) return tokenPromise;
    tokenPromise = authenticate(panel, credentials).then((token) => {
      accessToken = token;
      if (defaultFetch) {
        warmTokens.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
        pruneMap(warmTokens);
      }
      return token;
    }).finally(() => { tokenPromise = null; });
    return tokenPromise;
  }

  async function request(path, { method = 'GET', body, token, form = false } = {}) {
    const { panel, credentials } = await context();
    const url = new URL(endpoint(panel.baseUrl, path));
    if (url.origin !== new URL(panel.baseUrl).origin) {
      if (defaultUrlCheck) {
        pruneMap(warmUrlChecks);
        const cached = warmUrlChecks.get(url.origin);
        if (!cached || cached.expiresAt <= Date.now()) {
          await checkUrl(url.toString());
          warmUrlChecks.set(url.origin, { expiresAt: Date.now() + URL_CHECK_TTL_MS });
          pruneMap(warmUrlChecks);
        }
      } else {
        await checkUrl(url.toString());
      }
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const access = token && attempt === 0 ? token : await getAccessToken(panel, credentials, attempt > 0);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const headers = { Accept: 'application/json', Authorization: `Bearer ${access}` };
        if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
        else if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetchImpl(url, {
          method, redirect: 'manual', signal: controller.signal, headers,
          body: form ? new URLSearchParams(body).toString() : body === undefined ? undefined : JSON.stringify(body),
        });
        if (response.status === 401 || response.status === 403) {
          if (attempt === 0) {
            accessToken = null;
            warmTokens.delete(buildTokenCacheKey(panel, credentials));
            continue;
          }
        }
        if (response.status >= 300 && response.status < 400) throw new Error('PANEL_REDIRECT_NOT_ALLOWED');
        const text = await readTextBounded(response, MAX_RESPONSE_BYTES);
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { throw new Error('PANEL_INVALID_RESPONSE'); }
        if (!response.ok) {
          const error = new Error(`PANEL_HTTP_${response.status}`);
          error.status = response.status;
          error.operation = path;
          throw error;
        }
        if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.subscription_url === 'string') {
          const sub = data.subscription_url.trim();
          if (sub.startsWith('http://') || sub.startsWith('https://')) return data;
          if (sub.startsWith('/') && !sub.startsWith('//')) {
            data = { ...data, subscription_url: new URL(sub, panel.baseUrl).toString() };
          } else {
            throw new Error('PANEL_INVALID_SUBSCRIPTION_URL');
          }
        }
        return data;
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('PANEL_CONNECTION_TIMEOUT');
        throw error;
      } finally { clearTimeout(timer); }
    }
    throw new Error('PANEL_AUTHENTICATION_FAILED');
  }

  return {
    async health() { await request('/api/groups/simple'); return true; },
    async getGroups() {
      const { panel } = await context();
      const cacheKey = `${panelId}:${panel.updatedAt || ''}:${panel.baseUrl}`;
      if (defaultFetch) {
        pruneMap(warmGroups);
        const cached = warmGroups.get(cacheKey);
        if (cached && cached.expiresAt > Date.now() && Array.isArray(cached.groups) && cached.groups.length) {
          return cached.groups;
        }
      }
      const result = await request('/api/groups/simple');
      const groups = Array.isArray(result) ? result : result?.groups || [];
      if (!groups.length) throw new Error('PASARGUARD_NO_GROUPS');
      if (defaultFetch) {
        warmGroups.set(cacheKey, { groups, expiresAt: Date.now() + GROUPS_TTL_MS });
        pruneMap(warmGroups);
      }
      return groups;
    },
    async findUserByUsername(username) {
      try { return await request(`/api/user/${encodeURIComponent(username)}`); }
      catch (error) { if (error.status === 404) return null; throw error; }
    },
    async createUser({ username, trafficBytes, expire, hwidLimit, note }) {
      const groups = await this.getGroups();
      const groupIds = groups.filter((g) => g && g.id !== null && g.id !== undefined && String(g.id).trim() !== '' && Number.isInteger(Number(g.id))).map((g) => Number(g.id));
      const body = { username, status: 'active', data_limit: trafficBytes, data_limit_reset_strategy: 'no_reset', hwid_limit: hwidLimit, note: note || undefined, group_ids: groupIds, proxy_settings: {} };
      if (expire) body.expire = expire;
      return request('/api/user', { method: 'POST', body });
    },
    async getUserById(userId) { return request(`/api/user/by-id/${encodeURIComponent(userId)}`); },
    async updateUserById(userId, patch) { return request(`/api/user/by-id/${encodeURIComponent(userId)}`, { method: 'PUT', body: patch }); },
    async deleteUserById(userId) { return request(`/api/user/by-id/${encodeURIComponent(userId)}`, { method: 'DELETE' }); },
    async disableUser(userId) { return this.updateUserById(userId, { status: 'disabled' }); },
  };
}
module.exports = { createDynamicPasarGuardProvider };
