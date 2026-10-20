function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function gregorianTehranDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatJalaliDateTime(date) {
  const dateParts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const dateValues = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const timeParts = new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const timeValues = Object.fromEntries(timeParts.map((part) => [part.type, part.value]));
  return `${dateValues.year}/${dateValues.month}/${dateValues.day} - ${timeValues.hour}:${timeValues.minute}`;
}

async function recordFirstStart(storage, telegramUser, now = new Date()) {
  if (!telegramUser?.id) return null;

  const id = String(telegramUser.id);
  const existing = await storage.getUserRaw(id);
  if (existing) return null;

  // Prevent duplicate reports if Telegram retries the same first /start update.
  const claimed = await storage.set(`new_user_reported:${id}`, true, { nx: true });
  if (claimed !== 'OK') return null;

  const user = {
    telegramUserId: telegramUser.id,
    username: telegramUser.username || null,
    firstName: telegramUser.first_name || null,
    lastName: telegramUser.last_name || null,
    languageCode: telegramUser.language_code || null,
    updatedAt: now.toISOString(),
  };
  await storage.saveUser(user);

  const dayKey = gregorianTehranDateKey(now);
  await storage.sadd(`new_users:${dayKey}`, id);
  const [todayIds, allIds] = await Promise.all([
    storage.smembers(`new_users:${dayKey}`),
    storage.smembers('bot_users'),
  ]);

  const name = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') || 'نامشخص';
  const username = telegramUser.username ? `@${telegramUser.username}` : 'ندارد';
  const language = telegramUser.language_code || 'نامشخص';

  return [
    '🆕 | کاربر تازه وارد شد',
    '',
    '👥 مشخصات کاربر',
    `🆔 آیدی: ${escapeHtml(id)}`,
    `👤 اسم: ${escapeHtml(name)}`,
    `⚡️ نام کاربری: ${escapeHtml(username)}`,
    `🌐 زبان تلگرام: ${escapeHtml(language)}`,
    '',
    '📈 آمار عضویت',
    `🆕 امروز: ${todayIds.length.toLocaleString('fa-IR')}`,
    `👥 مجموع کاربران: ${allIds.length.toLocaleString('fa-IR')}`,
    '',
    `🗓 ${formatJalaliDateTime(now)}`,
  ].join('\n');
}

module.exports = { recordFirstStart, formatJalaliDateTime, gregorianTehranDateKey };
