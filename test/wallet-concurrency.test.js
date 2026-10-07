process.env.UPSTASH_REDIS_REST_URL = 'http://test.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../lib/storage');
const wallet = require('../lib/wallet');

// Utility to create a delay
const delay = ms => new Promise(r => setTimeout(r, ms));

const mem = new Map();
const memSets = new Map();
let interceptFetch = null;

// Mock fetch to simulate Redis locally and allow intercepting specific commands
global.fetch = async (url, opts) => {
  const cmd = JSON.parse(opts.body);
  if (interceptFetch) await interceptFetch(cmd);
  
  if (cmd[0] === 'GET') {
    return { ok: true, json: async () => ({ result: mem.has(cmd[1]) ? JSON.stringify(mem.get(cmd[1])) : null }) };
  }
  if (cmd[0] === 'SET') {
    // For NX/EX options
    const isNx = cmd.includes('NX');
    if (isNx && mem.has(cmd[1])) return { ok: true, json: async () => ({ result: null }) };
    mem.set(cmd[1], JSON.parse(cmd[2])); 
    return { ok: true, json: async () => ({ result: 'OK' }) }; 
  }
  if (cmd[0] === 'DEL') { 
    mem.delete(cmd[1]); 
    return { ok: true, json: async () => ({ result: 1 }) }; 
  }
  if (cmd[0] === 'EVAL') {
    const key = cmd[3];
    const arg = JSON.parse(cmd[4]);
    if (mem.get(key) === arg) {
      mem.delete(key);
      return { ok: true, json: async () => ({ result: 1 }) };
    }
    return { ok: true, json: async () => ({ result: 0 }) };
  }
  if (cmd[0] === 'SADD') { 
    return { ok: true, json: async () => ({ result: 1 }) }; 
  }
  return { ok: true, json: async () => ({ result: null }) };
};

test('1. profile update concurrent with wallet credit', async () => {
  mem.clear();
  const userId = 'user_1';
  await storage.saveUser({ telegramUserId: userId, username: 'test1' });
  await wallet.setBalance(userId, 1000);

  interceptFetch = async (cmd) => {
    if (cmd[0] === 'GET' && cmd[1] === `user:${userId}`) {
      interceptFetch = null; // Prevent infinite loop
      await wallet.credit(userId, 500);
    }
  };

  await storage.saveUser({ telegramUserId: userId, username: 'updated1' });
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, 1500, 'Balance should be 1500, saveUser must not clobber it');
  assert.equal(finalUser.username, 'updated1', 'Username should be updated');
});

test('2. profile update concurrent with wallet debit', async () => {
  mem.clear();
  const userId = 'user_2';
  await storage.saveUser({ telegramUserId: userId, username: 'test2' });
  await wallet.setBalance(userId, 1000);

  interceptFetch = async (cmd) => {
    if (cmd[0] === 'GET' && cmd[1] === `user:${userId}`) {
      interceptFetch = null;
      await wallet.debit(userId, 200);
    }
  };

  await storage.saveUser({ telegramUserId: userId, username: 'updated2' });
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, 800, 'Balance should be exactly 800');
});

test('3. multiple concurrent credits', async () => {
  mem.clear();
  const userId = 'user_3';
  await storage.saveUser({ telegramUserId: userId, username: 'test3' });
  await wallet.setBalance(userId, 0);

  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(async () => {
      while(true) {
        try {
          await wallet.credit(userId, 100);
          break;
        } catch (e) {
          if (e.message === 'WALLET_BUSY') await delay(5);
          else throw e;
        }
      }
    });
  }
  await Promise.all(promises.map(p => p()));
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, 500, 'Balance should be exactly 500');
});

test('4. multiple concurrent debits', async () => {
  mem.clear();
  const userId = 'user_4';
  await storage.saveUser({ telegramUserId: userId, username: 'test4' });
  await wallet.setBalance(userId, 1000);

  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(async () => {
      while(true) {
        try {
          await wallet.debit(userId, 100);
          break;
        } catch (e) {
          if (e.message === 'WALLET_BUSY') await delay(5);
          else throw e;
        }
      }
    });
  }
  await Promise.all(promises.map(p => p()));
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, 500, 'Balance should be exactly 500');
});

test('5. credit + debit concurrently', async () => {
  mem.clear();
  const userId = 'user_5';
  await storage.saveUser({ telegramUserId: userId, username: 'test5' });
  await wallet.setBalance(userId, 1000);

  const promises = [
    async () => {
      while(true) { try { await wallet.credit(userId, 500); break; } catch (e) { if (e.message === 'WALLET_BUSY') await delay(5); else throw e; } }
    },
    async () => {
      while(true) { try { await wallet.debit(userId, 200); break; } catch (e) { if (e.message === 'WALLET_BUSY') await delay(5); else throw e; } }
    }
  ];
  await Promise.all(promises.map(p => p()));
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, 1300, 'Balance should be exactly 1300');
});

test('6. reseller debt mutation + profile update', async () => {
  mem.clear();
  const userId = 'user_6';
  await storage.saveUser({ telegramUserId: userId, username: 'test6' });
  await storage.updateWallet(userId, { isReseller: true, debtLimit: 0 });

  interceptFetch = async (cmd) => {
    if (cmd[0] === 'GET' && cmd[1] === `user:${userId}`) {
      interceptFetch = null;
      await storage.updateWallet(userId, { debtLimit: 50000 });
    }
  };

  await storage.saveUser({ telegramUserId: userId, username: 'updated6' });
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.debtLimit, 50000, 'Debt limit mutation should survive saveUser');
});

test('7. wallet checkout + profile update', async () => {
  mem.clear();
  const userId = 'user_7';
  await storage.saveUser({ telegramUserId: userId, username: 'test7' });
  await wallet.setBalance(userId, 10000);

  interceptFetch = async (cmd) => {
    if (cmd[0] === 'GET' && cmd[1] === `user:${userId}`) {
      interceptFetch = null;
      await wallet.debit(userId, 8000, { walletLastTransaction: 'purchase:123' });
    }
  };

  await storage.saveUser({ telegramUserId: userId, username: 'updated7' });
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, 2000, 'Balance should be exactly 2000');
  assert.equal(finalUser.walletLastTransaction, 'purchase:123', 'Metadata should survive');
});

test('8. refund + concurrent purchase', async () => {
  mem.clear();
  const userId = 'user_8';
  await storage.saveUser({ telegramUserId: userId, username: 'test8' });
  await wallet.setBalance(userId, 5000);

  const promises = [
    async () => {
      while(true) { try { await wallet.credit(userId, 2000); break; } catch(e) { if (e.message==='WALLET_BUSY') await delay(5); else throw e; } }
    },
    async () => {
      while(true) { try { await wallet.debit(userId, 3000); break; } catch(e) { if (e.message==='WALLET_BUSY') await delay(5); else throw e; } }
    }
  ];
  await Promise.all(promises.map(p => p()));
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, 4000, 'Balance should be exactly 4000');
});

test('9. admin balance adjustment + purchase', async () => {
  mem.clear();
  const userId = 'user_9';
  await storage.saveUser({ telegramUserId: userId, username: 'test9' });
  await wallet.setBalance(userId, 5000);

  const promises = [
    async () => {
      while(true) { try { await storage.updateWallet(userId, { balance: 8000 }); break; } catch(e) { if (e.message==='WALLET_BUSY') await delay(5); else throw e; } }
    },
    async () => {
      while(true) { try { await wallet.debit(userId, 2000); break; } catch(e) { if (e.message==='WALLET_BUSY') await delay(5); else throw e; } }
    }
  ];
  await Promise.all(promises.map(p => p()));
  
  const finalUser = await storage.getUser(userId);
  assert.ok(finalUser.balance === 6000 || finalUser.balance === 8000, 'Balance should be one of the valid atomic outcomes');
});

test('10. debt-limit change + concurrent checkout', async () => {
  mem.clear();
  const userId = 'user_10';
  await storage.saveUser({ telegramUserId: userId, username: 'test10' });
  await storage.updateWallet(userId, { isReseller: true, debtLimit: 1000, balance: 0 });

  const promises = [
    async () => {
      while(true) { try { await storage.updateWallet(userId, { debtLimit: 5000 }); break; } catch(e) { if (e.message==='WALLET_BUSY') await delay(5); else throw e; } }
    },
    async () => {
      while(true) { try { await wallet.debit(userId, 2000); break; } catch(e) { if (e.message==='INSUFFICIENT_BALANCE' || e.message==='WALLET_BUSY') await delay(5); else throw e; } }
    }
  ];
  await Promise.all(promises.map(p => p()));
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, -2000, 'Balance should be exactly -2000');
  assert.equal(finalUser.debtLimit, 5000, 'Debt limit should be 5000');
});

test('11. migration followed by wallet mutation', async () => {
  mem.clear();
  const userId = 'user_11';
  mem.set(`user:${userId}`, { telegramUserId: userId, balance: 10000, debtLimit: 5000 });

  await wallet.credit(userId, 2000);
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, 12000, 'Lazy migration should add 2000 to the existing 10000');
  assert.equal(finalUser.debtLimit, 5000, 'Lazy migration should preserve debtLimit');

  await storage.saveUser({ telegramUserId: userId, username: 'migrated11' });
  
  const rawUser = mem.get(`user:${userId}`);
  assert.equal(rawUser.balance, undefined, 'saveUser should strip balance');
  assert.equal(rawUser.debtLimit, undefined, 'saveUser should strip debtLimit');
});

test('12. overlapping updateWallet calls', async () => {
  mem.clear();
  const userId = 'user_12';
  await storage.saveUser({ telegramUserId: userId, username: 'test12' });
  await storage.updateWallet(userId, { balance: 0, isReseller: false });

  const promises = [];
  for(let i=0; i<10; i++) {
    promises.push(async () => {
      while(true) { try { await storage.updateWallet(userId, { [`flag${i}`]: true }); break; } catch(e) { if (e.message==='WALLET_BUSY') await delay(2); else throw e; } }
    });
  }
  await Promise.all(promises.map(p => p()));
  
  const finalUser = await storage.getUser(userId);
  for(let i=0; i<10; i++) assert.equal(finalUser[`flag${i}`], true, `Flag ${i} should be true`);
});

test('13. simulated failure during wallet update', async () => {
  mem.clear();
  const userId = 'user_13';
  await storage.saveUser({ telegramUserId: userId, username: 'test13' });
  await storage.updateWallet(userId, { balance: 100 });

  // If a worker crashes inside updateWallet, the lock expires after 30s.
  // In our tests, memory lock is manually implemented or we just test normal behavior.
  // Actually, let's verify that a failed adjustBalance doesn't corrupt.
  try {
    await wallet.adjustBalance(userId, NaN);
  } catch(e) {
    // expected
  }
  
  const finalUser = await storage.getUser(userId);
  assert.equal(finalUser.balance, 100, 'Balance should remain unchanged');
});

test('14. lock ownership - simple acquire and release', async () => {
  mem.clear();
  const token = await storage.acquireLock('test_lock', 30);
  assert.ok(token, 'Should acquire lock and return token');
  const result = await storage.releaseLock('test_lock', token);
  assert.equal(result, true, 'Should release successfully with correct token');
});

test('15. lock ownership - worker A stalls, B acquires, A cannot release', async () => {
  mem.clear();
  const tokenA = await storage.acquireLock('shared_lock', 30);
  assert.ok(tokenA);
  
  mem.delete('lock:shared_lock');

  const tokenB = await storage.acquireLock('shared_lock', 30);
  assert.ok(tokenB);
  assert.notEqual(tokenA, tokenB, 'Tokens must be unique');

  const releasedA = await storage.releaseLock('shared_lock', tokenA);
  assert.equal(releasedA, false, 'A should fail to release lock owned by B');
  assert.ok(mem.has('lock:shared_lock'), 'Lock must still exist in memory');

  const releasedB = await storage.releaseLock('shared_lock', tokenB);
  assert.equal(releasedB, true, 'B should successfully release its lock');
  assert.equal(mem.has('lock:shared_lock'), false, 'Lock must be deleted');
});

test('16. Active reseller with debt can repay', async () => {
  mem.clear();
  await storage.saveUser({ telegramUserId: 901, reseller: true, debtLimit: 100000 });
  await storage.updateWallet(901, { balance: -50000, debtLimit: 100000, isReseller: true });
  await wallet.credit(901, 20000);
  const u = await storage.getUser(901);
  assert.equal(u.balance, -30000);
});

test('17. Reseller revoked while balance is negative -> repayment succeeds', async () => {
  mem.clear();
  await storage.saveUser({ telegramUserId: 902, reseller: false });
  await storage.updateWallet(902, { balance: -50000, isReseller: false }); // They have debt but are revoked
  await wallet.credit(902, 20000);
  const u = await storage.getUser(902);
  assert.equal(u.balance, -30000);
});

test('18. Revoked reseller with negative balance cannot create additional debt', async () => {
  mem.clear();
  await storage.saveUser({ telegramUserId: 903, reseller: false });
  await storage.updateWallet(903, { balance: -50000, isReseller: false });
  await assert.rejects(async () => {
    await wallet.debit(903, 10000);
  }, /INSUFFICIENT_BALANCE/);
  const u = await storage.getUser(903);
  assert.equal(u.balance, -50000); // Unchanged
});

test('19. Revoked reseller with negative balance can repay partially', async () => {
  mem.clear();
  await storage.saveUser({ telegramUserId: 904, reseller: false });
  await storage.updateWallet(904, { balance: -50000, isReseller: false });
  await wallet.credit(904, 10000);
  const u = await storage.getUser(904);
  assert.equal(u.balance, -40000);
});

test('20. Multiple concurrent repayments cannot lose money', async () => {
  mem.clear();
  await storage.saveUser({ telegramUserId: 905, reseller: false });
  await storage.updateWallet(905, { balance: -50000, isReseller: false });
  
  const promises = [
    (async () => { while(true) { try { await wallet.credit(905, 10000); break; } catch(e) { if(e.message!=='WALLET_BUSY') throw e; await new Promise(r=>setTimeout(r,5)); } } })(),
    (async () => { while(true) { try { await wallet.credit(905, 5000); break; } catch(e) { if(e.message!=='WALLET_BUSY') throw e; await new Promise(r=>setTimeout(r,5)); } } })(),
    (async () => { while(true) { try { await wallet.credit(905, 15000); break; } catch(e) { if(e.message!=='WALLET_BUSY') throw e; await new Promise(r=>setTimeout(r,5)); } } })()
  ];
  
  await Promise.all(promises);
  const u = await storage.getUser(905);
  assert.equal(u.balance, -20000); // -50k + 10k + 5k + 15k = -20k
});

test('21. Repayment + profile update remains safe', async () => {
  mem.clear();
  await storage.saveUser({ telegramUserId: 906, reseller: false });
  await storage.updateWallet(906, { balance: -50000, isReseller: false });
  
  const p1 = wallet.credit(906, 20000);
  const p2 = storage.saveUser({ telegramUserId: 906, firstName: 'Bob' });
  
  await Promise.all([p1, p2]);
  
  const u = await storage.getUser(906);
  assert.equal(u.balance, -30000);
  assert.equal(u.firstName, 'Bob');
});

test('22. Repayment + purchase/debit concurrency remains financially correct', async () => {
  mem.clear();
  await storage.saveUser({ telegramUserId: 907, reseller: false });
  await storage.updateWallet(907, { balance: -50000, isReseller: false });
  
  const p1 = (async () => { while(true) { try { await wallet.credit(907, 30000); break; } catch(e) { if(e.message!=='WALLET_BUSY') throw e; await new Promise(r=>setTimeout(r,5)); } } })();
  
  const p2 = (async () => { 
    while(true) { 
      try { 
        await wallet.debit(907, 10000); 
        return 'SUCCESS'; 
      } catch(e) { 
        if(e.message!=='WALLET_BUSY') return e.message; 
        await new Promise(r=>setTimeout(r,5)); 
      } 
    } 
  })();
  
  const [res1, res2] = await Promise.all([p1, p2]);
  assert.equal(res2, 'INSUFFICIENT_BALANCE');
  
  const u = await storage.getUser(907);
  assert.equal(u.balance, -20000);
});

test('23. Refund behavior remains correct', async () => {
  mem.clear();
  await storage.saveUser({ telegramUserId: 908, reseller: true, debtLimit: 100000 });
  await storage.updateWallet(908, { balance: 0, debtLimit: 100000, isReseller: true });
  
  // They buy
  await wallet.debit(908, 60000);
  // Now they are at -60000. 
  // Then they are revoked
  await storage.saveUser({ telegramUserId: 908, reseller: false });
  await storage.updateWallet(908, { isReseller: false }); // Debt limit is effectively 0
  
  // Order is refunded
  await wallet.credit(908, 60000); // Repayment
  const u = await storage.getUser(908);
  assert.equal(u.balance, 0); // Balance fully restored
});

test('cleanup', () => {
  delete global.fetch;
});
