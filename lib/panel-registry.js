const crypto = require('node:crypto');
const storage = require('./storage');
const net = require('node:net');
const { isDisallowedHostname, isPrivateAddress } = require('./panel-network');

const KEY = 'cms:panels';
const SUPPORTED_TYPES = Object.freeze(['pasarguard', 'artiq_master']);
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

function normalizeCredentials(value, type = 'pasarguard') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PANEL_CREDENTIAL_REQUIRED');
  if (type === 'artiq_master') {
    const token = String(value.token || value.password || '').trim();
    const panelId = String(value.panelId || value.username || '').trim();
    if (!token || token.length > 2000 || panelId.length > 200) throw new Error('PANEL_CREDENTIAL_REQUIRED');
    return { token, ...(panelId ? { panelId } : {}) };
  }
  const username = String(value.username || '').trim();
  const password = String(value.password || '');
  if (!username || username.length > 200 || !password || password.length > 2000) throw new Error('PANEL_CREDENTIAL_REQUIRED');
  return { username, password };
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
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isDisallowedHostname(host) || (net.isIP(host) && isPrivateAddress(host))) throw new Error('PANEL_URL_HOST_NOT_ALLOWED');
  return { id, name, type, baseUrl: url.toString().replace(/\/$/, '') };
}

function createPanelRegistry({ get = storage.get, set = storage.set, encryptionKey } = {}) {
  async function list() {
    const panels = await get(KEY);
    if (panels == null) return [];
    if (!Array.isArray(panels)) throw new Error('INVALID_PANEL_REGISTRY');
    return panels.filter((panel) => panel.type !== 'master').map(({ credentials, ...panel }) => ({ ...panel, hasCredentials: Boolean(credentials) }));
  }

  async function getById(id) {
    const panels = await get(KEY);
    if (!Array.isArray(panels)) return null;
    const panel = panels.find((item) => item.id === String(id) && item.type !== 'master');
    if (!panel) return null;
    const { credentials, ...safe } = panel;
    return { ...safe, hasCredentials: Boolean(credentials) };
  }

  async function save(input) {
    const normalized = validatePanelInput(input);
    const panels = await get(KEY) || [];
    if (!Array.isArray(panels)) throw new Error('INVALID_PANEL_REGISTRY');
    const old = panels.find((panel) => panel.id === normalized.id && panel.type !== 'master');
    if (normalized.id && !old) throw new Error('PANEL_NOT_FOUND');
    const id = normalized.id || crypto.randomUUID();
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id)) throw new Error('INVALID_PANEL_ID');
    const credentialInput = input.credentials;
    let credentials = old?.credentials || null;
    if (credentialInput !== undefined && credentialInput !== null && credentialInput !== '') {
      const normalizedCredentials = normalizeCredentials(credentialInput, normalized.type);
      credentials = encryptSecret(JSON.stringify(normalizedCredentials), encryptionKey || parseEncryptionKey());
    }
    if (!credentials) throw new Error('PANEL_CREDENTIAL_REQUIRED');
    const now = new Date().toISOString();
    const connectionDetailsChanged = !old || old.baseUrl !== normalized.baseUrl || old.type !== normalized.type ||
      (credentialInput !== undefined && credentialInput !== null && credentialInput !== '');
    const status = old?.status === 'disabled' ? 'disabled' : (connectionDetailsChanged ? 'pending' : (old?.status || 'pending'));
    const panel = {
      id, name: normalized.name, type: normalized.type, baseUrl: normalized.baseUrl,
      credentials, status,
      createdAt: old?.createdAt || now, updatedAt: now,
    };
    const next = old ? panels.map((item) => item.id === id ? panel : item) : [...panels, panel];
    await set(KEY, next);
    const { credentials: ignored, ...safe } = panel;
    return { ...safe, hasCredentials: Boolean(credentials) };
  }

  async function setStatus(id, status) {
    if (!STATUSES.includes(status)) throw new Error('INVALID_PANEL_STATUS');
    const panels = await get(KEY);
    if (!Array.isArray(panels)) throw new Error('PANEL_NOT_FOUND');
    const current = panels.find((panel) => panel.id === String(id) && panel.type !== 'master');
    if (!current) throw new Error('PANEL_NOT_FOUND');
    const next = panels.map((panel) => panel.id === String(id) ? { ...panel, status, updatedAt: new Date().toISOString() } : panel);
    await set(KEY, next);
    const { credentials, ...safe } = next.find((panel) => panel.id === String(id));
    return { ...safe, hasCredentials: Boolean(credentials) };
  }

  async function getCredentials(id) {
    const panels = await get(KEY);
    const panel = Array.isArray(panels) ? panels.find((item) => item.id === String(id) && item.type !== 'master') : null;
    if (!panel) throw new Error('PANEL_NOT_FOUND');
    try { return JSON.parse(decryptSecret(panel.credentials, encryptionKey || parseEncryptionKey())); } catch (error) { if (error?.message === 'PANEL_CREDENTIAL_DECRYPTION_FAILED') throw error; throw new Error('INVALID_PANEL_CREDENTIAL_PAYLOAD'); }
  }

  return { list, getById, save, setStatus, getCredentials };
}

const registry = createPanelRegistry();
module.exports = { KEY, SUPPORTED_TYPES, STATUSES, validatePanelInput, normalizeCredentials, parseEncryptionKey, encryptSecret, decryptSecret, createPanelRegistry, ...registry };
