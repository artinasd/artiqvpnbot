const registry = require('./panel-registry');
const { assertPublicHttpsUrl } = require('./panel-connection');

const TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

async function readTextBounded(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('PANEL_RESPONSE_TOO_LARGE');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('PANEL_RESPONSE_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function createDynamicPasarGuardProvider(panelId, { fetchImpl = fetch } = {}) {
  async function context() {
    const panel = await registry.getById(panelId);
    if (!panel) throw new Error('PANEL_NOT_FOUND');
    await assertPublicHttpsUrl(panel.baseUrl);
    const credentials = await registry.getCredentials(panelId);
    return { panel, credentials };
  }

  async function request(path, { method = 'GET', body, token, form = false } = {}) {
    const { panel, credentials } = await context();
    let accessToken = token;
    if (!accessToken) {
      const authController = new AbortController();
      const authTimer = setTimeout(() => authController.abort(), TIMEOUT_MS);
      try {
        const authResponse = await fetchImpl(new URL('/api/admin/token', panel.baseUrl), {
          method: 'POST', redirect: 'manual', signal: authController.signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username: credentials.username, password: credentials.password }).toString(),
        });
        if (authResponse.status >= 300 && authResponse.status < 400) throw new Error('PANEL_REDIRECT_NOT_ALLOWED');
        const authText = await readTextBounded(authResponse, 64 * 1024);
        const authData = JSON.parse(authText || '{}');
        if (!authResponse.ok || !authData.access_token) throw new Error('PANEL_AUTHENTICATION_FAILED');
        accessToken = authData.access_token;
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('PANEL_CONNECTION_TIMEOUT');
        throw error;
      } finally { clearTimeout(authTimer); }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const url = new URL(path, panel.baseUrl);
      await assertPublicHttpsUrl(url.toString());
      const headers = { Accept: 'application/json', Authorization: `Bearer ${accessToken}` };
      if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      else if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetchImpl(url, {
        method, redirect: 'manual', signal: controller.signal, headers,
        body: form ? new URLSearchParams(body).toString() : body === undefined ? undefined : JSON.stringify(body),
      });
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
        if (data.subscription_url.startsWith('http://') || data.subscription_url.startsWith('https://')) return data;
        data = { ...data, subscription_url: new URL(data.subscription_url, panel.baseUrl).toString() };
      }
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('PANEL_CONNECTION_TIMEOUT');
      throw error;
    } finally { clearTimeout(timer); }
  }

  return {
    async health() { await request('/api/groups/simple'); return true; },
    async getGroups() {
      const result = await request('/api/groups/simple');
      const groups = Array.isArray(result) ? result : result?.groups || [];
      if (!groups.length) throw new Error('PASARGUARD_NO_GROUPS');
      return groups;
    },
    async findUserByUsername(username) {
      try { return await request(`/api/user/${encodeURIComponent(username)}`); }
      catch (error) { if (error.status === 404) return null; throw error; }
    },
    async createUser({ username, trafficBytes, expire, hwidLimit, note }) {
      const groups = await this.getGroups();
      const groupIds = groups.filter((g) => g && Number.isInteger(Number(g.id))).map((g) => Number(g.id));
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
