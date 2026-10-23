const crypto = require('node:crypto');
const storage = require('./storage');

const KEY = 'cms:panels';
const SUPPORTED_TYPES = Object.freeze(['pasarguard']);
const STATUSES = Object.freeze(['pending', 'active', 'disabled', 'connection_error']);

function parseEncryptionKey(value = process.env.PANEL_CREDENTIALS_ENCRYPTION_KEY || '') {
  let key;
  if (/^[a-f0-9]{64}$/i.test(value)) key = Buffer.from(value, 'hex');
  else {
    try { key = Buffer.from(value, 'base64'); } catch { key = Buffer.alloc(0); }
  }
  if (key.length !== 32) throw new Error('PANEL_ENCRYPTION_KEY_MUST_BE_32_BYTES');
  return key;
}

function encryptSecret(secret, key) {
  if (typeof secret !== 'string' || !secret) throw new Error('PANEL_CREDENTIAL_REQUIRED');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function decryptSecret(envelope, key) {
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new Error('INVALID_ENCRYPTED_CREDENTIAL');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('PANEL_CREDENTIAL_DECRYPTION_FAILED');
  }
}

function validatePanelInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_PANEL');
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim();
  const type = String(input.type || '');
  if (id && !/^[a-zA-Z0-9_-]{2,64}$/.test(id)) throw new Error('INVALID_PANEL_ID');
  if (!name || name.length > 80) throw new Error('INVALID_PANEL_NAME');
  if (!SUPPORTED_TYPES.includes(type)) throw new Error('UNSUPPORTED_PANEL_TYPE');
  let url;
  try { url = new URL(String(input.baseUrl || '')); } catch { throw new Error('INVALID_PANEL_URL'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('INVALID_PANEL_URL');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host === '::1' || /^127\./.test(host) || /^10\./.test(host) ||
      /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '0.0.0.0') {
    throw new Error('PANEL_URL_HOST_NOT_ALLOWED');
  }
  return { id, name, type, baseUrl: url.toString().replace(/\/$/, '') };
}

function createPanelRegistry({ get = storage.get, set = storage.set, encryptionKey } = {}) {
  async function list() {
    const panels = await get(KEY);
    if (panels == null) return [];
    if (!Array.isArray(panels)) throw new Error('INVALID_PANEL_REGISTRY');
    return panels.map(({ credentials, ...panel }) => ({ ...panel, hasCredentials: Boolean(credentials) }));
  }

  async function getById(id) {
    const panels = await get(KEY);
    if (!Array.isArray(panels)) return null;
    const panel = panels.find((item) => item.id === String(id));
    if (!panel) return null;
    const { credentials, ...safe } = panel;
    return { ...safe, hasCredentials: Boolean(credentials) };
  }

  async function save(input) {
    const normalized = validatePanelInput(input);
    const panels = await get(KEY) || [];
    if (!Array.isArray(panels)) throw new Error('INVALID_PANEL_REGISTRY');
    const old = panels.find((panel) => panel.id === normalized.id);
    const id = normalized.id || crypto.randomUUID();
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id)) throw new Error('INVALID_PANEL_ID');
    const credentialInput = input.credentials;
    let credentials = old?.credentials || null;
    if (credentialInput !== undefined && credentialInput !== null && credentialInput !== '') {
      credentials = encryptSecret(String(credentialInput), encryptionKey || parseEncryptionKey());
    }
    if (!credentials) throw new Error('PANEL_CREDENTIAL_REQUIRED');
    const now = new Date().toISOString();
    const panel = {
      id, name: normalized.name, type: normalized.type, baseUrl: normalized.baseUrl,
      credentials, status: old?.status === 'disabled' ? 'disabled' : 'pending',
      createdAt: old?.createdAt || now, updatedAt: now,
    };
    const next = old ? panels.map((item) => item.id === id ? panel : item) : [...panels, panel];
    await set(KEY, next);
    const { credentials: ignored, ...safe } = panel;
    return { ...safe, hasCredentials: true };
  }

  async function setStatus(id, status) {
    if (!STATUSES.includes(status)) throw new Error('INVALID_PANEL_STATUS');
    const panels = await get(KEY);
    if (!Array.isArray(panels)) throw new Error('PANEL_NOT_FOUND');
    const current = panels.find((panel) => panel.id === String(id));
    if (!current) throw new Error('PANEL_NOT_FOUND');
    const next = panels.map((panel) => panel.id === String(id) ? { ...panel, status, updatedAt: new Date().toISOString() } : panel);
    await set(KEY, next);
    const { credentials, ...safe } = next.find((panel) => panel.id === String(id));
    return { ...safe, hasCredentials: Boolean(credentials) };
  }

  async function getCredentials(id) {
    const panels = await get(KEY);
    const panel = Array.isArray(panels) ? panels.find((item) => item.id === String(id)) : null;
    if (!panel) throw new Error('PANEL_NOT_FOUND');
    return decryptSecret(panel.credentials, encryptionKey || parseEncryptionKey());
  }

  return { list, getById, save, setStatus, getCredentials };
}

const registry = createPanelRegistry();
module.exports = { KEY, SUPPORTED_TYPES, STATUSES, validatePanelInput, parseEncryptionKey, encryptSecret, decryptSecret, createPanelRegistry, ...registry };
