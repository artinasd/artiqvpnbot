const tunnel = require('./pasarguard');
const gaming = require('./pasarguard-panel2');
const direct = require('./pasarguard-direct');

function getProvider(providerId) {
  if (providerId === 'pasarguard-panel2') return gaming;
  if (providerId === 'pasarguard-direct') return direct;
  return tunnel;
}

module.exports = { getProvider };