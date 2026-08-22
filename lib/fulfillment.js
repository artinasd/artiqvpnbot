const { buildUsername } = require('./username');
const { getOrder, updateOrder, getUser, saveUser, acquireLock, releaseLock } = require('./storage');
const { findUserByUsername, createUser, getUserById, updateUserById, PasarGuardError } = require('./pasarguard');
const crypto = require('crypto');

function orderId() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `TG-${stamp}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function expiryIso(durationDays) {
  return new Date(Date.now() + durationDays * 86400 * 1000).toISOString();
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

async function fulfillOrder(orderIdValue, telegram) {
  const lockName = `fulfill:${orderIdValue}`;
  if (!(await acquireLock(lockName, 120))) return { locked: true };

  try {
    let order = await getOrder(orderIdValue);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.fulfillmentStatus === 'FULFILLED') return { fulfilled: true, order };
    if (!['RECEIPT_SUBMITTED', 'PROVISIONING', 'FAILED_RETRYABLE', 'PASARGUARD_USER_CREATED', 'SUBSCRIPTION_RETRIEVED'].includes(order.fulfillmentStatus)) {
      throw new Error('ORDER_NOT_ELIGIBLE');
    }

    order = await updateOrder(orderIdValue, { fulfillmentStatus: 'PROVISIONING', failureReason: null });
    log('FULFILLMENT_STARTED', { order_id: orderIdValue, telegram_user_id: order.telegramUserId, pasarguard_username: order.generatedPasarguardUsername || null });

    // Renewals modify the existing TG_ account. The username is immutable.
    if (order.renewal) {
      if (!order.renewalPasarguardUserId) throw new Error('NO_EXISTING_PASARGUARD_ACCOUNT');
      const current = await getUserById(order.renewalPasarguardUserId);
      const existingExpire = current?.expire ? new Date(current.expire).getTime() : Date.now();
      const start = Math.max(Date.now(), existingExpire);
      const expire = new Date(start + order.durationDays * 86400 * 1000).toISOString();

      await updateUserById(order.renewalPasarguardUserId, {
        status: 'active',
        data_limit: order.trafficLimitBytes,
        data_limit_reset_strategy: 'no_reset',
        expire,
        hwid_limit: order.hwidLimit,
      });

      const updated = await getUserById(order.renewalPasarguardUserId);
      if (!updated?.subscription_url) throw new Error('PASARGUARD_SUBSCRIPTION_URL_MISSING');

      order = await updateOrder(orderIdValue, {
        generatedPasarguardUsername: updated.username || current.username,
        pasarguardUserId: order.renewalPasarguardUserId,
        subscriptionUrl: updated.subscription_url,
        fulfillmentStatus: 'SUBSCRIPTION_RETRIEVED',
      });

      await saveUser({
        telegramUserId: order.telegramUserId,
        username: order.telegramUsername || null,
        firstName: order.firstName || null,
        lastName: order.lastName || null,
        updatedAt: new Date().toISOString(),
        currentPasarguardUserId: order.renewalPasarguardUserId,
        currentPasarguardUsername: order.generatedPasarguardUsername,
        currentSubscriptionUrl: updated.subscription_url,
        currentOrderId: order.orderId,
      });

      order = await updateOrder(orderIdValue, {
        paymentStatus: 'RECEIPT_SUBMITTED',
        fulfillmentStatus: 'FULFILLED',
        fulfilledAt: new Date().toISOString(),
        deliveryStatus: 'PENDING',
      });

      await telegram.sendMessage(order.telegramUserId, `🔄 اشتراک شما تمدید شد.\n\n📦 سرویس: ${escapeHtml(order.planName)}\n👤 نام اشتراک: <code>${escapeHtml(order.generatedPasarguardUsername)}</code>\n⏳ اعتبار جدید: ${escapeHtml(updated.expire || expire)}\n\n🔗 لینک اشتراک:\n${escapeHtml(updated.subscription_url)}`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🔗 دریافت لینک اشتراک', url: updated.subscription_url }]] },
      });
      await updateOrder(orderIdValue, { deliveryStatus: 'DELIVERED' });
      log('ORDER_FULFILLED', { order_id: orderIdValue, telegram_user_id: order.telegramUserId, pasarguard_username: order.generatedPasarguardUsername });
      return { fulfilled: true, order: await getOrder(orderIdValue) };
    }

    // Persist the username BEFORE the remote create call. If PasarGuard creates the
    // account and the HTTP response is lost, a retry can find the same account.
    let username = order.generatedPasarguardUsername || buildUsername({
      telegramUsername: order.telegramUsername,
      customName: order.requestedName,
    });
    if (username !== order.generatedPasarguardUsername) {
      order = await updateOrder(orderIdValue, { generatedPasarguardUsername: username });
    }

    let pgUser = null;
    if (order.pasarguardUserId) {
      pgUser = await getUserById(order.pasarguardUserId);
    } else {
      for (let attempt = 0; attempt < 10; attempt++) {
        const existing = await findUserByUsername(username);
        if (existing) {
          const existingNote = String(existing.note || '');
          if (existingNote.includes(`Order: ${orderIdValue}`)) {
            pgUser = existing;
            break;
          }
          username = buildUsername({ telegramUsername: order.telegramUsername, customName: order.requestedName });
          order = await updateOrder(orderIdValue, { generatedPasarguardUsername: username });
          continue;
        }

        try {
          pgUser = await createUser({
            username,
            trafficBytes: order.trafficLimitBytes,
            expire: expiryIso(order.durationDays),
            hwidLimit: order.hwidLimit,
            note: `Order: ${orderIdValue}`,
          });
          log('PASARGUARD_USER_CREATED', { order_id: orderIdValue, telegram_user_id: order.telegramUserId, pasarguard_username: username });
          break;
        } catch (error) {
          if (error instanceof PasarGuardError && error.status === 409) {
            username = buildUsername({ telegramUsername: order.telegramUsername, customName: order.requestedName });
            order = await updateOrder(orderIdValue, { generatedPasarguardUsername: username });
            continue;
          }
          throw error;
        }
      }
    }

    if (!pgUser) throw new Error('PASARGUARD_CREATE_COLLISION_RETRY_EXHAUSTED');

    order = await updateOrder(orderIdValue, {
      generatedPasarguardUsername: pgUser.username || username,
      pasarguardUserId: pgUser.id,
      fulfillmentStatus: 'PASARGUARD_USER_CREATED',
    });

    const subscriptionUrl = pgUser.subscription_url || (await getUserById(pgUser.id)).subscription_url;
    if (!subscriptionUrl) throw new Error('PASARGUARD_SUBSCRIPTION_URL_MISSING');

    order = await updateOrder(orderIdValue, {
      subscriptionUrl,
      fulfillmentStatus: 'SUBSCRIPTION_RETRIEVED',
    });
    log('SUBSCRIPTION_RETRIEVED', { order_id: orderIdValue, telegram_user_id: order.telegramUserId, pasarguard_username: order.generatedPasarguardUsername });

    order = await updateOrder(orderIdValue, {
      paymentStatus: 'RECEIPT_SUBMITTED',
      fulfillmentStatus: 'FULFILLED',
      fulfilledAt: new Date().toISOString(),
      deliveryStatus: 'PENDING',
    });

    await saveUser({
      telegramUserId: order.telegramUserId,
      username: order.telegramUsername || null,
      firstName: order.firstName || null,
      lastName: order.lastName || null,
      updatedAt: new Date().toISOString(),
      currentPasarguardUserId: pgUser.id,
      currentPasarguardUsername: order.generatedPasarguardUsername,
      currentSubscriptionUrl: subscriptionUrl,
      currentOrderId: order.orderId,
    });

    const message = `🎉 اشتراک شما با موفقیت ساخته شد.\n\n📦 سرویس: ${order.planName}\n📊 حجم: ${order.trafficLimitBytes === 0 ? 'نامحدود' : formatBytes(order.trafficLimitBytes)}\n⏳ اعتبار: ${order.durationDays} روز\n👤 نام اشتراک: <code>${escapeHtml(order.generatedPasarguardUsername)}</code>\n\n🔗 لینک اشتراک:\n${escapeHtml(subscriptionUrl)}`;

    try {
      await telegram.sendMessage(order.telegramUserId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🔗 دریافت لینک اشتراک', url: subscriptionUrl }]] },
      });
      await updateOrder(orderIdValue, { deliveryStatus: 'DELIVERED' });
      log('ORDER_FULFILLED', { order_id: orderIdValue, telegram_user_id: order.telegramUserId, pasarguard_username: order.generatedPasarguardUsername });
    } catch (deliveryError) {
      await updateOrder(orderIdValue, { deliveryStatus: 'FAILED', failureReason: 'TELEGRAM_DELIVERY_FAILED' });
      log('DELIVERY_FAILED', { order_id: orderIdValue, telegram_user_id: order.telegramUserId, pasarguard_username: order.generatedPasarguardUsername });
    }

    return { fulfilled: true, order: await getOrder(orderIdValue) };
  } catch (error) {
    await updateOrder(orderIdValue, {
      fulfillmentStatus: 'FAILED_RETRYABLE',
      failureReason: error instanceof PasarGuardError ? error.message : String(error.message || error),
    }).catch(() => {});
    log('FULFILLMENT_FAILED', { order_id: orderIdValue, error: error.message || String(error) });
    throw error;
  } finally {
    await releaseLock(lockName);
  }
}

async function renewOrder(order, telegram) {
  return fulfillOrder(order.orderId, telegram);
}

function formatBytes(bytes) {
  const gb = bytes / (1024 ** 3);
  return Number.isInteger(gb) ? `${gb} گیگابایت` : `${gb.toFixed(1)} گیگابایت`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { orderId, expiryIso, fulfillOrder, renewOrder, formatBytes };
