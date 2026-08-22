const GIB = 1024 ** 3;

const PLANS = Object.freeze([
  {
    id: 'plan_1mo',
    name: 'اشتراک نامحدود (1 ماهه)',
    price: 199000,
    currency: 'IRR',
    type: 'unlimited',
    trafficBytes: 0,
    durationDays: 30,
    hwidLimit: 1,
  },
  {
    id: 'plan_2mo',
    name: 'اشتراک نامحدود (2 ماهه)',
    price: 299000,
    currency: 'IRR',
    type: 'unlimited',
    trafficBytes: 0,
    durationDays: 60,
    hwidLimit: 1,
  },
  {
    id: 'plan_10g',
    name: 'اشتراک 10 گیگابایت (1 ماهه)',
    price: 40000,
    currency: 'IRR',
    type: 'traffic',
    trafficBytes: 10 * GIB,
    durationDays: 30,
    hwidLimit: 0,
  },
  {
    id: 'plan_20g',
    name: 'اشتراک 20 گیگابایت (1 ماهه)',
    price: 70000,
    currency: 'IRR',
    type: 'traffic',
    trafficBytes: 20 * GIB,
    durationDays: 30,
    hwidLimit: 0,
  },
  {
    id: 'plan_50g',
    name: 'اشتراک 50 گیگابایت (2 ماهه)',
    price: 150000,
    currency: 'IRR',
    type: 'traffic',
    trafficBytes: 50 * GIB,
    durationDays: 60,
    hwidLimit: 0,
  },
  {
    id: 'plan_200g',
    name: 'اشتراک 200 گیگابایت (1 ماهه)',
    price: 200000,
    currency: 'IRR',
    type: 'traffic',
    trafficBytes: 200 * GIB,
    durationDays: 30,
    hwidLimit: 0,
  },
  {
    id: 'plan_300g',
    name: 'اشتراک 300 گیگابایت (1 ماهه)',
    price: 300000,
    currency: 'IRR',
    type: 'traffic',
    trafficBytes: 300 * GIB,
    durationDays: 30,
    hwidLimit: 0,
  },
  {
    id: 'plan_500g',
    name: 'اشتراک 500 گیگابایت (1 ماهه)',
    price: 450000,
    currency: 'IRR',
    type: 'traffic',
    trafficBytes: 500 * GIB,
    durationDays: 30,
    hwidLimit: 0,
  },
  {
    id: 'plan_1000g',
    name: 'اشتراک 1000 گیگابایت (1 ماهه)',
    price: 700000,
    currency: 'IRR',
    type: 'traffic',
    trafficBytes: 1000 * GIB,
    durationDays: 30,
    hwidLimit: 0,
  },
]);

function getPlan(id) {
  return PLANS.find((plan) => plan.id === id) || null;
}

function calculateCustomPrice(trafficGb) {
  return trafficGb > 51 ? trafficGb * 3000 : trafficGb * 4000;
}

function parseDurationDays(input) {
  const value = String(input || '').trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const match = value.match(/^(\d{1,3})\s*(?:روز|روزه|day|days|d)$/i);
  if (match) return Number(match[1]);

  const monthMatch = value.match(/^(\d{1,2})\s*(?:ماه|ماهه|month|months|m)$/i);
  if (monthMatch) return Number(monthMatch[1]) * 30;

  return null;
}

function buildCustomPlan(trafficGb, durationDays) {
  if (!Number.isInteger(trafficGb) || trafficGb < 1 || trafficGb > 1000) {
    throw new Error('CUSTOM_TRAFFIC_OUT_OF_RANGE');
  }
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 150) {
    throw new Error('CUSTOM_DURATION_OUT_OF_RANGE');
  }

  return {
    id: `custom_${trafficGb}g_${durationDays}d`,
    name: `بسته سفارشی (${trafficGb} گیگابایت | ${durationDays} روز)`,
    price: calculateCustomPrice(trafficGb),
    currency: 'IRR',
    type: 'traffic',
    trafficBytes: trafficGb * GIB,
    durationDays,
    hwidLimit: 0,
    custom: true,
  };
}

module.exports = {
  GIB,
  PLANS,
  getPlan,
  calculateCustomPrice,
  parseDurationDays,
  buildCustomPlan,
};
