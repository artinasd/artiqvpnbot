const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('CMS presentation scripts have valid JavaScript syntax', () => {
  for (const file of ['public/admin-cms.js', 'public/admin-shell.js', 'public/panels-cms.js']) {
    assert.doesNotThrow(() => new vm.Script(source(file), { filename: file }), file);
  }
});

test('professional shell loads after existing CMS feature modules', () => {
  const loader = source('public/admin-cms.js');
  assert.match(loader, /load\('\/panels-cms\.js',function\(\)\{load\('\/admin-shell\.js'\);\}\)/);
  assert.ok(fs.existsSync(path.join(root, 'public/admin-shell.css')));
});

test('shell routes existing CMS features without replacing their API modules', () => {
  const shell = source('public/admin-shell.js');
  for (const selector of [
    '#panels-cms-card',
    '#cardNumber',
    '#message_start',
    '#activeUsersCmsCard',
    '#resellerCmsCard',
    '#walletCard',
    '#debtCard',
    '#forceJoinCard'
  ]) {
    assert.ok(shell.includes(selector), 'missing existing feature selector: ' + selector);
  }
  assert.ok(shell.includes("window.dispatchEvent(new CustomEvent('artiq-cms-refresh'))"));
});
