const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const adminHandler = require('../api/admin');
const { escapeHtml } = require('../lib/html');

const root = path.join(__dirname, '..');

test('escapeHtml escapes single quotes alongside standard HTML metacharacters', () => {
  assert.equal(escapeHtml(`<a href="'test'">&`), '&lt;a href=&quot;&#39;test&#39;&quot;&gt;&amp;');
});

test('api/admin.js sets security headers and renders all message textareas', async () => {
  const headers = {};
  let body = '';
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { headers[k] = v; },
    end(chunk) { body = String(chunk || ''); },
  };
  await adminHandler({ method: 'GET', query: {}, headers: {} }, res);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.ok(body.includes('id="message_serviceUnavailable"'));
  assert.ok(body.includes('id="message_testProcessingLock"'));
  assert.ok(body.includes('id="message_maintenance"'));
});

test('CMS frontend scripts parse cleanly and include Batch 3 fixes', () => {
  for (const file of ['public/admin-cms.js', 'public/admin-shell.js', 'public/force-join-cms.js', 'public/panels-cms.js']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: file }), file);
  }

  const cmsLoader = fs.readFileSync(path.join(root, 'public/admin-cms.js'), 'utf8');
  assert.ok(cmsLoader.includes('clearInterval(timer)'));

  const forceJoinCms = fs.readFileSync(path.join(root, 'public/force-join-cms.js'), 'utf8');
  assert.ok(forceJoinCms.includes('var patch={bot:{forceJoin:'));
  assert.ok(forceJoinCms.includes('btn.disabled=true'));

  const panelsCms = fs.readFileSync(path.join(root, 'public/panels-cms.js'), 'utf8');
  assert.ok(panelsCms.includes("byId('panel-name').value = ''"));
  assert.ok(panelsCms.includes("byId('panel-url').value = ''"));
});
