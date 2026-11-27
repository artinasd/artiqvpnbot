const { Telegraf, Markup } = require('telegraf');
const { secretsEqual } = require('../lib/cms-auth');
const { escapeHtml } = require('../lib/html');
const { calculateCustomPrice, resolveCustomTrafficRate, resolveCustomOrderPrice, parseDurationDays, buildCustomPlan, normalizeDigits } = require('../lib/plans');
const planStore = require('../lib/plan-store');
const { getConfiguredServiceWithPanels, serviceName, serviceLabel, serviceButtonsWithPanels } = require('../lib/services');
const { normalizeSubscriptionName } = require('../lib/username');
const storage = require('../lib/storage');
const wallet = require('../lib/wallet');
const { orderId, fulfillOrder, renewOrder, formatBytes } = require('../lib/fulfillment');
const { getConfig, getMessage, getMenuKeyboard, getPublishedMenu, formatPublishedMenuText, getPublishedScreen, getScreenExtraRows, arrangeScreenRows, formatScreenMessage, buildDefaultMainMenuKeyboard } = require('../lib/bot-config');
const { getProvider } = require('../lib/providers');
const accountService = require('../lib/account-service');
const accountUI = require('../lib/account-ui');
const { registerAdminMessaging } = require('../lib/admin-messaging');
const forceJoin = require('../lib/force-join');
const requestContext = require('../lib/request-context');
const userReport = require('../lib/user-report');
const purchaseReport = require('../lib/purchase-report');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const BOT_BRAND_NAME = process.env.BOT_BRAND_NAME || 'VPN Bot';
const PAYMENT_CARD_NUMBER = process.env.PAYMENT_CARD_NUMBER || '';
const PAYMENT_CARD_HOLDER = process.env.PAYMENT_CARD_HOLDER || '';
const BANK_DETAILS = process.env.BANK_DETAILS || '';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || '';
const TEST_TRAFFIC_BYTES = 150 * 1024 * 1024;
const TEST_DURATION_DAYS = 1;
const TEST_HWID_LIMIT = Number(process.env.TEST_HWID_LIMIT ?? 0);

if (!BOT_TOKEN || !ADMIN_ID) console.error('Missing BOT_TOKEN or ADMIN_ID');
const bot = new Telegraf(BOT_TOKEN || 'INVALID_TOKEN');

// Apply Telegram HTML parsing consistently to every outgoing bot message that contains
// actual Telegram-supported HTML tags, including CMS screens and custom submenu text.
// Explicit parse_mode settings always win; plain text is left untouched.
const telegramHtmlTag = /<\/?(?:b|strong|i|em|u|ins|s|strike|del|span|tg-spoiler|a|code|pre|blockquote|tg-emoji)(?:\s|>)/i;
function wrapTelegramHtmlCallApi(telegram) {
  if (!telegram || telegram.__artiqHtmlWrapped) return telegram;
  const nativeCallApi = telegram.callApi.bind(telegram);
  telegram.callApi = function(method, payload = {}, ...args) {
    const nextPayload = { ...payload };
    if (!nextPayload.parse_mode) {
      const text = ['sendMessage', 'editMessageText'].includes(method) ? nextPayload.text
        : ['sendPhoto', 'sendDocument', 'sendVideo', 'sendAnimation', 'sendAudio', 'sendVoice', 'editMessageCaption'].includes(method) ? nextPayload.caption
        : null;
      if (typeof text === 'string' && telegramHtmlTag.test(text)) nextPayload.parse_mode = 'HTML';
    }
    return nativeCallApi(method, nextPayload, ...args);
  };
  telegram.__artiqHtmlWrapped = true;
  return telegram;
}
wrapTelegramHtmlCallApi(bot.telegram);
bot.use(requestContext.middleware);
bot.use((ctx, next) => {
  wrapTelegramHtmlCallApi(ctx.telegram);
  return next();
});
bot.use(async (ctx, next) => {
  if (isAdmin(ctx)) return next();
  const config = await getConfig();
  if (config.bot?.maintenanceMode) {
    if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
    return ctx.reply(await getMessage('maintenance'));
  }
  return next();
});
bot.use(forceJoin.createGateMiddleware({ sendMainMenu: (ctx) => sendMainMenu(ctx) }));
registerAdminMessaging(bot, { storage, isAdmin, log });

function toPersianDigits(value) { return String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]); }

function isAdmin(ctx) { return String(ctx.from?.id) === ADMIN_ID; }
function log(event, fields = {}) { console.log(JSON.stringify({ event, ...fields })); }
function userSnapshot(ctx) { return { telegramUserId: ctx.from.id, username: ctx.from.username || null, firstName: ctx.from.first_name || null, lastName: ctx.from.last_name || null, updatedAt: new Date().toISOString() }; }
async function persistUser(ctx) {
  const existing = await storage.getUserRaw(ctx.from.id);
  const snapshot = userSnapshot(ctx);
  const lastSeenAt = Date.parse(existing?.lastSeenAt || '');
  const seenRecently = Number.isFinite(lastSeenAt)
    && Date.now() - lastSeenAt >= 0
    && Date.now() - lastSeenAt <= 15 * 60 * 1000;
  const profileUnchanged = existing
    && (existing.username ?? null) === snapshot.username
    && (existing.firstName ?? null) === snapshot.firstName
    && (existing.lastName ?? null) === snapshot.lastName;
  if (existing && existing.botStatus === 'active' && profileUnchanged && seenRecently) return existing;
  return storage.saveUser(snapshot);
}

async function createOrderForPlan(ctx, plan) {
  const id = orderId();
  const panel = plan.panelId ? ((await require('../lib/panel-registry').getById(plan.panelId)) || await require('../lib/master-panel-registry').getById(plan.panelId)) : null;
  const serviceId = plan.panelId ? (panel?.type === 'master' ? `master_${plan.panelId}` : `panel_${plan.panelId}`) : (plan.service || 'tunnel');
  const order = {
    orderId: id, telegramUserId: ctx.from.id, telegramUsername: ctx.from.username || null,
    firstName: ctx.from.first_name || null, lastName: ctx.from.last_name || null,
    planId: plan.id, planName: plan.name, service: serviceId, serviceName: plan.panelName || null,
    panelId: panel?.type === 'master' ? null : (plan.panelId || null),
    masterPanelId: panel?.type === 'master' ? panel.id : (String(serviceId).startsWith('master_') ? String(serviceId).slice('master_'.length) : null),
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
  const fallback = await getMessage('subscriptionNamePrompt');
  const message = await formatScreenMessage('subscription_name', fallback, { title: order.planName || '', plan_name: order.planName || '' });
  const baseRows = [[Markup.button.callback(await getConfig().then(c => c.buttons?.autoName || '⚡ نام خودکار'), `auto_name_${order.orderId}`)]];
  const rows = await arrangeScreenRows('subscription_name', baseRows);
  await ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
}

async function showWalletCheckout(ctx, order) {
  const balance = await wallet.getBalance(ctx.from.id);
  const price = Number(order.price || 0);
  let currentBalance = balance;
  if (balance >= price) {
    const lock = `wallet-purchase:${ctx.from.id}`;
    const lockToken = await storage.acquireLock(lock, 30); if (!lockToken) return ctx.reply('⏳ درخواست شما در حال پردازش است.');
    let insufficientAfterLock = false;
    try {
      const freshOrder = await storage.getOrder(order.orderId);
      if (!freshOrder || freshOrder.walletCharged === true || ['FULFILLED', 'RECEIPT_SUBMITTED', 'PROVISIONING'].includes(freshOrder.fulfillmentStatus)) {
        return ctx.reply('⏳ این سفارش قبلاً ثبت یا در حال پردازش است.');
      }
      const freshBalance = await wallet.getBalance(ctx.from.id);
      if (freshBalance < price) {
        currentBalance = freshBalance;
        insufficientAfterLock = true;
      } else {
        await wallet.debit(ctx.from.id, price, { walletLastTransaction: `purchase:${order.orderId}` });
        await storage.updateOrder(order.orderId, { paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'RECEIPT_SUBMITTED', walletCharged: true, walletChargedAmount: price, walletChargedAt: new Date().toISOString() });
        await storage.deleteState('user', ctx.from.id);
        await ctx.reply(`✅ مبلغ ${price.toLocaleString('en-US')} تومان از کیف پول شما کسر شد.\n\n⏳ در حال ساخت اشتراک...`);
        await fulfillOrder(order.orderId, bot.telegram);
        return;
      }
    } finally { await storage.releaseLock(lock, lockToken); }
    if (!insufficientAfterLock) return;
  }
  await storage.updateOrder(order.orderId, { paymentStatus: 'WALLET_REQUIRED', fulfillmentStatus: 'AWAITING_WALLET' });
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_WALLET_AMOUNT', orderId: order.orderId, requiredAmount: price, balance: currentBalance });
  const missing = Math.max(0, price - currentBalance);
  const fallback = `💰 <b>موجودی کیف پول</b>\n\nموجودی فعلی: <b>${currentBalance.toLocaleString('en-US')} تومان</b>\nقیمت این اشتراک: <b>${price.toLocaleString('en-US')} تومان</b>\nکسری: <b>${missing.toLocaleString('en-US')} تومان</b>\n\nبرای ادامه، کیف پول خود را حداقل به اندازه مبلغ اشتراک شارژ کنید.\n\nمبلغ شارژ را به تومان وارد کنید:`;
  const message = await formatScreenMessage('wallet_checkout', fallback, {
    balance: currentBalance.toLocaleString('en-US'),
    price: price.toLocaleString('en-US'),
    missing: missing.toLocaleString('en-US'),
  });
  const baseRows = [[Markup.button.callback(`💳 شارژ حداقل ${missing.toLocaleString('en-US')} تومان`, `wallet_charge_${order.orderId}`)], [Markup.button.callback('🏠 منوی اصلی', 'main_home')]];
  const rows = await arrangeScreenRows('wallet_checkout', baseRows);
  await ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
}

async function showWalletTopupPayment(ctx, topup) {
  const config = await getConfig();
  const card = String(config.payment.cardNumber || PAYMENT_CARD_NUMBER).replace(/\D/g, '');
  const holder = config.payment.cardHolder || PAYMENT_CARD_HOLDER;
  const bankDetails = config.payment.bankDetails || BANK_DETAILS;
  const formattedCard = card.replace(/(\d{4})(?=\d)/g, '$1 ');
  const fallback = `💳 <b>شارژ کیف پول</b>\n\n💰 مبلغ: <b>${Number(topup.topupAmount).toLocaleString('en-US')} تومان</b>\n\n🏦 <b>شماره کارت</b>\n<code>${formattedCard}</code>\n👤 <b>به نام:</b> ${escapeHtml(holder)}${bankDetails ? `\n\n${escapeHtml(bankDetails)}\n` : ''}\n\nرسید پرداخت را همین‌جا ارسال کنید. پس از تأیید مدیر، مبلغ به کیف پول شما اضافه می‌شود و خرید درخواستی به‌صورت خودکار ادامه پیدا می‌کند.`;
  const text = await formatScreenMessage('wallet_topup', fallback, {
    amount: Number(topup.topupAmount).toLocaleString('en-US'),
    card: formattedCard,
    holder: escapeHtml(holder),
    bank_details: escapeHtml(bankDetails || ''),
  });
  const rows = await arrangeScreenRows('wallet_topup', [[{ text: config.buttons?.copyCard || '📋 کپی شماره کارت', copy_text: { text: card } }]]);
  await ctx.reply(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
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
  const lockToken = await storage.acquireLock(lock, 30); if (!lockToken) return { locked: true };
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
  } finally { await storage.releaseLock(lock, lockToken); }
}

async function defaultScreenHomeRows(screenId) {
  const screen = await getPublishedScreen(screenId) || {};
  const hasConfiguredHome = (screen.buttons || []).some((button) => button.action === 'back_home');
  return screen.homeButton !== false && !hasConfiguredHome ? [[Markup.button.callback('🏠 منوی اصلی', 'main_home')]] : [];
}
async function sendMainMenu(ctx) {
  const config = await getConfig();
  const mainMenu = await getPublishedMenu('main');
  const message = mainMenu?.text ? await formatPublishedMenuText('main', ctx.from.id) : await getMessage('start');
  const configuredKeyboard = await getMenuKeyboard('main');
  return ctx.reply(message, { ...(configuredKeyboard || buildDefaultMainMenuKeyboard(config.buttons)), parse_mode: 'HTML' });
}
async function sendSupportPage(ctx) {
  const config = await getConfig();
  const username = config.payment.supportUsername || SUPPORT_USERNAME;
  const fallback = await getMessage('support', { support_username: username });
  const message = await formatScreenMessage('support', fallback, { title: 'پشتیبانی', mode: 'support' });
  return ctx.reply(message, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: await arrangeScreenRows('support', await defaultScreenHomeRows('support')) },
  });
}

async function sendServiceMenu(ctx, mode = 'buy') {
  const config = await getConfig();
  const titleKey = mode === 'test' ? 'serviceSelectionTest' : mode === 'renew' ? 'serviceSelectionRenew' : 'serviceSelectionBuy';
  const fallbackTitle = await getMessage(titleKey);
  const screenId = mode === 'test' ? 'service_test' : mode === 'renew' ? 'service_renew' : 'service_buy';
  const title = await formatScreenMessage(screenId, fallbackTitle, { title: fallbackTitle, mode });
  const prefix = mode === 'test' ? 'service_test_' : mode === 'renew' ? 'service_renew_' : 'service_buy_';
  const buttons = (await serviceButtonsWithPanels(prefix, config, mode === 'test' ? 'test' : 'purchase'))
    .filter((row) => !row.some((b) => String(b.callback_data || '').startsWith(`${prefix}master_`)));
  if (!buttons.length) return ctx.reply(await formatScreenMessage(screenId, await getMessage('serviceUnavailable', { service_name: '' }), { title: fallbackTitle, mode }), { parse_mode: 'HTML' });
  const rows = await arrangeScreenRows(screenId, buttons);
  await ctx.reply(title, { ...Markup.inlineKeyboard(rows), parse_mode: 'HTML' });
}

async function sendPlanMenu(ctx, mode = 'buy', serviceId = 'tunnel') {
  const config = await getConfig();
  const service = await getConfiguredServiceWithPanels(serviceId, config);
  if (!service) return ctx.reply(await getMessage('invalidService'));
  const plans = service.panelId ? await planStore.listActiveByPanel(service.panelId, ctx.from.id) : await planStore.listActiveByService(service.id, ctx.from.id);
  const displayServiceName = serviceName(service);
  const screenId = mode === 'renew' ? 'plans_renew' : 'plans_buy';
  if (!plans.length && mode !== 'buy') return ctx.reply(await formatScreenMessage(screenId, await getMessage('noPlans', { service_name: displayServiceName }), { service: displayServiceName, prompt: await getMessage('planPrompt'), mode: 'تمدید', title: displayServiceName }), { parse_mode: 'HTML' });
  const screen = await getPublishedScreen(screenId) || {};
  const buttons = plans.map((plan) => [Markup.button.callback(`${plan.buttonText || plan.name} - ${toPersianDigits(Number(plan.price).toLocaleString('en-US'))} ${config.payment?.currency || plan.currency || 'تومان'}`, `${mode === 'renew' ? 'renew_plan_' : 'select_plan_'}${plan.id}`)]);
  const customSetting = screen.customPlanByService && screen.customPlanByService[service.id] || {};
  if (mode === 'buy' && screen.customPlanButton !== false && customSetting.enabled !== false) buttons.push([Markup.button.callback(String(screen.customPlanLabel || '✨ ساخت بسته دلخواه (حجم و زمان)').replace(/^🛠️?\s*/, '✨ '), `select_custom_${service.id}`)]);
  if (!buttons.length) return ctx.reply(await formatScreenMessage(screenId, await getMessage('noPlans', { service_name: displayServiceName }), { service: displayServiceName, prompt: await getMessage('planPrompt'), mode: mode === 'renew' ? 'تمدید' : 'خرید', title: displayServiceName }), { parse_mode: 'HTML' });
  const prompt = await getMessage('planPrompt');
  const fallbackText = `${displayServiceName}\n\n${prompt}`;
  // {service} is the exact CMS-defined service name. Keep emoji decoration out of the
  // placeholder so custom message templates don't inherit an unexpected prefix.
  const messageText = await formatScreenMessage(screenId, fallbackText, { service: displayServiceName, prompt, mode: mode === 'renew' ? 'تمدید' : 'خرید', title: displayServiceName });
  const rows = await arrangeScreenRows(screenId, buttons);
  await ctx.reply(messageText, { ...Markup.inlineKeyboard(rows), parse_mode: 'HTML' });
}

async function createTestForService(ctx, serviceId) {
  const config = await getConfig();
  const service = await getConfiguredServiceWithPanels(serviceId, config);
  if (!service) return ctx.reply(await getMessage('invalidService'));
  if (service.testEnabled === false) return ctx.reply('❌ برای این سرویس اکانت تست فعال نیست.');
  await persistUser(ctx);
  const user = await storage.getUser(ctx.from.id, config.limits.testLimitPerDay);
  if (user?.testUsed) return ctx.reply(await getMessage('testLimitReached'));
  const lockName = `test:${ctx.from.id}`;
  const lockToken = await storage.acquireLock(lockName, 150);
  if (!lockToken) return ctx.reply(await getMessage('testProcessingLock'));
  let lockTransferredToFulfillment = false;
  let orderIdValue = null;
  try {
    const refreshed = await storage.getUser(ctx.from.id, config.limits.testLimitPerDay);
    if (refreshed?.testUsed) return ctx.reply(await getMessage('testLimitReached'));
    const id = orderId();
    orderIdValue = id;
    const trafficBytes = Number(config.limits.testTrafficBytes ?? TEST_TRAFFIC_BYTES);
    const durationDays = Number(config.limits.testDurationDays ?? TEST_DURATION_DAYS);
    const hwidLimit = Number(config.limits.testHwidLimit ?? TEST_HWID_LIMIT);
    const order = {
      orderId: id, telegramUserId: ctx.from.id, telegramUsername: ctx.from.username || null,
      firstName: ctx.from.firstName || ctx.from.first_name || null, lastName: ctx.from.lastName || ctx.from.last_name || null,
      planId: 'test', planName: `اکانت تست — ${service.name}`, service: service.id, serviceName: service.name,
      panelId: service.panelId || null, trafficLimitBytes: trafficBytes, durationDays, hwidLimit,
      price: 0, currency: config.payment?.currency || 'تومان', requestedName: null,
      generatedPasarguardUsername: null, pasarguardUserId: null, subscriptionUrl: null,
      paymentStatus: 'NOT_REQUIRED', fulfillmentStatus: 'RECEIPT_SUBMITTED', deliveryStatus: null,
      receiptFileId: null, receiptType: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await storage.createOrder(order);
    await ctx.reply(await getMessage('testProcessing', { service_name: service.name }));
    await fulfillOrder(id, bot.telegram, { onSettled: () => storage.releaseLock(lockName, lockToken) });
    lockTransferredToFulfillment = true;
  } catch (error) {
    log('TEST_FULFILLMENT_FAILED', { order_id: orderIdValue, telegram_user_id: ctx.from.id, service: service.id, error: error?.message || String(error) });
    await ctx.reply(await getMessage('testFailure'));
  } finally {
    if (!lockTransferredToFulfillment) await storage.releaseLock(lockName, lockToken);
  }
}

async function createRenewalOrderForSubscription(ctx, sourceOrder) { const id=orderId(); const order={orderId:id,telegramUserId:ctx.from.id,telegramUsername:ctx.from.username||null,firstName:ctx.from.first_name||null,lastName:ctx.from.last_name||null,planId:sourceOrder.planId||sourceOrder.orderId,planName:sourceOrder.planName||'اشتراک',service:sourceOrder.service||'tunnel',serviceName:sourceOrder.serviceName||null,trafficLimitBytes:Number(sourceOrder.trafficLimitBytes||sourceOrder.trafficBytes||0),durationDays:Number(sourceOrder.durationDays||1),hwidLimit:Number(sourceOrder.hwidLimit||0),price:Number(sourceOrder.price||0),currency:sourceOrder.currency||'تومان',requestedName:null,generatedPasarguardUsername:sourceOrder.generatedPasarguardUsername||null,pasarguardUserId:null,subscriptionUrl:null,paymentStatus:'WALLET_REQUIRED',fulfillmentStatus:'DRAFT',deliveryStatus:null,walletCharged:false,receiptFileId:null,receiptType:null,receiptTelegramMessageId:null,failureReason:null,renewal:true,renewalSourceOrderId:sourceOrder.orderId,panelId:sourceOrder.panelId||null,renewalPasarguardUserId:sourceOrder.pasarguardUserId||sourceOrder.renewalPasarguardUserId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; if(!order.renewalPasarguardUserId)throw new Error('RENEWAL_TARGET_MISSING'); await storage.createOrder(order); return order; }

async function showWalletPage(ctx) {
  const balance = await wallet.getBalance(ctx.from.id);
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_WALLET_AMOUNT', orderId: null, requiredAmount: 0, balance });
  const fallback = `💰 <b>کیف پول من</b>\n\nموجودی فعلی: <b>${balance.toLocaleString('en-US')} تومان</b>\n\nمبلغی که می‌خواهید کیف پول را شارژ کنید به تومان وارد کنید.\n\nپس از ارسال رسید و تأیید مدیر، مبلغ به موجودی شما اضافه می‌شود.`;
  const message = await formatScreenMessage('wallet', fallback, { title: 'کیف پول من', mode: 'wallet', balance: balance.toLocaleString('en-US') });
  const rows = await arrangeScreenRows('wallet', await defaultScreenHomeRows('wallet'));
  return ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
}


const ACCOUNT_SUBSCRIPTIONS_PER_PAGE = 8;
async function sendAccountList(ctx, requestedPage = 0, { edit = false } = {}) {
  const subscriptions = await accountUI.listForUser(ctx.from.id);
  const screen = await getPublishedScreen('account_list') || {};
  const hasConfiguredHome = (screen.buttons || []).some((button) => button.action === 'back_home');
  const extraRows = await getScreenExtraRows('account_list');
  const homeButton = screen.homeButton !== false && !hasConfiguredHome;
  if (!subscriptions.length) {
    const emptyScreen = await getPublishedScreen('account_empty');
    const hasEmptyCustom = Boolean(emptyScreen && (emptyScreen.messageTemplate || (emptyScreen.buttons && emptyScreen.buttons.length) || emptyScreen.buttonRows || emptyScreen.homeButton === false));
    const emptyHome = (emptyScreen ? emptyScreen.homeButton !== false : homeButton) && !((emptyScreen?.buttons || []).some((b) => b.action === 'back_home'));
    const rows = hasEmptyCustom
      ? await arrangeScreenRows('account_empty', emptyHome ? [[Markup.button.callback('🏠 منوی اصلی', 'main_home')]] : [])
      : await arrangeScreenRows('account_list', homeButton ? [[Markup.button.callback('🏠 منوی اصلی', 'main_home')]] : []);
    const fallback = await getMessage('accountNoSubscription');
    const message = await formatScreenMessage(hasEmptyCustom ? 'account_empty' : 'account_list', fallback, { title: '👤 حساب من' });
    if (edit) return ctx.editMessageText(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
    return ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
  }
  const totalPages = Math.max(1, Math.ceil(subscriptions.length / ACCOUNT_SUBSCRIPTIONS_PER_PAGE));
  const page = Math.max(0, Math.min(totalPages - 1, Number.isFinite(Number(requestedPage)) ? Math.floor(Number(requestedPage)) : 0));
  const current = subscriptions.slice(page * ACCOUNT_SUBSCRIPTIONS_PER_PAGE, (page + 1) * ACCOUNT_SUBSCRIPTIONS_PER_PAGE);
  const fallback = '👤 <b>حساب من</b>\n\nاشتراک موردنظر را انتخاب کنید:';
  let message = await formatScreenMessage('account_list', fallback, { title: '👤 حساب من' });
  if (totalPages > 1) message += `\n\nصفحه ${page + 1} از ${totalPages}`;
  const generatedRows = accountUI.subscriptionKeyboard(current, {
    ...screen,
    homeButton,
    pagination: { page, totalPages },
  });
  const rows = [...generatedRows, ...extraRows];
  const options = { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } };
  if (edit) return ctx.editMessageText(message, options);
  return ctx.reply(message, options);
}

bot.catch((error,ctx)=>{log('BOT_ERROR',{update_type:ctx?.updateType,error:error?.message||String(error)});});
bot.start(async(ctx)=>{
  let newUserReport = null;
  try {
    newUserReport = await userReport.recordFirstStart(storage, ctx.from);
  } catch (error) {
    log('NEW_USER_REPORT_FAILED', { telegram_user_id: ctx.from?.id, error: error?.message || String(error) });
  }
  await persistUser(ctx);
  if (newUserReport) {
    await bot.telegram.sendMessage(ADMIN_ID, newUserReport, { parse_mode: 'HTML' })
      .catch((error) => log('NEW_USER_REPORT_SEND_FAILED', { telegram_user_id: ctx.from?.id, error: error?.message || String(error) }));
  }
  await storage.deleteState('user', ctx.from.id);
  return sendMainMenu(ctx);
});
bot.hears(/.*/, async (ctx, next) => {
  const config = await getConfig();
  const buttons = config.buttons || {};
  const text = ctx.message?.text;
  if (text === (buttons.support || '🎯 پشتیبانی')) {
    await storage.deleteState('user', ctx.from.id).catch(() => {});
    await persistUser(ctx);
    return sendSupportPage(ctx);
  }
  if (text === (buttons.buy || '🛒 خرید اشتراک')) {
    await storage.deleteState('user', ctx.from.id).catch(() => {});
    await persistUser(ctx);
    return sendServiceMenu(ctx, 'buy');
  }
  if (text === (buttons.test || '🎁 دریافت اکانت تست')) {
    await storage.deleteState('user', ctx.from.id).catch(() => {});
    return sendServiceMenu(ctx, 'test');
  }
  if (text === (buttons.wallet || '💰 کیف پول من')) {
    await storage.deleteState('user', ctx.from.id).catch(() => {});
    await persistUser(ctx);
    return showWalletPage(ctx);
  }
  if (text === (buttons.account || '👤 حساب من')) {
    await storage.deleteState('user', ctx.from.id).catch(() => {});
    await persistUser(ctx);
    return sendAccountList(ctx, 0);
  }
  return next();
});

async function startCustomPlanFlow(ctx, serviceId) {
  const selectedServiceId = serviceId || 'tunnel';
  if (serviceId !== undefined) {
    const config = await getConfig();
    const service = await getConfiguredServiceWithPanels(selectedServiceId, config);
    if (!service) return ctx.reply(await getMessage('invalidService'));
  }
  const screen = await getPublishedScreen('plans_buy') || {};
  const customSetting = screen.customPlanByService && screen.customPlanByService[selectedServiceId] || {};
  if (screen.customPlanButton === false || customSetting.enabled === false) return ctx.reply('❌ ساخت بسته دلخواه برای این سرویس فعال نیست.');
  const minTrafficGb = Number(customSetting.minTrafficGb ?? 1);
  const maxTrafficGb = Number(customSetting.maxTrafficGb ?? 1000);
  const maxDays = customSetting.maxDays == null ? null : Number(customSetting.maxDays);
  await storage.setState('user', ctx.from.id, { stage: 'AWAITING_CUSTOM_TRAFFIC', service: selectedServiceId, minTrafficGb, maxTrafficGb, customMaxDays: maxDays });
  const fallback = `🛠 حجم مورد نیاز را به گیگابایت وارد کنید.\nحداقل: ${minTrafficGb} | حداکثر: ${maxTrafficGb} گیگابایت`;
  const message = await formatScreenMessage('custom_traffic', fallback, { min_traffic: minTrafficGb, max_traffic: maxTrafficGb });
  const rows = await arrangeScreenRows('custom_traffic', await defaultScreenHomeRows('custom_traffic'));
  return ctx.reply(message, { parse_mode: 'HTML', ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}) });
}

bot.on('callback_query', async (ctx) => {
  if (!ctx.from?.id || !ctx.callbackQuery) return;
  let data = ctx.callbackQuery.data || '';
  await ctx.answerCbQuery().catch(() => {});
  if (data === 'main_home') return sendMainMenu(ctx);
  if (data.startsWith('menu_nav:')) {
    const targetId = data.slice('menu_nav:'.length);
    if (targetId.startsWith('screen_')) {
      const screenActions = {
        service_test: 'main_test',
        service_buy: 'main_buy',
        service_renew: 'renew_choose',
        plans_buy: 'main_buy',
        plans_renew: 'renew_choose',
        account_list: 'main_account',
        account_detail: 'main_account',
        account_remove: 'main_account',
        wallet: 'main_wallet',
        support: 'main_support',
      };
      const mapped = screenActions[targetId.slice('screen_'.length)];
      if (!mapped) return ctx.reply('This bot screen is not available.');
      data = mapped;
      if (ctx.callbackQuery) ctx.callbackQuery.data = data;
    } else {
      const targetMenu = await getPublishedMenu(targetId);
      const targetKeyboard = targetMenu ? await getMenuKeyboard(targetId) : null;
      if (!targetMenu || !targetKeyboard) return ctx.reply('This menu is no longer available.');
      const targetText = targetMenu.text ? await formatPublishedMenuText(targetId, ctx.from.id) : 'Choose an option:';
      return ctx.reply(targetText, { ...targetKeyboard, parse_mode: 'HTML' });
    }
  }
  if (data === 'main_test') return sendServiceMenu(ctx, 'test');
  if (data === 'main_buy') return sendServiceMenu(ctx, 'buy');
  if (data === 'main_wallet') return showWalletPage(ctx);
  if (data === 'main_account') return sendAccountList(ctx, 0);
  if (data === 'main_support') return sendSupportPage(ctx);
  if (data === 'account_divider') return;
  if(data.startsWith('wallet_charge_')){const id=data.slice('wallet_charge_'.length);const order=await storage.getOrder(id);if(!order||String(order.telegramUserId)!==String(ctx.from.id))return ctx.reply('❌ سفارش پیدا نشد.');await storage.setState('user',ctx.from.id,{stage:'AWAITING_WALLET_AMOUNT',orderId:id,requiredAmount:Number(order.price||0),balance:await wallet.getBalance(ctx.from.id)});return ctx.reply('💳 مبلغ شارژ کیف پول را به تومان وارد کنید:');}
  if(data.startsWith('wallet_approve_')){if(!isAdmin(ctx))return;const id=data.slice('wallet_approve_'.length);const lockName=`wallet-topup-approve:${id}`;const lockToken=await storage.acquireLock(lockName,60);if(!lockToken)return ctx.reply('⏳ این شارژ در حال پردازش است.');try{const topup=await storage.getOrder(id);if(!topup||topup.orderType!=='wallet_topup'||topup.paymentStatus!=='RECEIPT_SUBMITTED')return ctx.reply('❌ این درخواست قبلاً پردازش شده یا معتبر نیست.');const amount=Number(topup.topupAmount||0);if(!Number.isFinite(amount)||amount<=0)return ctx.reply('❌ مبلغ شارژ نامعتبر است.');await wallet.credit(topup.telegramUserId,amount,{walletLastCredit:`topup:${id}`,walletLastCreditAt:new Date().toISOString()});await storage.updateOrder(id,{paymentStatus:'APPROVED',fulfillmentStatus:'WALLET_CREDITED',approvedAt:new Date().toISOString()});await ctx.reply(`✅ شارژ ${amount.toLocaleString('en-US')} تومان تأیید شد.`);if(topup.linkedOrderId){const pending=await storage.getOrder(topup.linkedOrderId);if(pending)await activateWalletOrder(pending);}return;}finally{await storage.releaseLock(lockName,lockToken);}}
  if(data.startsWith('wallet_reject_')){if(!isAdmin(ctx))return;const id=data.slice('wallet_reject_'.length);const lockName=`wallet-topup-approve:${id}`;const lockToken=await storage.acquireLock(lockName,60);if(!lockToken)return ctx.reply('⏳ این شارژ در حال پردازش است.');try{const topup=await storage.getOrder(id);if(!topup||topup.orderType!=='wallet_topup'||topup.paymentStatus!=='RECEIPT_SUBMITTED')return ctx.reply('❌ این درخواست قبلاً پردازش شده یا معتبر نیست.');await storage.updateOrder(id,{paymentStatus:'REJECTED',fulfillmentStatus:'WALLET_TOPUP_REJECTED',rejectedAt:new Date().toISOString()});await bot.telegram.sendMessage(topup.telegramUserId,'❌ رسید شارژ کیف پول شما تأیید نشد. در صورت نیاز، دوباره تلاش کنید.').catch(()=>{});return ctx.reply('❌ درخواست شارژ رد شد.');}finally{await storage.releaseLock(lockName,lockToken);}}
  if(data.startsWith('account_page:')){const page=Number(data.slice('account_page:'.length));if(!Number.isInteger(page)||page<0)return;return sendAccountList(ctx,page,{edit:true});}
  if(data==='account_list')return sendAccountList(ctx,0);
  if(data.startsWith('account_remove_confirm:')) {
    const id = data.slice('account_remove_confirm:'.length);
    const lockName = `account-remove:${id}`;
    const lockToken = await storage.acquireLock(lockName, 90); if (!lockToken) return ctx.reply('⏳ حذف این اشتراک در حال پردازش است. کمی بعد دوباره بررسی کنید.');
    try {
      const result = await accountService.removeSubscriptionFromAccount(ctx.from.id, id);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      const note = result.alreadyRemoved ? 'این اشتراک قبلاً از فهرست حساب حذف شده بود.' : result.alreadyAbsent ? 'کاربر در پنل از قبل وجود نداشت؛ رکورد حساب پاک‌سازی شد.' : 'اشتراک از پنل PasarGuard و فهرست حساب شما حذف شد.';
      await ctx.reply(`✅ ${note}`);
      await sendAccountList(ctx, 0);
      return;
    } catch (error) {
      log('ACCOUNT_REMOVAL_FAILED', { telegram_user_id: ctx.from.id, source_order_id: id, error: error?.message || String(error), status: error?.status || 0 });
      if (error.code === 'SUBSCRIPTION_NOT_FOUND') return ctx.reply('❌ این اشتراک پیدا نشد یا متعلق به حساب شما نیست.');
      return ctx.reply('❌ حذف از پنل کامل نشد. اشتراک در فهرست شما باقی مانده است تا بتوانید دوباره تلاش کنید.');
    } finally {
      await storage.releaseLock(lockName, lockToken).catch(() => {});
    }
  }
  if(data.startsWith('account_remove:')) {
    const id = data.slice('account_remove:'.length);
    const order = await storage.getOrder(id);
    if (!order || String(order.telegramUserId) !== String(ctx.from.id) || order.accountRemovedAt || order.accountRemoved === true) return ctx.reply('❌ این اشتراک پیدا نشد یا قبلاً حذف شده است.');
    const username = order.generatedPasarguardUsername || order.username || order.pasarguardUsername || order.subscriptionUsername || 'این اشتراک';
    const screen = await getPublishedScreen('account_remove') || {};
    const fallback = `⚠️ حذف اشتراک ${escapeHtml(username)}\n\nاین کار کاربر را از پنل PasarGuard حذف می‌کند و اشتراک را از فهرست حساب شما پنهان می‌کند. سابقه سفارش و پرداخت برای سوابق مالی حفظ می‌شود.\n\nآیا مطمئن هستید؟`;
    const message = await formatScreenMessage('account_remove', fallback, { title: escapeHtml(username), service: escapeHtml(order.service || '') });
    return ctx.reply(message, { parse_mode: 'HTML', reply_markup: { inline_keyboard: await arrangeScreenRows('account_remove', accountUI.removeConfirmationKeyboard(id, { ...screen, homeButton: false })) } });
  }
  if(data.startsWith('account_sub:')){const id=data.slice('account_sub:'.length);const raw=await accountService.getSubscription(ctx.from.id,id);if(!raw)return ctx.reply('❌ این اشتراک پیدا نشد.');const sub=accountService.summary(raw);const screen=await getPublishedScreen('account_detail')||{};const message=await formatScreenMessage('account_detail',accountUI.formatDetail(sub),{title:escapeHtml(sub.planName||'اشتراک'),service:escapeHtml(sub.service||'Tunnel'),mode:escapeHtml(sub.status||'')});return ctx.reply(message,{parse_mode:'HTML',reply_markup:{inline_keyboard:await arrangeScreenRows('account_detail',accountUI.detailKeyboard(sub,{...screen,homeButton:false}))}});}
  if(data.startsWith('copy_sub:')){const id=data.slice('copy_sub:'.length);const raw=await accountService.getSubscription(ctx.from.id,id);const url=raw?.subUrl||raw?.subscriptionUrl;if(!url)return ctx.reply('❌ لینک اشتراک در دسترس نیست.');const message=await formatScreenMessage('copy_sub','📋 لینک اشتراک:',{sub_url:url});const rows=await arrangeScreenRows('copy_sub',[[{text:'📋 کپی لینک اشتراک',copy_text:{text:url}}],[{text:'⬅️ بازگشت',callback_data:`account_sub:${id}`}]]);return ctx.reply(message,{parse_mode:'HTML',reply_markup:{inline_keyboard:rows}});}
  if(data.startsWith('account_renew:')){const id=data.slice('account_renew:'.length);const raw=await accountService.getSubscription(ctx.from.id,id);if(!raw||!accountService.canRenew(raw))return ctx.reply('❌ این اشتراک قابل تمدید نیست.');try{const order=await createRenewalOrderForSubscription(ctx,raw);return showWalletCheckout(ctx,order);}catch(error){log('ACCOUNT_RENEWAL_CREATE_FAILED',{telegram_user_id:ctx.from.id,source_order_id:id,error:error?.message||String(error)});return ctx.reply('❌ تمدید این اشتراک در حال حاضر ممکن نیست.');}}
  if(data.startsWith('service_test_'))return createTestForService(ctx,data.slice('service_test_'.length));
  if(data.startsWith('service_buy_'))return sendPlanMenu(ctx,'buy',data.slice('service_buy_'.length));
  if(data.startsWith('service_renew_')){const serviceKey=data.slice('service_renew_'.length);const user=await storage.getUser(ctx.from.id);const hasPanelOrder=serviceKey.startsWith('panel_')&&((await accountService.listSubscriptions(ctx.from.id)).some((o)=>String(o.service||'')===serviceKey||String(o.panelId||'')===serviceKey.slice('panel_'.length)));if(!user?.currentPasarguardUserId&&!hasPanelOrder)return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.');return sendPlanMenu(ctx,'renew',serviceKey);}
  if(data.startsWith('select_plan_')){const plan=await planStore.get(data.slice('select_plan_'.length), ctx.from.id);if(!plan)return ctx.reply('❌ این پلن دیگر فعال نیست. لطفاً فهرست پلن‌ها را دوباره باز کنید.');const config=await getConfig();const panelRecord = plan.panelId ? ((await require('../lib/panel-registry').getById(plan.panelId)) || await require('../lib/master-panel-registry').getById(plan.panelId)) : null;const service=await getConfiguredServiceWithPanels(plan.panelId ? `${panelRecord?.type === 'master' ? 'master' : 'panel'}_${plan.panelId}` : plan.service,config);if(!service)return ctx.reply(await getMessage('invalidService'));const order=await createOrderForPlan(ctx,plan);await askSubscriptionName(ctx,order);return;}
  if(data.startsWith('select_custom_')) return startCustomPlanFlow(ctx, data.slice('select_custom_'.length));
  if(data==='select_custom') return startCustomPlanFlow(ctx);
  if(data.startsWith('auto_name_')){const id=data.slice('auto_name_'.length);const state=await storage.getState('user',ctx.from.id);if(!state||state.orderId!==id||state.stage!=='AWAITING_SUBSCRIPTION_NAME')return ctx.reply('❌ این سفارش منقضی شده یا معتبر نیست. لطفاً دوباره خرید را شروع کنید.');const order=await storage.getOrder(id);if(!order||order.telegramUserId!==ctx.from.id)return ctx.reply('❌ سفارش پیدا نشد. لطفاً دوباره از خرید شروع کنید.');await storage.updateOrder(id,{requestedName:null});return showWalletCheckout(ctx,{...order,requestedName:null});}
  if(data==='renew_choose'){const user=await storage.getUser(ctx.from.id);const subs=user?.currentPasarguardUserId?[]:await accountService.listSubscriptions(ctx.from.id);if(!user?.currentPasarguardUserId&&!subs.some((s)=>accountService.canRenew(s)))return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.');return sendServiceMenu(ctx,'renew');}
  if(data.startsWith('renew_plan_')){const plan=await planStore.get(data.slice('renew_plan_'.length), ctx.from.id);const user=await storage.getUser(ctx.from.id);if(!plan)return ctx.reply('❌ این پلن فعال نیست یا اشتراک شما پیدا نشد.');const config=await getConfig();const panelRecord = plan.panelId ? ((await require('../lib/panel-registry').getById(plan.panelId)) || await require('../lib/master-panel-registry').getById(plan.panelId)) : null;const service=await getConfiguredServiceWithPanels(plan.panelId ? `${panelRecord?.type === 'master' ? 'master' : 'panel'}_${plan.panelId}` : plan.service,config);if(!service)return ctx.reply(await getMessage('invalidService'));let renewalTarget=null;const targetPanel=plan.panelId?((await require('../lib/panel-registry').getById(plan.panelId))||await require('../lib/master-panel-registry').getById(plan.panelId)):null;if(plan.panelId){const orders=await storage.listUserOrders(ctx.from.id, 500);renewalTarget=orders.filter((item)=>Number(item.telegramUserId)===Number(ctx.from.id)&&(targetPanel?.type==='master'?String(item.masterPanelId||'')===String(plan.panelId):String(item.panelId||'')===String(plan.panelId))&&item.pasarguardUserId&&item.fulfillmentStatus==='FULFILLED'&&!item.renewal).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')))[0]||null;if(!renewalTarget)return ctx.reply('❌ اشتراک فعالی در این پنل برای تمدید پیدا نشد. ابتدا از همین پنل خرید کنید یا از بخش حساب من اشتراک مربوطه را انتخاب کنید.');}else if(!user?.currentPasarguardUserId)return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.');const order=await createOrderForPlan(ctx,plan);await storage.updateOrder(order.orderId,{renewal:true,renewalPasarguardUserId:targetPanel?.type==='master'?`master-user:${renewalTarget.orderId}`:(renewalTarget?renewalTarget.pasarguardUserId:user.currentPasarguardUserId),renewalSourceOrderId:renewalTarget?.orderId||null,masterPanelId:targetPanel?.type==='master'?targetPanel.id:undefined});return showWalletCheckout(ctx,order);}
  if(data.startsWith('invalidate_')){if(!isAdmin(ctx))return;const id=data.slice('invalidate_'.length);const order=await storage.getOrder(id);if(!order||!order.pasarguardUserId)return ctx.reply('❌ سفارش یا کاربر PasarGuard پیدا نشد.');try{const providerId=order.fulfillmentProvider||order.provider||order.backend||(order.panelId?`panel:${order.panelId}`:null);if(!providerId)return ctx.reply('❌ مسیر پنل این سفارش مشخص نیست؛ برای جلوگیری از تغییر اشتباه، اشتراک دست‌نخورده باقی ماند.');await getProvider(providerId).disableUser(order.pasarguardUserId);await storage.updateOrder(id,{paymentStatus:'PAYMENT_LATER_REJECTED',fulfillmentStatus:'PAYMENT_LATER_REJECTED'});await ctx.reply(`❌ اشتراک ${escapeHtml(order.generatedPasarguardUsername)} غیرفعال شد.`,{parse_mode:'HTML'});await bot.telegram.sendMessage(order.telegramUserId,'❌ پرداخت این سفارش بعداً نامعتبر تشخیص داده شد و اشتراک غیرفعال شد.');}catch(error){log('INVALIDATE_ORDER_FAILED',{order_id:id,error:error?.message||String(error)});await ctx.reply('❌ غیرفعال‌سازی اشتراک انجام نشد؛ لاگ فنی ثبت شد.');}}
});

bot.on('message',async(ctx,next)=>{
  if (!ctx.from?.id || !ctx.message) return next();
  await persistUser(ctx);const state=await storage.getState('user',ctx.from.id);if(!state)return next();
  if(state.stage==='AWAITING_WALLET_AMOUNT'){const amount=Number(normalizeDigits(String(ctx.message.text||'').trim()));const required=Number(state.requiredAmount||0);const minimum=state.orderId?Math.max(0,required-Number(state.balance||0)):1;if(!Number.isInteger(amount)||amount<1)return ctx.reply('❌ مبلغ نامعتبر است. یک عدد مثبت به تومان وارد کنید.');if(amount<minimum)return ctx.reply(`❌ این مبلغ کافی نیست. حداقل ${minimum.toLocaleString('en-US')} تومان لازم است.`);await createWalletTopup(ctx,amount,state.orderId||null);return;}
  if(state.stage==='AWAITING_WALLET_RECEIPT'){if(!ctx.message.photo&&!ctx.message.document)return ctx.reply('❌ لطفاً تصویر رسید یا فایل رسید را ارسال کنید.');const topup=await storage.getOrder(state.topupOrderId);if(!topup||topup.telegramUserId!==ctx.from.id||topup.orderType!=='wallet_topup')return ctx.reply('❌ درخواست شارژ پیدا نشد.');if(topup.paymentStatus!=='AWAITING_PAYMENT')return;const receiptFileId=ctx.message.photo?ctx.message.photo[ctx.message.photo.length-1].file_id:ctx.message.document.file_id;const receiptType=ctx.message.photo?'photo':'document';const updated=await storage.updateOrder(topup.orderId,{receiptFileId,receiptType,receiptTelegramMessageId:ctx.message.message_id,paymentStatus:'RECEIPT_SUBMITTED',fulfillmentStatus:'WALLET_TOPUP_PENDING'});await storage.deleteState('user',ctx.from.id);const caption=`💳 <b>درخواست شارژ کیف پول</b>\n\nشناسه: <code>${escapeHtml(updated.orderId)}</code>\nکاربر: ${escapeHtml(updated.firstName||'')}\nشناسه تلگرام: <code>${updated.telegramUserId}</code>\nمبلغ: <b>${Number(updated.topupAmount).toLocaleString('en-US')} تومان</b>${updated.linkedOrderId?`\nسفارش مرتبط: <code>${escapeHtml(updated.linkedOrderId)}</code>`:''}`;const buttons=Markup.inlineKeyboard([[Markup.button.callback('✅ تأیید شارژ',`wallet_approve_${updated.orderId}`),Markup.button.callback('❌ رد شارژ',`wallet_reject_${updated.orderId}`)]]);try{if(receiptType==='photo')await bot.telegram.sendPhoto(ADMIN_ID,receiptFileId,{caption,parse_mode:'HTML',...buttons});else await bot.telegram.sendDocument(ADMIN_ID,receiptFileId,{caption,parse_mode:'HTML',...buttons});}catch(error){log('ADMIN_WALLET_NOTIFICATION_FAILED',{order_id:updated.orderId,error:error?.message||String(error)});}return ctx.reply('✅ رسید شارژ دریافت شد. پس از تأیید مدیر، کیف پول شارژ می‌شود و خرید شما خودکار ادامه پیدا می‌کند.');}
  if(state.stage==='AWAITING_CUSTOM_TRAFFIC'){const traffic=Number(normalizeDigits(String(ctx.message.text||'').trim()));const minTrafficGb=Number(state.minTrafficGb??1);const maxTrafficGb=Number(state.maxTrafficGb??1000);if(!Number.isInteger(traffic)||traffic<minTrafficGb||traffic>maxTrafficGb)return ctx.reply(`❌ حجم نامعتبر است. عددی بین ${minTrafficGb} تا ${maxTrafficGb} گیگابایت وارد کنید.`);const service=state.service||'tunnel';const user=await storage.getUser(ctx.from.id);const rates=await storage.get('cms:custom-reseller-rates')||{};const configPricing=(await getConfig());const panelId=String(service).startsWith('panel_')?String(service).slice('panel_'.length):null;const pricing=panelId?(configPricing.pricingByPanel?.[panelId]||configPricing.pricing||{normalPerGb:4000,resellerPerGb:null}):(configPricing.pricing||{});const serviceRate=rates[service]!==null&&rates[service]!==undefined&&Number.isFinite(Number(rates[service]))?Number(rates[service]):null;const panelResellerRate=pricing.resellerPerGb===null||pricing.resellerPerGb===undefined||pricing.resellerPerGb===''?null:Number(pricing.resellerPerGb);const globalResellerRate=panelId?panelResellerRate:(pricing.resellerPerGb===null||pricing.resellerPerGb===undefined||pricing.resellerPerGb===''?null:Number(pricing.resellerPerGb));const isReseller=false;const customRate=isReseller?(serviceRate!==null?serviceRate:(globalResellerRate!==null&&Number.isFinite(globalResellerRate)?globalResellerRate:null)):null;const normalRate=Number(pricing.normalPerGb??4000);const discountPercent=traffic>=100?37.5:traffic>=75?20:traffic>=60?15:traffic>=50?10:0;const minimumRate=normalRate*0.625;const discountedRate=Math.max(minimumRate,Math.round(normalRate*(1-discountPercent/100)));const effectiveRate=resolveCustomTrafficRate({isReseller,customRate,normalRate,discountedRate});const price=traffic*effectiveRate;const maxDays=state.customMaxDays==null?(traffic>=50?60:150):Number(state.customMaxDays);await storage.setState('user',ctx.from.id,{stage:'AWAITING_CUSTOM_DURATION',traffic,price,customRate,service,customMaxDays:maxDays});const hasSpecialResellerRate=customRate!==null&&customRate!==undefined&&effectiveRate===Number(customRate)&&effectiveRate<=discountedRate;const durationFallback=`✅ حجم ${traffic} گیگابایت ثبت شد.\n💳 قیمت: ${price.toLocaleString('en-US')} تومان${hasSpecialResellerRate?' (نرخ ویژه ریسلر)':''}\n\nمدت را به صورت «۳۰ روزه» یا «۱ ماهه» وارد کنید. حداکثر ${maxDays} روز.`;const durationMsg=await formatScreenMessage('custom_duration',durationFallback,{traffic,price:price.toLocaleString('en-US'),max_days:maxDays});const durationRows=await arrangeScreenRows('custom_duration',await defaultScreenHomeRows('custom_duration'));return ctx.reply(durationMsg,{parse_mode:'HTML',...(durationRows.length?{reply_markup:{inline_keyboard:durationRows}}:{})});}
  if(state.stage==='AWAITING_CUSTOM_DURATION'){const days=parseDurationDays(ctx.message.text);const maxDays=state.customMaxDays==null?(Number(state.traffic)>=50?60:150):Number(state.customMaxDays);if(!days||days<1||days>maxDays)return ctx.reply(`❌ مدت نامعتبر است. برای حجم ${Number(state.traffic)>=50?'۵۰ گیگابایت یا بیشتر':'کمتر از ۵۰ گیگابایت'}، مدت باید بین ۱ تا ${maxDays} روز باشد.`);const customService=await getConfiguredServiceWithPanels(state.service||'tunnel',await getConfig());if(!customService)return ctx.reply(await getMessage('invalidService'));const plan={...buildCustomPlan(state.traffic,days),service:customService.panelId?'tunnel':customService.id,panelId:customService.panelId||null,price:resolveCustomOrderPrice(state)};const order=await createOrderForPlan(ctx,plan);await askSubscriptionName(ctx,order);return;}
  if(state.stage==='AWAITING_SUBSCRIPTION_NAME'){if(!ctx.message.text)return ctx.reply('❌ لطفاً نام اشتراک را به صورت متن انگلیسی ارسال کنید یا «نام خودکار» را انتخاب کنید.');let name;try{name=normalizeSubscriptionName(ctx.message.text);}catch(error){const messages={USERNAME_ENGLISH_ONLY:'❌ نام اشتراک فقط باید با حروف انگلیسی باشد. حروف فارسی/عربی و ایموجی مجاز نیست.',USERNAME_NO_SPACES:'❌ نام اشتراک نباید فاصله داشته باشد.',USERNAME_INVALID_CHARACTERS:'❌ فقط حروف انگلیسی، اعداد، @ و _ مجاز هستند.',USERNAME_TOO_GENERIC:'❌ این نام برای اشتراک مناسب نیست. یک نام معنادار انگلیسی انتخاب کنید.'};return ctx.reply(messages[error.message]||'❌ نام اشتراک نامعتبر است.');}const order=await storage.getOrder(state.orderId);if(!order||order.telegramUserId!==ctx.from.id)return ctx.reply('❌ سفارش پیدا نشد. لطفاً دوباره از خرید شروع کنید.');const updated=await storage.updateOrder(order.orderId,{requestedName:name});return showWalletCheckout(ctx,updated);}
  if(state.stage==='AWAITING_RECEIPT'){return ctx.reply('❌ پرداخت مستقیم برای خرید اشتراک دیگر استفاده نمی‌شود. لطفاً کیف پول خود را شارژ کنید.');}
});

bot.command('wallet',async(ctx)=>{await persistUser(ctx);return showWalletPage(ctx);});
bot.command('retryreports', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const requeued = await purchaseReport.requeueFailedPurchaseReports(100);
    const result = await purchaseReport.processPendingPurchaseReports(bot.telegram, { limit: 100 });
    return ctx.reply(`📊 گزارش‌های خرید: بازیابی‌شده ${requeued}، ارسال‌شده ${result.sent}، ناموفق ${result.failed}، در انتظار زمان مجدد ${result.skipped}، قفل‌شده ${result.locked}.`);
  } catch (error) {
    log('PURCHASE_REPORT_MANUAL_RETRY_FAILED', { error: error?.message || String(error) });
    return ctx.reply('❌ پردازش گزارش‌های خرید ناموفق بود.');
  }
});
bot.command('testreport',async(ctx)=>{if(!isAdmin(ctx))return;try{const now=new Date();const dayKey=userReport.gregorianTehranDateKey(now);const [todayCount,allCount]=await Promise.all([storage.scard(`new_users:${dayKey}`),storage.scard('bot_users')]);const message=['🧪 | گزارش آزمایشی (این کاربر واقعی نیست)','','👥 مشخصات کاربر','🆔 آیدی: 123456789','👤 اسم: Test User','⚡️ نام کاربری: @test_user','🌐 زبان تلگرام: en','','📈 آمار عضویت',`🆕 امروز: ${todayCount.toLocaleString('fa-IR')}`,`👥 مجموع کاربران: ${allCount.toLocaleString('fa-IR')}`,'',`🗓 ${userReport.formatJalaliDateTime(now)}`].join('\n');await bot.telegram.sendMessage(ADMIN_ID,message);return ctx.reply('✅ پیام آزمایشی به ADMIN_ID ارسال شد.');}catch(error){log('NEW_USER_REPORT_TEST_FAILED',{admin_id:ADMIN_ID,error:error?.message||String(error)});return ctx.reply(`❌ ارسال پیام آزمایشی ناموفق بود: ${error?.description||error?.message||'unknown error'}`);}});
bot.command('pingdb',async(ctx)=>{if(!isAdmin(ctx))return;try{await ctx.reply(await storage.ping()?'✅ Redis: OK':'⚠️ Redis در حالت حافظه محلی است.');}catch{await ctx.reply('❌ Redis: ERROR');}});
bot.command('status',async(ctx)=>{if(!isAdmin(ctx))return;const orders=await storage.listOrders(100);const pending=orders.filter(o=>!['FULFILLED','PAYMENT_LATER_REJECTED','WALLET_TOPUP_REJECTED'].includes(o.fulfillmentStatus)).length;const failed=orders.filter(o=>o.fulfillmentStatus==='FAILED_RETRYABLE').length;let pg='CMS panels only';try{const panels=await require('../lib/panel-registry').list();pg=panels.length?`${panels.filter(p=>p.status==='active').length}/${panels.length} active`:'no panels registered';}catch{pg='registry error';}await ctx.reply(`📊 <b>وضعیت سیستم</b>\n\nTelegram Bot: OK\nRedis: ${storage.configured()?'OK':'MEMORY'}\nPasarGuard panels: ${pg}\nPending orders: ${pending}\nFailed fulfillments: ${failed}`,{parse_mode:'HTML'});});
bot.command('orders',async(ctx)=>{if(!isAdmin(ctx))return;const orders=await storage.listOrders(20);if(!orders.length)return ctx.reply('سفارشی ثبت نشده است.');const text=orders.map(o=>`${o.orderId} | ${o.planName} | ${o.fulfillmentStatus} | ${o.generatedPasarguardUsername||'-'}`).join('\n');await ctx.reply(`<pre>${escapeHtml(text)}</pre>`,{parse_mode:'HTML'});});
bot.command('failed',async(ctx)=>{if(!isAdmin(ctx))return;const orders=(await storage.listOrders(100)).filter(o=>o.fulfillmentStatus==='FAILED_RETRYABLE');if(!orders.length)return ctx.reply('❌ مورد ناموفقی وجود ندارد.');for(const order of orders.slice(0,10))await ctx.reply(`⚠️ ${order.orderId}\n${order.failureReason||'unknown'}\n${order.generatedPasarguardUsername||'-'}`);});
bot.command('users',async(ctx)=>{if(!isAdmin(ctx))return;const count=await storage.scard('bot_users');await ctx.reply(`📊 تعداد کاربران ثبت‌شده: ${count}`);});

module.exports=async(req,res)=>{
  if(req.method!=='POST')return res.status(200).send(`${BOT_BRAND_NAME} is running.`);
  if(WEBHOOK_SECRET&&!secretsEqual(WEBHOOK_SECRET,req.headers['x-telegram-bot-api-secret-token']))return res.status(403).send('Unauthorized');
  if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).send('Invalid update payload');
  const startedAt=Date.now();
  const update=req.body||{};
  const callbackData=String(update.callback_query?.data||'');
  const messageText=String(update.message?.text||'');
  const diagnosticFields={
    update_id:update.update_id,
    update_type:update.callback_query?'callback_query':update.message?'message':update.pre_checkout_query?'pre_checkout_query':Object.keys(update).find((key)=>key!=='update_id')||'unknown',
    callback_action:callbackData?callbackData.split('_').slice(0,3).join('_'):undefined,
    message_command:messageText.startsWith('/')?messageText.split(/\s+/)[0].slice(0,40):undefined,
  };
  log('WEBHOOK_DIAGNOSTIC_START',diagnosticFields);
  try{
    await requestContext.runWithUpdate(req.body, () => bot.handleUpdate(req.body));
    log('WEBHOOK_DIAGNOSTIC_COMPLETE',{...diagnosticFields,duration_ms:Date.now()-startedAt});
    return res.status(200).send('OK');
  }catch(error){
    log('WEBHOOK_ERROR',{...diagnosticFields,duration_ms:Date.now()-startedAt,error:error.message||String(error)});
    return res.status(200).send('OK');
  }
};
