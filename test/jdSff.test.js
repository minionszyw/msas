const test = require('node:test');
const assert = require('node:assert/strict');
const { APIS, createJdSffClient } = require('../src/platforms/jdSff');

function createPage(respond = () => ({ code: 200, data: {} })) {
  const requests = [];
  return {
    requests,
    waitForFunction: async () => {},
    evaluate: async (_function, request) => {
      requests.push(request);
      const result = respond(request);
      return { status: result.status || 200, body: JSON.stringify(result) };
    },
  };
}

test('JD SFF client maps query filters without exposing or accepting DOM selectors', async () => {
  const page = createPage(() => ({ code: 200, data: { data: [] } }));
  const client = createJdSffClient(page);
  await client.ready();
  await client.queryProducts({
    productName: '药品',
    skuIds: ['101'],
    productIds: ['202'],
    itemNum: 'A-1',
    pageNum: 2,
    pageSize: 50,
  });

  const request = page.requests[0];
  assert.equal(request.api, APIS.queryProducts);
  assert.deepEqual(request.body.productListQueryReq.skuIdList, [101]);
  assert.deepEqual(request.body.productListQueryReq.productIdList, [202]);
  assert.equal(request.body.productListQueryReq.productName, '药品');
  assert.equal(request.body.productListQueryReq.itemNum, 'A-1');
  assert.equal(request.body.productListQueryReq.pageNum, 2);
  assert.equal(request.body.productListQueryReq.pageSize, 50);
});

test('JD SFF client builds captured status, stock, and price write payloads', async () => {
  const page = createPage();
  const client = createJdSffClient(page);
  const stocks = [
    { skuId: 11, stock: 8 },
    { skuId: 12, stock: 10 },
  ];
  await client.updateStatus(['100'], 'offline');
  await client.updateStocks('100', stocks, [{ skuId: '11', stock: 9 }]);
  await client.updatePrices('100', [{ skuId: '11', price: '6.20' }]);

  assert.deepEqual(page.requests[0].body.productStatusReq, {
    operation: 'down',
    skuGroups: [{ productId: 100 }],
    downReason: '',
  });
  assert.deepEqual(page.requests[1].body.batchUpdateStockNumParam, {
    updateStockNumParams: [
      { productId: 100, stockNum: 9, skuId: 11, addStockNum: 1 },
      { productId: 100, stockNum: 10, skuId: 12, addStockNum: null },
    ],
    updateStockModel: 'incrStockIn',
  });
  assert.deepEqual(page.requests[2].body.updatePriceQuery.updatePrices, [
    { productId: 100, skuId: 11, jdPrice: 6.2 },
  ]);
});

test('JD SFF client classifies login, risk, and general API failures', async () => {
  const login = createJdSffClient(createPage(() => ({ code: 401, msg: '请登录' })));
  const risk = createJdSffClient(createPage(() => ({ code: 601, msg: '未经京东授权的软件操作' })));
  const general = createJdSffClient(createPage(() => ({ code: 500, msg: '失败' })));

  await assert.rejects(() => login.queryProducts({}), (error) => error.code === 'loginRequired');
  await assert.rejects(() => risk.queryProducts({}), (error) => error.code === 'jdRiskBlocked');
  await assert.rejects(() => general.queryProducts({}), (error) => error.code === 'jdApiFailed');
});
