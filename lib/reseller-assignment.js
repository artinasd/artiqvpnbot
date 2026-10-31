function normalizeTelegramId(value) {
  const id = String(value ?? '').trim();
  return /^\d{5,20}$/.test(id) ? id : null;
}

async function assignCustomerToReseller(storage, customerTelegramId, resellerTelegramId, config = {}) {
  const customerId = normalizeTelegramId(customerTelegramId);
  const resellerId = normalizeTelegramId(resellerTelegramId);
  if (!customerId || !resellerId || customerId === resellerId) throw new Error('INVALID_RESELLER_ASSIGNMENT');
  const customer = await storage.getUserRaw(customerId);
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
  const reseller = await storage.getUserRaw(resellerId);
  const configuredIds = Array.isArray(config.resellerTelegramIds) ? config.resellerTelegramIds.map(String) : [];
  if (!configuredIds.includes(resellerId) && reseller?.isReseller !== true && reseller?.reseller !== true) throw new Error('TARGET_IS_NOT_A_RESELLER');
  const updated = await storage.saveUser({ ...customer, assignedResellerTelegramId: resellerId });
  return { customer: updated, resellerTelegramId: resellerId };
}

async function unassignCustomerReseller(storage, customerTelegramId) {
  const customerId = normalizeTelegramId(customerTelegramId);
  if (!customerId) throw new Error('INVALID_CUSTOMER_ID');
  const customer = await storage.getUserRaw(customerId);
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
  const previousResellerTelegramId = customer.assignedResellerTelegramId || null;
  const updated = await storage.saveUser({ ...customer, assignedResellerTelegramId: null });
  return { customer: updated, previousResellerTelegramId };
}

module.exports = { normalizeTelegramId, assignCustomerToReseller, unassignCustomerReseller };
