const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createAutomation, sanitizeStoreId, sanitizePlatform, normalizeStores } = require('../src/automationService');
const { createJdPlatform, responseHas601 } = require('../src/platforms/jdPlatform');

test('jd 601 detector handles transport, JSON code, and environment text', () => {
  assert.equal(responseHas601(601, '{"code":200}'), true);
  assert.equal(responseHas601(200, '{"code":601,"msg":"x"}'), true);
  assert.equal(responseHas601(200, '尊敬的商家您好，经识别您正在使用未经京东授权的软件操作'), true);
  assert.equal(responseHas601(200, '{"code":200,"msg":"成功"}'), false);
});

test('store ids and platforms are constrained', () => {
  assert.equal(sanitizeStoreId('shop_a-01'), 'shop_a-01');
  assert.throws(() => sanitizeStoreId('../bad'), /storeId/);
  assert.equal(sanitizePlatform('jd'), 'jd');
  assert.equal(sanitizePlatform('tb'), 'tb');
  assert.equal(sanitizePlatform('pdd'), 'pdd');
  assert.throws(() => sanitizePlatform('other'), /platform/);
});

test('stores are created through a generic API contract while storeId remains globally unique', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-platform-store-api-'));
  const automation = createAutomation({ rootDir: tmp, profilesDir: path.join(tmp, 'profiles'), storesFile: path.join(tmp, 'stores.json') });
  const a = automation.ensureStore('jd', 'shop_a', 'A');
  const b = automation.ensureStore('tb', 'shop_b', 'B');
  assert.equal(a.platform, 'jd');
  assert.equal(b.platform, 'tb');
  assert.equal(a.profileDir, path.join(tmp, 'profiles', 'shop_a'));
  assert.equal(b.profileDir, path.join(tmp, 'profiles', 'shop_b'));
  assert.equal(fs.existsSync(a.profileDir), true);
  assert.equal(fs.existsSync(b.profileDir), true);
  assert.deepEqual(automation.listStores('jd').map((s) => s.storeId), ['shop_a']);
  assert.deepEqual(automation.listStores('tb').map((s) => s.storeId), ['shop_b']);
  assert.throws(() => automation.ensureStore('pdd', 'shop_a', 'duplicate'), /already exists/);
});

test('legacy store records are normalized with current migration defaults', () => {
  const profilesDir = '/profiles';
  const stores = normalizeStores({ shop_a: { name: '店铺A' }, shop_b: { name: '店铺B' } }, profilesDir);
  assert.equal(stores.shop_a.platform, 'jd');
  assert.equal(stores.shop_b.platform, 'tb');
  assert.equal(stores.shop_a.profileDir, path.join(profilesDir, 'shop_a'));
});

test('placeholder platforms can be registered but not executed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-platform-store-api-'));
  const automation = createAutomation({ rootDir: tmp, profilesDir: path.join(tmp, 'profiles'), storesFile: path.join(tmp, 'stores.json') });
  automation.ensureStore('tb', 'shop_b', 'B');
  assert.throws(() => automation.startLogin('shop_b'), /not implemented/);
  assert.throws(() => automation.startAction('shop_b', 'query-601', { spuid: '123' }), /not implemented/);
});


test('jd query-601 requires spuid and records the caller supplied value in job metadata', () => {
  const platform = createJdPlatform();
  assert.throws(() => platform.validateActionPayload('query-601', {}), /spuid/);
  assert.throws(() => platform.validateActionPayload('query-601', { spuid: 'abc' }), /spuid/);
  assert.deepEqual(platform.validateActionPayload('query-601', { spuid: '998877' }), { spuid: '998877' });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-platform-store-api-'));
  const fakePlatform = {
    validateActionPayload: platform.validateActionPayload,
    createActionMetadata: platform.createActionMetadata,
    startAction: async () => ({ ok: true }),
    startLogin: async () => ({ ok: true }),
  };
  const automation = createAutomation({ rootDir: tmp, profilesDir: path.join(tmp, 'profiles'), storesFile: path.join(tmp, 'stores.json'), adapters: { jd: fakePlatform } });
  automation.ensureStore('jd', 'shop_a', 'A');
  assert.throws(() => automation.startAction('shop_a', 'query-601', {}), /spuid/);
  const job = automation.startAction('shop_a', 'query-601', { spuid: '998877' });
  assert.equal(job.metadata.spuid, '998877');
});
