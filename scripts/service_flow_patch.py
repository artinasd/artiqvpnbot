from pathlib import Path
p = Path('api/index.js')
s = p.read_text()
if "require('../lib/services')" not in s:
    s = s.replace("const planStore = require('../lib/plan-store');", "const planStore = require('../lib/plan-store');\nconst { SERVICES, getService, serviceButtons } = require('../lib/services');")
s = s.replace("    planName: plan.name,\n    trafficLimitBytes", "    planName: plan.name,\n    service: plan.service || 'tunnel',\n    trafficLimitBytes", 1)
start = s.index("async function sendPlanMenu(ctx, mode = 'buy') {")
end = s.index("\n\nbot.catch", start)
new = r'''async function sendServiceMenu(ctx, mode = 'buy') {
  const title = mode === 'test' ? '🎁 سرویس مورد نظر برای اکانت تست را انتخاب کنید:' : mode === 'renew' ? '🔄 سرویس مورد نظر برای تمدید را انتخاب کنید:' : '🛒 ابتدا سرویس مورد نظر را انتخاب کنید:';
  const prefix = mode === 'test' ? 'service_test_' : mode === 'renew' ? 'service_renew_' : 'service_buy_';
  await ctx.reply(title, Markup.inlineKeyboard(serviceButtons(prefix)));
}

async function sendPlanMenu(ctx, mode = 'buy', serviceId = 'tunnel') {
  const service = getService(serviceId);
  if (!service) return ctx.reply('❌ سرویس انتخاب‌شده معتبر نیست.');
  const plans = await planStore.listActiveByService(service.id);
  const buttons = plans.map((plan) => [Markup.button.callback(
    `${plan.name} - ${Number(plan.price).toLocaleString('en-US')} تومان`,
    `${mode === 'renew' ? 'renew_plan_' : 'select_plan_'}${plan.id}`
  )]);
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
    const order = {
      orderId: id, telegramUserId: ctx.from.id, telegramUsername: ctx.from.username || null,
      firstName: ctx.from.first_name || null, lastName: ctx.from.last_name || null,
      planId: 'test', planName: 'اکانت تست — Tunnel', service: service.id,
      trafficLimitBytes: TEST_TRAFFIC_BYTES, durationDays: TEST_DURATION_DAYS, hwidLimit: TEST_HWID_LIMIT,
      price: 0, currency: 'تومان', requestedName: null, generatedPasarguardUsername: null,
      pasarguardUserId: null, subscriptionUrl: null, paymentStatus: 'NOT_REQUIRED',
      fulfillmentStatus: 'RECEIPT_SUBMITTED', deliveryStatus: null, receiptFileId: null, receiptType: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
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
'''
s = s[:start] + new + s[end:]
s = s.replace("bot.hears('🛒 خرید اشتراک', async (ctx) => {\n  await persistUser(ctx);\n  await sendPlanMenu(ctx, 'buy');\n});", "bot.hears('🛒 خرید اشتراک', async (ctx) => {\n  await persistUser(ctx);\n  await sendServiceMenu(ctx, 'buy');\n});")
start = s.index("bot.hears('🎁 دریافت اکانت تست'")
end = s.index("\n\nbot.on('callback_query'", start)
s = s[:start] + "bot.hears('🎁 دریافت اکانت تست', async (ctx) => { await sendServiceMenu(ctx, 'test'); });" + s[end:]
needle = "  await ctx.answerCbQuery().catch(() => {});\n"
insert = """  if (data.startsWith('service_test_')) {\n    return createTestForService(ctx, data.slice('service_test_'.length));\n  }\n  if (data.startsWith('service_buy_')) {\n    return sendPlanMenu(ctx, 'buy', data.slice('service_buy_'.length));\n  }\n  if (data.startsWith('service_renew_')) {\n    const user = await storage.getUser(ctx.from.id);\n    if (!user?.currentPasarguardUserId) return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.');\n    return sendPlanMenu(ctx, 'renew', data.slice('service_renew_'.length));\n  }\n"""
s = s.replace(needle, needle + insert, 1)
old = """  if (data.startsWith('select_plan_')) {\n    const plan = await planStore.get(data.slice('select_plan_'.length));\n    if (!plan) return ctx.reply('❌ این پلن دیگر فعال نیست. لطفاً فهرست پلن‌ها را دوباره باز کنید.');\n    const order = await createOrderForPlan(ctx, plan);\n    await askSubscriptionName(ctx, order);\n    return;\n  }\n\n  if (data === 'select_custom') {"""
new = """  if (data.startsWith('select_plan_')) {\n    const plan = await planStore.get(data.slice('select_plan_'.length));\n    if (!plan) return ctx.reply('❌ این پلن دیگر فعال نیست. لطفاً فهرست پلن‌ها را دوباره باز کنید.');\n    if (plan.service !== 'tunnel') return ctx.reply(`🛠️ سرویس ${getService(plan.service)?.label || plan.service} هنوز در حال آماده‌سازی است. فعلاً خرید این سرویس فعال نیست.`);\n    const order = await createOrderForPlan(ctx, plan);\n    await askSubscriptionName(ctx, order);\n    return;\n  }\n\n  if (data.startsWith('select_custom_')) {\n    const serviceId = data.slice('select_custom_'.length);\n    if (serviceId !== 'tunnel') return ctx.reply(`🛠️ سرویس ${getService(serviceId)?.label || serviceId} هنوز در حال آماده‌سازی است. فعلاً بسته دلخواه این سرویس فعال نیست.`);\n    await storage.setState('user', ctx.from.id, { stage: 'AWAITING_CUSTOM_TRAFFIC', service: serviceId });\n    await ctx.reply('🛠 حجم مورد نیاز را فقط به صورت عدد و بر حسب گیگابایت وارد کنید.\\n\\nمثلاً: 15');\n    return;\n  }\n\n  if (data === 'select_custom') {"""
s = s.replace(old, new)
s = s.replace("    await sendPlanMenu(ctx, 'renew');", "    await sendServiceMenu(ctx, 'renew');", 1)
s = s.replace("    const plan = buildCustomPlan(state.traffic, days);", "    const plan = { ...buildCustomPlan(state.traffic, days), service: state.service || 'tunnel' };")
p.write_text(s)
PY