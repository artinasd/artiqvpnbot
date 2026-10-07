const test = require('node:test');
const assert = require('node:assert');
const accountUI = require('../lib/account-ui');

test('Dashboard formatting uses live provider data', () => {
  const sub = {
    planName: 'Test Plan',
    service: 'Tunnel',
    status: '✅ فعال',
    liveDataLimit: 15 * 1024 * 1024 * 1024,
    liveUsedTraffic: 5.5 * 1024 * 1024 * 1024,
    liveExpiresAt: new Date(Date.now() + 86400 * 1000 * 5).toISOString(),
    liveStatus: 'active',
    hwidLimit: 2,
    canRenew: true
  };
  
  const text = accountUI.formatDetail(sub);
  assert.match(text, /ترافیک کل: 15\.00 GB/);
  assert.match(text, /مصرف شده: 5\.50 GB/);
  assert.match(text, /باقی‌مانده: 9\.50 GB/);
  assert.match(text, /⏳ زمان باقی‌مانده: 5 روز/);
  assert.match(text, /📱 تعداد کاربر \(دستگاه\): 2/);
});

test('Dashboard formatting for unlimited traffic', () => {
  const sub = {
    planName: 'Unlimited Plan',
    service: 'Tunnel',
    status: '✅ فعال',
    liveDataLimit: 0,
    liveUsedTraffic: 10 * 1024 * 1024 * 1024,
    liveExpiresAt: 0,
    hwidLimit: 0,
    canRenew: false
  };
  
  const text = accountUI.formatDetail(sub);
  assert.match(text, /ترافیک کل: نامحدود/);
  assert.match(text, /مصرف شده: 10\.00 GB/);
  assert.match(text, /انقضا: نامحدود/);
  assert.match(text, /بدون محدودیت/);
});

test('Dashboard indicates disabled provider status', () => {
  const sub = {
    planName: 'Disabled Plan',
    service: 'Tunnel',
    status: '✅ فعال',
    liveStatus: 'disabled'
  };
  
  const text = accountUI.formatDetail(sub);
  assert.match(text, /⚠️ وضعیت در سرور: غیرفعال/);
});
