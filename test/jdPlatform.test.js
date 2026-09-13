const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJdPlatform } = require('../src/platforms/jdPlatform');

const PRODUCT_ID = '100';
const SKU_ID = '200';

function rawProduct(status = 'online') {
  return {
    productId: Number(PRODUCT_ID),
    productName: '测试商品',
    itemNum: 'A-1',
    stockNum: 8,
    modified: 1,
    productStatusVO: { productState: status === 'online' ? 4 : 6, statusDesc: status },
    productSkuInfoVO: { skuId: Number(SKU_ID), skuCount: 1 },
    priceDetailVO: { minJdPrice: 5.2, maxJdPrice: 5.2 },
    categoryDetailVO: { lastCategoryId: 9 },
    brandVO: { brandId: 10 },
  };
}

function createHarness(options = {}) {
  const state = {
    status: 'online',
    stock: 8,
    secondStock: 10,
    price: 5.2,
    calls: [],
  };
  const page = {
    goto: async () => {},
    url: () => 'https://wares-jdm.jd.com/ware/wareList',
    waitForTimeout: async () => {},
  };
  const context = {
    pages: () => [page],
    newPage: async () => page,
    storageState: async () => ({ cookies: [], origins: [] }),
    close: async () => {},
  };
  const client = {
    ready: async () => {},
    queryProducts: async () => ({
      data: [rawProduct(state.status)],
      pageNo: 1,
      pageSize: 10,
      totalCount: 1,
    }),
    getStocks: async () => [
      { skuId: Number(SKU_ID), skuName: '规格', outerId: 'X', stock: state.stock, totalStock: state.stock },
      ...(options.secondSku ? [{ skuId: 201, skuName: '规格2', outerId: 'Y', stock: state.secondStock, totalStock: state.secondStock }] : []),
    ],
    queryPrices: async () => [{ skuId: Number(SKU_ID), skuName: '规格', outerId: 'X', jdPrice: state.price }],
    updateStatus: async (ids, status) => {
      state.calls.push(['status', ids, status]);
      state.status = status;
    },
    updateStocks: async (_productId, _current, updates) => {
      state.calls.push(['stock', updates]);
      for (const update of updates) {
        if (update.skuId === SKU_ID && !options.ignoreStockWrites) state.stock = update.stock;
        if (update.skuId === '201' && !options.ignoreSecondStockWrite) state.secondStock = update.stock;
      }
    },
    updatePrices: async (_productId, updates) => {
      state.calls.push(['price', updates]);
      state.price = Number(updates[0].price);
    },
  };
  const platform = createJdPlatform({
    launchPersistentContext: async () => context,
    createClient: () => client,
    readbackDelayMs: 0,
    headed: false,
  });
  return { platform, state };
}

async function runAction(platform, name, payload) {
  const action = platform.actions[name];
  const normalized = action.validate(payload);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-action-'));
  return action.run({ profileDir }, normalized);
}

test('JD product query and query-test use only the API client', async () => {
  const { platform } = createHarness();
  const query = await runAction(platform, 'query-products', { productIds: PRODUCT_ID });
  const compatibility = await runAction(platform, 'query-test', { itemId: PRODUCT_ID });

  assert.equal(query.ok, true);
  assert.equal(query.products[0].productId, PRODUCT_ID);
  assert.equal(query.products[0].status, 'online');
  assert.equal(compatibility.itemFound, true);
  assert.equal(compatibility.mode, 'api');
});

test('JD status updates are idempotent and verified by API readback', async () => {
  const { platform, state } = createHarness();
  const changed = await runAction(platform, 'update-product-status', {
    productIds: PRODUCT_ID,
    status: 'offline',
  });
  const unchanged = await runAction(platform, 'update-product-status', {
    productIds: PRODUCT_ID,
    status: 'offline',
  });

  assert.equal(changed.verified, true);
  assert.deepEqual(changed.updated, [PRODUCT_ID]);
  assert.deepEqual(unchanged.unchanged, [PRODUCT_ID]);
  assert.equal(state.calls.filter(([type]) => type === 'status').length, 1);
});

test('JD stock and price updates validate ownership and return before/after values', async () => {
  const { platform, state } = createHarness();
  const stock = await runAction(platform, 'update-sku-stock', {
    productId: PRODUCT_ID,
    updates: [{ skuId: SKU_ID, stock: 9 }],
  });
  const price = await runAction(platform, 'update-sku-price', {
    productId: PRODUCT_ID,
    updates: [{ skuId: SKU_ID, price: '6.20' }],
  });

  assert.deepEqual(stock.before.map(({ stock: value }) => value), [8]);
  assert.deepEqual(stock.after.map(({ stock: value }) => value), [9]);
  assert.deepEqual(price.before.map(({ price: value }) => value), ['5.20']);
  assert.deepEqual(price.after.map(({ price: value }) => value), ['6.20']);
  assert.equal(stock.verified, true);
  assert.equal(price.verified, true);
  assert.equal(state.stock, 9);
  assert.equal(state.price, 6.2);
});

test('JD mutations fail verification when API readback does not contain the target value', async () => {
  const { platform } = createHarness({ ignoreStockWrites: true });
  const result = await runAction(platform, 'update-sku-stock', {
    productId: PRODUCT_ID,
    updates: [{ skuId: SKU_ID, stock: 9 }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.verified, false);
  assert.deepEqual(result.updated, []);
  assert.deepEqual(result.unchanged, []);
  assert.deepEqual(result.failed, [SKU_ID]);
});

test('JD batch mutation reports disjoint partial-success results after readback', async () => {
  const { platform } = createHarness({ secondSku: true, ignoreSecondStockWrite: true });
  const result = await runAction(platform, 'update-sku-stock', {
    productId: PRODUCT_ID,
    updates: [{ skuId: SKU_ID, stock: 9 }, { skuId: '201', stock: 11 }],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.updated, [SKU_ID]);
  assert.deepEqual(result.unchanged, []);
  assert.deepEqual(result.failed, ['201']);
  assert.equal(new Set([...result.updated, ...result.unchanged, ...result.failed]).size, 2);
});
