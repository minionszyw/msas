const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAutomation } = require('../src/automationService');
const { createApp } = require('../src/server');

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('gateway keeps public routes while hiding internal profile paths and validating login timeouts', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msas-server-'));
  const adapter = {
    platform: 'jd',
    startLogin: async () => ({ ok: true }),
    closeSession: async () => false,
    actions: {},
  };
  const automation = createAutomation({ rootDir, adapters: { jd: adapter } });
  const app = createApp({ automation, headed: true });

  await withServer(app, async (baseUrl) => {
    const createdResponse = await fetch(`${baseUrl}/stores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storeId: 'shop_a', name: 'A', platform: 'jd' }),
    });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);
    assert.equal(created.store.profileDir, undefined);

    const loginResponse = await fetch(`${baseUrl}/stores/shop_a/login/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeoutMs: 0 }),
    });
    const login = await loginResponse.json();
    assert.equal(loginResponse.status, 400);
    assert.equal(login.error.code, 'invalidTimeoutMs');

    const healthResponse = await fetch(`${baseUrl}/health`);
    const health = await healthResponse.json();
    assert.deepEqual(health.platforms, ['jd', 'tb', 'pdd']);

    const sessionResponse = await fetch(`${baseUrl}/stores/shop_a/session`);
    const session = await sessionResponse.json();
    assert.equal(session.session.state, 'closed');
    assert.equal(session.session.storeId, 'shop_a');

    const closeResponse = await fetch(`${baseUrl}/stores/shop_a/session`, { method: 'DELETE' });
    assert.equal(closeResponse.status, 202);

    const invalidBatchResponse = await fetch(`${baseUrl}/stores/shop_a/actions/batch/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [] }),
    });
    const invalidBatch = await invalidBatchResponse.json();
    assert.equal(invalidBatchResponse.status, 400);
    assert.equal(invalidBatch.error.code, 'invalidBatch');
  });
});
