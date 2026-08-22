const { Telegraf, Markup } = require('telegraf');
const { PLANS, getPlan, calculateCustomPrice, parseDurationDays, buildCustomPlan } = require('../lib/plans');
const { normalizeSubscriptionName } = require('../lib/username');
const storage = require('../lib/storage');
const pasarguard = require('../lib/pasarguard');
const { orderId, fulfillOrder, renewOrder, formatBytes } = require('../lib/fulfillment');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const BANK_DETAILS = process.env.BANK_DETAILS || '';
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

function isAdmin(ctx) {
  return String(ctx.from?.id) === ADMIN_ID;
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

function userSnapshot(ctx) {
  return {
    telegramUserId: ctx.from.id,
    username: ctx.from.username || null,
    firstName: ctx.from.first_name || null,
    lastName: ctx.from.last_name || null,
    updatedAt: new Date().toISOString(),
  };
}

async function persistUser(ctx) {
  return storage.saveUser(userSnapshot(ctx));
}

async function createOrderForPlan(ctx, plan) {
  const id = orderId();
  const order = {
    orderId: id,
    telegramUserId: ctx.from.id,
    telegramUsername: ctx.from.username || null,
    firstName: ctx.from.first_name || null,
    lastName: ctx.from.last_name || null,
    planId: plan.id,
    planName: plan.name,
    trafficLimitBytes: plan.trafficBytes,
    durationDays: plan.durationDays,
    hwidLimit: plan.hwidLimit,
    price: plan.price,
    currency: plan.currency || 'تومان',
    requestedName: null,
    generatedPasarguardUsername: null,
    pasarguardUserId: null,
    subscriptionUrl: null,
    paymentStatus: 'AWAITING_PAYMENT',
    fulfillmentStatus: 'DRAFT',
    deliveryStatus: null,
    receiptFileId: null,
    receiptType: null,
    receiptTelegramMessageId: null,
    failureReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await storage.createOrder(order);
  return order;
}

async function askSubscriptionName(ctx, order) {
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_SUBSCRIPTION_NAME', orderId: order.orderId });
  await ctx.reply(
    '👤 نام اشتراک\n\nاگر می‌خواهید نام دلخواهی برای اشتراک خود انتخاب کنید، آن را وارد کنید؛ در غیر این صورت نام به صورت خودکار ساخته می‌شود.\n\nفقط حروف انگلیسی، اعداد، @ و _ مجاز است و نام نباید فاصله یا کاراکتر دیگری داشته باشد.',
    Markup.inlineKeyboard([[Markup.button.callback('⚡ نام خودکار', `auto_name_${order.orderId}`)]])
  );
}

async function showPayment(ctx, order) {
  await storage.updateOrder(order.orderId, {
    paymentStatus: 'AWAITING_PAYMENT',
    fulfillmentStatus: 'AWAITING_PAYMENT',
  });
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_RECEIPT', orderId: order.orderId });
  await ctx.reply(
    `💳 <b>اطلاعات پرداخت</b>\n\nسرویس: <b>${escapeHtml(order.planName)}</b>\nمبلغ: <b>${Number(order.price).toLocaleString('en-US')} ${escapeHtml(order.currency)}</b>\n\n${escapeHtml(BANK_DETAILS)}\n\n📸 پس از پرداخت، عکس رسید یا فایل رسید را همینجا ارسال کنید.\n\n⚠️ رسید فقط برای ثبت و بررسی بعدی نگهداری می‌شود؛ پس از ارسال رسید، سفارش به صورت خودکار وارد مرحله ساخت اشتراک می‌شود.`,
    { parse_mode: 'HTML' }
  );
}

bot.catch((error, ctx) => {
  log('BOT_ERROR', { update_type: ctx?.updateType, error: error?.message || String(error) });
});

bot.start(async (ctx) => {
  await persistUser(ctx);
  await storage.deleteState('user', ctx.from.id);
  await ctx.reply('👋 به ربات آرتیک خوش آمدید!\n\nلطفاً یکی از گزینه‌های زیر را انتخاب کنید:', Markup.keyboard([
    ['🎁 دریافت اکانت تست'],
    ['🛒 خرید اشتراک'],
    ['👤 حساب من'],
    ['🎯 پشتیبانی'],
  ]).resize());
});

bot.hears('🎯 پشتیبانی', async (ctx) => {
  await persistUser(ctx);
  await ctx.reply(`ℹ️ برای پشتیبانی و راهنمایی، با ما در ارتباط باشید:\n\n💬 @${escapeHtml(SUPPORT_USERNAME)}`);
});

bot.hears('🛒 خرید اشتراک', async (ctx) => {
  await persistUser(ctx);
  const buttons = PLANS.map((plan) => [Markup.button.callback(
    `${plan.name} - ${Number(plan.price).toLocaleString('en-US')} تومان`,
    `select_plan_${plan.id}`
  )]);
  buttons.push([Markup.button.callback('🛠 ساخت بسته دلخواه (حجم و زمان)', 'select_custom')]);
  await ctx.reply('📋 لطفاً بسته مورد نظر خود را انتخاب کنید:', Markup.inlineKeyboard(buttons));
});

bot.hears('👤 حساب من', async (ctx) => {
  await persistUser(ctx);
  const user = await storage.getUser(ctx.from.id);
  if (!user?.currentPasarguardUserId) return ctx.reply('👤 هنوز اشتراک فعالی برای حساب شما ثبت نشده است.');
  try {
    const current = await pasarguard.getUserById(user.currentPasarguardUserId);
    const status = current.status || 'نامشخص';
    const traffic = current.data_limit === 0 ? 'نامحدود' : formatBytes(Number(current.data_limit || 0));
    const used = current.used_traffic != null ? formatBytes(Number(current.used_traffic)) : 'در دسترس نیست';
    await ctx.reply(
      `👤 <b>حساب من</b>\n\n👤 نام اشتراک: <code>${escapeHtml(current.username || user.currentPasarguardUsername)}</code>\n📊 حجم: ${escapeHtml(traffic)}\n📈 مصرف: ${escapeHtml(used)}\n⏳ انقضا: ${escapeHtml(current.expire || 'نامشخص')}\n📌 وضعیت: ${escapeHtml(status)}`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
        [{ text: '📥 دریافت لینک اشتراک', url: current.subscription_url || user.currentSubscriptionUrl }],
        [{ text: '🔄 تمدید اشتراک', callback_data: 'renew_choose' }],
      ] } }
    );
  } catch (error) {
    await ctx.reply('❌ دریافت وضعیت اشتراک در حال حاضر ممکن نیست. لطفاً کمی بعد دوباره تلاش کنید.');
  }
});

bot.hears('🎁 دریافت اکانت تست', async (ctx) => {
  await persistUser(ctx);
  const user = await storage.getUser(ctx.from.id);
  if (user?.testUsed) return ctx.reply('🎁 شما قبلاً از اکانت تست استفاده کرده‌اید.');

  const lockName = `test:${ctx.from.id}`;
  if (!(await storage.acquireLock(lockName, 120))) return ctx.reply('⏳ درخواست تست شما در حال پردازش است.');
  let orderIdValue = null;
  try {
    const refreshed = await storage.getUser(ctx.from.id);
    if (refreshed?.testUsed) return ctx.reply('🎁 شما قبلاً از اکانت تست استفاده کرده‌اید.');

    const id = orderId();
    orderIdValue = id;
    const order = {
      orderId: id,
      telegramUserId: ctx.from.id,
      telegramUsername: ctx.from.username || null,
      firstName: ctx.from.first_name || null,
      lastName: ctx.from.last_name || null,
      planId: 'test',
      planName: 'اکانت تست',
      trafficLimitBytes: TEST_TRAFFIC_BYTES,
      durationDays: TEST_DURATION_DAYS,
      hwidLimit: TEST_HWID_LIMIT,
      price: 0,
      currency: 'تومان',
      requestedName: null,
      generatedPasarguardUsername: null,
      pasarguardUserId: null,
      subscriptionUrl: null,
      paymentStatus: 'NOT_REQUIRED',
      fulfillmentStatus: 'RECEIPT_SUBMITTED',
      deliveryStatus: null,
      receiptFileId: null,
      receiptType: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.createOrder(order);
    await ctx.reply('⏳ اکانت تست شما در حال ساخت خودکار است...');
    await fulfillOrder(id, bot.telegram);
    await storage.saveUser({ ...userSnapshot(ctx), testUsed: true, testCreatedAt: new Date().toISOString() });
  } catch (error) {
    await storage.saveUser({ ...userSnapshot(ctx), testUsed: false, testCreatedAt: null });
    log('TEST_FULFILLMENT_FAILED', {
      order_id: orderIdValue,
      telegram_user_id: ctx.from.id,
      error: error?.message || String(error),
    });
    await ctx.reply('❌ ساخت اکانت تست انجام نشد. مشکل فنی ثبت شد و می‌توانید دوباره تلاش کنید.');
  } finally {
    await storage.releaseLock(lockName);
  }
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  await ctx.answerCbQuery().catch(() => {});

  if (data.startsWith('select_plan_')) {
    const plan = getPlan(data.slice('select_plan_'.length));
    if (!plan) return;
    const order = await createOrderForPlan(ctx, plan);
    await askSubscriptionName(ctx, order);
    return;
  }

  if (data === 'select_custom') {