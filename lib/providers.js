const tunnel = require('./pasarguard');
const gaming = require('./pasarguard-panel2');
const direct = require('./pasarguard-direct');
const direct2 = require('./pasarguard-tunnel2');

function getProvider(providerId) {
  if (providerId === 'pasarguard-panel2') return gaming;
  if (providerId === 'pasarguard-direct') return direct;
  if (providerId === 'pasarguard-direct2') return direct2;
  // Keep the old identifier working for existing saved configurations.
  if (providerId === 'pasarguard-tunnel2') return direct2;
  return tunnel;
}

module.exports = { getProvider };
