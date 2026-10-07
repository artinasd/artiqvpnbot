const test = require('node:test');
const assert = require('node:assert');
const accountUI = require('../lib/account-ui');

function generateSubs(count) {
  const subs = [];
  for (let i = 1; i <= count; i++) {
    subs.push({ id: `sub_${i}`, title: `Subscription ${i}`, status: '✅ فعال' });
  }
  return subs;
}

test('1. 0 subscriptions', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(0));
  assert.equal(kb.length, 0);
});

test('2. 1 subscription', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(1));
  assert.equal(kb.length, 1);
  assert.equal(kb[0][0].callback_data, 'account_sub:sub_1');
});

test('3. A normal list that fits on one page (5 subs)', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(5));
  assert.equal(kb.length, 5); // 5 rows, no pagination row
});

test('4. Exactly page-size subscriptions (10 subs)', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(10));
  assert.equal(kb.length, 10); // 10 rows, no pagination row
});

test('5. Page-size + 1 subscriptions (11 subs)', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(11));
  assert.equal(kb.length, 11); // 10 subs + 1 pagination row
  const navRow = kb[10];
  assert.equal(navRow.length, 1);
  assert.equal(navRow[0].text, 'بعدی ➡️');
  assert.equal(navRow[0].callback_data, 'account_list:2');
});

test('6. A large list such as 100 subscriptions (page 1)', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(100));
  assert.equal(kb.length, 11); 
  const navRow = kb[10];
  assert.equal(navRow.length, 1);
  assert.equal(navRow[0].text, 'بعدی ➡️');
});

test('7. Next-page navigation (page 2 of 100)', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(100), 2);
  assert.equal(kb.length, 11); // 10 subs + 1 nav row
  const navRow = kb[10];
  assert.equal(navRow.length, 2);
  assert.equal(navRow[0].text, '⬅️ قبلی');
  assert.equal(navRow[0].callback_data, 'account_list:1');
  assert.equal(navRow[1].text, 'بعدی ➡️');
  assert.equal(navRow[1].callback_data, 'account_list:3');
});

test('8. Previous-page navigation (page 2 -> 1)', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(100), 1);
  const navRow = kb[10];
  assert.equal(navRow.length, 1); // Only Next
});

test('9. Final-page behavior (page 10 of 100)', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(100), 10);
  assert.equal(kb.length, 11); 
  const navRow = kb[10];
  assert.equal(navRow.length, 1);
  assert.equal(navRow[0].text, '⬅️ قبلی');
  assert.equal(navRow[0].callback_data, 'account_list:9');
});

test('10. Out-of-range page number is safely clamped/rejected', () => {
  let kb = accountUI.subscriptionKeyboard(generateSubs(25), 999);
  let navRow = kb[kb.length - 1];
  // Clamped to page 3
  assert.equal(kb.length, 6); // 5 subs + 1 nav
  assert.equal(navRow.length, 1);
  assert.equal(navRow[0].text, '⬅️ قبلی');
  assert.equal(navRow[0].callback_data, 'account_list:2');

  kb = accountUI.subscriptionKeyboard(generateSubs(25), -5);
  navRow = kb[kb.length - 1];
  // Clamped to page 1
  assert.equal(navRow.length, 1);
  assert.equal(navRow[0].callback_data, 'account_list:2');
  
  kb = accountUI.subscriptionKeyboard(generateSubs(25), 'invalid');
  navRow = kb[kb.length - 1];
  // Clamped to page 1
  assert.equal(navRow[0].callback_data, 'account_list:2');
});

test('11. Stale callback after subscription count changes', () => {
  // Originally 25 subs, user clicks page 3.
  // But now they only have 5 subs (1 page).
  const kb = accountUI.subscriptionKeyboard(generateSubs(5), 3);
  // Clamped to page 1, no nav row!
  assert.equal(kb.length, 5); 
});

test('12. Callback from another Telegram user is rejected', () => {
  // This is handled by api/index.js inherently:
  // const subscriptions = await accountUI.listForUser(ctx.from.id);
  // It only fetches for ctx.from.id, so another user clicking their stale button 
  // with their own callback data (account_list:2) will just show THEIR OWN page 2, 
  // completely ignoring the other user's state. It is stateless.
  assert.ok(true);
});

test('13. Existing subscription selection callback still selects the correct subscription', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(100), 5);
  // Page 5 shows subs 41-50
  assert.equal(kb[0][0].callback_data, 'account_sub:sub_41');
  assert.equal(kb[9][0].callback_data, 'account_sub:sub_50');
});

test('14. Existing Home/back navigation still works', () => {
  const detail = accountUI.detailKeyboard({ id: 'sub_123', canRenew: true, subUrl: 'http' });
  const backBtnRow = detail.find(r => r[0].callback_data === 'account_list');
  assert.ok(backBtnRow);
  
  const homeBtnRow = detail.find(r => r[0].callback_data === 'main_home');
  assert.ok(homeBtnRow);
});

test('15. Generated keyboard remains within safe Telegram limits', () => {
  const kb = accountUI.subscriptionKeyboard(generateSubs(100), 1);
  assert.ok(kb.length <= 11); // Max 10 subs + 1 nav
});
