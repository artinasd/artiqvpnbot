const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TEST_LIMIT_ENABLED = process.env.TEST_LIMIT_ENABLED == null
  ? true
  : String(process.env.TEST_LIMIT_ENABLED).toLowerCase() === 'true';
const memory = new Map();
const memorySets = new Map();

function configured() {
  return Boolean(UPSTASH_URL && UPSTASH_TOKEN);
}

async function redis(command) {
  const response = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`REDIS_HTTP_${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`REDIS_${body.error}`);
  return body.result;
}

async function get(key) {
  if (!configured()) return memory.get(key) ?? null;
  const result = await redis(['GET', key]);
  return result == null ? null : JSON.parse(result);
}

async function set(key, value, options = {}) {
  if (!configured()) {
    memory.set(key, value);
    return 'OK';
  }
  const args = ['SET', key, JSON.stringify(value)];
  if (options.nx) args.push('NX');
  if (options.exSeconds) args.push('EX', String(options.exSeconds));
  return redis(args);
}

async function del(key) {
  if (!configured()) return memory.delete(key) ? 1 : 0;
  return redis(['DEL', key]);
}

async function sadd(key, member) {
  if (!configured()) {
    if (!memorySets.has(key)) memorySets.set(key, new Set());
    memorySets.get(key).add(String(member));
    return 1;
  }
  return redis(['SADD', key, String(member)]);
}

async function srem(key, member) {
  if (!configured()) {
    const setValue = memorySets.get(key);
    if (!setValue) return 0;
    return setValue.delete(String(member)) ? 1 : 0;
  }
  return redis(['SREM', key, String(member)]);
}

async function smembers(key) {
  if (!configured()) return Array.from(memorySets.get(key) || []);
  return (await redis(['SMEMBERS', key])) || [];
}

async function ping() {
  if (!configured()) return false;
  return (await redis(['PING'])) === 'PONG';
}

function tehranDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function createOrder(order) {
  const key = `order:${order.orderId}`;
  const created = await set(key, order, { nx: true });
  if (created !== 'OK') throw new Error('ORDER_ALREADY_EXISTS');
  await sadd('orders:ids', order.orderId);
  return order;
}

async function getOrder(orderId) {
  return get(`order:${orderId}`);
}

async function updateOrder(orderId, patch) {
  const existing = await getOrder(orderId);
  if (!existing) throw new Error('ORDER_NOT_FOUND');
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await set(`order:${orderId}`, updated);
  return updated;
}

async function listOrders(limit = 50) {
  const ids = await smembers('orders:ids');
  const orders = [];
  for (const id of ids.slice(0, limit * 3)) {
    const order = await getOrder(id);
    if (order) orders.push(order);
  }
  return orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}

async function saveUser(user) {
  const existing = await get(`user:${user.telegramUserId}`);
  const merged = existing ? { ...existing, ...user } : user;

  if (user.testUsed === true) {
    const today = tehranDateKey();
    if (merged.testUsageDate === today) {
      merged.testUsageCount = Number(merged.testUsageCount || 0) + 1;
    } else {
      merged.testUsageDate = today;
      merged.testUsageCount = 1;
    }
  }

  await set(`user:${user.telegramUserId}`, merged);
  await sadd('bot_users', user.telegramUserId);
  return merged;
}

async function getUser(telegramUserId, testLimitPerDay = 2) {
  const user = await get(`user:${telegramUserId}`);
  if (!user) return user;
  if (!TEST_LIMIT_ENABLED) return { ...user, testUsed: false };

  const today = tehranDateKey();
  const count = user.testUsageDate === today ? Number(user.testUsageCount || 0) : 0;
  const limit = Number.isFinite(Number(testLimitPerDay)) ? Math.max(0, Number(testLimitPerDay)) : 2;
  return { ...user, testUsed: count >= limit, testUsageDate: today, testUsageCount: count };
}

async function setState(type, id, state) {
  if (state == null) return del(`state:${type}:${id}`);
  return set(`state:${type}:${id}`, state, { exSeconds: 86400 });
}

async function getState(type, id) {
  return get(`state:${type}:${id}`);
}

async function deleteState(type, id) {
  return del(`state:${type}:${id}`);
}

async function acquireLock(name, ttlSeconds = 90) {
  const result = await set(`lock:${name}`, { acquiredAt: Date.now() }, { nx: true, exSeconds: ttlSeconds });
  return result === 'OK';
}

async function releaseLock(name) {
  return del(`lock:${name}`);
}

module.exports = {
  configured,
  get,
  set,
  del,
  sadd,
  srem,
  smembers,
  ping,
  createOrder,
  getOrder,
  updateOrder,
  listOrders,
  saveUser,
  getUser,
  setState,
  getState,
  deleteState,
  acquireLock,
  releaseLock,
};
