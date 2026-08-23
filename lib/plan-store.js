const storage = require('./storage');
const { PLANS: DEFAULT_PLANS } = require('./plans');

const KEY = 'cms:plans';

function normalizeDuration(value) {
  if (value === null || value === undefined || value === '' || Number(value) === 0) return null;
  return Number(value);
}

function normalizePlan(plan) {
  return {
    id: String(plan.id),
    name: String(plan.name || '').trim(),
    buttonText: String(plan.buttonText || plan.name || '').trim(),
    price: Number(plan.price),
    currency: String(plan.currency || 'تومان'),
    service: ['direct', 'tunnel', 'gaming'].includes(String(plan.service)) ? String(plan.service) : 'tunnel',
    type: plan.type === 'unlimited' ? 'unlimited' : 'traffic',
    trafficBytes: Number(plan.trafficBytes || 0),
    durationDays: normalizeDuration(plan.durationDays),
    hwidLimit: Number(plan.hwidLimit ?? (plan.type === 'unlimited' ? 1 : 0)),
    active: plan.active !== false,
    testEnabled: plan.testEnabled !== false,
    sortOrder: Number.isFinite(Number(plan.sortOrder)) ? Number(plan.sortOrder) : 0,
    custom: false,
  };
}

async function seedIfNeeded() {
  const existing = await storage.get(KEY);
  if (Array.isArray(existing) && existing.length) {
    const normalized = existing.map(normalizePlan);
    const changed = JSON.stringify(existing) !== JSON.stringify(normalized);
    if (changed) await storage.set(KEY, normalized);
    return normalized;
  }
  const seeded = DEFAULT_PLANS.map((plan, index) => normalizePlan({ ...plan, active: true, testEnabled: true, sortOrder: index }));
  await storage.set(KEY, seeded);
  return seeded;
}

async function listAll() { return seedIfNeeded(); }
async function listActive() { return (await seedIfNeeded()).filter((plan) => plan.active !== false).sort((a, b) => a.sortOrder - b.sortOrder); }
async function get(id) { return (await seedIfNeeded()).find((plan) => plan.id === id && plan.active !== false) || null; }
async function listActiveByService(service) {
  return (await listActive()).filter((plan) => plan.service === String(service));
}

async function save(input) {
  const id = String(input.id || '').trim();
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id)) throw new Error('INVALID_PLAN_ID');
  const name = String(input.name || '').trim();
  if (!name) throw new Error('PLAN_NAME_REQUIRED');
  const buttonText = String(input.buttonText || name).trim();
  const price = Number(input.price);
  const rawDuration = input.durationDays;
  const durationDays = rawDuration === null || rawDuration === undefined || rawDuration === '' || Number(rawDuration) === 0 ? null : Number(rawDuration);
  const trafficBytes = Number(input.trafficBytes || 0);
  const hwidLimit = Number(input.hwidLimit ?? (input.type === 'unlimited' ? 1 : 0));
  if (!buttonText) throw new Error('PLAN_BUTTON_TEXT_REQUIRED');
  if (!Number.isFinite(price) || price < 0) throw new Error('INVALID_PLAN_PRICE');
  if (durationDays !== null && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650)) throw new Error('INVALID_PLAN_DURATION');
  if (!Number.isFinite(trafficBytes) || trafficBytes < 0) throw new Error('INVALID_PLAN_TRAFFIC');
  if (!Number.isInteger(hwidLimit) || hwidLimit < 0) throw new Error('INVALID_HWID_LIMIT');
  const plans = await seedIfNeeded();
  const old = plans.find((plan) => plan.id === id);
  const next = normalizePlan({ ...old, ...input, id, name, buttonText, price, durationDays, trafficBytes, hwidLimit, active: input.active !== false, testEnabled: input.testEnabled !== false, sortOrder: input.sortOrder ?? old?.sortOrder ?? plans.length });
  const updated = old ? plans.map((plan) => plan.id === id ? next : plan) : [...plans, next];
  await storage.set(KEY, updated.sort((a, b) => a.sortOrder - b.sortOrder));
  return next;
}
async function remove(id) { const plans = await seedIfNeeded(); await storage.set(KEY, plans.map((plan) => plan.id === id ? { ...plan, active: false } : plan)); }
async function reorder(ids) { const wanted = Array.isArray(ids) ? ids.map(String) : []; const plans = await seedIfNeeded(); const rank = new Map(wanted.map((id, index) => [id, index])); const updated = plans.map((plan) => ({ ...plan, sortOrder: rank.has(plan.id) ? rank.get(plan.id) : plan.sortOrder })); await storage.set(KEY, updated.sort((a, b) => a.sortOrder - b.sortOrder)); return updated; }
module.exports = { listAll, listActive, listActiveByService, get, save, remove, reorder };
