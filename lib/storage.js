const BASE = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map();

async function command(parts) {
  if (!BASE || !TOKEN) throw new Error('Upstash Redis is not configured');
  const encoded = parts.map((p) => encodeURIComponent(String(p))).join('/');
  const res = await fetch(`${BASE}/${encoded}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const body = await res.json();
  return body.result;
}

async function getJson(key) {
  if (!BASE || !TOKEN) return memory.get(key) ?? null;
  const result = await command(['get', key]);
  return result ? JSON.parse(result) : null;
}
async function setJson(key, value, ttlSeconds) {
  if (!BASE || !TOKEN) { memory.set(key, value); return; }
  if (ttlSeconds) await command(['set', key, JSON.stringify(value), 'EX', ttlSeconds]);
  else await command(['set', key, JSON.stringify(value)]);
}
async function deleteKey(key) {
  if (!BASE || !TOKEN) { memory.delete(key); return; }
  await command(['del', key]);
}
async function addToSet(key, member) {
  if (!BASE || !TOKEN) { const set = memory.get(key) || new Set(); set.add(String(member)); memory.set(key, set); return; }
  await command(['sadd', key, member]);
}
async function removeFromSet(key, member) {
  if (!BASE || !TOKEN) { const set = memory.get(key); if (set) set.delete(String(member)); return; }
  await command(['srem', key, member]);
}
async function getSet(key) {
  if (!BASE || !TOKEN) return [...(memory.get(key) || new Set())];
  return (await command(['smembers', key])) || [];
}
async function acquireLock(key, ttlSeconds = 60) {
  if (!BASE || !TOKEN) {
    if (memory.has(`lock:${key}`)) return false;
    memory.set(`lock:${key}`, Date.now() + ttlSeconds * 1000);
    return true;
  }
  const result = await command(['set', `lock:${key}`, String(Date.now()), 'NX', 'EX', ttlSeconds]);
  return result === 'OK';
}
async function releaseLock(key) { return deleteKey(`lock:${key}`); }

async function getUser(id) { return getJson(`user:${id}`); }
async function saveUser(user) { return setJson(`user:${user.telegram_user_id}`, user); }
async function getOrder(id) { return getJson(`order:${id}`); }
async function saveOrder(order) { return setJson(`order:${order.order_id}`, order); }
async function getReceipt(id) { return getJson(`receipt:${id}`); }
async function saveReceipt(receipt) { return setJson(`receipt:${receipt.receipt_id}`, receipt); }
async function listOrderIds() { return getSet('orders'); }
async function addOrderId(id) { return addToSet('orders', id); }
async function listUserIds() { return getSet('bot_users'); }

module.exports = { getJson, setJson, deleteKey, addToSet, removeFromSet, getSet, acquireLock, releaseLock, getUser, saveUser, getOrder, saveOrder, getReceipt, saveReceipt, listOrderIds, addOrderId, listUserIds };
