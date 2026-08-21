const { randomBytes } = require('crypto');
const storage = require('./storage');
const pg = require('./pasarguard');
const { buildSubscriptionUsername } = require('./username');
const { durationSeconds } = require('./plans');

const MAX_COLLISION_ATTEMPTS = 8;
const LOCK_TTL = 120;
function orderId() { const date = new Date().toISOString().slice(0, 10).replace(/-/g, ''); return `TG-${date}-${randomBytes(2).toString('hex').toUpperCase()}`; }
function now() { return new Date().toISOString(); }
function log(event, fields = {}) { console.log(JSON.stringify({ event, ...fields })); }
function extractUserId(user) { return user?.id ?? user?.user_id ?? null; }
function extractSubscriptionUrl(user) { return user?.subscription_url || user?.subscriptionUrl || user?.subscription?.url || null; }
function extractExpire(user) { return user?.expire ?? user?.expires_at ?? user?.expiration ?? null; }
function safePgUser(user) { return { id: extractUserId(user), username: user?.username, subscription_url: extractSubscriptionUrl(user), traffic_limit_bytes: user?.data_limit ?? null, used_traffic_bytes: user?.used_traffic ?? null, expire: extractExpire(user), status: user?.status ?? null, data_limit_reset_strategy: user?.data_limit_reset_strategy ?? null }; }

async function createOrder({ telegramUser, plan, requestedName, fulfillmentType = 'new', existingPasarguardUserId = null, generatedUsername = null }) {
  const generated = generatedUsername ? { ok: true, username: generatedUsername } : buildSubscriptionUsername({ telegramUsername: telegramUser.username, customName: requestedName });
  if (!generated.ok) throw new Error(generated.reason);
  const order = {
    order_id: orderId(), telegram_user_id: String(telegramUser.id), telegram_username: telegramUser.username || null,
    first_name: telegramUser.first_name || null, last_name: telegramUser.last_name || null,
    plan_id: plan.id, plan_name: plan.name, traffic_limit_bytes: plan.trafficBytes, duration_days: plan.durationDays,
    price: plan.price, currency: 'IRR', requested_name: requestedName || null, generated_pasarguard_username: generated.username,
    payment_status: 'AWAITING_PAYMENT', fulfillment_status: 'AWAITING_RECEIPT', pasarguard_user_id: existingPasarguardUserId,
    plan_template_id: plan.templateId, custom: Boolean(plan.custom), subscription_url: null, created_at: now(), receipt_file_id: null,
    fulfilled_at: null, failure_reason: null, fulfillment_type, events: []
  };
  order.events.push({ at: now(), type: 'ORDER_CREATED' });
  await storage.saveOrder(order); await storage.addOrderId(order.order_id); await storage.addToSet(`orders:user:${order.telegram_user_id}`, order.order_id);
  log('ORDER_CREATED', { order_id: order.order_id, telegram_user_id: order.telegram_user_id, pasarguard_username: order.generated_pasarguard_username });
  return order;
}
async function updateOrder(order, patch, event) { const next = { ...order, ...patch }; if (event) next.events = [...(next.events || []), { at: now(), type: event }]; await storage.saveOrder(next); if (event) log(event, { order_id: next.order_id, telegram_user_id: next.telegram_user_id, pasarguard_username: next.generated_pasarguard_username }); return next; }
async function attachReceipt(orderIdValue, receipt) { const order = await storage.getOrder(orderIdValue); if (!order) throw new Error('order_not_found'); if (order.receipt_file_id) return order; const next = await updateOrder(order, { receipt_file_id: receipt.file_id, receipt_type: receipt.type, receipt_message_id: receipt.message_id, payment_status: 'RECEIPT_SUBMITTED', fulfillment_status: 'PROVISIONING' }, 'RECEIPT_SUBMITTED'); await storage.saveReceipt({ receipt_id: `${order.order_id}:${receipt.message_id}`, order_id: order.order_id, ...receipt, created_at: now() }); return next; }
async function applyCustomLimits(userId, order) { if (!order.custom) return; const expire = new Date(Date.now() + durationSeconds({ durationDays: order.duration_days }) * 1000).toISOString(); await pg.modifyUserById(userId, { data_limit: order.traffic_limit_bytes, expire }); }

async function fulfillOrder(orderIdValue) {
  const lockKey = `fulfillment:${orderIdValue}`; if (!(await storage.acquireLock(lockKey, LOCK_TTL))) return storage.getOrder(orderIdValue);
  try {
    let order = await storage.getOrder(orderIdValue); if (!order) throw new Error('order_not_found'); if (order.fulfillment_status === 'FULFILLED') return order; if (!order.plan_template_id) throw new Error('plan_template_not_configured');
    order = await updateOrder(order, { fulfillment_status: 'PROVISIONING', failure_reason: null }, 'FULFILLMENT_STARTED');
    let pgUser = null;
    if (order.pasarguard_user_id) { try { pgUser = await pg.getUserById(order.pasarguard_user_id); } catch (err) { if (!err.transient && err.status !== 404) throw err; } }
    if (!pgUser && order.fulfillment_type === 'renewal') pgUser = await pg.getUserByUsername(order.generated_pasarguard_username);
    if (!pgUser) {
      let created = null;
      for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt += 1) {
        try { created = await pg.createFromTemplate(order.plan_template_id, order.generated_pasarguard_username, `Telegram order ${order.order_id}`); break; }
        catch (err) {
          if (err.status === 409) { const generated = buildSubscriptionUsername({ telegramUsername: order.telegram_username, customName: order.requested_name }); if (!generated.ok) throw new Error('username_generation_failed'); order = await updateOrder(order, { generated_pasarguard_username: generated.username }); continue; }
          if (err.transient) { try { created = await pg.getUserByUsername(order.generated_pasarguard_username); } catch (_) {} if (created) break; }
          throw err;
        }
      }
      if (!created) throw new Error('username_collision_exhausted');
      pgUser = created; const pgId = extractUserId(pgUser); if (!pgId) throw new Error('pasarguard_user_id_missing');
      order = await updateOrder(order, { pasarguard_user_id: pgId, generated_pasarguard_username: pgUser.username || order.generated_pasarguard_username }, 'PASARGUARD_USER_CREATED');
      await applyCustomLimits(pgId, order); if (order.custom) pgUser = await pg.getUserById(pgId);
    }
    if (!pgUser || !extractUserId(pgUser)) throw new Error('pasarguard_user_id_missing');
    if (!extractSubscriptionUrl(pgUser)) pgUser = await pg.getUserById(extractUserId(pgUser));
    const finalUrl = extractSubscriptionUrl(pgUser); if (!finalUrl) throw new Error('subscription_url_missing');
    const actual = safePgUser(pgUser);
    return updateOrder(order, { pasarguard_user_id: actual.id, generated_pasarguard_username: actual.username || order.generated_pasarguard_username, subscription_url: finalUrl, traffic_limit_bytes: actual.traffic_limit_bytes ?? order.traffic_limit_bytes, used_traffic_bytes: actual.used_traffic_bytes, actual_expire: actual.expire, status: actual.status, data_limit_reset_strategy: actual.data_limit_reset_strategy, fulfillment_status: 'FULFILLED', fulfilled_at: now(), payment_status: 'RECEIPT_SUBMITTED', failure_reason: null }, 'ORDER_FULFILLED');
  } catch (err) { const current = await storage.getOrder(orderIdValue); if (current) await updateOrder(current, { fulfillment_status: 'FAILED_RECOVERABLE', failure_reason: String(err.message || 'fulfillment_failed').slice(0, 300) }, 'FULFILLMENT_FAILED'); log('FULFILLMENT_FAILED', { order_id: orderIdValue, error: String(err.message || err), operation: err.operation, status: err.status }); throw err; }
  finally { await storage.releaseLock(lockKey); }
}

async function renewOrder(orderIdValue) {
  const lockKey = `fulfillment:${orderIdValue}`; if (!(await storage.acquireLock(lockKey, LOCK_TTL))) return storage.getOrder(orderIdValue);
  try {
    let order = await storage.getOrder(orderIdValue); if (!order) throw new Error('order_not_found'); if (order.fulfillment_status === 'FULFILLED') return order;
    let user = await pg.getUserById(order.pasarguard_user_id); const currentExpire = extractExpire(user); const currentMs = currentExpire ? new Date(currentExpire).getTime() : 0; const baseMs = Number.isFinite(currentMs) && currentMs > Date.now() ? currentMs : Date.now(); const targetExpire = new Date(baseMs + durationSeconds({ durationDays: order.duration_days }) * 1000).toISOString();
    await pg.applyTemplate(order.generated_pasarguard_username, order.plan_template_id, `Telegram renewal ${order.order_id}`);
    if (order.custom) await pg.modifyUserById(order.pasarguard_user_id, { data_limit: order.traffic_limit_bytes, expire: targetExpire }); else await pg.modifyUserById(order.pasarguard_user_id, { expire: targetExpire });
    user = await pg.getUserById(order.pasarguard_user_id); const url = extractSubscriptionUrl(user); if (!url) throw new Error('subscription_url_missing');
    return updateOrder(order, { subscription_url: url, actual_expire: extractExpire(user), used_traffic_bytes: user.used_traffic ?? null, traffic_limit_bytes: user.data_limit ?? order.traffic_limit_bytes, fulfillment_status: 'FULFILLED', fulfilled_at: now(), payment_status: 'RECEIPT_SUBMITTED', failure_reason: null }, 'ORDER_FULFILLED');
  } catch (err) { const current = await storage.getOrder(orderIdValue); if (current) await updateOrder(current, { fulfillment_status: 'FAILED_RECOVERABLE', failure_reason: String(err.message || err).slice(0, 300) }, 'FULFILLMENT_FAILED'); throw err; }
  finally { await storage.releaseLock(lockKey); }
}
module.exports = { createOrder, updateOrder, attachReceipt, fulfillOrder, renewOrder, extractUserId, extractSubscriptionUrl, extractExpire, safePgUser };
