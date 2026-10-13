const { buildUsername } = require('./username');
const { getOrder, updateOrder, saveUser, setState, acquireLock, releaseLock } = require('./storage');
const { getProvider } = require('./providers');
const wallet = require('./wallet');
const { createSubscriptionQr } = require('./qr');
const { getConfig, getMessage } = require('./bot-config');
const { getFulfillment } = require('./service-fulfillment');
const crypto = require('crypto');
const { waitUntil } = require('@vercel/functions');
function orderId() { const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, ''); return `TG-${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`; }
function expiryIso(durationDays) { if (durationDays === null || durationDays === undefined || durationDays === '' || Number(durationDays) === 0) return undefined; return new Date(Date.now() + Number(durationDays) * 86400 * 1000).toISOString(); }
async function deliverSubscription(telegram, order, text, subscriptionUrl) { const config = await getConfig(); const qrBackground = config.bot?.qrBackground || 'bg.png'; const copySubscription = config.buttons?.copySubscription || '📋 کپی لینک اشتراک'; const openSubscription = config.buttons?.openSubscription || '🔗 باز کردن لینک اشتراک'; const fallbackTemplate = await getMessage('subscriptionDeliveryFallback', { sub_url: subscriptionUrl }); const replyMarkup = { inline_keyboard: [[{ text: copySubscription, copy_text: { text: subscriptionUrl }, style: 'primary' }], [{ text: openSubscription, url: subscriptionUrl, style: 'primary' }], [{ text: '🏠 منوی اصلی', callback_data: 'main_home', style: 'primary' }]] }; let qrBuffer = null; try { qrBuffer = await createSubscriptionQr(subscriptionUrl, qrBackground); } catch (error) { console.error(JSON.stringify({ event: 'QR_GENERATION_ERROR', order_id: order.orderId, background: qrBackground, error: error?.message || String(error) })); } try { if (qrBuffer) await telegram.sendPhoto(order.telegramUserId, { source: qrBuffer, filename: 'subscription-qr.png' }, { caption: text, parse_mode: 'HTML', reply_markup: replyMarkup }); else await telegram.sendMessage(order.telegramUserId, text, { parse_mode: 'HTML', reply_markup: replyMarkup }); return true; } catch (error) { try { await telegram.sendMessage(order.telegramUserId, fallbackTemplate, { reply_markup: { inline_keyboard: [[{ text: openSubscription, url: subscriptionUrl, style: 'primary' }], [{ text: '🏠 منوی اصلی', callback_data: 'main_home', style: 'primary' }]] } }); return true; } catch { return false; } } }
function isConflict(error) { return Number(error?.status) === 409; }

function classifyFulfillmentError(error) {
  const status = Number(error?.status || 0);
  const operation = String(error?.operation || '');
  const code = String(error?.message || error?.code || '').toUpperCase();
  const details = error?.details;

  if (code === 'PASARGUARD_NO_GROUPS') {
    return { userMessage: '❌ پنل فعلاً هیچ گروه فعالی برای ساخت اشتراک ندارد. لطفاً کمی بعد دوباره تلاش کنید.', retryable: true };
  }
  if (code === 'PASARGUARD_SUBSCRIPTION_URL_MISSING') {
    return { userMessage: '❌ پنل اشتراک را ساخت اما لینک اشتراک را برنگرداند. مبلغ این سفارش به کیف پول شما برمی‌گردد.', retryable: true };
  }
  if (code === 'PASARGUARD_NETWORK_ERROR' || code === 'PASARGUARD_NOT_CONFIGURED' || code === 'PASARGUARD_HTTP_408' || code === 'PASARGUARD_HTTP_425' || code === 'PASARGUARD_HTTP_429' || status >= 500) {
    return { userMessage: '⏳ سرور پنل در دسترس نبود یا پاسخ کامل نداد. مبلغ این سفارش به کیف پول شما برمی‌گردد؛ لطفاً بعداً دوباره تلاش کنید.', retryable: true };
  }
  if (status === 401 || status === 403) {
    return { userMessage: '❌ ارتباط احراز هویت با پنل برقرار نشد. مبلغ این سفارش به کیف پول شما برمی‌گردد و مدیر باید تنظیمات پنل را بررسی کند.', retryable: true };
  }
  if (status === 400 && operation === 'create_user') {
    return { userMessage: '❌ پنل مشخصات این اشتراک را نپذیرفت؛ احتمالاً نام اشتراک یا یکی از مشخصات سفارش نامعتبر است. مبلغ این سفارش به کیف پول شما برمی‌گردد. لطفاً با یک نام دیگر دوباره تلاش کنید.', retryable: false };
  }
  if (status === 404 && (operation === 'find_user' || operation === 'get_user_by_id')) {
    return { userMessage: '❌ اشتراک موردنظر در پنل پیدا نشد. مبلغ این سفارش به کیف پول شما برمی‌گردد. لطفاً دوباره تلاش کنید.', retryable: true };
  }
  return { userMessage: '❌ ساخت اشتراک انجام نشد. مبلغ این سفارش به کیف پول شما برمی‌گردد. لطفاً دوباره تلاش کنید.', retryable: true, details };
}

async function refundWalletForFailedOrder(order, reason) {
  if (!order || order.renewal || order.walletCharged !== true || order.walletRefunded === true) return { refunded: false, already: true };
  const amount = Number(order.walletChargedAmount ?? order.price ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return { refunded: false, invalidAmount: true };
  const refundLock = `wallet-refund:${order.orderId}`;
  if (!(await acquireLock(refundLock, 60))) return { refunded: false, locked: true };
  try {
    const current = await getOrder(order.orderId);
    if (!current || current.walletRefunded === true || current.walletCharged !== true) return { refunded: false, already: true };
    await wallet.credit(current.telegramUserId, amount, { walletLastRefund: current.orderId, walletLastRefundAt: new Date().toISOString() });
    const updated = await updateOrder(current.orderId, {
      walletRefunded: true,
      walletRefundedAmount: amount,
      walletRefundedAt: new Date().toISOString(),
      paymentStatus: 'WALLET_REFUNDED',
      fulfillmentStatus: 'FAILED_REFUNDED',
      failureReason: reason,
    });
    return { refunded: true, amount, order: updated };
  } finally {
    await releaseLock(refundLock);
  }
}
async function performFulfillment(orderIdValue, telegram) {
  const lockName = `fulfill:${orderIdValue}`; if (!(await acquireLock(lockName, 120))) return { locked: true };
  try {
    let order = await getOrder(orderIdValue); if (!order) throw new Error('ORDER_NOT_FOUND'); if (order.fulfillmentStatus === 'FULFILLED') return { fulfilled: true, order }; if (!['RECEIPT_SUBMITTED', 'PROVISIONING', 'FAILED_RETRYABLE', 'PASARGUARD_USER_CREATED', 'SUBSCRIPTION_RETRIEVED'].includes(order.fulfillmentStatus)) throw new Error('ORDER_NOT_ELIGIBLE');
    if (order.planId !== 'test' && order.orderType !== 'test' && order.walletCharged !== true) throw new Error('PAYMENT_NOT_APPROVED');
    const config = await getConfig(); const decision = getFulfillment(order.service, config); if (!decision.ok) {
      const reason = decision.code || 'SERVICE_PREPARING';
      const refund = await refundWalletForFailedOrder(order, reason).catch(() => ({ refunded: false }));
      await updateOrder(orderIdValue, { fulfillmentStatus: refund.refunded ? 'FAILED_REFUNDED' : 'FAILED_RETRYABLE', failureReason: reason, failureCategory: 'SERVICE_UNAVAILABLE' });
      if (order.telegramUserId) {
        const message = refund.refunded
          ? '🛠️ این سرویس فعلاً در دسترس نیست. مبلغ سفارش به کیف پول شما برگردانده شد و می‌توانید بعداً دوباره تلاش کنید.'
          : '🛠️ این سرویس فعلاً در دسترس نیست. لطفاً فعلاً خرید را دوباره انجام ندهید؛ پشتیبانی پیگیری می‌کند.';
        await telegram.sendMessage(order.telegramUserId, message).catch(() => {});
      }
      return { fulfilled: false, blocked: true, reason, refunded: refund.refunded };
    }
    const provider = getProvider(decision.provider);
    order = await updateOrder(orderIdValue, { fulfillmentStatus: 'PROVISIONING', failureReason: null, fulfillmentProvider: decision.provider });
    if (order.renewal) {
      if (!order.renewalPasarguardUserId) throw new Error('NO_EXISTING_PASARGUARD_ACCOUNT'); const current = await provider.getUserById(order.renewalPasarguardUserId); const existingExpire = current?.expire ? new Date(current.expire).getTime() : Date.now(); const start = Math.max(Date.now(), existingExpire); const renewalTraffic = Number(order.trafficLimitBytes || order.trafficBytes || 0); const existingLimit = Number(current?.data_limit ?? current?.dataLimit ?? 0); const combinedTraffic = existingLimit === 0 || renewalTraffic === 0 ? 0 : existingLimit + renewalTraffic; const renewalPatch = { status: 'active', data_limit: combinedTraffic, data_limit_reset_strategy: 'no_reset', hwid_limit: order.hwidLimit }; if (order.durationDays !== null && order.durationDays !== undefined && order.durationDays !== '' && Number(order.durationDays) !== 0) renewalPatch.expire = new Date(start + Number(order.durationDays) * 86400 * 1000).toISOString(); await provider.updateUserById(order.renewalPasarguardUserId, renewalPatch); const updated = await provider.getUserById(order.renewalPasarguardUserId); if (!updated?.subscription_url) throw new Error('PASARGUARD_SUBSCRIPTION_URL_MISSING'); order = await updateOrder(orderIdValue, { generatedPasarguardUsername: updated.username || current.username, pasarguardUserId: order.renewalPasarguardUserId, subscriptionUrl: updated.subscription_url, renewalAddedTrafficBytes: renewalTraffic, renewalPreviousTrafficLimitBytes: existingLimit, renewalCombinedTrafficLimitBytes: combinedTraffic, fulfillmentStatus: 'SUBSCRIPTION_RETRIEVED', fulfillmentProvider: decision.provider }); await saveUser({ telegramUserId: order.telegramUserId, username: order.telegramUsername || null, firstName: order.firstName || null, lastName: order.lastName || null, updatedAt: new Date().toISOString(), currentPasarguardUserId: order.renewalPasarguardUserId, currentPasarguardUsername: order.generatedPasarguardUsername, currentSubscriptionUrl: updated.subscription_url, currentOrderId: order.orderId, currentProvider: decision.provider }); order = await updateOrder(orderIdValue, { paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'FULFILLED', fulfilledAt: new Date().toISOString(), deliveryStatus: 'PENDING' }); const renewalText = await getMessage('renewalSuccess', { plan_name: order.planName, username: order.generatedPasarguardUsername, expire: updated.expire || 'بدون انقضا', sub_url: updated.subscription_url }); const delivered = await deliverSubscription(telegram, order, renewalText, updated.subscription_url); await updateOrder(orderIdValue, delivered ? { deliveryStatus: 'DELIVERED' } : { deliveryStatus: 'FAILED', failureReason: 'TELEGRAM_DELIVERY_FAILED' }); return { fulfilled: true, order: await getOrder(orderIdValue) };
    }
    let username = order.generatedPasarguardUsername || buildUsername({ telegramUsername: order.telegramUsername, customName: order.requestedName }); if (username !== order.generatedPasarguardUsername) order = await updateOrder(orderIdValue, { generatedPasarguardUsername: username }); let pgUser = null;
    if (order.pasarguardUserId) pgUser = await provider.getUserById(order.pasarguardUserId); else { for (let attempt = 0; attempt < 10; attempt++) { const existing = await provider.findUserByUsername(username); if (existing) { if (String(existing.note || '').includes(`Order: ${orderIdValue}`)) { pgUser = existing; break; } username = buildUsername({ telegramUsername: order.telegramUsername, customName: order.requestedName }); order = await updateOrder(orderIdValue, { generatedPasarguardUsername: username }); continue; } try { pgUser = await provider.createUser({ username, trafficBytes: order.trafficLimitBytes, expire: expiryIso(order.durationDays), hwidLimit: order.hwidLimit, note: `Order: ${orderIdValue}` }); break; } catch (error) { if (isConflict(error)) { username = buildUsername({ telegramUsername: order.telegramUsername, customName: order.requestedName }); order = await updateOrder(orderIdValue, { generatedPasarguardUsername: username }); continue; } throw error; } } }
    if (!pgUser) throw new Error('PASARGUARD_CREATE_COLLISION_RETRY_EXHAUSTED'); order = await updateOrder(orderIdValue, { generatedPasarguardUsername: pgUser.username || username, pasarguardUserId: pgUser.id, fulfillmentStatus: 'PASARGUARD_USER_CREATED', fulfillmentProvider: decision.provider }); const subscriptionUrl = pgUser.subscription_url || (await provider.getUserById(pgUser.id)).subscription_url; if (!subscriptionUrl) throw new Error('PASARGUARD_SUBSCRIPTION_URL_MISSING'); order = await updateOrder(orderIdValue, { subscriptionUrl, fulfillmentStatus: 'SUBSCRIPTION_RETRIEVED' }); order = await updateOrder(orderIdValue, { paymentStatus: 'WALLET_PAID', fulfillmentStatus: 'FULFILLED', fulfilledAt: new Date().toISOString(), deliveryStatus: 'PENDING' }); await saveUser({ telegramUserId: order.telegramUserId, username: order.telegramUsername || null, firstName: order.firstName || null, lastName: order.lastName || null, updatedAt: new Date().toISOString(), currentPasarguardUserId: pgUser.id, currentPasarguardUsername: order.generatedPasarguardUsername, currentSubscriptionUrl: subscriptionUrl, currentOrderId: order.orderId, currentProvider: decision.provider }); const traffic = order.trafficLimitBytes === 0 ? 'نامحدود ♾️' : formatBytes(order.trafficLimitBytes); const duration = order.durationDays === null || order.durationDays === undefined || order.durationDays === '' || Number(order.durationDays) === 0 ? 'بدون انقضا' : `${order.durationDays} روز`; const successText = await getMessage('subscriptionSuccess', { plan_name: order.planName, traffic, duration, username: order.generatedPasarguardUsername, sub_url: subscriptionUrl }); const delivered = await deliverSubscription(telegram, order, successText, subscriptionUrl); await updateOrder(orderIdValue, delivered ? { deliveryStatus: 'DELIVERED' } : { deliveryStatus: 'FAILED', failureReason: 'TELEGRAM_DELIVERY_FAILED' }); return { fulfilled: true, order: await getOrder(orderIdValue) };
  } catch (error) {
    const reason = error?.message || String(error);
    const failedOrder = await getOrder(orderIdValue).catch(() => null);

    // If a new panel account was already created but delivery failed afterwards,
    // disable it before refunding so a refund cannot leave an uncharged active account.
    if (failedOrder?.walletCharged === true && failedOrder?.pasarguardUserId && !failedOrder?.renewal && failedOrder?.fulfillmentStatus !== 'FULFILLED') {
      try {
        const config = await getConfig();
        const decision = getFulfillment(failedOrder.service, config);
        if (decision.ok) {
          const provider = getProvider(decision.provider);
          await provider.updateUserById(failedOrder.pasarguardUserId, { status: 'disabled' });
        }
      } catch (cleanupError) {
        log('FULFILLMENT_CLEANUP_FAILED', {
          order_id: orderIdValue,
          pasarguard_user_id: failedOrder?.pasarguardUserId,
          error: cleanupError?.message || String(cleanupError),
        });
      }
    }

    const refund = await refundWalletForFailedOrder(failedOrder, reason).catch((refundError) => {
      log('WALLET_REFUND_FAILED', {
        order_id: orderIdValue,
        error: refundError?.message || String(refundError),
      });
      return { refunded: false, error: refundError };
    });

    const classification = classifyFulfillmentError(error);
    const userMessage = refund.refunded
      ? classification.userMessage
      : (failedOrder?.walletCharged === true
        ? '❌ ساخت اشتراک ناموفق بود و بازگشت وجه خودکار انجام نشد. لطفاً فعلاً خرید را دوباره انجام ندهید؛ پشتیبانی پیگیری می‌کند.'
        : classification.userMessage);

    await updateOrder(orderIdValue, {
      fulfillmentStatus: refund.refunded ? 'FAILED_REFUNDED' : 'FAILED_RETRYABLE',
      failureReason: reason,
      failureCategory: classification.retryable ? 'TRANSIENT' : 'VALIDATION',
    }).catch(() => {});

    if (failedOrder?.telegramUserId) {
      await setState('user', failedOrder.telegramUserId, { stage: 'PURCHASE_FAILED', orderId: orderIdValue });
      await telegram.sendMessage(failedOrder.telegramUserId, userMessage).catch(() => {});
    }
    throw error;
  } finally { await releaseLock(lockName); }
}
async function fulfillOrder(orderIdValue, telegram) { const task = performFulfillment(orderIdValue, telegram); try { waitUntil(task.catch(() => {})); return { started: true, orderId: orderIdValue }; } catch { return task; } }
async function renewOrder(order, telegram) { return fulfillOrder(order.orderId, telegram); }
function formatBytes(bytes) { const gb = bytes / (1024 ** 3); return Number.isInteger(gb) ? `${gb} گیگابایت` : `${gb.toFixed(1)} گیگابایت`; }
module.exports = { orderId, expiryIso, fulfillOrder, renewOrder, formatBytes };