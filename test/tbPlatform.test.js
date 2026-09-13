const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTbPlatform } = require('../src/platforms/tbPlatform');
const {
  createTableRequestData,
  extractMtopToken,
  mtopSign,
  summarizeQueryResponse,
} = require('../src/platforms/tbMtop');
const { validateItemIdPayload } = require('../src/platforms/platformUtils');

test('tb query helpers validate itemId and build stable signed requests', () => {
  assert.throws(() => validateItemIdPayload({}), /itemId/);
  assert.throws(() => validateItemIdPayload({ itemId: 'abc' }), /itemId/);
  assert.deepEqual(validateItemIdPayload({ itemId: 1073633522598 }), { itemId: '1073633522598' });
  const data = createTableRequestData('1073633522598');
  assert.equal(JSON.parse(JSON.parse(data).jsonBody).filter.queryItemId, '1073633522598');
  assert.equal(extractMtopToken([
    { name: '_m_h5_tk', domain: '.taobao.com', value: 'abc123_1789030000000' },
  ]), 'abc123');
  assert.equal(mtopSign('token', '123', '{"a":1}'), 'ca90935608e4270816002f0b46bb6590');
});

test('tb query retries after token bootstrap with browser fetch and no DOM locators', async () => {
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
          itemDesc: {
            desc: [{ text: '测试商品' }, { text: `ID:${itemId}` }],
            imgLink: { href: `https://item.taobao.com/item.htm?id=${itemId}` },
          },
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
      return cookieReads === 1
        ? []
        : [{ name: '_m_h5_tk', domain: '.taobao.com', value: 'token_1789030000000' }];
    },
    pages: () => [page],
    newPage: async () => page,
    addCookies: async () => {},
    storageState: async () => ({ cookies: [], origins: [] }),
    close: async () => { closed = true; },
  };
  const platform = createTbPlatform({ launchPersistentContext: async () => context });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-query-'));
  const profileDir = path.join(root, 'tb_a');
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'auth-state.json'), JSON.stringify({ cookies: [], origins: [] }));

  const result = await platform.actions['query-test'].run({ profileDir }, { itemId });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'api');
  assert.equal(result.itemFound, true);
  assert.equal(result.item.itemId, itemId);
  assert.equal(result.loginRequired, false);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].navigation, 'https://myseller.taobao.com/home.htm/SellManage/all');
  assert.equal(JSON.parse(JSON.parse(requests[2].requestData).jsonBody).filter.queryItemId, itemId);
  assert.equal(closed, true);
});

test('tb query summary distinguishes login and risk failures', () => {
  const login = summarizeQueryResponse([
    { status: 200, body: JSON.stringify({ ret: ['FAIL_SYS_SESSION_EXPIRED::登录失效'] }) },
  ], '123');
  const risk = summarizeQueryResponse([
    { status: 200, body: JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::需要安全验证'] }) },
  ], '123');

  assert.equal(login.ok, false);
  assert.equal(login.loginRequired, true);
  assert.equal(risk.ok, false);
  assert.equal(risk.riskCheck.detected, true);
});
