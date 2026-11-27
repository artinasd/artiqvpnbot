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
  if (/[^\x00-\x7F]/.test(value)) throw new Error('USERNAME_ENGLISH_ONLY');
  if (/\s/.test(value)) throw new Error('USERNAME_NO_SPACES');
  if (!ALLOWED.test(value)) throw new Error('USERNAME_INVALID_CHARACTERS');

  if (/^@+$/.test(value) || /^_+$/.test(value) || !/[A-Za-z0-9]/.test(value)) throw new Error('USERNAME_TOO_GENERIC');
  return value.slice(0, MAX_BASE_LENGTH);
}

function buildUsername({ telegramUsername, customName, telegramUserId, collisionRetry = false } = {}) {
  let base = null;
  if (customName != null && String(customName).trim() !== '') {
    base = normalizeSubscriptionName(customName);
  } else if (telegramUsername) {
    try {
      base = normalizeSubscriptionName(String(telegramUsername).replace(/^@/, ''));
    } catch {
      base = null;
    }
  }
  if (!base && telegramUserId != null && String(telegramUserId).trim() !== '') {
    const numericId = String(telegramUserId).replace(/\D/g, '');
    base = numericId || normalizeSubscriptionName(String(telegramUserId));
  }
  if (!base) base = 'user';

  if (collisionRetry) return `${base.slice(0, MAX_BASE_LENGTH)}_${randomSuffix()}`;
  return base;
}

function isBotUsername(username) {
  return typeof username === 'string' && (username.startsWith('TG_') || username.startsWith('TG@'));
}

module.exports = { normalizeSubscriptionName, buildUsername, isBotUsername, randomSuffix };
