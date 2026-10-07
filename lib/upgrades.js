const { GIB } = require('./plans');

const UPGRADES = Object.freeze([
  {
    id: 'upg_10g',
    name: 'افزایش 10 گیگابایت',
    price: 35000,
    resellerPrice: 30000,
    currency: 'IRR',
    addedTrafficBytes: 10 * GIB,
    addedDurationDays: 0,
  },
  {
    id: 'upg_50g',
    name: 'افزایش 50 گیگابایت',
    price: 120000,
    resellerPrice: 100000,
    currency: 'IRR',
    addedTrafficBytes: 50 * GIB,
    addedDurationDays: 0,
  },
  {
    id: 'upg_100g',
    name: 'افزایش 100 گیگابایت',
    price: 200000,
    resellerPrice: 170000,
    currency: 'IRR',
    addedTrafficBytes: 100 * GIB,
    addedDurationDays: 0,
  },
  {
    id: 'upg_30d',
    name: 'تمدید 30 روز زمان',
    price: 60000,
    resellerPrice: 50000,
    currency: 'IRR',
    addedTrafficBytes: 0,
    addedDurationDays: 30,
  },
  {
    id: 'upg_50g_30d',
    name: 'افزایش 50 گیگ و 30 روز',
    price: 150000,
    resellerPrice: 130000,
    currency: 'IRR',
    addedTrafficBytes: 50 * GIB,
    addedDurationDays: 30,
  },
  {
    id: 'upg_unlimited',
    name: 'تبدیل به زمان نامحدود',
    price: 500000,
    resellerPrice: 450000,
    currency: 'IRR',
    addedTrafficBytes: 0,
    addedDurationDays: null,
    type: 'to_unlimited'
  }
]);

function getUpgrade(id) {
  return UPGRADES.find((u) => u.id === id) || null;
}

function applyResellerUpgradePrice(upgrade, isReseller) {
  if (!isReseller || upgrade.resellerPrice == null) return upgrade;
  return { ...upgrade, price: upgrade.resellerPrice, originalPrice: upgrade.price, resellerPriceApplied: true };
}

module.exports = { UPGRADES, getUpgrade, applyResellerUpgradePrice };
