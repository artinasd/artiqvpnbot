const { Telegraf, Markup } = require('telegraf');
const crypto = require('crypto');

const env = process.env;
const BOT_TOKEN = env.BOT_TOKEN;
const ADMIN_ID = String(env.ADMIN_ID || '');
const WEBHOOK_SECRET = env.WEBHOOK_SECRET || '';
const SUPPORT_USERNAME = env.SUPPORT_USERNAME || '';
const BANK_DETAILS = env.BANK_DETAILS || '';
const UPSTASH_URL = (env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const UPSTASH_TOKEN = env.UPSTASH_REDIS_REST_TOKEN || '';
const PG_BASE_URL = (env.PASARGUARD_BASE_URL || '').replace(/\/$/, '');
const PG_USERNAME = env.PASARGUARD_USERNAME || '';
const PG_PASSWORD = env.PASARGUARD_PASSWORD || '';
const ATTRIBUTION = '@AtiqVPN';
const MAX_FULFILL_ATTEMPTS = 8;

const PLANS = [
  { id: 'plan_1mo', name: 'اشتراک نامحدود (۱ ماهه)', price: 199000, trafficBytes: 0, durationDays: 30, templateId: env.PASARGUARD_TEMPLATE_1MO },
  { id: 'plan_2mo', name: 'اشتراک نامحدود (۲ ماهه)', price: 299000, trafficBytes: 0, durationDays: 60, templateId: env.PASARGUARD_TEMPLATE_2MO },
  { id: 'plan_10g', name: 'اشتراک ۱۰ گیگابایت (۱ ماهه)', price: 40000, trafficBytes: 10 * 1024 ** 3, durationDays: 30, templateId: env.PASARGUARD_TEMPLATE_10GB },
  { id: 'plan_20g', name: 'اشتراک ۲۰ گیگابایت (۱ ماهه)', price: 70000, trafficBytes: 20 * 1024 ** 3, durationDays: 30, templateId: env.PASARGUARD_TEMPLATE_20GB },
  { id: 'plan_50g', name: 'اشتراک ۵۰ گیگابایت (۲ ماهه)', price: 150000, trafficBytes: 50 * 1024 ** 3, durationDays: 60, templateId: env.PASARGUARD_TEMPLATE_50GB },
  { id: 'plan_200g', name: 'اشتراک ۲۰۰ گیگابایت (۱ ماهه)', price: 200000, trafficBytes: 200 * 1024 ** 3, durationDays: 30, templateId: env.PASARGUARD_TEMPLATE_200GB },
  { id: 'plan_300g', name: 'اشتراک ۳۰۰ گیگابایت (۱ ماهه)', price: 300000, trafficBytes: 300 * 1024 ** 3, durationDays: 30, templateId: env.PASARGUARD_TEMPLATE_300GB },
  { id: 'plan_500g', name: 'اشتراک ۵۰۰ گیگابایت (۱ ماهه)', price: 450000, trafficBytes: 500 * 1024 ** 3, durationDays: 30, templateId: env.PASARGUARD_TEMPLATE_500GB },
  { id: 'plan_1000g', name: 'اشتراک ۱۰۰۰ گیگابایت (۱ ماهه)', price: 700000, trafficBytes: 1000 * 1024 ** 3, durationDays: 30, templateId: env.PASARGUARD_TEMPLATE_1000GB }
];

function now() { return new Date().toISOString(); }
function log(event, data = {}) { console.log(JSON.stringify({ event, at: now(), ...data })); }
function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function random4() { return crypto.randomBytes(3).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).padEnd(4, 'A'); }

function normalizeSubscriptionName(input) {
  const value = String(input ?? '').trim();
  if (!value) return { ok: true, value: '' };
  if (!/^[A-Za-z0-9_@]+$/.test(value)) return { ok: false, reason: 'فقط حروف انگلیسی، اعداد، @ و _ مجاز است.' };
  if (value.replace(/_/g, '').replace(/@/g, '').length < 2) return { ok: false, reason: 'نام اشتراک خیلی کوتاه یا نامعتبر است.' };
  if (/^TG_?$/i.test(value) || /^TG_+$/i.test(value) || /^TG_@$/i.test(value)) return { ok: false, reason: 'این نام برای اشتراک قابل استفاده نیست.' };
  return { ok: true, value: value.replace(/^TG_/i, '') };
}

function makeUsername({ customName, telegramUsername }) {
  let base = customName;
  if (!base) base = telegramUsername ? telegramUsername.replace(/^@/, '') : ATTRIBUTION;
  return `TG_${base}_${random4()}`;
}
function validBotUsername(username) { return /^TG_[A-Za-z0-9_@]+$/.test(username) && username.length >= 7 && username.length <= 128; }
function formatMoney(n) { return `${Number(n).toLocaleString('en-US')} تومان`; }
function bytesFromGb(gb) { return Math.round(Number(gb) * 1024 ** 3); }
function parseDurationDays(input) {
  const s = String(input || '').trim().replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  let m = s.match(/^(\d+)\s*(?:ماه|ماهه|month|months?)$/i); if (m) return Number(m[1]) * 30;
  m = s.match(/^(\d+)\s*(?:روز|روزه|day|days?)$/i); if (m) return Number(m[1]);
  return null;
}

class RedisStore {
  constructor(url, token) { this.url = url; this.token = token; }
  get enabled() { return Boolean(this.url && this.token); }
  async command(args) {
    if (!this.enabled) throw new Error('Redis is not configured');
    const r = await fetch(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error(body.error || `Redis HTTP ${r.status}`);
    return body.result;
  }
  async get(key) { const v = await this.command(['GET', key]); return v ? JSON.parse(v) : null; }
  async set(key, value, ttlSeconds) { const args = ['SET', key, JSON.stringify(value)]; if (ttlSeconds) args.push('EX', String(ttlSeconds)); await this.command(args); }
  async del(key) { await this.command(['DEL', key]); }
  async sadd(key, value) { await this.command(['SADD', key, String(value)]); }
  async srem(key, value) { await this.command(['SREM', key, String(value)]); }
  async smembers(key) { return await this.command(['SMEMBERS', key]) || []; }
  async incr(key) { return Number(await this.command(['INCR', key])); }
  async acquire(key, token, ttl = 60) { const r = await this.command(['SET', key, token, 'NX', 'EX', String(ttl)]); return r === 'OK'; }
  async release(key, token) { const script = `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`; return this.command(['EVAL', script, '1', key, token]); }
}
const store = new RedisStore(UPSTASH_URL, UPSTASH_TOKEN);

async function saveUser(user) { const key = `user:${user.telegram_user_id}`; const old = await store.get(key).catch(() => null); const value = { ...old, ...user, created_at: old?.created_at || now(), updated_at: now() }; await store.set(key, value); await store.sadd('bot_users', user.telegram_user_id); return value; }
async function getUser(id) { return store.get(`user:${id}`); }
async function createOrder(order) { await store.set(`order:${order.order_id}`, order); await store.sadd('orders', order.order_id); return order; }
async function getOrder(id) { return store.get(`order:${id}`); }
async function updateOrder(id, patch) { const old = await getOrder(id); if (!old) throw new Error('Order not found'); const value = { ...old, ...patch, updated_at: now() }; await store.set(`order:${id}`, value); return value; }
async function getUserOrders(id) { const ids = await store.smembers('orders'); const out = []; for (const oid of ids) { const o = await getOrder(oid); if (o?.telegram_user_id === String(id)) out.push(o); } return out.sort((a,b) => b.created_at.localeCompare(a.created_at)); }
async function nextOrderId() { const n = await store.incr('order_sequence'); const d = now().slice(0,10).replace(/-/g,''); return `TG-${d}-${n.toString(36).toUpperCase().padStart(4,'0')}`; }

let pgToken = null;
let pgTokenAt = 0;
async function pgRequest(path, options = {}, retryAuth = true) {
  if (!PG_BASE_URL || !PG_USERNAME || !PG_PASSWORD) throw new Error('PasarGuard configuration is incomplete');
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (pgToken) headers.Authorization = `Bearer ${pgToken}`;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    let res = await fetch(`${PG_BASE_URL}${path}`, { ...options, headers, signal: controller.signal });
    if (res.status === 401 && retryAuth) { pgToken = null; await pgLogin(); return pgRequest(path, options, false); }
    const text = await res.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) { const e = new Error(`PasarGuard HTTP ${res.status}`); e.status = res.status; e.body = body; throw e; }
    return body;
  } finally { clearTimeout(timer); }
}
async function pgLogin() {
  if (pgToken && Date.now() - pgTokenAt < 10 * 60 * 1000) return pgToken;
  const body = new URLSearchParams({ username: PG_USERNAME, password: PG_PASSWORD });
  const r = await fetch(`${PG_BASE_URL}/api/admin/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: AbortSignal.timeout(15000) });
  const data = await r.json().catch(() => ({})); if (!r.ok || !data.access_token) throw new Error(`PasarGuard authentication failed (${r.status})`);
  pgToken = data.access_token; pgTokenAt = Date.now(); return pgToken;
}
async function pgGetUserByUsername(username) { try { return await pgRequest(`/api/user/by-username/${encodeURIComponent(username)}`); } catch (e) { if (e.status === 404) return null; throw e; } }
async function pgCreateFromTemplate(username, templateId, note) { return pgRequest('/api/user/from_template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, user_template_id: Number(templateId), note }) }); }
async function pgCreateDirect(username, { trafficBytes, durationDays, groupIds = [], note }) { return pgRequest('/api/user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, data_limit: trafficBytes, data_limit_reset_strategy: 'no_reset', expire: new Date(Date.now() + durationDays * 86400000).toISOString(), group_ids: groupIds, note }) }); }
async function pgModifyById(id, body) { return pgRequest(`/api/user/by-id/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
async function pgDisableById(id, disabled = true) { return pgRequest(`/api/user/by-id/${encodeURIComponent(id)}/disabled`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disabled }) }); }
async function pgSubscriptionById(id) { return pgRequest(`/api/user/${encodeURIComponent(id)}/subscription/base64`); }
async function pgHealth() { await pgLogin(); return true; }

async function withRetry(fn, attempts = 3) {
  let last; for (let i=0;i<attempts;i++) { try { return await fn(); } catch(e) { last=e; const transient = !e.status || e.status >= 500 || e.name === 'AbortError'; if (!transient || i === attempts-1) throw e; await new Promise(r => setTimeout(r, 500 * 2 ** i)); } } throw last;
}

async function findOrCreateUsername(baseArgs, templateId, note) {
  for (let i=0;i<10;i++) {
    const username = makeUsername(baseArgs); if (!validBotUsername(username)) throw new Error('Generated username is invalid');
    const existing = await withRetry(() => pgGetUserByUsername(username)); if (existing) continue;
    try { const created = await withRetry(() => pgCreateFromTemplate(username, templateId, note)); return { username, user: created }; }
    catch (e) { if (e.status === 409 || /exist|duplicate|already/i.test(JSON.stringify(e.body))) continue; throw e; }
  }
  throw new Error('Unable to allocate a unique PasarGuard username');
}

async function fulfillOrder(orderId) {
  const lockToken = crypto.randomUUID(); const lockKey = `lock:fulfill:${orderId}`;
  if (!(await store.acquire(lockKey, lockToken, 120))) return getOrder(orderId);
  try {
    let order = await getOrder(orderId); if (!order) throw new Error('Order not found');
    if (order.fulfillment_status === 'FULFILLED') return order;
    if (!['RECEIPT_SUBMITTED','PROVISIONING','PASARGUARD_USER_CREATED','SUBSCRIPTION_RETRIEVED'].includes(order.fulfillment_status)) return order;
    await updateOrder(orderId, { fulfillment_status: 'PROVISIONING' }); log('FULFILLMENT_STARTED', { order_id: orderId, telegram_user_id: order.telegram_user_id, pasarguard_username: order.pasarguard_username });
    const plan = PLANS.find(p => p.id === order.plan_id);
    if (!plan && !order.custom) throw new Error('Plan no longer exists');
    if (!order.pasarguard_user_id) {
      const existing = await pgGetUserByUsername(order.generated_pasarguard_username).catch(e => { throw e; });
      if (existing) { order = await updateOrder(orderId, { pasarguard_user_id: existing.id, fulfillment_status: 'PASARGUARD_USER_CREATED' }); }
      else {
        let created;
        if (plan?.templateId) created = await pgCreateFromTemplate(order.generated_pasarguard_username, plan.templateId, `Telegram order ${orderId}`);
        else if (order.custom && order.custom.templateId) created = await pgCreateFromTemplate(order.generated_pasarguard_username, order.custom.templateId, `Telegram order ${orderId}`);
        else created = await pgCreateDirect(order.generated_pasarguard_username, order.custom);
        order = await updateOrder(orderId, { pasarguard_user_id: created.id, fulfillment_status: 'PASARGUARD_USER_CREATED' }); log('PASARGUARD_USER_CREATED', { order_id: orderId, telegram_user_id: order.telegram_user_id, pasarguard_username: order.generated_pasarguard_username });
      }
    }
    if (!order.subscription_url) {
      const pgUser = await pgRequest(`/api/user/by-id/${encodeURIComponent(order.pasarguard_user_id)}`);
      const subscriptionUrl = pgUser?.subscription_url;
      if (!subscriptionUrl) throw new Error('PasarGuard returned no subscription URL');
      order = await updateOrder(orderId, { subscription_url: subscriptionUrl, fulfillment_status: 'SUBSCRIPTION_RETRIEVED' }); log('SUBSCRIPTION_RETRIEVED', { order_id: orderId, telegram_user_id: order.telegram_user_id, pasarguard_username: order.generated_pasarguard_username });
    }
    order = await updateOrder(orderId, { fulfillment_status: 'FULFILLED', fulfilled_at: now() });
    const user = await getUser(order.telegram_user_id); await saveUser({ ...user, telegram_user_id: order.telegram_user_id, pasarguard_user_ids: Array.from(new Set([...(user?.pasarguard_user_ids || []), order.pasarguard_user_id])) });
    log('ORDER_FULFILLED', { order_id: orderId, telegram_user_id: order.telegram_user_id, pasarguard_username: order.generated_pasarguard_username });
    return order;
  } catch (error) {
    log('FULFILLMENT_FAILED', { order_id: orderId, telegram_user_id: (await getOrder(orderId).catch(()=>null))?.telegram_user_id, pasarguard_username: (await getOrder(orderId).catch(()=>null))?.generated_pasarguard_username, operation: error.message });
    await updateOrder(orderId, { fulfillment_status: 'FAILED_RECOVERABLE', failure_reason: safeError(error) }).catch(() => {}); throw error;
  } finally { await store.release(lockKey, lockToken).catch(() => {}); }
}
function safeError(e) { return e?.status ? `PasarGuard HTTP ${e.status}` : String(e?.message || 'Unknown error').slice(0, 300); }

async function buildOrder(ctx, plan, custom, requestedName) {
  const orderId = await nextOrderId();
  const normalized = normalizeSubscriptionName(requestedName); if (!normalized.ok) throw new Error(normalized.reason);
  const username = makeUsername({ customName: normalized.value, telegramUsername: ctx.from.username });
  const order = { order_id: orderId, telegram_user_id: String(ctx.from.id), plan_id: plan?.id || 'custom', plan_name: plan?.name || custom.name, traffic_limit_bytes: plan?.trafficBytes ?? custom.trafficBytes, duration_days: plan?.durationDays ?? custom.durationDays, price: plan?.price ?? custom.price, currency: 'IRR', requested_name: normalized.value || null, generated_pasarguard_username: username, payment_status: 'AWAITING_PAYMENT', fulfillment_status: 'AWAITING_PAYMENT', pasarguard_user_id: null, subscription_url: null, created_at: now(), receipt_file_id: null, fulfilled_at: null, failure_reason: null, custom: custom || null };
  await createOrder(order); await saveUser({ telegram_user_id: String(ctx.from.id), username: ctx.from.username || null, first_name: ctx.from.first_name || null, last_name: ctx.from.last_name || null, test_used: (await getUser(ctx.from.id))?.test_used || false }); log('ORDER_CREATED', { order_id: orderId, telegram_user_id: order.telegram_user_id, pasarguard_username: username }); return order;
}

const userStages = new Map();
const bot = new Telegraf(BOT_TOKEN || 'PLACEHOLDER_TOKEN');
const mainMenu = Markup.keyboard([['🎁 دریافت اکانت تست'], ['🛒 خرید اشتراک'], ['👤 حساب من'], ['🎯 پشتیبانی']]).resize();

async function requireAdmin(ctx) { return String(ctx.from.id) === ADMIN_ID; }
async function sendAdminReceipt(ctx, order) {
  const caption = `💰 <b>رسید پرداخت جدید</b>\n\nسفارش: <code>${escapeHtml(order.order_id)}</code>\nکاربر: <code>${escapeHtml(order.telegram_user_id)}</code>\nنام کاربری: @${escapeHtml(ctx.from.username || 'ندارد')}\nبسته: <b>${escapeHtml(order.plan_name)}</b>\nمبلغ: <b>${formatMoney(order.price)}</b>\nنام اشتراک: <code>${escapeHtml(order.generated_pasarguard_username)}</code>\nوضعیت: RECEIPT_SUBMITTED`;
  if (ctx.message.photo) { const id = ctx.message.photo.at(-1).file_id; await bot.telegram.sendPhoto(ADMIN_ID, id, { caption, parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ پرداخت نامعتبر / غیرفعال‌سازی', `invalidate_${order.order_id}`)]]) }); }
  else await bot.telegram.sendDocument(ADMIN_ID, ctx.message.document.file_id, { caption, parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('❌ پرداخت نامعتبر / غیرفعال‌سازی', `invalidate_${order.order_id}`)]]) });
}

bot.start(async ctx => { await saveUser({ telegram_user_id: String(ctx.from.id), username: ctx.from.username || null, first_name: ctx.from.first_name || null, last_name: ctx.from.last_name || null, test_used: (await getUser(ctx.from.id))?.test_used || false }); userStages.delete(ctx.from.id); await ctx.reply('👋 به ربات آرتیک خوش آمدید!\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:', mainMenu); });

bot.hears('🛒 خرید اشتراک', async ctx => { const buttons = PLANS.map(p => [Markup.button.callback(`${p.name} - ${formatMoney(p.price)}`, `plan:${p.id}`)]); buttons.push([Markup.button.callback('🛠 ساخت بسته دلخواه', 'custom')]); await ctx.reply('📋 لطفاً بسته مورد نظر خود را انتخاب کنید:', Markup.inlineKeyboard(buttons)); });
bot.hears('🎯 پشتیبانی', async ctx => ctx.reply(`ℹ️ پشتیبانی: @${escapeHtml(SUPPORT_USERNAME)}`));
bot.hears('👤 حساب من', async ctx => { const orders = await getUserOrders(ctx.from.id); const active = orders.find(o => o.fulfillment_status === 'FULFILLED'); if (!active) return ctx.reply('هنوز اشتراک فعالی برای شما ثبت نشده است.'); let live = null; try { live = await pgRequest(`/api/user/by-id/${active.pasarguard_user_id}`); } catch {} await ctx.reply(`👤 حساب من\n\nنام اشتراک: <code>${escapeHtml(active.generated_pasarguard_username)}</code>\n📊 حجم: ${active.traffic_limit_bytes ? `${(active.traffic_limit_bytes/1024**3).toFixed(2)} GB` : 'نامحدود'}\n📈 مصرف: ${live ? `${(Number(live.used_traffic||0)/1024**3).toFixed(2)} GB` : 'نامشخص'}\n⏳ انقضا: ${escapeHtml(live?.expire || 'نامشخص')}\n🔗 لینک: ${escapeHtml(active.subscription_url)}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.url('📥 دریافت لینک اشتراک', active.subscription_url)]]) }); });

bot.hears('🎁 دریافت اکانت تست', async ctx => {
  const user = await getUser(ctx.from.id); if (user?.test_used) return ctx.reply('❌ قبلاً اکانت تست خود را دریافت کرده‌اید.');
  const templateId = env.PASARGUARD_TEMPLATE_TEST; if (!templateId) return ctx.reply('❌ سرویس تست در حال حاضر پیکربندی نشده است.');
  const stage = { type: 'TEST_NAME' }; userStages.set(ctx.from.id, stage); await ctx.reply('🎁 برای اکانت تست نام دلخواه وارد کنید یا «خودکار» را بفرستید.\n\nفقط حروف انگلیسی، اعداد، @ و _ مجاز است.');
});

bot.on('callback_query', async ctx => {
  const data = ctx.callbackQuery.data || ''; await ctx.answerCbQuery().catch(()=>{});
  if (data.startsWith('plan:')) { const p = PLANS.find(x => x.id === data.slice(5)); if (!p) return; userStages.set(ctx.from.id, { type: 'NAME', planId: p.id }); await ctx.reply('📝 اگر می‌خواهید نام دلخواهی برای اشتراک خود انتخاب کنید، وارد کنید؛ در غیر این صورت «خودکار» را بفرستید.'); return; }
  if (data === 'custom') { userStages.set(ctx.from.id, { type: 'CUSTOM_TRAFFIC' }); await ctx.reply('🛠 حجم مورد نیاز را به گیگابایت وارد کنید (مثلاً 15). حداقل 1 و حداکثر 1000 گیگابایت.'); return; }
  if (data.startsWith('invalidate_') && await requireAdmin(ctx)) { const oid = data.slice(11); const order = await getOrder(oid); if (!order?.pasarguard_user_id) return ctx.reply('سفارش هنوز حساب PasarGuard ندارد.'); try { await pgDisableById(order.pasarguard_user_id, true); await updateOrder(oid, { payment_status: 'PAYMENT_LATER_REJECTED', fulfillment_status: 'PAYMENT_LATER_REJECTED', failure_reason: 'Administrator invalidated payment' }); await ctx.reply('❌ پرداخت نامعتبر ثبت شد و حساب PasarGuard غیرفعال شد.'); await bot.telegram.sendMessage(order.telegram_user_id, '❌ پرداخت این سفارش بعداً نامعتبر تشخیص داده شد و اشتراک شما غیرفعال شد. برای پیگیری با پشتیبانی تماس بگیرید.'); } catch(e) { await ctx.reply('❌ غیرفعال‌سازی انجام نشد؛ جزئیات در لاگ ثبت شد.'); log('PAYMENT_INVALIDATION_FAILED',{order_id:oid,operation:safeError(e)}); } }
});

bot.on('message', async ctx => {
  if (!ctx.from || !ctx.message) return;
  const id = ctx.from.id; const stage = userStages.get(id);
  if (String(id) === ADMIN_ID && ctx.message.text?.startsWith('/')) return;
  if (!stage) return;
  if (stage.type === 'NAME') {
    const raw = ctx.message.text; if (!raw) return ctx.reply('❌ لطفاً نام را به صورت متن ارسال کنید.');
    const auto = raw.trim().toLowerCase() === 'خودکار'; const normalized = auto ? { ok:true, value:'' } : normalizeSubscriptionName(raw); if (!normalized.ok) return ctx.reply(`❌ ${normalized.reason}\n\nمثال صحیح: MyShop_1`);
    const p = PLANS.find(x => x.id === stage.planId); if (!p) return ctx.reply('❌ بسته دیگر در دسترس نیست.');
    try { const order = await buildOrder(ctx,p,null,normalized.value); userStages.set(id,{type:'RECEIPT',orderId:order.order_id}); await ctx.reply(`💳 <b>اطلاعات پرداخت</b>\n\nبسته: <b>${escapeHtml(order.plan_name)}</b>\nمبلغ: <b>${formatMoney(order.price)}</b>\n\n${BANK_DETAILS}\n\n📸 پس از پرداخت، رسید را همینجا ارسال کنید.\n\n⚠️ رسید صرفاً برای ثبت و حسابرسی است؛ پس از ارسال، اشتراک به‌صورت خودکار ساخته می‌شود.`,{parse_mode:'HTML'}); } catch(e) { await ctx.reply('❌ ایجاد سفارش ممکن نشد. لطفاً دوباره تلاش کنید.'); log('ORDER_CREATE_FAILED',{telegram_user_id:String(id),operation:safeError(e)}); }
    return;
  }
  if (stage.type === 'CUSTOM_TRAFFIC') { const gb = Number(String(ctx.message.text||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))); if (!Number.isInteger(gb)||gb<1||gb>1000) return ctx.reply('❌ حجم باید عدد صحیح بین 1 تا 1000 گیگابایت باشد.'); userStages.set(id,{type:'CUSTOM_DURATION',trafficGb:gb}); return ctx.reply('⏳ مدت اعتبار را وارد کنید؛ مثلاً 30 روز یا 1 ماهه.'); }
  if (stage.type === 'CUSTOM_DURATION') { const days=parseDurationDays(ctx.message.text); if (!days||days<1||days>150) return ctx.reply('❌ مدت باید بین 1 تا 150 روز باشد؛ مثال: 45 روز.'); const gb=stage.trafficGb; const price=gb>51?gb*3000:gb*4000; const customTemplate=env.PASARGUARD_TEMPLATE_CUSTOM; if(!customTemplate) return ctx.reply('❌ بسته سفارشی هنوز در PasarGuard پیکربندی نشده است.'); const custom={name:`بسته سفارشی (${gb} گیگابایت | ${days} روز)`,price,trafficBytes:bytesFromGb(gb),durationDays:days,templateId:customTemplate}; userStages.set(id,{type:'CUSTOM_NAME',custom}); return ctx.reply('📝 نام دلخواه اشتراک را وارد کنید یا «خودکار» بفرستید.'); }
  if (stage.type === 'CUSTOM_NAME') { const auto=String(ctx.message.text||'').trim().toLowerCase()==='خودکار'; const n=auto?{ok:true,value:''}:normalizeSubscriptionName(ctx.message.text); if(!n.ok)return ctx.reply(`❌ ${n.reason}`); try{const order=await buildOrder(ctx,null,stage.custom,n.value); userStages.set(id,{type:'RECEIPT',orderId:order.order_id}); await ctx.reply(`💳 <b>اطلاعات پرداخت</b>\n\nبسته: <b>${escapeHtml(order.plan_name)}</b>\nمبلغ: <b>${formatMoney(order.price)}</b>\n\n${BANK_DETAILS}\n\n📸 رسید را همینجا ارسال کنید.\n\n⚠️ پس از ارسال رسید، بدون انتظار برای تأیید دستی، provisioning شروع می‌شود.`,{parse_mode:'HTML'});}catch(e){await ctx.reply('❌ ایجاد سفارش ناموفق بود. لطفاً دوباره تلاش کنید.');} return; }
  if (stage.type === 'TEST_NAME') { const auto=String(ctx.message.text||'').trim().toLowerCase()==='خودکار'; const n=auto?{ok:true,value:''}:normalizeSubscriptionName(ctx.message.text); if(!n.ok)return ctx.reply(`❌ ${n.reason}`); const user=await getUser(id); if(user?.test_used)return ctx.reply('❌ قبلاً اکانت تست گرفته‌اید.'); const username=makeUsername({customName:n.value,telegramUsername:ctx.from.username}); try { const created=await findOrCreateUsername({customName:n.value,telegramUsername:ctx.from.username},env.PASARGUARD_TEMPLATE_TEST,`Telegram test for ${id}`); const pg=created.user; await saveUser({...user,telegram_user_id:String(id),test_used:true,test_created_at:now(),pasarguard_user_ids:[...(user?.pasarguard_user_ids||[]),pg.id]}); const url=pg.subscription_url; if(!url)throw new Error('No test subscription URL returned'); userStages.delete(id); await ctx.reply(`🎉 اکانت تست شما ساخته شد.\n\n👤 نام اشتراک: <code>${escapeHtml(created.username)}</code>\n🔗 لینک اشتراک:\n${escapeHtml(url)}`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.url('📥 دریافت اشتراک',url)]])}); } catch(e){await ctx.reply('❌ در ساخت اکانت تست مشکلی پیش آمد. لطفاً بعداً دوباره تلاش کنید.');log('TEST_PROVISION_FAILED',{telegram_user_id:String(id),pasarguard_username:username,operation:safeError(e)});} return; }
  if (stage.type === 'RECEIPT') {
    if (!ctx.message.photo && !ctx.message.document) return ctx.reply('❌ لطفاً تصویر رسید یا فایل رسید را ارسال کنید.');
    const order=await getOrder(stage.orderId); if(!order)return ctx.reply('❌ سفارش پیدا نشد.'); if(order.payment_status==='RECEIPT_SUBMITTED'||order.fulfillment_status==='FULFILLED')return ctx.reply('این رسید قبلاً ثبت شده است.');
    const fileId=ctx.message.photo ? ctx.message.photo.at(-1).file_id : ctx.message.document.file_id; await updateOrder(order.order_id,{receipt_file_id:fileId,payment_status:'RECEIPT_SUBMITTED',fulfillment_status:'RECEIPT_SUBMITTED'}); log('RECEIPT_SUBMITTED',{order_id:order.order_id,telegram_user_id:order.telegram_user_id,pasarguard_username:order.generated_pasarguard_username});
    await ctx.reply('✅ رسید ثبت شد. سفارش شما بدون انتظار برای تأیید دستی وارد مرحله ساخت خودکار شد.'); try{await sendAdminReceipt(ctx,{...order,receipt_file_id:fileId});}catch(e){log('ADMIN_RECEIPT_NOTIFY_FAILED',{order_id:order.order_id,operation:safeError(e)});} userStages.delete(id);
    fulfillOrder(order.order_id).then(async finalOrder=>{ if(finalOrder?.fulfillment_status==='FULFILLED') await ctx.telegram.sendMessage(id,`🎉 <b>اشتراک شما با موفقیت ساخته شد.</b>\n\n📦 سرویس: ${escapeHtml(finalOrder.plan_name)}\n📊 حجم: ${finalOrder.traffic_limit_bytes?`${(finalOrder.traffic_limit_bytes/1024**3).toFixed(2)} GB`:'نامحدود'}\n⏳ اعتبار: ${finalOrder.duration_days} روز\n👤 نام اشتراک: <code>${escapeHtml(finalOrder.generated_pasarguard_username)}</code>\n\n🔗 لینک اشتراک:\n${escapeHtml(finalOrder.subscription_url)}`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.url('📥 دریافت لینک اشتراک',finalOrder.subscription_url)]])}); }).catch(async e=>{await ctx.telegram.sendMessage(id,'در حال حاضر ساخت اشتراک با تأخیر مواجه شده است؛ سفارش شما ثبت شده و سیستم به‌صورت خودکار قابل بازیابی است.'); log('FULFILLMENT_NOTIFY',{order_id:order.order_id,operation:safeError(e)});});
  }
});

bot.command('pingdb', async ctx => { if(!await requireAdmin(ctx))return; try{await store.command(['PING']);await ctx.reply('✅ Redis: OK');}catch(e){await ctx.reply('❌ Redis: ERROR');} });
bot.command('status', async ctx => { if(!await requireAdmin(ctx))return; let redis='ERROR',pg='ERROR';try{await store.command(['PING']);redis='OK';}catch{}try{await pgHealth();pg='OK';}catch{}const ids=await store.smembers('orders').catch(()=>[]);let pending=0,failed=0;for(const x of ids){const o=await getOrder(x);if(['RECEIPT_SUBMITTED','PROVISIONING','PASARGUARD_USER_CREATED','SUBSCRIPTION_RETRIEVED'].includes(o?.fulfillment_status))pending++;if(o?.fulfillment_status==='FAILED_RECOVERABLE')failed++;}await ctx.reply(`Telegram bot: OK\nRedis: ${redis}\nPasarGuard: ${pg}\nPending orders: ${pending}\nFailed fulfillments: ${failed}`); });
bot.command('users', async ctx => { if(!await requireAdmin(ctx))return; const users=await store.smembers('bot_users'); await ctx.reply(`📊 کاربران ثبت‌شده: ${users.length}`); });
bot.command('orders', async ctx => { if(!await requireAdmin(ctx))return; const ids=await store.smembers('orders'); const rows=[];for(const id of ids){const o=await getOrder(id);if(o)rows.push(o);}rows.sort((a,b)=>b.created_at.localeCompare(a.created_at));await ctx.reply(rows.slice(0,20).map(o=>`${o.order_id} | ${o.fulfillment_status} | ${o.generated_pasarguard_username}`).join('\n')||'سفارشی نیست.'); });
bot.command('failed', async ctx => { if(!await requireAdmin(ctx))return; const ids=await store.smembers('orders'); const rows=[];for(const id of ids){const o=await getOrder(id);if(o?.fulfillment_status==='FAILED_RECOVERABLE')rows.push(`${o.order_id} | ${o.failure_reason||''}`);}await ctx.reply(rows.slice(0,20).join('\n')||'خطای بازیابی‌پذیری وجود ندارد.'); });
bot.command('broadcast', async ctx => { if(!await requireAdmin(ctx))return; const text=ctx.message.text.replace('/broadcast','').trim(); if(!text)return ctx.reply('استفاده: /broadcast متن پیام'); const users=await store.smembers('bot_users');let ok=0,fail=0;for(const uid of users){try{await bot.telegram.sendMessage(uid,text);ok++;}catch(e){fail++; if(/blocked|chat not found/i.test(e.description||e.message||''))await store.srem('bot_users',uid);}await new Promise(r=>setTimeout(r,50));}await ctx.reply(`ارسال تمام شد. موفق: ${ok} | ناموفق: ${fail}`); });

bot.catch((err,ctx)=>{ log('BOT_ERROR',{update_type:ctx.updateType,operation:safeError(err)}); });

module.exports = { bot, fulfillOrder, normalizeSubscriptionName, makeUsername, PLANS, RedisStore, pgRequest };

module.exports.handler = async function handler(req,res) {
  if(req.method !== 'POST') return res.status(200).json({ok:true});
  if(WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) return res.status(401).json({ok:false});
  try { await bot.handleUpdate(req.body); return res.status(200).json({ok:true}); } catch(e) { log('WEBHOOK_ERROR',{operation:safeError(e)}); return res.status(200).json({ok:false}); }
};
