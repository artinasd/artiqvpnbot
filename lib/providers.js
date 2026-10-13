const tunnel = require('./pasarguard');
const gaming = require('./pasarguard-panel2');
const tunnel2 = require('./pasarguard-tunnel2');
const direct2 = require('./pasarguard-direct2');

function getProvider(providerId) {
  if (providerId === 'pasarguard-panel2') return gaming;
  if (providerId === 'pasarguard-tunnel2') return tunnel2;
  if (providerId === 'pasarguard-direct2') return direct2;
  return tunnel;
}

module.exports = { getProvider };
