const { Telegraf, Markup } = require('telegraf');
const { getConfig } = require('./bot-config');

const DEFAULT_MESSAGE = '🔒 برای استفاده از ربات، ابتدا در کانال(های) ما عضو شوید. سپس روی «بررسی عضویت» بزنید.';

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

async function membershipStatus(ctx) {
  const config = await getConfig();
  const gate = normalizeForceJoin(config);
  if (!gate.enabled || !gate.channels.length) return { enabled: false, joined: true, gate };

  const results = [];
  for (const channel of gate.channels) {
    try {
      const member = await ctx.telegram.getChatMember(channel.chatId, ctx.from.id);
      results.push({ channel, joined: isMember(member) });
    } catch (error) {
      console.error(JSON.stringify({ event: 'FORCE_JOIN_CHECK_FAILED', telegram_user_id: ctx.from?.id, chat_id: channel.chatId, error: error?.message || String(error) }));
      results.push({ channel, joined: false, error: true });
    }
  }

  return { enabled: true, joined: results.every((item) => item.joined), results, gate };
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
  return ctx.reply(gate.message, promptKeyboard(gate));
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

async function handleCheck(ctx) {
  const status = await membershipStatus(ctx);
  await ctx.answerCbQuery(status.joined ? 'عضویت شما تأیید شد ✅' : 'هنوز عضویت کامل نیست ❌', { show_alert: false }).catch(() => {});
  if (!status.enabled || status.joined) {
    const config = await getConfig();
    return ctx.reply('✅ عضویت شما تأیید شد. خوش آمدید!', mainMenuKeyboard(config));
  }
  return sendPrompt(ctx, status.gate);
}

function shouldBypass(ctx) {
  if (!ctx.from) return true;
  if (String(ctx.chat?.type || '') !== 'private') return true;
  if (String(ctx.callbackQuery?.data || '') === 'main_home') return true;
  const data = String(ctx.callbackQuery?.data || '');
  return data === 'force_join_channels' || data === 'force_join_check';
}

if (!Telegraf.prototype.__artiqForceJoinPatched) {
  const nativeUse = Telegraf.prototype.use;
  Telegraf.prototype.use = function patchedUse(...middlewares) {
    const gateMiddleware = async (ctx, next) => {
      if (shouldBypass(ctx)) {
        const data = String(ctx.callbackQuery?.data || '');
        if (data === 'force_join_channels') return handleJoinChannels(ctx);
        if (data === 'force_join_check') return handleCheck(ctx);
        return next();
      }

      const status = await membershipStatus(ctx);
      if (!status.enabled || status.joined) return next();
      return sendPrompt(ctx, status.gate);
    };
    return nativeUse.call(this, gateMiddleware, ...middlewares);
  };
  Telegraf.prototype.__artiqForceJoinPatched = true;
}

module.exports = { normalizeForceJoin, membershipStatus, promptKeyboard };
