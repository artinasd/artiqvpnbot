const test = require('node:test');
const assert = require('node:assert/strict');
const { PLANS, getPlan, calculateCustomPrice, parseDurationDays, buildCustomPlan } = require('../lib/plans');

test('traffic plans use HWID 0', () => {
  for (const plan of PLANS.filter((p) => p.type === 'traffic')) assert.equal(plan.hwidLimit, 0);
});

test('unlimited plans use HWID 1', () => {
  for (const plan of PLANS.filter((p) => p.type === 'unlimited')) assert.equal(plan.hwidLimit, 1);
  assert.equal(getPlan('plan_1mo').trafficBytes, 0);
});

test('custom price uses existing pricing rule', () => {
  assert.equal(calculateCustomPrice(10), 40000);
  assert.equal(calculateCustomPrice(100), 300000);
});

test('duration parser supports Persian and English forms', () => {
  assert.equal(parseDurationDays('۳۰ روزه'), 30);
  assert.equal(parseDurationDays('45 روز'), 45);
  assert.equal(parseDurationDays('۱ ماهه'), 30);
  assert.equal(parseDurationDays('2 months'), 60);
  assert.equal(parseDurationDays('bad'), null);
});

test('custom plans are centrally validated', () => {
  const plan = buildCustomPlan(20, 30);
  assert.equal(plan.trafficBytes, 20 * 1024 ** 3);
  assert.equal(plan.hwidLimit, 0);
  assert.throws(() => buildCustomPlan(0, 30), /CUSTOM_TRAFFIC_OUT_OF_RANGE/);
  assert.throws(() => buildCustomPlan(20, 151), /CUSTOM_DURATION_OUT_OF_RANGE/);
});
