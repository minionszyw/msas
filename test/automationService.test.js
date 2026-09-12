const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createAutomation, sanitizeStoreId, sanitizePlatform, normalizeStores } = require('../src/automationService');
const { createJdPlatform, responseHas601 } = require('../src/platforms/jdPlatform');
const {
  createTbPlatform,
  createTableRequestData,
  extractMtopToken,
  mtopSign,
  summarizeQueryResponse,
  validateQueryTestPayload: validateTbQueryTestPayload,
} = require('../src/platforms/tbPlatform');

function createFakePage(finalUrl, options = {}) {
  return {
    goto: async (url) => {
      if (options.onGoto) options.onGoto(url);
    },
    waitForTimeout: async () => {},
    title: async () => options.title || '',
    url: () => finalUrl,
  };
}

function createFakeContext(page, onClose = () => {}) {
  return {
    pages: () => [page],
    newPage: async () => page,
    storageState: async (options = {}) => {
      const state = { cookies: [{ name: 'session', value: 'saved', domain: '.taobao.com', path: '/' }], origins: [] };
      if (options.path) {
        fs.mkdirSync(path.dirname(options.path), { recursive: true });
        fs.writeFileSync(options.path, JSON.stringify(state));
      }
      return state;
    },
    addCookies: async () => {},
    close: async () => onClose(),
  };
}

test('jd 601 detector handles transport, JSON code, and environment text', () => {
  assert.equal(responseHas601(601, '{"code":200}'), true);
  assert.equal(responseHas601(200, '{"code":601,"msg":"x"}'), true);
  assert.equal(responseHas601(200, '尊敬的商家您好，经识别您正在使用未经京东授权的软件操作'), true);
  assert.equal(responseHas601(200, '{"code":200,"msg":"成功"}'), false);
});

test('jd login closes headed context then verifies the same profile headlessly', async () => {
  const launches = [];
  const closes = [];
  const visitedUrls = [];
  const contexts = [
    createFakeContext(createFakePage('https://shop.jd.com/jdm/home', { title: '京麦商家PC端', onGoto: (url) => visitedUrls.push(url) }), () => closes.push('login')),
    createFakeContext(createFakePage('https://shop.jd.com/jdm/home', { title: '京麦商家PC端', onGoto: (url) => visitedUrls.push(url) }), () => closes.push('verify')),
  ];
  const platform = createJdPlatform({
    headed: true,
    launchPersistentContext: async (profileDir, options) => {
      launches.push({ profileDir, options });
      return contexts.shift();
    },
  });

  const result = await platform.startLogin({ profileDir: '/profiles/shop_a' }, { timeoutMs: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.loginPageOk, true);
  assert.equal(result.reuseCheck.ok, true);
  assert.deepEqual(closes, ['login', 'verify']);
  assert.equal(launches[0].options.headless, false);
  assert.equal(launches[1].options.headless, true);
  assert.equal(launches[0].profileDir, launches[1].profileDir);
  assert.deepEqual(visitedUrls, [
    'https://passport.shop.jd.com/login/index.action/jdm',
    'https://shop.jd.com/jdm/home',
  ]);
});

test('jd login reports an expired or unavailable saved login state', async () => {
  const contexts = [
    createFakeContext(createFakePage('https://shop.jd.com/jdm/home')),
    createFakeContext(createFakePage('https://passport.shop.jd.com/login/index.action/jdm')),
  ];
  const platform = createJdPlatform({ launchPersistentContext: async () => contexts.shift() });

  const result = await platform.startLogin({ profileDir: '/profiles/shop_a' }, { timeoutMs: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.loginPageOk, true);
  assert.equal(result.reuseCheck.ok, false);
  assert.equal(result.reuseCheck.loginRequired, true);
});

test('jd login captures reuse verification errors', async () => {
  let launchCount = 0;
  const platform = createJdPlatform({
    launchPersistentContext: async () => {
      launchCount += 1;
      if (launchCount === 2) throw new Error('verification launch failed');
      return createFakeContext(createFakePage('https://shop.jd.com/jdm/home'));
    },
  });

  const result = await platform.startLogin({ profileDir: '/profiles/shop_a' }, { timeoutMs: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.reuseCheck.loginRequired, null);
  assert.match(result.reuseCheck.error, /verification launch failed/);
});

test('jd login skips reuse verification when manual login does not reach home', async () => {
  let launchCount = 0;
  const platform = createJdPlatform({
    launchPersistentContext: async () => {
      launchCount += 1;
      return createFakeContext(createFakePage('https://passport.shop.jd.com/login/index.action/jdm'));
    },
  });

  const result = await platform.startLogin({ profileDir: '/profiles/shop_a' }, { timeoutMs: 0 });

  assert.equal(result.ok, false);
  assert.equal(result.loginPageOk, false);
  assert.equal(result.reuseCheck, null);
  assert.equal(launchCount, 1);
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

test('pdd can be registered but not executed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-platform-store-api-'));
  const automation = createAutomation({ rootDir: tmp, profilesDir: path.join(tmp, 'profiles'), storesFile: path.join(tmp, 'stores.json') });
  automation.ensureStore('pdd', 'shop_pdd', 'PDD');
  assert.throws(() => automation.startLogin('shop_pdd'), /not implemented/);
  assert.throws(() => automation.startAction('shop_pdd', 'query-test', { itemId: '123' }), /not implemented/);
});


test('jd query-test requires itemId and records the caller supplied value in job metadata', () => {
  const platform = createJdPlatform();
  assert.throws(() => platform.validateActionPayload('query-test', {}), /itemId/);
  assert.throws(() => platform.validateActionPayload('query-test', { itemId: 'abc' }), /itemId/);
  assert.deepEqual(platform.validateActionPayload('query-test', { itemId: '998877' }), { itemId: '998877' });
  assert.throws(() => platform.validateActionPayload('query-601', { itemId: '998877' }), /not supported/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-platform-store-api-'));
  const fakePlatform = {
    validateActionPayload: platform.validateActionPayload,
    createActionMetadata: platform.createActionMetadata,
    startAction: async () => ({ ok: true }),
    startLogin: async () => ({ ok: true }),
  };
  const automation = createAutomation({ rootDir: tmp, profilesDir: path.join(tmp, 'profiles'), storesFile: path.join(tmp, 'stores.json'), adapters: { jd: fakePlatform } });
  automation.ensureStore('jd', 'shop_a', 'A');
  assert.throws(() => automation.startAction('shop_a', 'query-test', {}), /itemId/);
  const job = automation.startAction('shop_a', 'query-test', { itemId: '998877' });
  assert.equal(job.metadata.itemId, '998877');
});

test('tb login closes headed context then verifies the same profile headlessly', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-login-'));
  const profileDir = path.join(tmp, 'tb_a');
  const launches = [];
  const closes = [];
  const visitedUrls = [];
  const contexts = [
    createFakeContext(createFakePage('https://myseller.taobao.com/home.htm/QnworkbenchHome/', { title: '千牛商家工作台', onGoto: (url) => visitedUrls.push(url) }), () => closes.push('login')),
    createFakeContext(createFakePage('https://myseller.taobao.com/home.htm/QnworkbenchHome/', { title: '千牛商家工作台', onGoto: (url) => visitedUrls.push(url) }), () => closes.push('verify')),
  ];
  const platform = createTbPlatform({
    headed: true,
    launchPersistentContext: async (profileDir, options) => {
      launches.push({ profileDir, options });
      return contexts.shift();
    },
  });

  const result = await platform.startLogin({ profileDir }, { timeoutMs: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.loginPageOk, true);
  assert.equal(result.reuseCheck.ok, true);
  assert.deepEqual(closes, ['login', 'verify']);
  assert.equal(launches[0].options.headless, false);
  assert.equal(launches[1].options.headless, true);
  assert.equal(launches[0].profileDir, launches[1].profileDir);
  assert.deepEqual(visitedUrls, [
    'https://loginmyseller.taobao.com/',
    'https://myseller.taobao.com/home.htm/QnworkbenchHome/',
  ]);
});

test('tb query helpers validate itemId and build stable signed requests', () => {
  assert.throws(() => validateTbQueryTestPayload({}), /itemId/);
  assert.throws(() => validateTbQueryTestPayload({ itemId: 'abc' }), /itemId/);
  assert.deepEqual(validateTbQueryTestPayload({ itemId: 1073633522598 }), { itemId: '1073633522598' });
  const data = createTableRequestData('1073633522598');
  assert.equal(JSON.parse(JSON.parse(data).jsonBody).filter.queryItemId, '1073633522598');
  assert.equal(extractMtopToken([{ name: '_m_h5_tk', domain: '.taobao.com', value: 'abc123_1789030000000' }]), 'abc123');
  assert.equal(mtopSign('token', '123', '{"a":1}'), 'ca90935608e4270816002f0b46bb6590');
});

test('tb query-test retries after token bootstrap with browser fetch and no DOM locators', async () => {
  const itemId = '1073633522598';
  const requests = [];
  let cookieReads = 0;
  let closed = false;
  const inner = {
    success: true,
    data: {
      table: {
        dataSource: [{
          itemId,
          itemDesc: { desc: [{ text: '测试商品' }, { text: `ID:${itemId}` }], imgLink: { href: `https://item.taobao.com/item.htm?id=${itemId}` } },
          managerPrice: { currentPrice: '¥ 19.80' },
          managerQuantityNew: { text: 10 },
          monthlySoldQuantity: { value: '0' },
          upShelfDate_m: { value: '2026-08-12 22:21', status: { text: '出售中' } },
        }],
      },
      pagination: { total: 1 },
    },
  };
  const responses = [
    { ret: ['FAIL_SYS_TOKEN_EMPTY::令牌为空'] },
    { ret: ['SUCCESS::调用成功'], data: { result: JSON.stringify(inner) } },
  ];
  const page = {
    goto: async (url) => requests.push({ navigation: url }),
    waitForTimeout: async () => {},
    url: () => 'https://myseller.taobao.com/home.htm/SellManage/all',
    title: async () => '我的商品',
    evaluate: async (_callback, input) => {
      requests.push(input);
      return { status: 200, body: JSON.stringify(responses.shift()) };
    },
  };
  const context = {
    cookies: async () => {
      cookieReads += 1;
      return cookieReads === 1 ? [] : [{ name: '_m_h5_tk', domain: '.taobao.com', value: 'token_1789030000000' }];
    },
    pages: () => [page],
    newPage: async () => page,
    addCookies: async () => {},
    close: async () => { closed = true; },
  };
  const platform = createTbPlatform({ launchPersistentContext: async () => context });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-query-'));
  const profileDir = path.join(tmp, 'tb_a');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'auth-state.json'), JSON.stringify({ cookies: [] }));

  const result = await platform.startAction('query-test', { profileDir }, { itemId });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'api');
  assert.equal(result.itemFound, true);
  assert.equal(result.item.itemId, itemId);
  assert.equal(result.item.status, '出售中');
  assert.equal(result.loginRequired, false);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].navigation, 'https://myseller.taobao.com/home.htm/SellManage/all');
  assert.equal(JSON.parse(JSON.parse(requests[2].requestData).jsonBody).filter.queryItemId, itemId);
  assert.equal(closed, true);
});

test('tb query summary distinguishes login and risk failures', () => {
  const login = summarizeQueryResponse([
    { event: 'response', status: 200, body: JSON.stringify({ ret: ['FAIL_SYS_SESSION_EXPIRED::登录失效'] }) },
  ], '1073633522598');
  const risk = summarizeQueryResponse([
    { event: 'response', status: 200, body: JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::需要安全验证'] }) },
  ], '1073633522598');

  assert.equal(login.ok, false);
  assert.equal(login.loginRequired, true);
  assert.equal(risk.ok, false);
  assert.equal(risk.riskCheck.detected, true);
});
