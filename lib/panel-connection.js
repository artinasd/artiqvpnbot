const dns = require('node:dns').promises;
const { validatePanelInput } = require('./panel-registry');
const { isPrivateAddress, assertPublicHttpsUrl, endpoint, readTextBounded } = require('./panel-network');

const TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REDIRECTS = 0;

async function boundedRequest(url, options, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new Error('PANEL_REDIRECT_NOT_ALLOWED');
    const text = await readTextBounded(response, MAX_RESPONSE_BYTES);
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { throw new Error('PANEL_INVALID_RESPONSE'); }
    return { response, data };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('PANEL_CONNECTION_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function testPasarGuardConnection(input, { lookup = dns.lookup, fetchImpl = fetch } = {}) {
  const panel = validatePanelInput(input);
  await assertPublicHttpsUrl(panel.baseUrl, lookup);
  const credentials = input.credentials;
  const username = String(credentials?.username || '').trim();
  const password = String(credentials?.password || '');
  if (!username || !password) throw new Error('PANEL_CREDENTIAL_REQUIRED');

  const authUrl = endpoint(panel.baseUrl, '/api/admin/token');
  const auth = await boundedRequest(authUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }).toString(),
  }, fetchImpl);
  if (!auth.response.ok || !auth.data?.access_token) throw new Error('PANEL_AUTHENTICATION_FAILED');

  // The token is used only for a harmless read request and is never returned or logged.
  const groupsUrl = endpoint(panel.baseUrl, '/api/groups/simple');
  const groups = await boundedRequest(groupsUrl, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${auth.data.access_token}` },
  }, fetchImpl);
  if (!groups.response.ok) throw new Error('PANEL_READ_CHECK_FAILED');
  const values = Array.isArray(groups.data) ? groups.data : groups.data?.groups;
  if (!Array.isArray(values)) throw new Error('PANEL_INVALID_GROUPS_RESPONSE');
  return { ok: true, groupCount: values.length, checkedAt: new Date().toISOString() };
}

module.exports = { TIMEOUT_MS, MAX_RESPONSE_BYTES, isPrivateAddress, assertPublicHttpsUrl, endpoint, testPasarGuardConnection };
