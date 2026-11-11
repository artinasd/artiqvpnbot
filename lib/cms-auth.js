const crypto = require('node:crypto');

function secretsEqual(expected, actual) {
  if (typeof expected !== 'string' || !expected.length || typeof actual !== 'string' || !actual.length) return false;
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  const actualDigest = crypto.createHash('sha256').update(actual, 'utf8').digest();
  return crypto.timingSafeEqual(expectedDigest, actualDigest);
}

function isAuthorizedAdmin(req, expectedPassword = process.env.ADMIN_CMS_PASSWORD || '') {
  const provided = req?.headers?.['x-admin-password'] ?? req?.headers?.['X-Admin-Password'];
  return secretsEqual(expectedPassword, provided);
}

function sendJson(res, status, body) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  return res.end(JSON.stringify(body));
}

module.exports = { secretsEqual, isAuthorizedAdmin, sendJson };
