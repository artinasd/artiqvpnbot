const registry = require('./panel-registry');
const { assertPublicHttpsUrl, readTextBounded } = require('./panel-network');

const TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const warmUrlChecks = new Map();
const URL_CHECK_TTL_MS = 30 * 1000;

function resolveMirzaEndpoint(baseUrl) {
  const clean = String(baseUrl || '').replace(/\/+$/, '');
  return clean.endsWith('/api/bot/mirza') ? clean : `${clean}/api/bot/mirza`;
}

function normalizeSubUrl(subUrl, baseUrl) {
  if (typeof subUrl !== 'string' || !subUrl.trim()) return subUrl;
  const trimmed = subUrl.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return new URL(trimmed, baseUrl).toString();
  throw new Error('PANEL_INVALID_SUBSCRIPTION_URL');
}

function isNotFoundMsg(msg) {
  const text = String(msg || '').toLowerCase();
  return text.includes('not found') || text.includes('یافت نشد') || text.includes('پیدا نشد') || text.includes('exist');
}

function createArtiqMasterProvider(panelId, {
  fetchImpl = fetch,
  getPanel = registry.getById,
  getCredentials = registry.getCredentials,
  checkUrl = assertPublicHttpsUrl,
} = {}) {
  const defaultUrlCheck = checkUrl === assertPublicHttpsUrl;
  let contextPromise = null;

  async function context() {
    if (!contextPromise) {
      contextPromise = (async () => {
        const panel = await getPanel(panelId);
        if (!panel) throw new Error('PANEL_NOT_FOUND');
        const credentials = await getCredentials(panelId);
        const token = String(credentials?.token || credentials?.password || '').trim();
        if (!token) throw new Error('PANEL_CREDENTIAL_REQUIRED');
        const url = new URL(panel.baseUrl);
        if (defaultUrlCheck) {
          const cached = warmUrlChecks.get(url.origin);
          if (!cached || cached.expiresAt <= Date.now()) {
            await checkUrl(panel.baseUrl);
            warmUrlChecks.set(url.origin, { expiresAt: Date.now() + URL_CHECK_TTL_MS });
          }
        } else {
          await checkUrl(panel.baseUrl);
        }
        return { panel, token, targetPanelId: String(credentials?.panelId || '').trim() || undefined };
      })().catch((error) => {
        contextPromise = null;
        throw error;
      });
    }
    return contextPromise;
  }

  async function request({ method = 'GET', query, body } = {}) {
    const { panel, token } = await context();
    const baseEndpoint = resolveMirzaEndpoint(panel.baseUrl);
    const url = new URL(baseEndpoint);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetchImpl(url.toString(), {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status >= 300 && response.status < 400) throw new Error('PANEL_REDIRECT_NOT_ALLOWED');
      if (response.status === 401 || response.status === 403) throw new Error('PANEL_AUTHENTICATION_FAILED');
      const text = await readTextBounded(response, MAX_RESPONSE_BYTES);
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { throw new Error('PANEL_INVALID_RESPONSE'); }
      if (!response.ok) {
        const err = new Error(`PANEL_HTTP_${response.status}`);
        err.status = response.status;
        err.operation = query?.actions || body?.actions || 'mirza';
        throw err;
      }
      if (!data || data.status !== true) {
        const msg = String(data?.msg || 'PANEL_REQUEST_FAILED');
        const err = new Error(isNotFoundMsg(msg) ? 'PANEL_HTTP_404' : msg);
        err.status = isNotFoundMsg(msg) ? 404 : 400;
        err.operation = query?.actions || body?.actions || 'mirza';
        err.details = msg;
        throw err;
      }
      return { obj: data.obj, baseUrl: panel.baseUrl };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('PANEL_CONNECTION_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async health() {
      const { obj } = await request({ method: 'GET', query: { actions: 'list_panel' } });
      return Array.isArray(obj);
    },
    async getGroups() {
      const { obj } = await request({ method: 'GET', query: { actions: 'list_panel' } });
      const list = Array.isArray(obj) ? obj : [];
      if (!list.length) throw new Error('PASARGUARD_NO_GROUPS');
      return list;
    },
    async findUserByUsername(username) {
      try {
        return await this.getUserById(username);
      } catch (error) {
        if (Number(error?.status) === 404) return null;
        throw error;
      }
    },
    async getUserById(userId) {
      try {
        const { obj, baseUrl } = await request({ method: 'GET', query: { actions: 'get_user_data', username: userId } });
        const u = obj?.user;
        if (!u) {
          const err = new Error('PANEL_HTTP_404');
          err.status = 404;
          err.operation = 'get_user_by_id';
          throw err;
        }
        return {
          ...u,
          id: u.username || u.uuid || String(userId),
          username: u.username || String(userId),
          expire: u.expire ? new Date(Number(u.expire) * 1000).toISOString() : null,
          subscription_url: normalizeSubUrl(u.subscription_url, baseUrl),
        };
      } catch (error) {
        if (Number(error?.status) === 404) error.operation = 'get_user_by_id';
        throw error;
      }
    },
    async createUser({ username, trafficBytes, expire, durationDays, isTest }) {
      const { targetPanelId } = await context();
      const testMode = isTest === true;
      const body = testMode
        ? { actions: 'user_test', username, ...(targetPanelId ? { panel_id: targetPanelId } : {}) }
        : {
          actions: 'user_create',
          username,
          ...(targetPanelId ? { panel_id: targetPanelId } : {}),
          ...(Number(trafficBytes) > 0 ? { data_limit_gb: Math.max(0.1, Number((Number(trafficBytes) / (1024 ** 3)).toFixed(2))) } : {}),
          expire_days: (() => {
            if (durationDays != null && Number(durationDays) > 0) return Math.max(1, Math.min(90, Math.round(Number(durationDays))));
            if (expire) {
              const days = Math.round((new Date(expire).getTime() - Date.now()) / (86400 * 1000));
              if (Number.isFinite(days) && days > 0) return Math.max(1, Math.min(90, days));
            }
            return 30;
          })(),
        };
      const { obj, baseUrl } = await request({ method: 'POST', body });
      return {
        id: obj?.username || username,
        username: obj?.username || username,
        subscription_url: normalizeSubUrl(obj?.subscription_url, baseUrl),
        links: Array.isArray(obj?.links) ? obj.links : [],
      };
    },
    async updateUserById(userId, patch = {}, meta = {}) {
      if (patch.status === 'disabled') {
        return this.deleteUserById(userId);
      }
      const addedGb = meta.addedTrafficBytes != null
        ? Number((Number(meta.addedTrafficBytes) / (1024 ** 3)).toFixed(2))
        : 0;
      const timeDay = meta.addedDurationDays != null && Number(meta.addedDurationDays) > 0
        ? Math.max(1, Math.min(90, Math.round(Number(meta.addedDurationDays))))
        : undefined;
      await request({
        method: 'PUT',
        body: {
          actions: 'extend_service',
          username: userId,
          ...(timeDay ? { time_day: timeDay } : {}),
          ...(addedGb > 0 ? { data_limit_gb: addedGb } : {}),
        },
      });
      return this.getUserById(userId);
    },
    async changeLink(userId) {
      const { obj, baseUrl } = await request({ method: 'PUT', body: { actions: 'change_link', username: userId } });
      return { subscription_url: normalizeSubUrl(obj?.subscription_url, baseUrl) };
    },
    async deleteUserById(userId) {
      const { obj } = await request({ method: 'DELETE', body: { actions: 'user_delete', username: userId } });
      return obj;
    },
    async disableUser(userId) {
      return this.deleteUserById(userId);
    },
  };
}

module.exports = { createArtiqMasterProvider, resolveMirzaEndpoint };
