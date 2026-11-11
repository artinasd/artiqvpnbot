const dns = require('node:dns').promises;
const net = require('node:net');

function isDisallowedHostname(hostname) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
}
function isPrivateAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113);
  }
  if (version === 6) {
    const ip = address.toLowerCase();
    if (ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip)) return true;
    const dotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = parseInt(hex[1],16), low = parseInt(hex[2],16);
      return isPrivateAddress([high >> 8, high & 255, low >> 8, low & 255].join('.'));
    }
    return false;
  }
  return true;
}
async function assertPublicHttpsUrl(value, lookup = dns.lookup) {
  let url;
  try { url = new URL(value); } catch { throw new Error('INVALID_PANEL_URL'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('INVALID_PANEL_URL');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isDisallowedHostname(hostname)) throw new Error('PANEL_URL_HOST_NOT_ALLOWED');
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('PANEL_URL_HOST_NOT_ALLOWED');
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error('PANEL_URL_HOST_NOT_ALLOWED');
}
function endpoint(baseUrl, path) {
  const base = String(baseUrl), cleanBase = base.endsWith('/') ? base.slice(0,-1) : base, part = String(path);
  return cleanBase + (part.startsWith('/') ? part : '/' + part);
}
async function readTextBounded(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('PANEL_RESPONSE_TOO_LARGE');
    return text;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value); size += chunk.length;
    if (size > maxBytes) { reader.cancel().catch(() => {}); throw new Error('PANEL_RESPONSE_TOO_LARGE'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
module.exports = { isDisallowedHostname, isPrivateAddress, assertPublicHttpsUrl, endpoint, readTextBounded };
