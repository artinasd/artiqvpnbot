const crypto = require('crypto');

const ALLOWED = /^[A-Za-z0-9_@]+$/;
const SUFFIX_LENGTH = 4;
const MAX_BASE_LENGTH = 24;

function randomSuffix() {
  return crypto.randomBytes(3).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, SUFFIX_LENGTH).padEnd(SUFFIX_LENGTH, 'A');
}

function normalizeSubscriptionName(input) {
  const value = String(input ?? '').trim();
  if (!value) return null;

  if (/[^\x00-\x7F]/.test(value)) {
    throw new Error('USERNAME_ENGLISH_ONLY');
  }
  if (/\s/.test(value)) {
    throw new Error('USERNAME_NO_SPACES');
  }
  if (!ALLOWED.test(value)) {
    throw new Error('USERNAME_INVALID_CHARACTERS');
  }

  const withoutPrefix = value.replace(/^TG_+/i, '');
  if (!withoutPrefix || /^@+$/.test(withoutPrefix) || /^_+$/.test(withoutPrefix)) {
    throw new Error('USERNAME_TOO_GENERIC');
  }

  const base = withoutPrefix.slice(0, MAX_BASE_LENGTH);
  if (!/[A-Za-z0-9]/.test(base)) {
    throw new Error('USERNAME_TOO_GENERIC');
  }
  return base;
}

function buildUsername({ telegramUsername, customName }) {
  let base;
  if (customName != null && String(customName).trim() !== '') {
    base = normalizeSubscriptionName(customName);
  } else if (telegramUsername) {
    base = normalizeSubscriptionName(String(telegramUsername).replace(/^@/, ''));
  } else {
    // The business requirement explicitly allows avoiding the underscore immediately before @.
    // This is the only deliberate exception to the usual TG_ prefix rule.
    base = '@AtiqVPN';
  }

  if (!base) base = '@AtiqVPN';
  return `TG_${base}_${randomSuffix()}`;
}

function isBotUsername(username) {
  return typeof username === 'string' && (username.startsWith('TG_') || username.startsWith('TG@'));
}

module.exports = {
  normalizeSubscriptionName,
  buildUsername,
  isBotUsername,
  randomSuffix,
};
