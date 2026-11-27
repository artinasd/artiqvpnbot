const { Markup } = require('telegraf');
const storage = require('./storage');

const DEFAULT_MESSAGE = '🔒 برای استفاده از ربات، ابتدا در کانال(های) ما عضو شوید. سپس روی «بررسی عضویت» بزنید.';

function getConfig() {
  return require('./bot-config').getConfig();
}

function normalizeForceJoin(config) {
  const raw = config?.bot?.forceJoin || {};
  const channels = Array.isArray(raw.channels) ? raw.channels : [];
  return {
    enabled: raw.enabled === true,
    message: String(raw.message || DEFAULT_MESSAGE),
    channels: channels.map((channel) => ({
      title: String(channel?.title || channel?.chatId || 'کانال').trim(),
      chatId: String(channel?.chatId || '').trim(),
      joinUrl: String(channel?.joinUrl || '').trim(),
    })).filter((channel) => channel.chatId && /^https?:\/\//i.test(channel.joinUrl)),
  };
}

function isMember(member) {
  const status = String(member?.status || '').toLowerCase();
  if (status === 'creator' || status === 'administrator' || status === 'member') return true;
  if (status === 'restricted') return member?.is_member === true;
  return false;
}

async function membershipStatus(ctx, { bypassCache = false } = {}) {
  const config = await getConfig();
  const gate = normalizeForceJoin(config);
  if (!gate.enabled || !gate.channels.length) return { enabled: false, joined: true, gate };

  const channelsKey = JSON.stringify(gate.channels.map((channel) => channel.chatId));
  const cacheKey = `force-join:ok:${ctx.from.id}`;
  if (!bypassCache) {
    const cached = await storage.get(cacheKey);
    if (cached?.channelsKey === channelsKey) return { enabled: true, joined: true, results: [], gate, cached: true };
  }

  const results = await Promise.all(gate.channels.map(async (channel) => {
    try {
      const member = await ctx.telegram.getChatMember(channel.chatId, ctx.from.id);
      return { channel, joined: isMember(member) };
    } catch (error) {
      console.error(JSON.stringify({ event: 'FORCE_JOIN_CHECK_FAILED', telegram_user_id: ctx.from?.id, chat_id: channel.chatId, error: error?.message || String(error) }));
      return { channel, joined: false, error: true };
    }
  }));

  const joined = results.every((item) => item.joined);
  if (joined) await storage.set(cacheKey, { channelsKey }, { exSeconds: 60 });
  return { enabled: true, joined, results, gate };
}

function promptKeyboard(gate) {
  const joinButton = gate.channels.length === 1
    ? { text: '📢 عضویت در کانال', url: gate.channels[0].joinUrl, style: 'primary' }
    : { text: '📢 عضویت در کانال‌ها', callback_data: 'force_join_channels', style: 'primary' };

  return Markup.inlineKeyboard([
    [joinButton],
    [{ text: '✅ بررسی عضویت', callback_data: 'force_join_check', style: 'success' }],
    [{ text: '🏠 منوی اصلی', callback_data: 'main_home', style: 'primary' }],
  ]);
}

function mainMenuKeyboard(config) {
  const b = config.buttons || {};
  return Markup.inlineKeyboard([
    [{ text: b.test || '🎁 دریافت اکانت تست', callback_data: 'main_test', style: 'success' }],
    [{ text: b.buy || '🛒 خرید اشتراک', callback_data: 'main_buy', style: 'primary' }],
    [{ text: b.wallet || '💰 کیف پول من', callback_data: 'main_wallet', style: 'primary' }, { text: b.account || '👤 حساب من', callback_data: 'main_account', style: 'primary' }],
    [{ text: b.support || '🎯 پشتیبانی', callback_data: 'main_support', style: 'primary' }],
  ]);
}

async function sendPrompt(ctx, gate) {
  const { formatScreenMessage, arrangeScreenRows } = require('./bot-config');
  const message = await formatScreenMessage('force_join', gate.message, {});
  const baseRows = promptKeyboard(gate).reply_markup.inline_keyboard;
  const rows = await arrangeScreenRows('force_join', baseRows);
  return ctx.reply(message, { reply_markup: { inline_keyboard: rows } });
}

async function handleJoinChannels(ctx) {
  const config = await getConfig();
  const gate = normalizeForceJoin(config);
  if (!gate.enabled || !gate.channels.length) return;
  await ctx.answerCbQuery().catch(() => {});
  const rows = gate.channels.map((channel) => ([{ text: `📢 ${channel.title}`, url: channel.joinUrl, style: 'primary' }]));
  rows.push([{ text: '✅ بررسی عضویت', callback_data: 'force_join_check', style: 'success' }]);
  rows.push([{ text: '🏠 منوی اصلی', callback_data: 'main_home', style: 'primary' }]);
  return ctx.reply('📢 لطفاً در کانال(های) زیر عضو شوید:', { reply_markup: { inline_keyboard: rows } });
}

async function handleCheck(ctx, { sendMainMenu } = {}) {
  const status = await membershipStatus(ctx, { bypassCache: true });
  await ctx.answerCbQuery(status.joined ? 'عضویت شما تأیید شد ✅' : 'هنوز عضویت کامل نیست ❌', { show_alert: false }).catch(() => {});
  if (!status.enabled || status.joined) {
    if (typeof sendMainMenu === 'function') return sendMainMenu(ctx);
    const config = await getConfig();
    return ctx.reply('✅ عضویت شما تأیید شد. خوش آمدید!', mainMenuKeyboard(config));
  }
  return sendPrompt(ctx, status.gate);
}

function shouldBypass(ctx) {
  if (!ctx.from) return true;
  if (String(ctx.chat?.type || '') !== 'private') return true;
  if (String(process.env.ADMIN_ID || '') === String(ctx.from.id)) return true;
  const data = String(ctx.callbackQuery?.data || '');
  return data === 'main_home' || data === 'force_join_channels' || data === 'force_join_check';
}

function createGateMiddleware({ sendMainMenu } = {}) {
  return async (ctx, next) => {
    if (shouldBypass(ctx)) {
      const data = String(ctx.callbackQuery?.data || '');
      if (data === 'force_join_channels') return handleJoinChannels(ctx);
      if (data === 'force_join_check') return handleCheck(ctx, { sendMainMenu });
      return next();
    }

    const status = await membershipStatus(ctx);
    if (!status.enabled || status.joined) return next();
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    return sendPrompt(ctx, status.gate);
  };
}

const gateMiddleware = createGateMiddleware();

module.exports = { normalizeForceJoin, membershipStatus, promptKeyboard, handleCheck, gateMiddleware, createGateMiddleware };
