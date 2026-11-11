process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('package.json retains the node --test script without runtime script changes', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.scripts, { test: 'node --test' });
  assert.equal(Object.hasOwn(pkg, 'engines'), false);
});

test('GitHub Actions configures an isolated environment for npm test', () => {
  const workflow = read('.github/workflows/test.yml');
  const testStep = workflow.split(/\n(?=      - )/).find((step) => step.startsWith('      - run: npm test'));
  assert.ok(testStep, 'npm test step must exist');
  assert.ok(testStep.includes("UPSTASH_REDIS_REST_URL: ''"));
  assert.ok(testStep.includes("UPSTASH_REDIS_REST_TOKEN: ''"));
  assert.ok(testStep.includes("BOT_TOKEN: '123456:CI_TEST_TOKEN'"));
  assert.ok(testStep.includes("ADMIN_ID: '999999999'"));
  assert.ok(testStep.includes("WEBHOOK_SECRET: 'ci-test-secret'"));
});

test('Group 7 test files isolate Redis before library imports and pass Node syntax checks', () => {
  const files = ["test/purchase-report-worker.test.js","test/menu-builder.test.js","test/cms-shell.test.js","test/account-service.test.js","test/account-ui.test.js","test/dynamic-pasarguard.test.js","test/dynamic-services.test.js","test/panel-registry.test.js","test/plans.test.js","test/purchase-report-outbox-storage.test.js","test/purchase-report.test.js","test/group7-tooling.test.js"];
  for (const file of files) {
    const content = read(file);
    const urlLine = content.indexOf("process.env.UPSTASH_REDIS_REST_URL = '';");
    const tokenLine = content.indexOf("process.env.UPSTASH_REDIS_REST_TOKEN = '';");
    assert.ok(urlLine >= 0 && tokenLine >= 0, file + ' must clear both Redis environment variables');
    const singleQuoteImport = content.indexOf("require('../lib/");
    const doubleQuoteImport = content.indexOf('require("../lib/');
    const libraryImport = [singleQuoteImport, doubleQuoteImport].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? -1;
    if (libraryImport >= 0) {
      assert.ok(urlLine < libraryImport && tokenLine < libraryImport, file + ' must clear Redis before importing lib modules');
    }
    execFileSync(process.execPath, ['-c', path.join(root, file)], { stdio: 'pipe' });
  }
});
