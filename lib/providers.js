const tunnel = require('./pasarguard');
const gaming = require('./pasarguard-panel2');

function getProvider(providerId) {
  if (providerId === 'pasarguard-panel2') return gaming;
  return tunnel;
}

module.exports = { getProvider };
