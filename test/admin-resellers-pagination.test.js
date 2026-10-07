const test = require('node:test');
const assert = require('node:assert');
process.env.ADMIN_CMS_PASSWORD = 'test_password';
const adminResellers = require('../api/admin-resellers');
const storage = require('../lib/storage');

// Mock response object
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    end(data) {
      this.body = JSON.parse(data);
      return this;
    }
  };
  return res;
}

// Mock request object
function mockReq(method, path, headers = {}, query = {}, body = {}) {
  return { method, path, headers, query, body };
}

async function setupResellers(count) {
  const existing = await storage.smembers('bot_users');
  for (const id of existing) {
    await storage.srem('bot_users', id);
  }
  for (let i = 1; i <= count; i++) {
    await storage.saveUser({ telegramUserId: i, username: `user_${i}` });
    await storage.updateWallet(i, { isReseller: true, debtLimit: 1000 * i });
  }
  await storage.saveUser({ telegramUserId: 9999, username: `non_reseller` });
  await storage.updateWallet(9999, { isReseller: false });
}

test('1. Admin authorization: unauthorized GET is rejected', async () => {
  const req = mockReq('GET', '/api/admin-resellers', {}, { page: '1' });
  const res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'UNAUTHORIZED');
});

test('2. Admin authorization: unauthorized POST is rejected', async () => {
  const req = mockReq('POST', '/api/admin-resellers', {}, {}, { action: 'set-user', telegramId: '1', isReseller: false });
  const res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'UNAUTHORIZED');
});

test('3. Admin authorization: authorized admin GET works', async () => {
  await setupResellers(1);
  const req = mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' });
  const res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.resellers);
});

test('4. Admin authorization: authorized admin POST works', async () => {
  await setupResellers(1);
  const req = mockReq('POST', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, {}, { action: 'set-debt-limit', telegramId: '1', debtLimit: 2000 });
  const res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.debtLimit, 2000);
});

test('5. POST semantics: adding page parameter does not break target or finances', async () => {
  await setupResellers(3);
  
  // Set debt limit for user 2 on page 2
  const req = mockReq('POST', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, {}, { action: 'set-debt-limit', telegramId: '2', debtLimit: 5000, page: 2 });
  const res = mockRes();
  await adminResellers(req, res);
  
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.telegramUserId, 2);
  assert.equal(res.body.user.debtLimit, 5000);
  
  // Returns clamped pagination (since there are only 3, max page is 1)
  assert.equal(res.body.page, 1); 
  assert.equal(res.body.totalCount, 3);
  
  // Check wallet remains unchanged for others
  const u1 = await storage.getUserRaw(1);
  assert.equal(u1.debtLimit, 1000);
});

test('6. Pagination correctness: 0 resellers', async () => {
  await setupResellers(0);
  const req = mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 1 });
  const res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.body.resellers.length, 0);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.totalPages, 1);
});

test('7. Pagination correctness: 1 reseller', async () => {
  await setupResellers(1);
  const req = mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 1 });
  const res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.body.resellers.length, 1);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.totalPages, 1);
});

test('8. Pagination correctness: 10 resellers', async () => {
  await setupResellers(10);
  const req = mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 1 });
  const res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.body.resellers.length, 10);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.totalPages, 1);
});

test('9. Pagination correctness: 11 resellers', async () => {
  await setupResellers(11);
  let req = mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 1 });
  let res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.body.resellers.length, 10);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.totalPages, 2);

  req = mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 2 });
  res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.body.resellers.length, 1);
  assert.equal(res.body.page, 2);
  assert.equal(res.body.totalPages, 2);
});

test('10. Pagination correctness: 100+ resellers (middle page)', async () => {
  await setupResellers(105);
  const req = mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 5 });
  const res = mockRes();
  await adminResellers(req, res);
  assert.equal(res.body.resellers.length, 10);
  assert.equal(res.body.page, 5);
  assert.equal(res.body.totalPages, 11); // 105 / 10 = 10.5 -> 11 pages
});

test('11. Pagination correctness: clamping (page 0, negative, non-numeric, beyond totalPages)', async () => {
  await setupResellers(25); // 3 pages
  
  // page 0 -> 1
  let res = mockRes();
  await adminResellers(mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 0 }), res);
  assert.equal(res.body.page, 1);

  // negative page -> 1
  res = mockRes();
  await adminResellers(mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: -5 }), res);
  assert.equal(res.body.page, 1);
  
  // non-numeric page -> 1
  res = mockRes();
  await adminResellers(mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 'invalid' }), res);
  assert.equal(res.body.page, 1);

  // beyond totalPages -> max page
  res = mockRes();
  await adminResellers(mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 999 }), res);
  assert.equal(res.body.page, 3);
  assert.equal(res.body.resellers.length, 5);
});

test('12. Race/staleness behavior: request stale page after population shrinks', async () => {
  await setupResellers(50); // 5 pages
  
  // request page 5 -> OK
  let res = mockRes();
  await adminResellers(mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 5 }), res);
  assert.equal(res.body.page, 5);
  
  // simulate population shrinking to 2 pages (20 users)
  const existing = await storage.smembers('bot_users');
  for (let i = 20; i < existing.length; i++) {
    await storage.updateWallet(existing[i], { isReseller: false });
  }
  
  // request page 5 again -> safely clamped to 2
  res = mockRes();
  await adminResellers(mockReq('GET', '/api/admin-resellers', { 'x-admin-password': 'test_password' }, { page: 5 }), res);
  assert.equal(res.body.page, 2);
  assert.equal(res.body.totalPages, 2);
});
