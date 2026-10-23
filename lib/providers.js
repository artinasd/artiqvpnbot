const { createDynamicPasarGuardProvider } = require('./dynamic-pasarguard');

function getProvider(providerId) {
  const id = String(providerId || '');
  if (id.startsWith('panel:')) return createDynamicPasarGuardProvider(id.slice('panel:'.length));
  throw new Error('UNSUPPORTED_PROVIDER');
}

module.exports = { getProvider };
