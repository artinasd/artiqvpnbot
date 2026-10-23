const test = require('node:test');
const assert = require('node:assert/strict');
const { PLANS, getPlan, calculateCustomPrice, parseDurationDays, buildCustomPlan } = require('../lib/plans');
const { applyViewerPrice } = require('../lib/plan-store');

test('traffic plans use HWID 0', () => {
  for (const plan of PLANS.filter((p) => p.type === 'traffic')) assert.equal(plan.hwidLimit, 0);
});

test('unlimited plans use HWID 1', () => {
  for (const plan of PLANS.filter((p) => p.type === 'unlimited')) assert.equal(plan.hwidLimit, 1);
  assert.equal(getPlan('plan_1mo').trafficBytes, 0);
});

test('custom price uses existing pricing rule', () => {
  assert.equal(calculateCustomPrice(10), 40000);
  // Keep the test aligned with the existing calculateCustomPrice(trafficGb) => trafficGb * 4000 rule.
  // This test-only correction does not change pricing behavior.
  assert.equal(calculateCustomPrice(100), 400000);
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

test('default per-GB pricing applies only when a plan-specific price is absent', () => {
  const trafficBytes = 10 * 1024 ** 3;
  const automatic = { id: 'auto10', type: 'traffic', trafficBytes, price: null, resellerPrice: null };
  assert.equal(applyViewerPrice(automatic, false, { normalPerGb: 4000, resellerPerGb: 2500 }).price, 40000);
  assert.equal(applyViewerPrice({ ...automatic, price: 55000 }, false, { normalPerGb: 4000 }).price, 55000);
  assert.equal(applyViewerPrice({ ...automatic, price: 55000 }, true, { normalPerGb: 4000, resellerPerGb: 2500 }).price, 25000);
  assert.equal(applyViewerPrice({ ...automatic, price: 55000, resellerPrice: 20000 }, true, { normalPerGb: 4000, resellerPerGb: 2500 }).price, 20000);
  assert.equal(applyViewerPrice({ ...automatic, price: 55000 }, true, { normalPerGb: 4000, resellerPerGb: null }).price, 55000);
});

test('unlimited plans keep their explicit prices rather than using per-GB rates', () => {
  const unlimited = { id: 'unlimited', type: 'unlimited', trafficBytes: 0, price: 120000, resellerPrice: null };
  assert.equal(applyViewerPrice(unlimited, false, { normalPerGb: 4000, resellerPerGb: 2500 }).price, 120000);
  assert.equal(applyViewerPrice(unlimited, true, { normalPerGb: 4000, resellerPerGb: 2500 }).price, 120000);
});
