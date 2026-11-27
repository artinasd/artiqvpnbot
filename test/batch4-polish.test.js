const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const menuBuilderApi = require('../api/menu-builder');

const root = path.join(__dirname, '..');

test('api/menu-builder normalizes non-numeric draft version to 1', async () => {
  process.env.ADMIN_CMS_PASSWORD = 'test-password';
  let getPayload = null;
  await menuBuilderApi({
    method: 'GET',
    headers: { 'x-admin-password': 'test-password' },
  }, {
    status() { return this; },
    setHeader() {},
    end(body) { getPayload = JSON.parse(body); },
  });

  const doc = { ...getPayload.draft, version: 'not-a-number' };
  let statusCode = 0;
  let postPayload = null;
  await menuBuilderApi({
    method: 'POST',
    headers: { 'x-admin-password': 'test-password' },
    body: { action: 'save_draft', document: doc },
  }, {
    status(code) { statusCode = code; return this; },
    setHeader() {},
    end(body) { postPayload = JSON.parse(body); },
  });
  assert.equal(statusCode, 200);
  assert.equal(postPayload.draft.version, 1);
});

test('public/menu-builder.js parses cleanly and disables action buttons while saving', () => {
  const src = fs.readFileSync(path.join(root, 'public/menu-builder.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'public/menu-builder.js' }));
  assert.ok(src.includes('saveBtn.disabled = true'));
  assert.ok(src.includes('publishBtn.disabled = true'));
  assert.ok(src.includes('rollbackBtn.disabled = true'));
});
