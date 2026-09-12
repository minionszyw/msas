const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAutomation } = require('../src/automationService');
const { createQueryTestAction } = require('../src/platforms/platformUtils');
const { createPlatformAdapters } = require('../src/platforms/registry');
const { sanitizePlatform, sanitizeStoreId } = require('../src/storeRepository');

function createTempOptions(prefix = 'msas-') {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    rootDir,
    profilesDir: path.join(rootDir, 'profiles'),
    storesFile: path.join(rootDir, 'stores.json'),
  };
}

function createFakeAdapter(run = async () => ({ ok: true })) {
  return {
    platform: 'jd',
    startLogin: async () => ({ ok: true }),
    actions: { 'query-test': createQueryTestAction(run) },
  };
}

async function waitForJob(automation, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = automation.getJob(jobId);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`job ${jobId} did not finish`);
}

test('store ids and platforms use the shared registry constraints', () => {
  assert.equal(sanitizeStoreId('shop_a-01'), 'shop_a-01');
  assert.throws(() => sanitizeStoreId('../bad'), /storeId/);
  assert.equal(sanitizePlatform('jd'), 'jd');
  assert.equal(sanitizePlatform('tb'), 'tb');
  assert.equal(sanitizePlatform('pdd'), 'pdd');
  assert.throws(() => sanitizePlatform('other'), /platform/);

  const adapters = createPlatformAdapters({ headed: false });
  assert.deepEqual([...adapters.keys()], ['jd', 'tb']);
  assert.equal(adapters.get('jd').platform, 'jd');
  assert.equal(adapters.get('tb').platform, 'tb');
});

test('stores persist only portable public fields while profiles remain internal', () => {
  const options = createTempOptions();
  const automation = createAutomation({ ...options, adapters: { jd: createFakeAdapter() } });
  const store = automation.ensureStore('jd', 'shop_a', 'A');

  assert.equal(store.platform, 'jd');
  assert.equal(store.profileDir, undefined);
  assert.equal(fs.existsSync(path.join(options.profilesDir, 'shop_a')), true);
  const persisted = JSON.parse(fs.readFileSync(options.storesFile, 'utf8'));
  assert.equal(persisted.shop_a.profileDir, undefined);
  assert.equal(persisted.shop_a.name, 'A');
});

test('legacy stores are normalized once and relocated under the configured profiles directory', () => {
  const options = createTempOptions();
  fs.writeFileSync(options.storesFile, JSON.stringify({
    shop_b: { name: '店铺B', profileDir: '/stale/profiles/shop_b' },
  }));

  const automation = createAutomation({ ...options, adapters: {} });
  assert.equal(automation.getStore('shop_b').platform, 'tb');
  assert.equal(automation.getStore('shop_b').profileDir, undefined);
  const persisted = JSON.parse(fs.readFileSync(options.storesFile, 'utf8'));
  assert.equal(persisted.shop_b.platform, 'tb');
  assert.equal(persisted.shop_b.profileDir, undefined);
});

test('a malformed stores file fails explicitly instead of becoming empty data', () => {
  const options = createTempOptions();
  fs.writeFileSync(options.storesFile, '{invalid');
  assert.throws(
    () => createAutomation({ ...options, adapters: {} }),
    (error) => error.code === 'invalidStoresFile',
  );

  fs.writeFileSync(options.storesFile, JSON.stringify({ shop_a: 'invalid' }));
  assert.throws(
    () => createAutomation({ ...options, adapters: {} }),
    (error) => error.code === 'invalidStoresFile',
  );

  fs.writeFileSync(options.storesFile, JSON.stringify({ shop_a: { platform: 'unknown' } }));
  assert.throws(
    () => createAutomation({ ...options, adapters: {} }),
    (error) => error.code === 'invalidStoresFile',
  );
});

test('storeId remains globally unique and pdd stays registration-only', () => {
  const options = createTempOptions();
  const automation = createAutomation({ ...options, adapters: { jd: createFakeAdapter() } });
  automation.ensureStore('jd', 'shared', 'A');
  assert.throws(() => automation.ensureStore('tb', 'shared', 'B'), /already exists/);
  automation.ensureStore('pdd', 'shop_pdd', 'PDD');
  assert.throws(() => automation.startLogin('shop_pdd'), /not implemented/);
  assert.throws(() => automation.startAction('shop_pdd', 'query-test', { itemId: '123' }), /not implemented/);
});

test('query actions validate once and expose normalized metadata', async () => {
  const options = createTempOptions();
  let validationCount = 0;
  let receivedPayload;
  const action = createQueryTestAction(async (_store, payload) => {
    receivedPayload = payload;
    return { ok: true };
  });
  const validate = action.validate;
  action.validate = (payload) => {
    validationCount += 1;
    return validate(payload);
  };
  const automation = createAutomation({
    ...options,
    adapters: { jd: { platform: 'jd', startLogin: async () => ({}), actions: { 'query-test': action } } },
  });
  automation.ensureStore('jd', 'shop_a', 'A');

  assert.throws(() => automation.startAction('shop_a', 'query-test', {}), /itemId/);
  const queued = automation.startAction('shop_a', 'query-test', { itemId: 998877 });
  assert.deepEqual(queued.metadata, { action: 'query-test', itemId: '998877' });
  const finished = await waitForJob(automation, queued.id);
  assert.equal(finished.status, 'succeeded');
  assert.equal(validationCount, 2);
  assert.deepEqual(receivedPayload, { itemId: '998877' });
  assert.throws(() => automation.startAction('shop_a', 'query-601', { itemId: '1' }), /not supported/);
  assert.throws(() => automation.startAction('shop_a', 'toString', { itemId: '1' }), /not supported/);
});

test('login timeout is bounded and job failures do not expose stacks', async () => {
  const options = createTempOptions();
  const adapter = createFakeAdapter(async () => {
    const error = new Error('query failed');
    error.code = 'queryFailed';
    throw error;
  });
  const automation = createAutomation({ ...options, adapters: { jd: adapter } });
  automation.ensureStore('jd', 'shop_a', 'A');

  assert.throws(() => automation.startLogin('shop_a', { timeoutMs: 0 }), (error) => error.code === 'invalidTimeoutMs');
  assert.throws(() => automation.startLogin('shop_a', { timeoutMs: 3600001 }), /timeoutMs/);
  const queued = automation.startAction('shop_a', 'query-test', { itemId: '123' });
  const failed = await waitForJob(automation, queued.id);
  assert.deepEqual(failed.error, { message: 'query failed', code: 'queryFailed' });
  assert.equal('stack' in failed.error, false);
});
