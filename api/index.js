const { Telegraf, Markup } = require('telegraf');
const storage = require('../lib/storage');
const pg = require('../lib/pasarguard');
const { plans, getPlan, customPlan, formatPrice, durationSeconds } = require('../lib/plans');
const { normalizeSubscriptionName, buildSubscriptionUsername } = require('../lib/username');
const orders = require('../lib/orders');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const BANK_DETAILS = process.env.BANK_DETAILS || 'اطلاعات پرداخت در حال تنظیم است.';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || 'AtiqVPN';
const TEST_TEMPLATE = Number(process.env.PASARGUARD_TEMPLATE_TEST || 0);
const bot = new Telegraf(BOT_TOKEN || '000000000:placeholder');

function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function isAdmin(ctx) { return String(ctx.from?.id) === ADMIN_ID; }
function log(event, fields = {}) { console.log(JSON.stringify({ event, ...fields })); }
function userSummary(ctx) { return { id: String(ctx.from.id), username: ctx.from.username || null, first_name: ctx.from.first_name || null, last_name: ctx.from.last_name || null }; }
function stateKey(id) { return `flow:${id}`; }
async function getFlow(id) { return storage.getJson(stateKey(id)); }
async function setFlow(id, value) { return storage.setJson(stateKey(id), value, 1800); }
async function clearFlow(id) { return storage.deleteKey(stateKey(id)); }
async function saveUser(ctx, extra = {}) {
  const current = await storage.getUser(ctx.from.id) || { telegram_user_id: String(ctx.from.id), created_at: new Date().toISOString(), test_used: false, pasarguard_user_ids: [] };
  const next = { ...current, username: ctx.from.username || null, first_name: ctx.from.first_name || null, last_name: ctx.from.last_name || null, updated_at: new Date().toISOString(), ...extra };
  await storage.saveUser(next); await storage.addToSet('bot_users', String(ctx.from.id));
  return next;
}
async function latestFulfilledOrder(userId) {
  const ids = await storage.getSet(`orders:user:${userId}`);
  const ordersList = [];
  for (const id of ids) { const order = await storage.getOrder(id); if (order?.fulfillment_status === 'FULFILLED') ordersList.push(order); }
  ordersList.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return ordersList[0] || null;
}
function planButtons() { return plans.map(p => [Markup.button.callback(`${p.name} - ${formatPrice(p.price)}`, `plan:${p.id}`)]).concat([[Markup.button.callback('🛠 ساخت بسته دلخواه', 'custom:start')]]); }
function namePrompt(orderDraft) {
  return Markup.inlineKeyboard([[Markup.button.callback('⚡ نام خودکار', `auto_name:${orderDraft.planId}`)], [Markup.button.callback('❌ لغو', 'flow:cancel')]]);
}
function friendlyUsernameError(reason) {
  const messages = { ascii_only: '❌ نام اشتراک باید فقط با حروف انگلیسی، عدد، _ و @ باشد.', spaces: '❌ فاصله مجاز نیست. فقط حروف انگلیسی، عدد، _ و @ قابل استفاده است.', characters: '❌ فقط حروف انگلیسی، عدد، _ و @ مجاز است.', reserved_prefix: '❌ عبارت TG_ رزرو شده است و نمی‌توانید آن را وارد کنید.', reserved_fallback: '❌ این نام رزرو شده است. نام دیگری انتخاب کنید.', meaningless: '❌ این نام برای اشتراک قابل استفاده نیست.', too_short: '❌ نام اشتراک خیلی کوتاه است.' };
  return messages[reason] || '❌ نام اشتراک قابل قبول نیست.';
}
function receiptFromMessage(message) {
  if (message.photo?.length) return { type: 'photo', file_id: message.photo[message.photo.length - 1].file_id, message_id: message.message_id };
  if (message.document) return { type: 'document', file_id: message.document.file_id, message_id: message.message_id, file_name: message.document.file_name || null };
  return null;
}
async function notifyAdminReceipt(order, ctx) {
  const caption = `💰 <b>رسید پرداخت جدید</b>\n\nسفارش: <code>${escapeHtml(order.order_id)}</code>\nکاربر: ${escapeHtml(order.first_name || '')}\nآیدی: <code>${escapeHtml(order.telegram_user_id)}</code>\nیوزرنیم تلگرام: ${escapeHtml(order.telegram_username ? '@' + order.telegram_username : 'ندارد')}\nپلن: <b>${escapeHtml(order.plan_name)}</b>\nمبلغ: <b>${formatPrice(order.price)}</b>\nنام اشتراک: <code>${escapeHtml(order.generated_pasarguard_username)}</code>\nوضعیت: RECEIPT_SUBMITTED\n\n⚠️ رسید صرفاً برای ممیزی است؛ سفارش بدون انتظار برای تأیید، به‌صورت خودکار provision می‌شود.`;
  const buttons = Markup.inlineKeyboard([[Markup.button.callback('❌ پرداخت نامعتبر / غیرفعال‌سازی', `invalidate:${order.order_id}`)]]);
  if (order.receipt_type === 'photo') return bot.telegram.sendPhoto(ADMIN_ID, order.receipt_file_id, { caption, parse_mode: 'HTML', ...buttons });
  return bot.telegram.sendDocument(ADMIN_ID, order.receipt_file_id, { caption, parse_mode: 'HTML', ...buttons });
}
async function deliverOrder(order, chatId) {
  const text = `🎉 <b>اشتراک شما با موفقیت ساخته شد.</b>\n\n📦 سرویس: ${escapeHtml(order.plan_name)}\n📊 حجم: ${order.traffic_limit_bytes === 0 ? 'نامحدود' : `${(order.traffic_limit_bytes / (1024 ** 3)).toFixed(2)} GB`}\n⏳ اعتبار: ${escapeHtml(order.actual_expire || 'طبق تنظیمات PasarGuard')}\n👤 نام اشتراک: <code>${escapeHtml(order.generated_pasarguard_username)}</code>\n\n🔗 لینک اشتراک:\n<code>${escapeHtml(order.subscription_url)}</code>`;
  await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.url('🔗 باز کردن لینک اشتراک', order.subscription_url)]]) });
}
async function sendFriendlyFailure(ctx, order) {
  await ctx.reply('در حال حاضر در ساخت اشتراک مشکلی پیش آمده است. سفارش شما ثبت شده و در صف بررسی خودکار قرار دارد. لطفاً چند دقیقه بعد دوباره وضعیت را بررسی کنید.');
  if (isAdmin(ctx)) return;
  try { await bot.telegram.sendMessage(ADMIN_ID, `⚠️ <b>Fulfillment failed</b>\nسفارش: <code>${escapeHtml(order.order_id)}</code>\nکاربر: <code>${escapeHtml(order.telegram_user_id)}</code>\nنام PasarGuard: <code>${escapeHtml(order.generated_pasarguard_username)}</code>\nخطا: ${escapeHtml(order.failure_reason || 'unknown')}`, { parse_mode: 'HTML' }); } catch (_) {}
}

bot.start(async ctx => {
  await saveUser(ctx);
  await clearFlow(ctx.from.id);
  await ctx.reply('👋 به ربات آتی‌کیو‌وی‌پی‌ان خوش آمدید!\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:', Markup.keyboard([['🎁 دریافت اکانت تست'], ['🛒 خرید اشتراک'], ['👤 حساب من'], ['🎯 پشتیبانی']]).resize());
});

bot.hears('🛒 خرید اشتراک', async ctx => { await saveUser(ctx); await ctx.reply('📋 لطفاً بسته مورد نظر خود را انتخاب کنید:', Markup.inlineKeyboard(planButtons())); });
bot.hears('🎯 پشتیبانی', async ctx => ctx.reply(`💬 پشتیبانی: @${SUPPORT_USERNAME}`));
bot.hears('👤 حساب من', async ctx => {
  const order = await latestFulfilledOrder(ctx.from.id);
  if (!order) return ctx.reply('هنوز اشتراک فعالی برای حساب شما ثبت نشده است.');
  let live = null;
  if (order.pasarguard_user_id) { try { live = await pg.getUserById(order.pasarguard_user_id); } catch (_) {} }
  const traffic = live?.data_limit ?? order.traffic_limit_bytes;
  const used = live?.used_traffic ?? order.used_traffic_bytes;
  const expire = live?.expire ?? order.actual_expire;
  await ctx.reply(`👤 <b>حساب من</b>\n\nنام اشتراک: <code>${escapeHtml(live?.username || order.generated_pasarguard_username)}</code>\n📊 حجم: ${traffic === 0 ? 'نامحدود' : `${(traffic / 1024 ** 3).toFixed(2)} GB`}\n📈 مصرف: ${used == null ? 'نامشخص' : `${(used / 1024 ** 3).toFixed(2)} GB`}\n⏳ انقضا: ${escapeHtml(expire || 'نامحدود')}\n🔘 وضعیت: ${escapeHtml(live?.status || order.status || 'unknown')}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.url('📥 دریافت لینک اشتراک', order.subscription_url)]]) });
});

bot.hears('🎁 دریافت اکانت تست', async ctx => {
  const user = await saveUser(ctx);
  if (user.test_used) return ctx.reply('❌ شما قبلاً اکانت تست دریافت کرده‌اید.');
  if (!TEST_TEMPLATE) return ctx.reply('❌ اکانت تست در حال حاضر توسط مدیریت تنظیم نشده است.');
  if (!(await storage.acquireLock(`test:${ctx.from.id}`, 90))) return ctx.reply('⏳ درخواست شما در حال پردازش است.');
  try {
    const generated = buildSubscriptionUsername({ telegramUsername: ctx.from.username, customName: null });
    let created = null;
    for (let i = 0; i < 8; i += 1) {
      try { created = await pg.createFromTemplate(TEST_TEMPLATE, generated.username, `Telegram test ${ctx.from.id}`); break; }
      catch (err) { if (err.status !== 409) throw err; }
    }
    if (!created?.id && !created?.user_id) throw new Error('test_creation_failed');
    const pgId = created.id ?? created.user_id;
    const live = await pg.getUserById(pgId);
    const url = live.subscription_url || live.subscriptionUrl || live.subscription?.url;
    if (!url) throw new Error('test_subscription_url_missing');
    await saveUser(ctx, { test_used: true, test_created_at: new Date().toISOString(), pasarguard_user_ids: [...(user.pasarguard_user_ids || []), pgId] });
    log('TEST_FULFILLED', { telegram_user_id: ctx.from.id, pasarguard_username: live.username });
    await ctx.reply(`🎁 <b>اکانت تست شما آماده است.</b>\n\n👤 نام اشتراک: <code>${escapeHtml(live.username)}</code>\n🔗 لینک اشتراک:\n<code>${escapeHtml(url)}</code>`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.url('🔗 باز کردن لینک اشتراک', url)]]) });
  } catch (err) { log('TEST_FAILED', { telegram_user_id: ctx.from.id, error: err.message }); await ctx.reply('❌ ساخت اکانت تست موقتاً با مشکل مواجه شد. لطفاً بعداً دوباره تلاش کنید.'); }
  finally { await storage.releaseLock(`test:${ctx.from.id}`); }
});

bot.command('pingdb', async ctx => { if (!isAdmin(ctx)) return; try { await storage.setJson('health:ping', { at: new Date().toISOString() }, 10); await ctx.reply('✅ Redis: OK'); } catch (err) { await ctx.reply(`❌ Redis: ${escapeHtml(err.message)}`); } });
bot.command('status', async ctx => {
  if (!isAdmin(ctx)) return;
  let redis = 'OK', pasar = 'OK';
  try { await storage.setJson('health:status', { at: Date.now() }, 10); } catch (_) { redis = 'FAIL'; }
  try { if (!pg.configured()) throw new Error('not configured'); await pg.ping(); } catch (_) { pasar = 'FAIL'; }
  let pending = 0, failed = 0;
  for (const id of await storage.listOrderIds()) { const o = await storage.getOrder(id); if (['AWAITING_RECEIPT', 'PROVISIONING'].includes(o?.fulfillment_status)) pending += 1; if (o?.fulfillment_status === 'FAILED_RECOVERABLE') failed += 1; }
  await ctx.reply(`🤖 Telegram bot: OK\n🗄 Redis: ${redis}\n🛡 PasarGuard: ${pasar}\n⏳ Pending: ${pending}\n❌ Failed: ${failed}`);
});
bot.command('users', async ctx => { if (!isAdmin(ctx)) return; await ctx.reply(`📊 کاربران ثبت‌شده: ${(await storage.listUserIds()).length}`); });
bot.command('orders', async ctx => { if (!isAdmin(ctx)) return; const ids = await storage.listOrderIds(); const recent = []; for (const id of ids) { const o = await storage.getOrder(id); if (o) recent.push(o); } recent.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))); await ctx.reply(recent.slice(0,10).map(o=>`<code>${escapeHtml(o.order_id)}</code> | ${escapeHtml(o.fulfillment_status)} | <code>${escapeHtml(o.generated_pasarguard_username)}</code>`).join('\n') || 'سفارشی وجود ندارد.', { parse_mode: 'HTML' }); });
bot.command('failed', async ctx => { if (!isAdmin(ctx)) return; const failed=[]; for(const id of await storage.listOrderIds()){const o=await storage.getOrder(id);if(o?.fulfillment_status==='FAILED_RECOVERABLE')failed.push(o);} await ctx.reply(failed.slice(0,15).map(o=>`<code>${escapeHtml(o.order_id)}</code> | ${escapeHtml(o.failure_reason||'unknown')}`).join('\n')||'خطای قابل بازیابی وجود ندارد.',{parse_mode:'HTML'}); });
bot.command('broadcast', async ctx => {
  if (!isAdmin(ctx)) return;
  const text = ctx.message.text.replace(/^\/broadcast\s*/, '').trim();
  if (!text && !ctx.message.reply_to_message) return ctx.reply('❌ متن پیام یا Reply لازم است.');
  const ids = await storage.listUserIds(); let ok=0, failed=0;
  for (const id of ids) { try { if(ctx.message.reply_to_message) await ctx.telegram.copyMessage(id, ctx.chat.id, ctx.message.reply_to_message.message_id); else await ctx.telegram.sendMessage(id,text); ok++; await new Promise(r=>setTimeout(r,60)); } catch(err){ failed++; if(String(err.description||'').includes('blocked')) await storage.removeFromSet('bot_users',id); } }
  await ctx.reply(`✅ ارسال پایان یافت. موفق: ${ok}\nناموفق: ${failed}`);
});

bot.on('callback_query', async ctx => {
  const data = String(ctx.callbackQuery.data || '');
  await ctx.answerCbQuery().catch(() => {});
  if (data === 'flow:cancel') { await clearFlow(ctx.from.id); return ctx.reply('لغو شد.'); }
  if (data.startsWith('plan:')) {
    const plan = getPlan(data.slice(5));
    if (!plan) return ctx.reply('❌ پلن نامعتبر است.');
    await setFlow(ctx.from.id, { stage: 'NAME', planId: plan.id });
    return ctx.reply('📝 اگر می‌خواهید نام دلخواهی برای اشتراک خود انتخاب کنید، وارد کنید؛ در غیر این صورت نام به صورت خودکار ساخته می‌شود.', namePrompt({ planId: plan.id }));
  }
  if (data.startsWith('auto_name:')) {
    const flow = await getFlow(ctx.from.id); const plan = getPlan(data.slice(10));
    if (!flow || !plan || flow.planId !== plan.id) return ctx.reply('❌ این درخواست منقضی شده است.');
    return createOrderForUser(ctx, plan, null);
  }
  if (data === 'custom:start') { await setFlow(ctx.from.id, { stage: 'CUSTOM_TRAFFIC' }); return ctx.reply('🛠 حجم را به عدد صحیح گیگابایت وارد کنید (۱ تا ۱۰۰۰).'); }
  if (data.startsWith('invalidate:')) {
    if (!isAdmin(ctx)) return;
    const order = await storage.getOrder(data.slice(11));
    if (!order) return ctx.reply('❌ سفارش پیدا نشد.');
    if (!order.pasarguard_user_id) return ctx.reply('ℹ️ برای این سفارش هنوز کاربر PasarGuard ثبت نشده است.');
    try { await pg.disableUserById(order.pasarguard_user_id, true); await orders.updateOrder(order, { payment_status: 'PAYMENT_LATER_REJECTED', fulfillment_status: 'PAYMENT_LATER_REJECTED', invalidated_at: new Date().toISOString() }, 'PAYMENT_INVALIDATED'); await bot.telegram.sendMessage(order.telegram_user_id, '❌ پرداخت شما توسط مدیریت نامعتبر تشخیص داده شد و اشتراک مربوطه غیرفعال شد. در صورت اعتراض با پشتیبانی تماس بگیرید.'); await ctx.reply('✅ سفارش ثبت و اشتراک غیرفعال شد.'); } catch (err) { await ctx.reply('❌ غیرفعال‌سازی انجام نشد؛ جزئیات فنی در لاگ ثبت شد.'); log('INVALIDATION_FAILED', { order_id: order.order_id, pasarguard_user_id: order.pasarguard_user_id, error: err.message }); }
  }
});

async function createOrderForUser(ctx, plan, requestedName) {
  try {
    const order = await orders.createOrder({ telegramUser: userSummary(ctx), plan, requestedName });
    if (!order.plan_template_id) { await orders.updateOrder(order, { fulfillment_status: 'FAILED_RECOVERABLE', failure_reason: 'plan_template_not_configured' }); return ctx.reply('❌ این پلن هنوز توسط مدیریت به PasarGuard متصل نشده است.'); }
    await setFlow(ctx.from.id, { stage: 'RECEIPT', orderId: order.order_id });
    return ctx.reply(`💳 <b>اطلاعات پرداخت</b>\n\nپلن: <b>${escapeHtml(plan.name)}</b>\nمبلغ: <b>${formatPrice(plan.price)}</b>\nنام اشتراک: <code>${escapeHtml(order.generated_pasarguard_username)}</code>\nسفارش: <code>${escapeHtml(order.order_id)}</code>\n\n${escapeHtml(BANK_DETAILS)}\n\n📸 پس از پرداخت، رسید را همینجا ارسال کنید. رسید برای ممیزی مدیریت ذخیره می‌شود، اما ساخت اشتراک منتظر تأیید دستی نمی‌ماند.`, { parse_mode: 'HTML' });
  } catch (err) { return ctx.reply(friendlyUsernameError(err.message)); }
}

bot.on('message', async ctx => {
  await saveUser(ctx);
  const flow = await getFlow(ctx.from.id);
  if (!flow) return;
  if (flow.stage === 'NAME') {
    if (!ctx.message.text) return ctx.reply('❌ لطفاً نام اشتراک را به صورت متن بفرستید یا روی «نام خودکار» بزنید.');
    const normalized = normalizeSubscriptionName(ctx.message.text);
    if (!normalized.ok) return ctx.reply(friendlyUsernameError(normalized.reason));
    const plan = getPlan(flow.planId); if (!plan) return ctx.reply('❌ پلن منقضی شده است.');
    return createOrderForUser(ctx, plan, normalized.value);
  }
  if (flow.stage === 'CUSTOM_TRAFFIC') {
    const traffic = Number(String(ctx.message.text || '').trim());
    if (!Number.isInteger(traffic) || traffic < 1 || traffic > 1000) return ctx.reply('❌ حجم باید یک عدد صحیح بین ۱ تا ۱۰۰۰ گیگابایت باشد.');
    await setFlow(ctx.from.id, { stage: 'CUSTOM_DURATION', traffic }); return ctx.reply('⏳ مدت را به عدد صحیح روز وارد کنید (۱ تا ۱۵۰ روز).');
  }
  if (flow.stage === 'CUSTOM_DURATION') {
    const duration = Number(String(ctx.message.text || '').trim());
    const plan = customPlan(flow.traffic, duration);
    if (!plan) return ctx.reply('❌ مدت باید یک عدد صحیح بین ۱ تا ۱۵۰ روز باشد.');
    await setFlow(ctx.from.id, { stage: 'NAME', planId: plan.id, customPlan: plan });
    return ctx.reply(`✅ بسته ${plan.trafficBytes / 1024 ** 3} گیگابایت / ${plan.durationDays} روز\n💳 ${formatPrice(plan.price)}\n\nنام دلخواه را وارد کنید یا نام خودکار را انتخاب کنید.`, namePrompt({ planId: plan.id }));
  }
  if (flow.stage === 'RECEIPT') {
    const receipt = receiptFromMessage(ctx.message);
    if (!receipt) return ctx.reply('❌ لطفاً فقط تصویر رسید یا فایل رسید را ارسال کنید.');
    const order = await storage.getOrder(flow.orderId);
    if (!order) { await clearFlow(ctx.from.id); return ctx.reply('❌ سفارش پیدا نشد. لطفاً خرید را دوباره شروع کنید.'); }
    if (order.receipt_file_id) return ctx.reply('✅ این رسید قبلاً ثبت شده و سفارش شما در حال پردازش است.');
    try {
      const withReceipt = await orders.attachReceipt(order.order_id, receipt);
      await clearFlow(ctx.from.id);
      await notifyAdminReceipt(withReceipt, ctx).catch(err => log('ADMIN_RECEIPT_NOTIFY_FAILED', { order_id: order.order_id, error: err.message }));
      await ctx.reply('✅ رسید دریافت شد و برای ممیزی مدیریت ذخیره شد. ساخت اشتراک را همین حالا به‌صورت خودکار شروع می‌کنیم.');
      try { const fulfilled = await orders.fulfillOrder(order.order_id); await deliverOrder(fulfilled, ctx.chat.id); }
      catch (err) { const failed = await storage.getOrder(order.order_id); await sendFriendlyFailure(ctx, failed || order); }
    } catch (err) { await ctx.reply('❌ ثبت رسید انجام نشد. لطفاً دوباره ارسال کنید.'); }
  }
});

bot.catch(async (err, ctx) => { log('BOT_ERROR', { update_type: ctx?.updateType, error: String(err.message || err) }); });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ArtiQ VPN bot is active.');
  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) return res.status(403).send('Unauthorized');
  try { await bot.handleUpdate(req.body); return res.status(200).send('OK'); }
  catch (err) { log('WEBHOOK_ERROR', { error: String(err.message || err) }); return res.status(200).send('OK'); }
};
