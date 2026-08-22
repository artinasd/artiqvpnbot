const { Telegraf, Markup } = require('telegraf');
const { calculateCustomPrice, parseDurationDays, buildCustomPlan } = require('../lib/plans');
const planStore = require('../lib/plan-store');
const { SERVICES, getService, serviceButtons } = require('../lib/services');
const { normalizeSubscriptionName } = require('../lib/username');
const storage = require('../lib/storage');
const pasarguard = require('../lib/pasarguard');
const { orderId, fulfillOrder, renewOrder, formatBytes } = require('../lib/fulfillment');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const BANK_DETAILS = process.env.BANK_DETAILS || '';
const PAYMENT_CARD_NUMBER = process.env.PAYMENT_CARD_NUMBER || '6219861947080387';
const PAYMENT_CARD_HOLDER = process.env.PAYMENT_CARD_HOLDER || 'اسعدی';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || 'Your_Personal_ID';
const TEST_TRAFFIC_BYTES = 150 * 1024 * 1024;
const TEST_DURATION_DAYS = 1;
const TEST_HWID_LIMIT = Number(process.env.TEST_HWID_LIMIT ?? 0);

if (!BOT_TOKEN || !ADMIN_ID) console.error('Missing BOT_TOKEN or ADMIN_ID');
const bot = new Telegraf(BOT_TOKEN || 'INVALID_TOKEN');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
}
function isAdmin(ctx) { return String(ctx.from?.id) === ADMIN_ID; }
function log(event, fields = {}) { console.log(JSON.stringify({ event, ...fields })); }
function userSnapshot(ctx) { return { telegramUserId: ctx.from.id, username: ctx.from.username || null, firstName: ctx.from.first_name || null, lastName: ctx.from.last_name || null, updatedAt: new Date().toISOString() }; }
async function persistUser(ctx) { return storage.saveUser(userSnapshot(ctx)); }

async function createOrderForPlan(ctx, plan) {
  const id = orderId();
  const order = {
    orderId: id, telegramUserId: ctx.from.id, telegramUsername: ctx.from.username || null,
    firstName: ctx.from.first_name || null, lastName: ctx.from.last_name || null,
    planId: plan.id, planName: plan.name, service: plan.service || 'tunnel',
    trafficLimitBytes: plan.trafficBytes, durationDays: plan.durationDays, hwidLimit: plan.hwidLimit,
    price: plan.price, currency: plan.currency || 'تومان', requestedName: null,
    generatedPasarguardUsername: null, pasarguardUserId: null, subscriptionUrl: null,
    paymentStatus: 'AWAITING_PAYMENT', fulfillmentStatus: 'DRAFT', deliveryStatus: null,
    receiptFileId: null, receiptType: null, receiptTelegramMessageId: null, failureReason: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await storage.createOrder(order); return order;
}

async function askSubscriptionName(ctx, order) {
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_SUBSCRIPTION_NAME', orderId: order.orderId });
  await ctx.reply('👤 نام اشتراک\n\nاگر می‌خواهید نام دلخواهی برای اشتراک خود انتخاب کنید، آن را وارد کنید؛ در غیر این صورت نام به صورت خودکار ساخته می‌شود.\n\nفقط حروف انگلیسی، اعداد، @ و _ مجاز است و نام نباید فاصله یا کاراکتر دیگری داشته باشد.', Markup.inlineKeyboard([[Markup.button.callback('⚡ نام خودکار', `auto_name_${order.orderId}`)]]));
}

async function showPayment(ctx, order) {
  await storage.updateOrder(order.orderId, { paymentStatus: 'AWAITING_PAYMENT', fulfillmentStatus: 'AWAITING_PAYMENT' });
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_RECEIPT', orderId: order.orderId });
  const card = PAYMENT_CARD_NUMBER.replace(/\D/g, '');
  const formattedCard = card.replace(/(\d{4})(?=\d)/g, '$1 ');
  const paymentText = `💳 <b>پرداخت اشتراک</b>\n\n📦 <b>سرویس:</b> ${escapeHtml(order.planName)}\n💰 <b>مبلغ قابل پرداخت:</b> ${Number(order.price).toLocaleString('en-US')} ${escapeHtml(order.currency)}\n\n🏦 <b>شماره کارت</b>\n<code>${formattedCard}</code>\n👤 <b>به نام:</b> ${escapeHtml(PAYMENT_CARD_HOLDER)}${BANK_DETAILS ? `\n\n${escapeHtml(BANK_DETAILS)}\n` : ''}\n📸 <b>بعد از پرداخت</b>\nعکس یا فایل رسید پرداخت را همینجا ارسال کنید.\n\n⚡ پس از دریافت رسید، سفارش شما به‌صورت خودکار برای ساخت اشتراک پردازش می‌شود.\n🔒 لطفاً مبلغ و شماره کارت مقصد را قبل از پرداخت بررسی کنید.`;
  await ctx.reply(paymentText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '📋 کپی شماره کارت', copy_text: { text: card } }]] } });
}

async function sendServiceMenu(ctx, mode = 'buy') {
  const title = mode === 'test' ? '🎁 سرویس مورد نظر برای اکانت تست را انتخاب کنید:' : mode === 'renew' ? '🔄 سرویس مورد نظر برای تمدید را انتخاب کنید:' : '🛒 ابتدا سرویس مورد نظر را انتخاب کنید:';
  const prefix = mode === 'test' ? 'service_test_' : mode === 'renew' ? 'service_renew_' : 'service_buy_';
  await ctx.reply(title, Markup.inlineKeyboard(serviceButtons(prefix)));
}

async function sendPlanMenu(ctx, mode = 'buy', serviceId = 'tunnel') {
  const service = getService(serviceId);
  if (!service) return ctx.reply('❌ سرویس انتخاب‌شده معتبر نیست.');
  const plans = await planStore.listActiveByService(service.id);
  const buttons = plans.map((plan) => [Markup.button.callback(`${plan.name} - ${Number(plan.price).toLocaleString('en-US')} تومان`, `${mode === 'renew' ? 'renew_plan_' : 'select_plan_'}${plan.id}`)]);
  if (mode === 'buy') buttons.push([Markup.button.callback('🛠 ساخت بسته دلخواه (حجم و زمان)', `select_custom_${service.id}`)]);
  if (!buttons.length) return ctx.reply(`📭 برای سرویس ${service.label} فعلاً پلنی ثبت نشده است.`);
  await ctx.reply(`${mode === 'renew' ? '🔄' : '📋'} ${service.label}\n\nلطفاً بسته مورد نظر را انتخاب کنید:`, Markup.inlineKeyboard(buttons));
}

async function createTestForService(ctx, serviceId) {
  const service = getService(serviceId);
  if (!service) return ctx.reply('❌ سرویس انتخاب‌شده معتبر نیست.');
  if (service.id !== 'tunnel') return ctx.reply(`🛠️ سرویس ${service.label} هنوز در حال آماده‌سازی است.\n\nفعلاً فقط 🛡️ Tunnel امکان ساخت اکانت تست دارد.`);
  await persistUser(ctx);
  const user = await storage.getUser(ctx.from.id);
  if (user?.testUsed) return ctx.reply('🎁 شما قبلاً از اکانت تست استفاده کرده‌اید.');
  const lockName = `test:${ctx.from.id}`;
  if (!(await storage.acquireLock(lockName, 120))) return ctx.reply('⏳ درخواست تست شما در حال پردازش است.');
  let orderIdValue = null;
  try {
    const refreshed = await storage.getUser(ctx.from.id);
    if (refreshed?.testUsed) return ctx.reply('🎁 شما قبلاً از اکانت تست استفاده کرده‌اید.');
    const id = orderId(); orderIdValue = id;
    const order = { orderId: id, telegramUserId: ctx.from.id, telegramUsername: ctx.from.username || null, firstName: ctx.from.first_name || null, lastName: ctx.from.last_name || null, planId: 'test', planName: 'اکانت تست — Tunnel', service: service.id, trafficLimitBytes: TEST_TRAFFIC_BYTES, durationDays: TEST_DURATION_DAYS, hwidLimit: TEST_HWID_LIMIT, price: 0, currency: 'تومان', requestedName: null, generatedPasarguardUsername: null, pasarguardUserId: null, subscriptionUrl: null, paymentStatus: 'NOT_REQUIRED', fulfillmentStatus: 'RECEIPT_SUBMITTED', deliveryStatus: null, receiptFileId: null, receiptType: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await storage.createOrder(order);
    await ctx.reply('⏳ اکانت تست Tunnel شما در حال ساخت خودکار است...');
    await fulfillOrder(id, bot.telegram);
    await storage.saveUser({ ...userSnapshot(ctx), testUsed: true, testCreatedAt: new Date().toISOString() });
  } catch (error) {
    await storage.saveUser({ ...userSnapshot(ctx), testUsed: false, testCreatedAt: null });
    log('TEST_FULFILLMENT_FAILED', { order_id: orderIdValue, telegram_user_id: ctx.from.id, service: service.id, error: error?.message || String(error) });
    await ctx.reply('❌ ساخت اکانت تست انجام نشد. مشکل فنی ثبت شد و می‌توانید دوباره تلاش کنید.');
  } finally { await storage.releaseLock(lockName); }
}

bot.catch((error, ctx) => { log('BOT_ERROR', { update_type: ctx?.updateType, error: error?.message || String(error) }); });

bot.start(async (ctx) => { await persistUser(ctx); await storage.deleteState('user', ctx.from.id); await ctx.reply('👋 به ربات آرتیک خوش آمدید!\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:', Markup.keyboard([['🎁 دریافت اکانت تست'], ['🛒 خرید اشتراک'], ['👤 حساب من'], ['🎯 پشتیبانی']]).resize()); });
bot.hears('🎯 پشتیبانی', async (ctx) => { await persistUser(ctx); await ctx.reply(`ℹ️ برای پشتیبانی و راهنمایی، با ما در ارتباط باشید:\n\n💬 @${escapeHtml(SUPPORT_USERNAME)}`); });
bot.hears('🛒 خرید اشتراک', async (ctx) => { await persistUser(ctx); await sendServiceMenu(ctx, 'buy'); });

bot.hears('👤 حساب من', async (ctx) => {
  await persistUser(ctx); const user = await storage.getUser(ctx.from.id);
  if (!user?.currentPasarguardUserId) return ctx.reply('👤 هنوز اشتراک فعالی برای حساب شما ثبت نشده است.');
  try {
    const current = await pasarguard.getUserById(user.currentPasarguardUserId);
    const status = current.status || 'نامشخص'; const traffic = current.data_limit === 0 ? 'نامحدود' : formatBytes(Number(current.data_limit || 0)); const used = current.used_traffic != null ? formatBytes(Number(current.used_traffic)) : 'در دسترس نیست';
    await ctx.reply(`👤 <b>حساب من</b>\n\n👤 نام اشتراک: <code>${escapeHtml(current.username || user.currentPasarguardUsername)}</code>\n📊 حجم: ${escapeHtml(traffic)}\n📈 مصرف: ${escapeHtml(used)}\n⏳ انقضا: ${escapeHtml(current.expire || 'نامشخص')}\n📌 وضعیت: ${escapeHtml(status)}`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '📥 دریافت لینک اشتراک', url: current.subscription_url || user.currentSubscriptionUrl }], [{ text: '🔄 تمدید اشتراک', callback_data: 'renew_choose' }]] } });
  } catch (error) { await ctx.reply('❌ دریافت وضعیت اشتراک در حال حاضر ممکن نیست. لطفاً کمی بعد دوباره تلاش کنید.'); }
});

bot.hears('🎁 دریافت اکانت تست', async (ctx) => { await sendServiceMenu(ctx, 'test'); });

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data || ''; await ctx.answerCbQuery().catch(() => {});
  if (data.startsWith('service_test_')) return createTestForService(ctx, data.slice('service_test_'.length));
  if (data.startsWith('service_buy_')) return sendPlanMenu(ctx, 'buy', data.slice('service_buy_'.length));
  if (data.startsWith('service_renew_')) { const user = await storage.getUser(ctx.from.id); if (!user?.currentPasarguardUserId) return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.'); return sendPlanMenu(ctx, 'renew', data.slice('service_renew_'.length)); }

  if (data.startsWith('select_plan_')) {
    const plan = await planStore.get(data.slice('select_plan_'.length));
    if (!plan) return ctx.reply('❌ این پلن دیگر فعال نیست. لطفاً فهرست پلن‌ها را دوباره باز کنید.');
    if (plan.service !== 'tunnel') return ctx.reply(`🛠️ سرویس ${getService(plan.service)?.label || plan.service} هنوز در حال آماده‌سازی است. فعلاً خرید این سرویس فعال نیست.`);
    const order = await createOrderForPlan(ctx, plan); await askSubscriptionName(ctx, order); return;
  }
  if (data.startsWith('select_custom_')) {
    const serviceId = data.slice('select_custom_'.length);
    if (serviceId !== 'tunnel') return ctx.reply(`🛠️ سرویس ${getService(serviceId)?.label || serviceId} هنوز در حال آماده‌سازی است. فعلاً بسته دلخواه این سرویس فعال نیست.`);
    await storage.setState('user', ctx.from.id, { stage: 'AWAITING_CUSTOM_TRAFFIC', service: serviceId });
    await ctx.reply('🛠 حجم مورد نیاز را فقط به صورت عدد و بر حسب گیگابایت وارد کنید.\n\nمثلاً: 15'); return;
  }
  if (data === 'select_custom') { await storage.setState('user', ctx.from.id, { stage: 'AWAITING_CUSTOM_TRAFFIC', service: 'tunnel' }); await ctx.reply('🛠 حجم مورد نیاز را فقط به صورت عدد و بر حسب گیگابایت وارد کنید.\n\nمثلاً: 15'); return; }
  if (data.startsWith('auto_name_')) {
    const id = data.slice('auto_name_'.length); const state = await storage.getState('user', ctx.from.id); if (!state || state.orderId !== id || state.stage !== 'AWAITING_SUBSCRIPTION_NAME') return;
    const order = await storage.getOrder(id); if (!order || order.telegramUserId !== ctx.from.id) return; await storage.updateOrder(id, { requestedName: null }); await showPayment(ctx, { ...order, requestedName: null }); return;
  }
  if (data === 'renew_choose') { const user = await storage.getUser(ctx.from.id); if (!user?.currentPasarguardUserId) return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.'); await sendServiceMenu(ctx, 'renew'); return; }
  if (data.startsWith('renew_plan_')) {
    const plan = await planStore.get(data.slice('renew_plan_'.length)); const user = await storage.getUser(ctx.from.id);
    if (!plan || !user?.currentPasarguardUserId) return ctx.reply('❌ این پلن فعال نیست یا اشتراک شما پیدا نشد.');
    if (plan.service !== 'tunnel') return ctx.reply(`🛠️ سرویس ${getService(plan.service)?.label || plan.service} هنوز در حال آماده‌سازی است. فعلاً تمدید این سرویس فعال نیست.`);
    const order = await createOrderForPlan(ctx, plan); await storage.updateOrder(order.orderId, { renewal: true, renewalPasarguardUserId: user.currentPasarguardUserId }); await showPayment(ctx, order); return;
  }
  if (data.startsWith('invalidate_')) {
    if (!isAdmin(ctx)) return; const id = data.slice('invalidate_'.length); const order = await storage.getOrder(id); if (!order || !order.pasarguardUserId) return ctx.reply('❌ سفارش یا کاربر PasarGuard پیدا نشد.');
    try { await pasarguard.disableUser(order.pasarguardUserId); await storage.updateOrder(id, { paymentStatus: 'PAYMENT_LATER_REJECTED', fulfillmentStatus: 'PAYMENT_LATER_REJECTED' }); await ctx.reply(`❌ اشتراک ${escapeHtml(order.generatedPasarguardUsername)} غیرفعال شد.`, { parse_mode: 'HTML' }); await bot.telegram.sendMessage(order.telegramUserId, '❌ پرداخت این سفارش بعداً نامعتبر تشخیص داده شد و اشتراک غیرفعال شد. برای پیگیری با پشتیبانی تماس بگیرید.'); } catch (error) { await ctx.reply('❌ غیرفعال‌سازی اشتراک انجام نشد؛ لاگ فنی ثبت شد.'); }
  }
});

bot.on('message', async (ctx) => {
  await persistUser(ctx); const state = await storage.getState('user', ctx.from.id); if (!state) return;
  if (state.stage === 'AWAITING_CUSTOM_TRAFFIC') {
    const traffic = Number(String(ctx.message.text || '').trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    if (!Number.isInteger(traffic) || traffic < 1 || traffic > 1000) return ctx.reply('❌ حجم نامعتبر است. عددی بین ۱ تا ۱۰۰۰ گیگابایت وارد کنید.');
    const price = calculateCustomPrice(traffic); await storage.setState('user', ctx.from.id, { stage: 'AWAITING_CUSTOM_DURATION', traffic, price, service: state.service || 'tunnel' });
    return ctx.reply(`✅ حجم ${traffic} گیگابایت ثبت شد.\n💳 قیمت: ${price.toLocaleString('en-US')} تومان\n\nمدت را به صورت «۳۰ روزه» یا «۱ ماهه» وارد کنید. حداکثر ۱۵۰ روز.`);
  }
  if (state.stage === 'AWAITING_CUSTOM_DURATION') {
    const days = parseDurationDays(ctx.message.text); if (!days || days < 1 || days > 150) return ctx.reply('❌ مدت نامعتبر است. بین ۱ تا ۱۵۰ روز وارد کنید.');
    const plan = { ...buildCustomPlan(state.traffic, days), service: state.service || 'tunnel' }; const order = await createOrderForPlan(ctx, plan); await askSubscriptionName(ctx, order); return;
  }
  if (state.stage === 'AWAITING_SUBSCRIPTION_NAME') {
    if (!ctx.message.text) return ctx.reply('❌ لطفاً نام اشتراک را به صورت متن انگلیسی ارسال کنید یا «نام خودکار» را انتخاب کنید.');
    let name; try { name = normalizeSubscriptionName(ctx.message.text); } catch (error) {
      const messages = { USERNAME_ENGLISH_ONLY: '❌ نام اشتراک فقط باید با حروف انگلیسی باشد. حروف فارسی/عربی و ایموجی مجاز نیست.', USERNAME_NO_SPACES: '❌ نام اشتراک نباید فاصله داشته باشد.', USERNAME_INVALID_CHARACTERS: '❌ فقط حروف انگلیسی، اعداد، @ و _ مجاز هستند.', USERNAME_TOO_GENERIC: '❌ این نام برای اشتراک مناسب نیست. یک نام معنادار انگلیسی انتخاب کنید.' };
      return ctx.reply(messages[error.message] || '❌ نام اشتراک نامعتبر است.');
    }
    const order = await storage.getOrder(state.orderId); if (!order || order.telegramUserId !== ctx.from.id) return ctx.reply('❌ سفارش پیدا نشد. لطفاً دوباره از خرید شروع کنید.');
    const updated = await storage.updateOrder(order.orderId, { requestedName: name }); await showPayment(ctx, updated); return;
  }
  if (state.stage === 'AWAITING_RECEIPT') {
    if (!ctx.message.photo && !ctx.message.document) return ctx.reply('❌ لطفاً تصویر رسید یا فایل رسید را ارسال کنید.');
    const order = await storage.getOrder(state.orderId); if (!order || order.telegramUserId !== ctx.from.id) return ctx.reply('❌ سفارش پیدا نشد.'); if (!['AWAITING_PAYMENT', 'AWAITING_RECEIPT'].includes(order.paymentStatus)) return;
    const receiptFileId = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.document.file_id; const receiptType = ctx.message.photo ? 'photo' : 'document';
    const updated = await storage.updateOrder(order.orderId, { receiptFileId, receiptType, receiptTelegramMessageId: ctx.message.message_id, paymentStatus: 'RECEIPT_SUBMITTED', fulfillmentStatus: 'RECEIPT_SUBMITTED' });
    await storage.deleteState('user', ctx.from.id); log('RECEIPT_SUBMITTED', { order_id: order.orderId, telegram_user_id: ctx.from.id, pasarguard_username: order.generatedPasarguardUsername || null });
    const caption = `💰 <b>رسید پرداخت جدید</b>\n\nسفارش: <code>${escapeHtml(updated.orderId)}</code>\nکاربر: ${escapeHtml(updated.firstName)}\nآیدی: ${escapeHtml(updated.telegramUsername ? `@${updated.telegramUsername}` : 'بدون آیدی')}\nشناسه تلگرام: <code>${updated.telegramUserId}</code>\nنام اشتراک درخواستی: <code>${escapeHtml(updated.requestedName || 'خودکار')}</code>\nبسته: <b>${escapeHtml(updated.planName)}</b>\nمبلغ: <b>${Number(updated.price).toLocaleString('en-US')} تومان</b>`;
    const adminButtons = Markup.inlineKeyboard([[Markup.button.callback('❌ پرداخت نامعتبر / غیرفعال کردن', `invalidate_${updated.orderId}`)] ]);
    try { if (receiptType === 'photo') await bot.telegram.sendPhoto(ADMIN_ID, receiptFileId, { caption, parse_mode: 'HTML', ...adminButtons }); else await bot.telegram.sendDocument(ADMIN_ID, receiptFileId, { caption, parse_mode: 'HTML', ...adminButtons }); } catch (error) { log('ADMIN_RECEIPT_NOTIFICATION_FAILED', { order_id: updated.orderId, error: error.message }); }
    await ctx.reply('✅ رسید دریافت شد. اشتراک شما بدون نیاز به تأیید دستی در حال ساخت خودکار است.'); try { await fulfillOrder(updated.orderId, bot.telegram); } catch (error) { await ctx.reply('⏳ ساخت اشتراک با مشکل موقت مواجه شد. سفارش شما ثبت شده و امکان تلاش مجدد وجود دارد.'); }
  }
});

bot.command('pingdb', async (ctx) => { if (!isAdmin(ctx)) return; try { await ctx.reply(await storage.ping() ? '✅ Redis: OK' : '⚠️ Redis در حالت حافظه محلی است.'); } catch { await ctx.reply('❌ Redis: ERROR'); } });
bot.command('status', async (ctx) => { if (!isAdmin(ctx)) return; const orders = await storage.listOrders(100); const pending = orders.filter((o) => !['FULFILLED', 'PAYMENT_LATER_REJECTED'].includes(o.fulfillmentStatus)).length; const failed = orders.filter((o) => o.fulfillmentStatus === 'FAILED_RETRYABLE').length; let pg = 'ERROR'; try { await pasarguard.health(); pg = 'OK'; } catch {} await ctx.reply(`📊 <b>وضعیت سیستم</b>\n\nTelegram Bot: OK\nRedis: ${storage.configured() ? 'OK' : 'MEMORY'}\nPasarGuard: ${pg}\nPending orders: ${pending}\nFailed fulfillments: ${failed}`, { parse_mode: 'HTML' }); });
bot.command('orders', async (ctx) => { if (!isAdmin(ctx)) return; const orders = await storage.listOrders(20); if (!orders.length) return ctx.reply('سفارشی ثبت نشده است.'); const text = orders.map((o) => `${o.orderId} | ${o.planName} | ${o.fulfillmentStatus} | ${o.generatedPasarguardUsername || '-'}`).join('\n'); await ctx.reply(`<pre>${escapeHtml(text)}</pre>`, { parse_mode: 'HTML' }); });
bot.command('failed', async (ctx) => { if (!isAdmin(ctx)) return; const orders = (await storage.listOrders(100)).filter((o) => o.fulfillmentStatus === 'FAILED_RETRYABLE'); if (!orders.length) return ctx.reply('❌ مورد ناموفقی وجود ندارد.'); for (const order of orders.slice(0, 10)) await ctx.reply(`⚠️ ${order.orderId}\n${order.failureReason || 'unknown'}\n${order.generatedPasarguardUsername || '-'}`); });
bot.command('users', async (ctx) => { if (!isAdmin(ctx)) return; const users = await storage.smembers('bot_users'); await ctx.reply(`📊 تعداد کاربران ثبت‌شده: ${users.length}`); });
bot.command('broadcast', async (ctx) => { if (!isAdmin(ctx)) return; const messageText = ctx.message.text.replace(/^\/broadcast\s*/, '').trim(); if (!messageText) return ctx.reply('❌ استفاده: /broadcast متن پیام'); const users = await storage.smembers('bot_users'); let success = 0; let failed = 0; for (const id of users) { try { await bot.telegram.sendMessage(id, messageText); success++; } catch (error) { failed++; if (String(error.description || '').includes('blocked')) await storage.srem('bot_users', id); } await new Promise((resolve) => setTimeout(resolve, 50)); } await ctx.reply(`✅ ارسال پایان یافت. موفق: ${success} | ناموفق: ${failed}`); });

module.exports = async (req, res) => { if (req.method !== 'POST') return res.status(200).send('ArtiQ VPN Bot is running.'); if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) return res.status(403).send('Unauthorized'); try { await bot.handleUpdate(req.body); return res.status(200).send('OK'); } catch (error) { log('WEBHOOK_ERROR', { error: error.message || String(error) }); return res.status(200).send('OK'); } };
