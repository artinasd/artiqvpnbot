const tunnel = require('./pasarguard');
const gaming = require('./pasarguard-panel2');
const direct = require('./pasarguard-direct');
const tunnel2 = require('./pasarguard-tunnel2');

function getProvider(providerId) {
  if (providerId === 'pasarguard-panel2') return gaming;
  if (providerId === 'pasarguard-direct') return direct;
  if (providerId === 'pasarguard-tunnel2') return tunnel2;
  return tunnel;
}

module.exports = { getProvider };