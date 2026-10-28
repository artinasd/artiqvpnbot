const test = require('node:test');
const assert = require('node:assert/strict');
const { createMasterPanelRegistry, KEY, LEGACY_KEY } = require('../lib/master-panel-registry');

test('legacy master entries migrate into independent storage without losing fields', async () => {
  const store = new Map([[LEGACY_KEY, [
    { id: 'master-old', name: 'Old Master', type: 'master', panelAId: 'a-panel', panelBId: 'b-panel', status: 'active', createdAt: 'yesterday' },
    { id: 'a-panel', name: 'A', type: 'pasarguard', status: 'active' },
  ]]]);
  const registry = createMasterPanelRegistry({
    get: async (key) => store.get(key) || null,
    set: async (key, value) => { store.set(key, structuredClone(value)); return 'OK'; },
    listSourcePanels: async () => [],
  });
  const masters = await registry.list();
  assert.equal(masters.length, 1);
  assert.equal(masters[0].id, 'master-old');
  assert.equal(masters[0].createdAt, 'yesterday');
  assert.deepEqual(store.get(LEGACY_KEY).map((panel) => panel.id), ['a-panel']);
  assert.equal(store.get(KEY)[0].panelBId, 'b-panel');
});

test('master registry validates distinct active PasarGuard sources', async () => {
  const store = new Map();
  const sources = [
    { id: 'a-panel', type: 'pasarguard', status: 'active' },
    { id: 'b-panel', type: 'pasarguard', status: 'active' },
  ];
  const registry = createMasterPanelRegistry({
    get: async (key) => store.get(key) || null,
    set: async (key, value) => { store.set(key, structuredClone(value)); return 'OK'; },
    listSourcePanels: async () => sources,
  });
  await assert.rejects(registry.save({ name: 'Bad', panelAId: 'a-panel', panelBId: 'a-panel' }), /MASTER_PANEL_REQUIRES_TWO_DISTINCT_PANELS/);
  const master = await registry.save({ name: 'Combined', panelAId: 'a-panel', panelBId: 'b-panel' });
  assert.equal(master.type, 'master');
  assert.equal(master.status, 'pending');
  assert.equal(master.panelAId, 'a-panel');
});
