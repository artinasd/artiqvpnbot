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



test('disabled panels are excluded from new selection while legacy service IDs remain absent', async () => {
  const disabledOptions = { listPanels: async () => [{ ...panels[0], status: 'disabled' }] };
  const services = await getConfiguredServicesWithPanels({}, disabledOptions);
  assert.deepEqual(services, []);
  assert.equal((await serviceButtonsWithPanels('service_buy_', {}, 'purchase', disabledOptions)).length, 0);
  assert.equal((await serviceButtonsWithPanels('service_test_', {}, 'test', disabledOptions)).length, 0);
});


test('active master panels become purchase services but never test services', async () => {
  const masterPanels = [
    ...panels,
    { id: 'master-1', name: 'West + East', type: 'master', status: 'active', panelAId: 'west-1', panelBId: 'east-1' },
    { id: 'east-1', name: 'Reseller East', type: 'pasarguard', status: 'active' },
  ];
  const options = { listPanels: async () => masterPanels };
  const service = await getConfiguredServiceWithPanels('master_master-1', {}, options);
  assert.equal(service.provider, 'master:master-1');
  assert.equal(service.testEnabled, false);
  assert.ok((await serviceButtonsWithPanels('service_buy_', {}, 'purchase', options)).flat().some((button) => button.callback_data === 'service_buy_master_master-1'));
  assert.equal((await serviceButtonsWithPanels('service_test_', {}, 'test', options)).flat().some((button) => button.callback_data === 'service_test_master_master-1'), false);
});
