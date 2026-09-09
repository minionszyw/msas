const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createAutomation, responseHas601, sanitizeStoreId } = require('../src/jdAutomation');

test('responseHas601 detects transport, JSON code, and JD environment text', () => {
  assert.equal(responseHas601(601, '{"code":200}'), true);
  assert.equal(responseHas601(200, '{"code":601,"msg":"x"}'), true);
  assert.equal(responseHas601(200, '尊敬的商家您好，经识别您正在使用未经京东授权的软件操作'), true);
  assert.equal(responseHas601(200, '{"code":200,"msg":"成功"}'), false);
});

test('store ids are constrained to safe profile directory names', () => {
  assert.equal(sanitizeStoreId('shop_a-01'), 'shop_a-01');
  assert.throws(() => sanitizeStoreId('../bad'), /storeId/);
});

test('ensureStore creates independent profile directories', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-stealth-store-api-'));
  const automation = createAutomation({ rootDir: tmp, profilesDir: path.join(tmp, 'profiles'), storesFile: path.join(tmp, 'stores.json') });
  const a = automation.ensureStore('shop_a', 'A');
  const b = automation.ensureStore('shop_b', 'B');
  assert.notEqual(a.profileDir, b.profileDir);
  assert.equal(fs.existsSync(a.profileDir), true);
  assert.equal(fs.existsSync(b.profileDir), true);
});
