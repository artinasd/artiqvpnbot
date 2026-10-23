const dns = require('node:dns').promises;
const net = require('node:net');
const { validatePanelInput } = require('./panel-registry');

const TIMEOUT_MS = 7000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_REDIRECTS = 0;

function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && Number(address.split('.')[2]) === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && Number(address.split('.')[2]) === 100) ||
      (a === 203 && b === 0 && Number(address.split('.')[2]) === 113);
  }
  if (version === 6) {
    const ip = address.toLowerCase();
    if (ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip)) return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  return true;
}

async function assertPublicHttpsUrl(value, lookup = dns.lookup) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('INVALID_PANEL_URL');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('PANEL_URL_HOST_NOT_ALLOWED');
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error('PANEL_URL_HOST_NOT_ALLOWED');
}

async function boundedRequest(url, options, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new Error('PANEL_REDIRECT_NOT_ALLOWED');
    const reader = response.body?.getReader?.();
    let text = '';
    if (reader) {
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error('PANEL_RESPONSE_TOO_LARGE');
        }
        text += Buffer.from(value).toString('utf8');
      }
    } else {
      text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('PANEL_RESPONSE_TOO_LARGE');
    }
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

function endpoint(baseUrl, path) { return `${String(baseUrl).replace(/\\/+$/, '')}/${String(path).replace(/^\\/+/, '')}`; }

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
