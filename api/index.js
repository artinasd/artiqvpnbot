const { Telegraf, Markup } = require('telegraf');
const { calculateCustomPrice, parseDurationDays, buildCustomPlan } = require('../lib/plans');
const planStore = require('../lib/plan-store');
const { SERVICES, getService, getConfiguredService, serviceLabel, serviceButtons } = require('../lib/services');
const { normalizeSubscriptionName } = require('../lib/username');
const storage = require('../lib/storage');
const wallet = require('../lib/wallet');
const pasarguard = require('../lib/pasarguard');
const { orderId, fulfillOrder, renewOrder, formatBytes } = require('../lib/fulfillment');
const { getConfig, getMessage } = require('../lib/bot-config');
const accountService = require('../lib/account-service');
const accountUI = require('../lib/account-ui');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const PAYMENT_CARD_NUMBER = process.env.PAYMENT_CARD_NUMBER || '6219861947080387';
const PAYMENT_CARD_HOLDER = process.env.PAYMENT_CARD_HOLDER || 'اسعدی';
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
    paymentStatus: 'WALLET_REQUIRED', fulfillmentStatus: 'DRAFT', deliveryStatus: null,
    walletCharged: false, receiptFileId: null, receiptType: null, receiptTelegramMessageId: null, failureReason: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  await storage.createOrder(order); return order;
}

async function askSubscriptionName(ctx, order) {
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_SUBSCRIPTION_NAME', orderId: order.orderId });
  await ctx.reply(await getMessage('subscriptionNamePrompt'), Markup.inlineKeyboard([[Markup.button.callback(await getConfig().then(c => c.buttons?.autoName || '⚡ نام خودکار'), `auto_name_${order.orderId}`)]]));
}

async function showWalletCheckout(ctx, order) {
  const balance = await wallet.getBalance(ctx.from.id);
  const price = Number(order.price || 0);
  if (balance >= price) {
    const lock = `wallet-purchase:${ctx.from.id}`;
    if (!(await storage.acquireLock(lock, 30))) return ctx.reply('⏳ درخواست شما در حال پردازش است.');
    try {
      const freshBalance = await wallet.getBalance(ctx.from.id);
      if (freshBalance < price) return showWalletCheckout(ctx, order);
      await wallet.debit(ctx.from.id, price, { walletLastTransaction: `purchase:${order.orderId}` });
      await storage.updateOrder(order.orderId, { paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'RECEIPT_SUBMITTED', walletCharged: true, walletChargedAmount: price, walletChargedAt: new Date().toISOString() });
      await storage.deleteState('user', ctx.from.id);
      await ctx.reply(`✅ مبلغ ${price.toLocaleString('en-US')} تومان از کیف پول شما کسر شد.\n\n⏳ در حال ساخت اشتراک...`);
      await fulfillOrder(order.orderId, bot.telegram);
    } finally { await storage.releaseLock(lock); }
    return;
  }
  await storage.updateOrder(order.orderId, { paymentStatus: 'WALLET_REQUIRED', fulfillmentStatus: 'AWAITING_WALLET' });
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_WALLET_AMOUNT', orderId: order.orderId, requiredAmount: price, balance });
  const missing = Math.max(0, price - balance);
  await ctx.reply(`💰 <b>موجودی کیف پول</b>\n\nموجودی فعلی: <b>${balance.toLocaleString('en-US')} تومان</b>\nقیمت این اشتراک: <b>${price.toLocaleString('en-US')} تومان</b>\nکسری: <b>${missing.toLocaleString('en-US')} تومان</b>\n\nبرای ادامه، کیف پول خود را حداقل به اندازه مبلغ اشتراک شارژ کنید.\n\nمبلغ شارژ را به تومان وارد کنید:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[Markup.button.callback(`💳 شارژ حداقل ${missing.toLocaleString('en-US')} تومان`, `wallet_charge_${order.orderId}`)]] } });
}

async function showWalletTopupPayment(ctx, topup) {
  const config = await getConfig();
  const card = String(config.payment.cardNumber || PAYMENT_CARD_NUMBER).replace(/\D/g, '');
  const holder = config.payment.cardHolder || PAYMENT_CARD_HOLDER;
  const bankDetails = config.payment.bankDetails || BANK_DETAILS;
  const formattedCard = card.replace(/(\d{4})(?=\d)/g, '$1 ');
  const text = `💳 <b>شارژ کیف پول</b>\n\n💰 مبلغ: <b>${Number(topup.topupAmount).toLocaleString('en-US')} تومان</b>\n\n🏦 <b>شماره کارت</b>\n<code>${formattedCard}</code>\n👤 <b>به نام:</b> ${escapeHtml(holder)}${bankDetails ? `\n\n${escapeHtml(bankDetails)}\n` : ''}\n\nرسید پرداخت را همین‌جا ارسال کنید. پس از تأیید مدیر، مبلغ به کیف پول شما اضافه می‌شود و خرید درخواستی به‌صورت خودکار ادامه پیدا می‌کند.`;
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: config.buttons?.copyCard || '📋 کپی شماره کارت', copy_text: { text: card } }]] } });
}

async function createWalletTopup(ctx, amount, linkedOrderId) {
  const id = orderId();
  const topup = { orderId: id, orderType: 'wallet_topup', telegramUserId: ctx.from.id, telegramUsername: ctx.from.username || null, firstName: ctx.from.first_name || null, lastName: ctx.from.last_name || null, planId: 'wallet_topup', planName: 'شارژ کیف پول', service: 'wallet', topupAmount: Number(amount), price: Number(amount), currency: 'تومان', linkedOrderId: linkedOrderId || null, paymentStatus: 'AWAITING_PAYMENT', fulfillmentStatus: 'AWAITING_WALLET_RECEIPT', walletCharged: false, receiptFileId: null, receiptType: null, receiptTelegramMessageId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await storage.createOrder(topup);
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_WALLET_RECEIPT', topupOrderId: id, linkedOrderId: linkedOrderId || null });
  await showWalletTopupPayment(ctx, topup);
  return topup;
}

async function activateWalletOrder(order) {
  const price = Number(order.price || 0);
  const lock = `wallet-purchase:${order.telegramUserId}`;
  if (!(await storage.acquireLock(lock, 30))) return { locked: true };
  try {
    const current = await storage.getOrder(order.orderId);
    if (!current || current.walletCharged || current.fulfillmentStatus === 'FULFILLED') return { already: true, order: current };
    const balance = await wallet.getBalance(current.telegramUserId);
    if (balance < price) return { insufficient: true, balance };
    await wallet.debit(current.telegramUserId, price, { walletLastTransaction: `purchase:${current.orderId}` });
    const paid = await storage.updateOrder(current.orderId, { paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'RECEIPT_SUBMITTED', walletCharged: true, walletChargedAmount: price, walletChargedAt: new Date().toISOString() });
    await storage.deleteState('user', current.telegramUserId);
    await bot.telegram.sendMessage(current.telegramUserId, `✅ شارژ کیف پول تأیید شد و ${price.toLocaleString('en-US')} تومان بابت سفارش ${current.planName} کسر شد.\n\n⏳ اشتراک شما در حال ساخت است...`).catch(() => {});
    await fulfillOrder(current.orderId, bot.telegram);
    return { fulfilled: true, order: paid };
  } finally { await storage.releaseLock(lock); }
}

async function sendServiceMenu(ctx, mode = 'buy') {
  const config = await getConfig();
  const titleKey = mode === 'test' ? 'serviceSelectionTest' : mode === 'renew' ? 'serviceSelectionRenew' : 'serviceSelectionBuy';
  const title = await getMessage(titleKey);
  const prefix = mode === 'test' ? 'service_test_' : mode === 'renew' ? 'service_renew_' : 'service_buy_';
  const buttons = serviceButtons(prefix, config);
  if (!buttons.length) return ctx.reply(await getMessage('serviceUnavailable'));
  await ctx.reply(title, Markup.inlineKeyboard(buttons));
}

async function sendPlanMenu(ctx, mode = 'buy', serviceId = 'tunnel') {
  const config = await getConfig();
  const service = getConfiguredService(serviceId, config);
  if (!service) return ctx.reply(await getMessage('invalidService'));
  const plans = await planStore.listActiveByService(service.id);
  const buttons = plans.map((plan) => [Markup.button.callback(`${plan.buttonText || plan.name} - ${Number(plan.price).toLocaleString('en-US')} ${config.payment?.currency || plan.currency || 'تومان'}`, `${mode === 'renew' ? 'renew_plan_' : 'select_plan_'}${plan.id}`)]);
  if (mode === 'buy' && service.id === 'tunnel') buttons.push([Markup.button.callback('🛠 ساخت بسته دلخواه (حجم و زمان)', `select_custom_${service.id}`)]);
  if (!buttons.length) return ctx.reply(await getMessage('noPlans', { service_name: serviceLabel(service) }));
  await ctx.reply(`${mode === 'renew' ? '🔄' : '📋'} ${serviceLabel(service)}\n\n${await getMessage('planPrompt')}`, Markup.inlineKeyboard(buttons));
}

async function createTestForService(ctx, serviceId) {
  const config = await getConfig(); const service = getConfiguredService(serviceId, config);
  if (!service) return ctx.reply(await getMessage('invalidService')); await persistUser(ctx);
  const user = await storage.getUser(ctx.from.id, config.limits.testLimitPerDay); if (user?.testUsed) return ctx.reply(await getMessage('testLimitReached'));
  const lockName = `test:${ctx.from.id}`; if (!(await storage.acquireLock(lockName, 120))) return ctx.reply(await getMessage('testProcessingLock'));
  let orderIdValue = null; try { const refreshed = await storage.getUser(ctx.from.id, config.limits.testLimitPerDay); if (refreshed?.testUsed) return ctx.reply(await getMessage('testLimitReached')); const id = orderId(); orderIdValue = id; const trafficBytes = Number(config.limits.testTrafficBytes ?? TEST_TRAFFIC_BYTES); const durationDays = Number(config.limits.testDurationDays ?? TEST_DURATION_DAYS); const hwidLimit = Number(config.limits.testHwidLimit ?? TEST_HWID_LIMIT); const order = { orderId:id,telegramUserId:ctx.from.id,telegramUsername:ctx.from.username||null,firstName:ctx.from.firstName||ctx.from.first_name||null,lastName:ctx.from.lastName||ctx.from.last_name||null,planId:'test',planName:`اکانت تست — ${service.name}`,service:service.id,trafficLimitBytes:trafficBytes,durationDays,hwidLimit,price:0,currency:config.payment?.currency||'تومان',requestedName:null,generatedPasarguardUsername:null,pasarguardUserId:null,subscriptionUrl:null,paymentStatus:'NOT_REQUIRED',fulfillmentStatus:'RECEIPT_SUBMITTED',deliveryStatus:null,receiptFileId:null,receiptType:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() }; await storage.createOrder(order); await ctx.reply(await getMessage('testProcessing',{service_name:service.name})); await fulfillOrder(id,bot.telegram); await storage.saveUser({...userSnapshot(ctx),testUsed:true,testCreatedAt:new Date().toISOString()}); } catch(error){ await storage.saveUser({...userSnapshot(ctx),testUsed:false,testCreatedAt:null}); log('TEST_FULFILLMENT_FAILED',{order_id:orderIdValue,telegram_user_id:ctx.from.id,service:service.id,error:error?.message||String(error)}); await ctx.reply(await getMessage('testFailure')); } finally { await storage.releaseLock(lockName); }
}

async function createRenewalOrderForSubscription(ctx, sourceOrder) { const id=orderId(); const order={orderId:id,telegramUserId:ctx.from.id,telegramUsername:ctx.from.username||null,firstName:ctx.from.first_name||null,lastName:ctx.from.last_name||null,planId:sourceOrder.planId||sourceOrder.orderId,planName:sourceOrder.planName||'اشتراک',service:sourceOrder.service||'tunnel',trafficLimitBytes:Number(sourceOrder.trafficLimitBytes||sourceOrder.trafficBytes||0),durationDays:Number(sourceOrder.durationDays||1),hwidLimit:Number(sourceOrder.hwidLimit||0),price:Number(sourceOrder.price||0),currency:sourceOrder.currency||'تومان',requestedName:null,generatedPasarguardUsername:sourceOrder.generatedPasarguardUsername||null,pasarguardUserId:null,subscriptionUrl:null,paymentStatus:'WALLET_REQUIRED',fulfillmentStatus:'DRAFT',deliveryStatus:null,walletCharged:false,receiptFileId:null,receiptType:null,receiptTelegramMessageId:null,failureReason:null,renewal:true,renewalSourceOrderId:sourceOrder.orderId,renewalPasarguardUserId:sourceOrder.pasarguardUserId||sourceOrder.renewalPasarguardUserId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; if(!order.renewalPasarguardUserId)throw new Error('RENEWAL_TARGET_MISSING'); await storage.createOrder(order); return order; }

async function showWalletPage(ctx) {
  const balance = await wallet.getBalance(ctx.from.id);
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_WALLET_AMOUNT', orderId: null, requiredAmount: 0, balance });
  return ctx.reply(`💰 <b>کیف پول من</b>\n\nموجودی فعلی: <b>${balance.toLocaleString('en-US')} تومان</b>\n\nمبلغی که می‌خواهید کیف پول را شارژ کنید به تومان وارد کنید.\n\nپس از ارسال رسید و تأیید مدیر، مبلغ به موجودی شما اضافه می‌شود.`, { parse_mode: 'HTML' });
}

bot.catch((error,ctx)=>{log('BOT_ERROR',{update_type:ctx?.updateType,error:error?.message||String(error)});});
bot.use(async(ctx,next)=>{if(isAdmin(ctx))return next();const config=await getConfig();if(config.bot?.maintenanceMode)return ctx.reply(await getMessage('maintenance'));return next();});
bot.start(async(ctx)=>{await persistUser(ctx);await storage.deleteState('user',ctx.from.id);const config=await getConfig();const b=config.buttons||{};const testText=b.test||'🎁 دریافت اکانت تست';const buyText=b.buy||'🛒 خرید اشتراک';const accountText=b.account||'👤 حساب من';const walletText=b.wallet||'💰 کیف پول من';const supportText=b.support||'🎯 پشتیبانی';const message=await getMessage('start');await ctx.reply(message,Markup.keyboard([[testText],[buyText],[walletText],[accountText],[supportText]]).resize());});
bot.hears(/.*/,async(ctx,next)=>{const config=await getConfig();const b=config.buttons||{};const text=ctx.message?.text;if(text===(b.support||'🎯 پشتیبانی')){await persistUser(ctx);const username=config.payment.supportUsername||SUPPORT_USERNAME;return ctx.reply(await getMessage('support',{support_username:username}));}if(text===(b.buy||'🛒 خرید اشتراک')){await persistUser(ctx);return sendServiceMenu(ctx,'buy');}if(text===(b.test||'🎁 دریافت اکانت تست')){return sendServiceMenu(ctx,'test');}if(text===(b.wallet||'💰 کیف پول من')){await persistUser(ctx);return showWalletPage(ctx);}if(text===(b.account||'👤 حساب من')){await persistUser(ctx);const subscriptions=await accountUI.listForUser(ctx.from.id);if(!subscriptions.length)return ctx.reply(await getMessage('accountNoSubscription'));return ctx.reply('👤 <b>حساب من</b>\n\nاشتراک موردنظر را انتخاب کنید:',{parse_mode:'HTML',reply_markup:{inline_keyboard:accountUI.subscriptionKeyboard(subscriptions)}});}return next();});
bot.hears('🛒 خرید اشتراک',async(ctx)=>{await persistUser(ctx);await sendServiceMenu(ctx,'buy');});
bot.hears('🎁 دریافت اکانت تست',async(ctx)=>{await sendServiceMenu(ctx,'test');});

bot.on('callback_query',async(ctx)=>{
  const data=ctx.callbackQuery.data||'';await ctx.answerCbQuery().catch(()=>{});
  if(data.startsWith('wallet_charge_')){const id=data.slice('wallet_charge_'.length);const order=await storage.getOrder(id);if(!order||String(order.telegramUserId)!==String(ctx.from.id))return ctx.reply('❌ سفارش پیدا نشد.');await storage.setState('user',ctx.from.id,{stage:'AWAITING_WALLET_AMOUNT',orderId:id,requiredAmount:Number(order.price||0),balance:await wallet.getBalance(ctx.from.id)});return ctx.reply('💳 مبلغ شارژ کیف پول را به تومان وارد کنید:');}
  if(data.startsWith('wallet_approve_')){if(!isAdmin(ctx))return;const id=data.slice('wallet_approve_'.length);const topup=await storage.getOrder(id);if(!topup||topup.orderType!=='wallet_topup'||topup.paymentStatus!=='RECEIPT_SUBMITTED')return ctx.reply('❌ این درخواست قبلاً پردازش شده یا معتبر نیست.');await wallet.credit(topup.telegramUserId,Number(topup.topupAmount||0),{walletLastCredit:`topup:${id}`,walletLastCreditAt:new Date().toISOString()});await storage.updateOrder(id,{paymentStatus:'APPROVED',fulfillmentStatus:'WALLET_CREDITED',approvedAt:new Date().toISOString()});await ctx.reply(`✅ شارژ ${Number(topup.topupAmount||0).toLocaleString('en-US')} تومان تأیید شد.`);if(topup.linkedOrderId){const pending=await storage.getOrder(topup.linkedOrderId);if(pending)await activateWalletOrder(pending);}return;}
  if(data.startsWith('wallet_reject_')){if(!isAdmin(ctx))return;const id=data.slice('wallet_reject_'.length);const topup=await storage.getOrder(id);if(!topup||topup.orderType!=='wallet_topup'||topup.paymentStatus!=='RECEIPT_SUBMITTED')return ctx.reply('❌ این درخواست قبلاً پردازش شده یا معتبر نیست.');await storage.updateOrder(id,{paymentStatus:'REJECTED',fulfillmentStatus:'WALLET_TOPUP_REJECTED',rejectedAt:new Date().toISOString()});await bot.telegram.sendMessage(topup.telegramUserId,'❌ رسید شارژ کیف پول شما تأیید نشد. در صورت نیاز، دوباره تلاش کنید.').catch(()=>{});return ctx.reply('❌ درخواست شارژ رد شد.');}
  if(data==='account_list'){const subscriptions=await accountUI.listForUser(ctx.from.id);if(!subscriptions.length)return ctx.reply(await getMessage('accountNoSubscription'));return ctx.reply('👤 <b>حساب من</b>\n\nاشتراک موردنظر را انتخاب کنید:',{parse_mode:'HTML',reply_markup:{inline_keyboard:accountUI.subscriptionKeyboard(subscriptions)}});}
  if(data.startsWith('account_sub:')){const id=data.slice('account_sub:'.length);const raw=await accountService.getSubscription(ctx.from.id,id);if(!raw)return ctx.reply('❌ این اشتراک پیدا نشد.');const sub=accountService.summary(raw);return ctx.reply(accountUI.formatDetail(sub),{reply_markup:{inline_keyboard:accountUI.detailKeyboard(sub)}});}
  if(data.startsWith('copy_sub:')){const id=data.slice('copy_sub:'.length);const raw=await accountService.getSubscription(ctx.from.id,id);const url=raw?.subUrl||raw?.subscriptionUrl;if(!url)return ctx.reply('❌ لینک اشتراک در دسترس نیست.');return ctx.reply('📋 لینک اشتراک:',{reply_markup:{inline_keyboard:[[{text:'📋 کپی لینک اشتراک',copy_text:{text:url}}],[{text:'⬅️ بازگشت',callback_data:`account_sub:${id}`}]]}});}
  if(data.startsWith('account_renew:')){const id=data.slice('account_renew:'.length);const raw=await accountService.getSubscription(ctx.from.id,id);if(!raw||!accountService.canRenew(raw))return ctx.reply('❌ این اشتراک قابل تمدید نیست.');try{const order=await createRenewalOrderForSubscription(ctx,raw);return showWalletCheckout(ctx,order);}catch(error){log('ACCOUNT_RENEWAL_CREATE_FAILED',{telegram_user_id:ctx.from.id,source_order_id:id,error:error?.message||String(error)});return ctx.reply('❌ تمدید این اشتراک در حال حاضر ممکن نیست.');}}
  if(data.startsWith('service_test_'))return createTestForService(ctx,data.slice('service_test_'.length));
  if(data.startsWith('service_buy_'))return sendPlanMenu(ctx,'buy',data.slice('service_buy_'.length));
  if(data.startsWith('service_renew_')){const user=await storage.getUser(ctx.from.id);if(!user?.currentPasarguardUserId)return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.');return sendPlanMenu(ctx,'renew',data.slice('service_renew_'.length));}
  if(data.startsWith('select_plan_')){const plan=await planStore.get(data.slice('select_plan_'.length));if(!plan)return ctx.reply('❌ این پلن دیگر فعال نیست. لطفاً فهرست پلن‌ها را دوباره باز کنید.');const config=await getConfig();const service=getConfiguredService(plan.service,config);if(!service)return ctx.reply(await getMessage('invalidService'));const order=await createOrderForPlan(ctx,plan);await askSubscriptionName(ctx,order);return;}
  if(data.startsWith('select_custom_')){const serviceId=data.slice('select_custom_'.length);const config=await getConfig();const service=getConfiguredService(serviceId,config);if(!service)return ctx.reply(await getMessage('invalidService'));if(service.id!=='tunnel')return ctx.reply(await getMessage('serviceUnavailable',{service_name:serviceLabel(service)}));await storage.setState('user',ctx.from.id,{stage:'AWAITING_CUSTOM_TRAFFIC',service:serviceId});return ctx.reply('🛠 حجم مورد نیاز را فقط به صورت عدد و بر حسب گیگابایت وارد کنید.\n\nمثلاً: 15');}
  if(data==='select_custom'){await storage.setState('user',ctx.from.id,{stage:'AWAITING_CUSTOM_TRAFFIC',service:'tunnel'});return ctx.reply('🛠 حجم مورد نیاز را فقط به صورت عدد و بر حسب گیگابایت وارد کنید.\n\nمثلاً: 15');}
  if(data.startsWith('auto_name_')){const id=data.slice('auto_name_'.length);const state=await storage.getState('user',ctx.from.id);if(!state||state.orderId!==id||state.stage!=='AWAITING_SUBSCRIPTION_NAME')return;const order=await storage.getOrder(id);if(!order||order.telegramUserId!==ctx.from.id)return;await storage.updateOrder(id,{requestedName:null});return showWalletCheckout(ctx,{...order,requestedName:null});}
  if(data==='renew_choose'){const user=await storage.getUser(ctx.from.id);if(!user?.currentPasarguardUserId)return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.');return sendServiceMenu(ctx,'renew');}
  if(data.startsWith('renew_plan_')){const plan=await planStore.get(data.slice('renew_plan_'.length));const user=await storage.getUser(ctx.from.id);if(!plan||!user?.currentPasarguardUserId)return ctx.reply('❌ این پلن فعال نیست یا اشتراک شما پیدا نشد.');const config=await getConfig();const service=getConfiguredService(plan.service,config);if(!service)return ctx.reply(await getMessage('invalidService'));const order=await createOrderForPlan(ctx,plan);await storage.updateOrder(order.orderId,{renewal:true,renewalPasarguardUserId:user.currentPasarguardUserId});return showWalletCheckout(ctx,order);}
  if(data.startsWith('invalidate_')){if(!isAdmin(ctx))return;const id=data.slice('invalidate_'.length);const order=await storage.getOrder(id);if(!order||!order.pasarguardUserId)return ctx.reply('❌ سفارش یا کاربر PasarGuard پیدا نشد.');try{await pasarguard.disableUser(order.pasarguardUserId);await storage.updateOrder(id,{paymentStatus:'PAYMENT_LATER_REJECTED',fulfillmentStatus:'PAYMENT_LATER_REJECTED'});await ctx.reply(`❌ اشتراک ${escapeHtml(order.generatedPasarguardUsername)} غیرفعال شد.`,{parse_mode:'HTML'});await bot.telegram.sendMessage(order.telegramUserId,'❌ پرداخت این سفارش بعداً نامعتبر تشخیص داده شد و اشتراک غیرفعال شد.');}catch(error){await ctx.reply('❌ غیرفعال‌سازی اشتراک انجام نشد؛ لاگ فنی ثبت شد.');}}
});

bot.on('message',async(ctx)=>{
  await persistUser(ctx);const state=await storage.getState('user',ctx.from.id);if(!state)return;
  if(state.stage==='AWAITING_WALLET_AMOUNT'){const amount=Number(String(ctx.message.text||'').trim().replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));const required=Number(state.requiredAmount||0);const minimum=state.orderId?Math.max(0,required-Number(state.balance||0)):1;if(!Number.isInteger(amount)||amount<1)return ctx.reply('❌ مبلغ نامعتبر است. یک عدد مثبت به تومان وارد کنید.');if(amount<minimum)return ctx.reply(`❌ این مبلغ کافی نیست. حداقل ${minimum.toLocaleString('en-US')} تومان لازم است.`);await createWalletTopup(ctx,amount,state.orderId||null);return;}
  if(state.stage==='AWAITING_WALLET_RECEIPT'){if(!ctx.message.photo&&!ctx.message.document)return ctx.reply('❌ لطفاً تصویر رسید یا فایل رسید را ارسال کنید.');const topup=await storage.getOrder(state.topupOrderId);if(!topup||topup.telegramUserId!==ctx.from.id||topup.orderType!=='wallet_topup')return ctx.reply('❌ درخواست شارژ پیدا نشد.');if(topup.paymentStatus!=='AWAITING_PAYMENT')return;const receiptFileId=ctx.message.photo?ctx.message.photo[ctx.message.photo.length-1].file_id:ctx.message.document.file_id;const receiptType=ctx.message.photo?'photo':'document';const updated=await storage.updateOrder(topup.orderId,{receiptFileId,receiptType,receiptTelegramMessageId:ctx.message.message_id,paymentStatus:'RECEIPT_SUBMITTED',fulfillmentStatus:'WALLET_TOPUP_PENDING'});await storage.deleteState('user',ctx.from.id);const caption=`💳 <b>درخواست شارژ کیف پول</b>\n\nشناسه: <code>${escapeHtml(updated.orderId)}</code>\nکاربر: ${escapeHtml(updated.firstName||'')}\nشناسه تلگرام: <code>${updated.telegramUserId}</code>\nمبلغ: <b>${Number(updated.topupAmount).toLocaleString('en-US')} تومان</b>${updated.linkedOrderId?`\nسفارش مرتبط: <code>${escapeHtml(updated.linkedOrderId)}</code>`:''}`;const buttons=Markup.inlineKeyboard([[Markup.button.callback('✅ تأیید شارژ',`wallet_approve_${updated.orderId}`),Markup.button.callback('❌ رد شارژ',`wallet_reject_${updated.orderId}`)]]);try{if(receiptType==='photo')await bot.telegram.sendPhoto(ADMIN_ID,receiptFileId,{caption,parse_mode:'HTML',...buttons});else await bot.telegram.sendDocument(ADMIN_ID,receiptFileId,{caption,parse_mode:'HTML',...buttons});}catch(error){log('ADMIN_WALLET_NOTIFICATION_FAILED',{order_id:updated.orderId,error:error?.message||String(error)});}return ctx.reply('✅ رسید شارژ دریافت شد. پس از تأیید مدیر، کیف پول شارژ می‌شود و خرید شما خودکار ادامه پیدا می‌کند.');}
  if(state.stage==='AWAITING_CUSTOM_TRAFFIC'){const traffic=Number(String(ctx.message.text||'').trim().replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));if(!Number.isInteger(traffic)||traffic<1||traffic>1000)return ctx.reply('❌ حجم نامعتبر است. عددی بین ۱ تا ۱۰۰۰ گیگابایت وارد کنید.');const price=calculateCustomPrice(traffic);await storage.setState('user',ctx.from.id,{stage:'AWAITING_CUSTOM_DURATION',traffic,price,service:state.service||'tunnel'});return ctx.reply(`✅ حجم ${traffic} گیگابایت ثبت شد.\n💳 قیمت: ${price.toLocaleString('en-US')} تومان\n\nمدت را به صورت «۳۰ روزه» یا «۱ ماهه» وارد کنید. حداکثر ۱۵۰ روز.`);}
  if(state.stage==='AWAITING_CUSTOM_DURATION'){const days=parseDurationDays(ctx.message.text);if(!days||days<1||days>150)return ctx.reply('❌ مدت نامعتبر است. بین ۱ تا ۱۵۰ روز وارد کنید.');const plan={...buildCustomPlan(state.traffic,days),service:state.service||'tunnel'};const order=await createOrderForPlan(ctx,plan);await askSubscriptionName(ctx,order);return;}
  if(state.stage==='AWAITING_SUBSCRIPTION_NAME'){if(!ctx.message.text)return ctx.reply('❌ لطفاً نام اشتراک را به صورت متن انگلیسی ارسال کنید یا «نام خودکار» را انتخاب کنید.');let name;try{name=normalizeSubscriptionName(ctx.message.text);}catch(error){const messages={USERNAME_ENGLISH_ONLY:'❌ نام اشتراک فقط باید با حروف انگلیسی باشد. حروف فارسی/عربی و ایموجی مجاز نیست.',USERNAME_NO_SPACES:'❌ نام اشتراک نباید فاصله داشته باشد.',USERNAME_INVALID_CHARACTERS:'❌ فقط حروف انگلیسی، اعداد، @ و _ مجاز هستند.',USERNAME_TOO_GENERIC:'❌ این نام برای اشتراک مناسب نیست. یک نام معنادار انگلیسی انتخاب کنید.'};return ctx.reply(messages[error.message]||'❌ نام اشتراک نامعتبر است.');}const order=await storage.getOrder(state.orderId);if(!order||order.telegramUserId!==ctx.from.id)return ctx.reply('❌ سفارش پیدا نشد. لطفاً دوباره از خرید شروع کنید.');const updated=await storage.updateOrder(order.orderId,{requestedName:name});return showWalletCheckout(ctx,updated);}
  if(state.stage==='AWAITING_RECEIPT'){return ctx.reply('❌ پرداخت مستقیم برای خرید اشتراک دیگر استفاده نمی‌شود. لطفاً کیف پول خود را شارژ کنید.');}
});

bot.command('wallet',async(ctx)=>{await persistUser(ctx);return showWalletPage(ctx);});
bot.command('pingdb',async(ctx)=>{if(!isAdmin(ctx))return;try{await ctx.reply(await storage.ping()?'✅ Redis: OK':'⚠️ Redis در حالت حافظه محلی است.');}catch{await ctx.reply('❌ Redis: ERROR');}});
bot.command('status',async(ctx)=>{if(!isAdmin(ctx))return;const orders=await storage.listOrders(100);const pending=orders.filter(o=>!['FULFILLED','PAYMENT_LATER_REJECTED','WALLET_TOPUP_REJECTED'].includes(o.fulfillmentStatus)).length;const failed=orders.filter(o=>o.fulfillmentStatus==='FAILED_RETRYABLE').length;let pg='ERROR';try{await pasarguard.health();pg='OK';}catch{}await ctx.reply(`📊 <b>وضعیت سیستم</b>\n\nTelegram Bot: OK\nRedis: ${storage.configured()?'OK':'MEMORY'}\nPasarGuard: ${pg}\nPending orders: ${pending}\nFailed fulfillments: ${failed}`,{parse_mode:'HTML'});});
bot.command('orders',async(ctx)=>{if(!isAdmin(ctx))return;const orders=await storage.listOrders(20);if(!orders.length)return ctx.reply('سفارشی ثبت نشده است.');const text=orders.map(o=>`${o.orderId} | ${o.planName} | ${o.fulfillmentStatus} | ${o.generatedPasarguardUsername||'-'}`).join('\n');await ctx.reply(`<pre>${escapeHtml(text)}</pre>`,{parse_mode:'HTML'});});
bot.command('failed',async(ctx)=>{if(!isAdmin(ctx))return;const orders=(await storage.listOrders(100)).filter(o=>o.fulfillmentStatus==='FAILED_RETRYABLE');if(!orders.length)return ctx.reply('❌ مورد ناموفقی وجود ندارد.');for(const order of orders.slice(0,10))await ctx.reply(`⚠️ ${order.orderId}\n${order.failureReason||'unknown'}\n${order.generatedPasarguardUsername||'-'}`);});
bot.command('users',async(ctx)=>{if(!isAdmin(ctx))return;const users=await storage.smembers('bot_users');await ctx.reply(`📊 تعداد کاربران ثبت‌شده: ${users.length}`);});
bot.command('broadcast',async(ctx)=>{if(!isAdmin(ctx))return;const messageText=ctx.message.text.replace(/^\/broadcast\s*/,'').trim();if(!messageText)return ctx.reply('❌ استفاده: /broadcast متن پیام');const users=await storage.smembers('bot_users');let success=0;let failed=0;for(const id of users){try{await bot.telegram.sendMessage(id,messageText);success++;}catch(error){failed++;if(String(error.description||'').includes('blocked'))await storage.srem('bot_users',id);}await new Promise(resolve=>setTimeout(resolve,50));}await ctx.reply(`✅ ارسال پایان یافت. موفق: ${success} | ناموفق: ${failed}`);});

module.exports=async(req,res)=>{if(req.method!=='POST')return res.status(200).send('ArtiQ VPN Bot is running.');if(WEBHOOK_SECRET&&req.headers['x-telegram-bot-api-secret-token']!==WEBHOOK_SECRET)return res.status(403).send('Unauthorized');try{await bot.handleUpdate(req.body);return res.status(200).send('OK');}catch(error){log('WEBHOOK_ERROR',{error:error.message||String(error)});return res.status(200).send('OK');}};
