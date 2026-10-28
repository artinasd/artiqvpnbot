const { createDynamicPasarGuardProvider } = require('./dynamic-pasarguard');

function getProvider(providerId) {
  const id = String(providerId || '');
  if (id.startsWith('panel:')) return createDynamicPasarGuardProvider(id.slice('panel:'.length));
  if (id.startsWith('master:')) return require('./master-panel-fulfillment').createMasterPanelProvider(id.slice('master:'.length));
  throw new Error('UNSUPPORTED_PROVIDER');
}

module.exports = { getProvider };
