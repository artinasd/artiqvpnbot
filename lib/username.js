const crypto = require('crypto');

const ALLOWED = /^[A-Za-z0-9_@]+$/;
const SUFFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function normalizeSubscriptionName(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'empty' };
  const value = input.trim();
  if (!value) return { ok: false, reason: 'empty' };
  if (/[^\x00-\x7F]/.test(value)) return { ok: false, reason: 'ascii_only' };
  if (/\s/.test(value)) return { ok: false, reason: 'spaces' };
  if (!ALLOWED.test(value)) return { ok: false, reason: 'characters' };
  if (/^TG_/i.test(value)) return { ok: false, reason: 'reserved_prefix' };
  if (/^@?AtiqVPN$/i.test(value)) return { ok: false, reason: 'reserved_fallback' };
  if (/^_+$/.test(value) || /^@+$/.test(value)) return { ok: false, reason: 'meaningless' };
  if (value.length < 2) return { ok: false, reason: 'too_short' };
  return { ok: true, value };
}

function randomSuffix(length = 4) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i += 1) result += SUFFIX_ALPHABET[bytes[i] % SUFFIX_ALPHABET.length];
  return result;
}

function buildSubscriptionUsername({ telegramUsername, customName }) {
  let base;
  let fallback = false;
  if (customName != null && String(customName).trim() !== '') {
    const normalized = normalizeSubscriptionName(String(customName));
    if (!normalized.ok) return normalized;
    base = normalized.value;
  } else if (telegramUsername) {
    const normalized = normalizeSubscriptionName(String(telegramUsername).replace(/^@+/, ''));
    if (!normalized.ok) { base = '@AtiqVPN'; fallback = true; } else base = normalized.value;
  } else {
    base = '@AtiqVPN';
    fallback = true;
  }

  const suffix = randomSuffix(4);
  return { ok: true, base, fallback, username: fallback ? `TG@AtiqVPN_${suffix}` : `TG_${base}_${suffix}` };
}

function isBotUsername(username) {
  return typeof username === 'string' && (username.startsWith('TG_') || username.startsWith('TG@'));
}

module.exports = { normalizeSubscriptionName, randomSuffix, buildSubscriptionUsername, isBotUsername };
