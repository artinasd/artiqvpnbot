const { createDynamicPasarGuardProvider } = require('./dynamic-pasarguard');
const { createArtiqMasterProvider } = require('./artiq-master-panel');
const panelRegistry = require('./panel-registry');

function createLazyPanelProvider(panelId) {
  let resolved = null;
  async function resolve() {
    if (!resolved) {
      const panel = await panelRegistry.getById(panelId);
      resolved = panel?.type === 'artiq_master'
        ? createArtiqMasterProvider(panelId)
        : createDynamicPasarGuardProvider(panelId);
    }
    return resolved;
  }
  return {
    health: (...args) => resolve().then((p) => p.health(...args)),
    getGroups: (...args) => resolve().then((p) => p.getGroups(...args)),
    findUserByUsername: (...args) => resolve().then((p) => p.findUserByUsername(...args)),
    createUser: (...args) => resolve().then((p) => p.createUser(...args)),
    getUserById: (...args) => resolve().then((p) => p.getUserById(...args)),
    updateUserById: (...args) => resolve().then((p) => p.updateUserById(...args)),
    deleteUserById: (...args) => resolve().then((p) => p.deleteUserById(...args)),
    disableUser: (...args) => resolve().then((p) => p.disableUser(...args)),
  };
}

function getProvider(providerId) {
  const id = String(providerId || '');
  if (id.startsWith('panel:')) return createLazyPanelProvider(id.slice('panel:'.length));
  if (id.startsWith('master:')) return require('./master-panel-fulfillment').createMasterPanelProvider(id.slice('master:'.length));
  throw new Error('UNSUPPORTED_PROVIDER');
}

module.exports = { getProvider };
