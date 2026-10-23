const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfiguredServicesWithPanels, getConfiguredServiceWithPanels, serviceButtonsWithPanels } = require('../lib/services');

const panels = [
  { id: 'west-1', name: 'Reseller West', type: 'pasarguard', status: 'active' },
  { id: 'pending-2', name: 'Pending Panel', type: 'pasarguard', status: 'pending' },
  { id: 'disabled-3', name: 'Disabled Panel', type: 'pasarguard', status: 'disabled' },
];

const options = { listPanels: async () => panels };

test('active registry panels become the only selectable services', async () => {
  const services = await getConfiguredServicesWithPanels({}, options);
  assert.equal(services.some((service) => ['tunnel', 'gaming', 'tunnel2', 'direct2'].includes(service.id)), false);
  const dynamic = services.find((service) => service.id === 'panel_west-1');
  assert.equal(dynamic.name, 'Reseller West');
  assert.equal(dynamic.panelId, 'west-1');
  assert.equal(dynamic.provider, 'panel:west-1');
  assert.equal(services.some((service) => service.id === 'panel_pending-2'), false);
  assert.equal(services.some((service) => service.id === 'panel_disabled-3'), false);
});

test('dynamic panel can be resolved by stable panel ID and yields purchase/test buttons', async () => {
  const service = await getConfiguredServiceWithPanels('panel_west-1', {}, options);
  assert.equal(service.provider, 'panel:west-1');
  const purchase = await serviceButtonsWithPanels('service_buy_', {}, 'purchase', options);
  const trial = await serviceButtonsWithPanels('service_test_', {}, 'test', options);
  assert.ok(purchase.flat().some((button) => button.callback_data === 'service_buy_panel_west-1'));
  assert.ok(trial.flat().some((button) => button.callback_data === 'service_test_panel_west-1'));
});

test('renaming a panel does not change its generated service ID', async () => {
  const renamed = await getConfiguredServiceWithPanels('panel_west-1', {}, {
    listPanels: async () => [{ ...panels[0], name: 'West Updated' }],
  });
  assert.equal(renamed.id, 'panel_west-1');
  assert.equal(renamed.name, 'West Updated');
});
