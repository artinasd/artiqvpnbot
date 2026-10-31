const test = require('node:test');
const assert = require('node:assert/strict');
const { isAuthorized } = require('../api/purchase-reports');

test('purchase report worker accepts only the exact bearer secret', () => {
  assert.equal(isAuthorized('Bearer secret-value', 'secret-value'), true);
  assert.equal(isAuthorized('bearer secret-value', 'secret-value'), false);
  assert.equal(isAuthorized('Bearer wrong', 'secret-value'), false);
  assert.equal(isAuthorized('Bearer secret-value', ''), false);
  assert.equal(isAuthorized(undefined, 'secret-value'), false);
});
