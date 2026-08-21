const GB = 1024 ** 3;
const DAY = 24 * 60 * 60;

function envInt(name) {
  const value = process.env[name];
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

const plans = [
  { id: 'plan_1mo', name: 'اشتراک نامحدود (1 ماهه)', price: 199000, trafficBytes: 0, durationDays: 30, templateId: envInt('PASARGUARD_TEMPLATE_1MO') },
  { id: 'plan_2mo', name: 'اشتراک نامحدود (2 ماهه)', price: 299000, trafficBytes: 0, durationDays: 60, templateId: envInt('PASARGUARD_TEMPLATE_2MO') },
  { id: 'plan_10g', name: 'اشتراک 10 گیگابایت (1 ماهه)', price: 40000, trafficBytes: 10 * GB, durationDays: 30, templateId: envInt('PASARGUARD_TEMPLATE_10GB') },
  { id: 'plan_20g', name: 'اشتراک 20 گیگابایت (1 ماهه)', price: 70000, trafficBytes: 20 * GB, durationDays: 30, templateId: envInt('PASARGUARD_TEMPLATE_20GB') },
  { id: 'plan_50g', name: 'اشتراک 50 گیگابایت (2 ماهه)', price: 150000, trafficBytes: 50 * GB, durationDays: 60, templateId: envInt('PASARGUARD_TEMPLATE_50GB') },
  { id: 'plan_200g', name: 'اشتراک 200 گیگابایت (1 ماهه)', price: 200000, trafficBytes: 200 * GB, durationDays: 30, templateId: envInt('PASARGUARD_TEMPLATE_200GB') },
  { id: 'plan_300g', name: 'اشتراک 300 گیگابایت (1 ماهه)', price: 300000, trafficBytes: 300 * GB, durationDays: 30, templateId: envInt('PASARGUARD_TEMPLATE_300GB') },
  { id: 'plan_500g', name: 'اشتراک 500 گیگابایت (1 ماهه)', price: 450000, trafficBytes: 500 * GB, durationDays: 30, templateId: envInt('PASARGUARD_TEMPLATE_500GB') },
  { id: 'plan_1000g', name: 'اشتراک 1000 گیگابایت (1 ماهه)', price: 700000, trafficBytes: 1000 * GB, durationDays: 30, templateId: envInt('PASARGUARD_TEMPLATE_1000GB') }
];

function getPlan(id) { return plans.find((p) => p.id === id) || null; }
function customPlan(trafficGb, durationDays) {
  const traffic = Number(trafficGb);
  const days = Number(durationDays);
  if (!Number.isInteger(traffic) || traffic < 1 || traffic > 1000) return null;
  if (!Number.isInteger(days) || days < 1 || days > 150) return null;
  const price = traffic > 51 ? traffic * 3000 : traffic * 4000;
  return {
    id: `custom_${traffic}gb_${days}d`,
    name: `بسته سفارشی (${traffic} گیگابایت | ${days} روز)`,
    price,
    trafficBytes: traffic * GB,
    durationDays: days,
    templateId: envInt('PASARGUARD_TEMPLATE_CUSTOM'),
    custom: true
  };
}
function formatPrice(value) { return `${Number(value).toLocaleString('en-US')} تومان`; }
function durationSeconds(plan) { return plan.durationDays * DAY; }
module.exports = { plans, getPlan, customPlan, formatPrice, durationSeconds, GB };
