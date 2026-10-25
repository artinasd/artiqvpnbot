const storage = require('./storage');

async function getBalance(userId) {
  const user = await storage.getUser(userId);
  return Number(user?.balance || 0);
}

async function setBalance(userId, balance, meta = {}) {
  const user = await storage.getUser(userId);
  if (!user) throw new Error('USER_NOT_FOUND');
  const value = Number(balance);
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_BALANCE');
  return storage.saveUser({ ...user, balance: value, walletUpdatedAt: new Date().toISOString(), ...meta });
}

async function adjustBalance(userId, delta, meta = {}) {
  const lock = `wallet:${userId}`;
  if (!(await storage.acquireLock(lock, 30))) throw new Error('WALLET_BUSY');
  try {
    const user = await storage.getUser(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    const current = Number(user.balance || 0);
    const next = current + Number(delta);
    if (!Number.isFinite(next) || next < 0) throw new Error('INSUFFICIENT_BALANCE');
    return storage.saveUser({ ...user, balance: next, walletUpdatedAt: new Date().toISOString(), ...meta });
  } finally {
    await storage.releaseLock(lock);
  }
}

async function adjustBalanceOnce(userId, delta, transactionId, meta = {}) {
  const id = String(transactionId || '').trim();
  if (!id) throw new Error('TRANSACTION_ID_REQUIRED');
  const amount = Number(delta);
  if (!Number.isFinite(amount)) throw new Error('INVALID_AMOUNT');

  const lock = `wallet:${userId}`;
  if (!(await storage.acquireLock(lock, 30))) throw new Error('WALLET_BUSY');
  try {
    const user = await storage.getUser(userId);
    if (!user) throw new Error('USER_NOT_FOUND');
    const ledger = user.walletTransactions && typeof user.walletTransactions === 'object' && !Array.isArray(user.walletTransactions)
      ? user.walletTransactions
      : {};
    if (Object.prototype.hasOwnProperty.call(ledger, id)) {
      if (Number(ledger[id]) !== amount) throw new Error('WALLET_TRANSACTION_MISMATCH');
      return { user, alreadyProcessed: true };
    }

    const current = Number(user.balance || 0);
    const next = current + amount;
    if (!Number.isFinite(next) || next < 0) throw new Error('INSUFFICIENT_BALANCE');
    const updatedUser = await storage.saveUser({
      ...user,
      ...meta,
      balance: next,
      walletTransactions: { ...ledger, [id]: amount },
      walletUpdatedAt: new Date().toISOString(),
    });
    return { user: updatedUser, alreadyProcessed: false };
  } finally {
    await storage.releaseLock(lock);
  }
}

async function debit(userId, amount, meta = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_AMOUNT');
  return adjustBalance(userId, -value, meta);
}

async function credit(userId, amount, meta = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_AMOUNT');
  return adjustBalance(userId, value, meta);
}

async function debitOnce(userId, amount, transactionId, meta = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_AMOUNT');
  return adjustBalanceOnce(userId, -value, transactionId, meta);
}

async function creditOnce(userId, amount, transactionId, meta = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_AMOUNT');
  return adjustBalanceOnce(userId, value, transactionId, meta);
}

async function hasProcessedTransaction(userId, transactionId) {
  const user = await storage.getUser(userId);
  const ledger = user?.walletTransactions;
  return Boolean(ledger && typeof ledger === 'object' && !Array.isArray(ledger) && Object.prototype.hasOwnProperty.call(ledger, String(transactionId || '').trim()));
}

module.exports = { getBalance, setBalance, adjustBalance, adjustBalanceOnce, debit, credit, debitOnce, creditOnce, hasProcessedTransaction };
