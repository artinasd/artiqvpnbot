const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  validatePanelInput, encryptSecret, decryptSecret, createPanelRegistry,
} = require('../lib/panel-registry');

const key = crypto.randomBytes(32);
const valid = { name: 'Reseller West', type: 'pasarguard', baseUrl: 'https://panel.example.com/', credentials: { username: 'panel-admin', password: 'secret-api-token' } };

test('panel input accepts HTTPS URLs and normalizes trailing slash', () => {
  assert.equal(validatePanelInput(valid).baseUrl, 'https://panel.example.com');
});

test('panel input rejects unsupported types and unsafe URL forms', () => {
  assert.throws(() => validatePanelInput({ ...valid, type: 'other' }), /UNSUPPORTED_PANEL_TYPE/);
  assert.throws(() => validatePanelInput({ ...valid, baseUrl: 'http://panel.example.com' }), /INVALID_PANEL_URL/);
  assert.throws(() => validatePanelInput({ ...valid, baseUrl: 'https://127.0.0.1' }), /PANEL_URL_HOST_NOT_ALLOWED/);
  assert.throws(() => validatePanelInput({ ...valid, baseUrl: 'https://user:pass@panel.example.com' }), /INVALID_PANEL_URL/);
});

test('credential envelope encrypts and authenticates secrets', () => {
  const envelope = encryptSecret('token-value', key);
  assert.notEqual(envelope.ciphertext, Buffer.from('token-value').toString('base64'));
  assert.equal(decryptSecret(envelope, key), 'token-value');
  assert.throws(() => decryptSecret(envelope, crypto.randomBytes(32)), /PANEL_CREDENTIAL_DECRYPTION_FAILED/);
});

test('registry saves stable IDs, hides credentials from list responses, and preserves status on edits', async () => {
  let stored = null;
  const registry = createPanelRegistry({
    get: async () => stored,
    set: async (_key, value) => { stored = structuredClone(value); return 'OK'; },
    encryptionKey: key,
  });
  const created = await registry.save(valid);
  assert.ok(created.id);
  assert.equal(created.hasCredentials, true);
  assert.equal('credentials' in created, false);
  assert.equal((await registry.list()).length, 1);
  assert.equal('credentials' in (await registry.list())[0], false);
  assert.deepEqual(await registry.getCredentials(created.id), { username: 'panel-admin', password: 'secret-api-token' });

  await registry.setStatus(created.id, 'active');
  const edited = await registry.save({ ...valid, id: created.id, name: 'Renamed panel', credentials: '' });
  assert.equal(edited.id, created.id);
  assert.equal(edited.name, 'Renamed panel');
  assert.equal(edited.status, 'active');
  assert.deepEqual(await registry.getCredentials(created.id), { username: 'panel-admin', password: 'secret-api-token' });
});

test('registry rejects duplicate IDs only by updating the existing record and rejects missing credentials', async () => {
  let stored = [];
  const registry = createPanelRegistry({
    get: async () => stored,
    set: async (_key, value) => { stored = structuredClone(value); return 'OK'; },
    encryptionKey: key,
  });
  await assert.rejects(registry.save({ name: 'No token', type: 'pasarguard', baseUrl: 'https://panel.example.com' }), /PANEL_CREDENTIAL_REQUIRED/);
  const one = await registry.save(valid);
  const two = await registry.save({ ...valid, id: one.id, name: 'Updated name' });
  assert.equal(two.id, one.id);
  assert.equal(stored.length, 1);
});


test('editing with an unknown explicit panel ID is rejected instead of creating that ID', async () => {
  let stored = [];
  const registry = createPanelRegistry({
    get: async () => stored,
    set: async (_key, value) => { stored = structuredClone(value); return 'OK'; },
    encryptionKey: key,
  });
  const created = await registry.save(valid);
  await assert.rejects(
    registry.save({ ...valid, id: 'does-not-exist', name: 'Accidental overwrite' }),
    /PANEL_NOT_FOUND/,
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, created.id);
  assert.equal(stored[0].name, 'Reseller West');
});

test('panel URL validation rejects local hostnames and accepts only HTTPS without URL credentials', () => {
  for (const baseUrl of [
    'http://panel.example.com',
    'https://localhost',
    'https://node.local',
    'https://inside.localhost',
    'https://user:pass@panel.example.com',
    'https://panel.example.com/?token=x',
    'https://panel.example.com/#fragment',
  ]) {
    assert.throws(() => validatePanelInput({ ...valid, baseUrl }), /INVALID_PANEL_URL|PANEL_URL_HOST_NOT_ALLOWED/);
  }
});
