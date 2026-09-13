const { makeError } = require('../errors');
const { createLaunchContext } = require('./browserContext');
const { createJdSffClient } = require('./jdSff');
const { createManualLoginFlow } = require('./loginFlow');
const {
  createProductQueryAction,
  createProductStatusAction,
  createSkuPriceAction,
  createSkuStockAction,
} = require('./productActions');
const { createQueryTestAction } = require('./platformUtils');
const { restoreAuthState, saveAuthState } = require('./profileAuthState');

const LOGIN_URL = 'https://passport.shop.jd.com/login/index.action/jdm';
const HOME_URL = 'https://shop.jd.com/jdm/home';
const WARE_LIST_URL = 'https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0';
const READBACK_ATTEMPTS = 3;
const READBACK_DELAY_MS = 1500;

function productState(product) {
  const state = product && product.productStatusVO && Number(product.productStatusVO.productState);
  if (state === 4) return 'online';
  if (state === 6) return 'offline';
  return 'other';
}

function normalizeProduct(product = {}) {
  const skuInfo = product.productSkuInfoVO || {};
  const price = product.priceDetailVO || {};
  return {
    productId: product.productId === undefined ? undefined : String(product.productId),
    productName: product.productName,
    itemNum: product.itemNum,
    status: productState(product),
    statusDescription: product.productStatusVO && product.productStatusVO.statusDesc,
    stock: product.stockNum,
    minPrice: price.minJdPrice,
    maxPrice: price.maxJdPrice,
    skuCount: skuInfo.skuCount,
    primarySkuId: skuInfo.skuId === undefined ? undefined : String(skuInfo.skuId),
    modified: product.modified,
  };
}

function productPage(data) {
  const rows = data && Array.isArray(data.data) ? data.data : [];
  return {
    rows,
    pageNum: Number((data && data.pageNo) || 1),
    pageSize: Number((data && data.pageSize) || rows.length),
    total: Number((data && data.totalCount) || 0),
  };
}

function normalizeStock(stock = {}) {
  return {
    skuId: stock.skuId === undefined ? undefined : String(stock.skuId),
    skuName: stock.skuName,
    merchantSkuId: stock.outerId,
    stock: Number(stock.stock),
    totalStock: Number(stock.totalStock),
  };
}

function normalizePrice(price = {}) {
  return {
    skuId: price.skuId === undefined ? undefined : String(price.skuId),
    skuName: price.skuName,
    merchantSkuId: price.outerId,
    price: Number(price.jdPrice).toFixed(2),
  };
}

function createJdPlatform(options = {}) {
  const launchContext = createLaunchContext(options);
  const createClient = options.createClient || createJdSffClient;
  const readbackDelayMs = options.readbackDelayMs ?? READBACK_DELAY_MS;
  const startLogin = createManualLoginFlow({
    launchContext,
    loginUrl: LOGIN_URL,
    homeUrl: HOME_URL,
    saveState: saveAuthState,
    restoreState: restoreAuthState,
  });

  async function withClient(store, run) {
    const context = await launchContext(store);
    try {
      const page = context.pages()[0] || await context.newPage();
      let restored = false;

      async function openClient() {
        await page.goto(WARE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (/passport\.shop\.jd\.com/.test(page.url()) && !restored && await restoreAuthState(context, store)) {
          restored = true;
          await page.goto(WARE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        }
        if (/passport\.shop\.jd\.com/.test(page.url())) {
          throw makeError('JD login state expired; run login/start again', 401, 'loginRequired');
        }
        const client = createClient(page);
        await client.ready();
        return client;
      }

      let client = await openClient();
      let result;
      try {
        result = await run(client, page);
      } catch (error) {
        if (error.code !== 'loginRequired' || restored || !await restoreAuthState(context, store)) throw error;
        restored = true;
        client = await openClient();
        result = await run(client, page);
      }
      await saveAuthState(context, store);
      return result;
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function queryExactProducts(client, productIds) {
    const data = await client.queryProducts({ productIds, pageNum: 1, pageSize: 100 });
    return productPage(data).rows;
  }

  function requireProduct(rows, productId) {
    const product = rows.find((row) => String(row.productId) === productId);
    if (!product) throw makeError(`product ${productId} not found`, 404, 'productNotFound');
    return product;
  }

  async function poll(page, read, verify) {
    let value;
    for (let attempt = 0; attempt < READBACK_ATTEMPTS; attempt += 1) {
      value = await read();
      if (verify(value)) return { verified: true, value };
      if (attempt + 1 < READBACK_ATTEMPTS && readbackDelayMs > 0) await page.waitForTimeout(readbackDelayMs);
    }
    return { verified: false, value };
  }

  async function runProductQuery(store, payload) {
    return withClient(store, async (client) => {
      const page = productPage(await client.queryProducts(payload));
      return {
        ok: true,
        mode: 'api',
        filters: {
          productName: payload.productName,
          skuIds: payload.skuIds,
          productIds: payload.productIds,
          itemNum: payload.itemNum,
        },
        pageNum: page.pageNum,
        pageSize: page.pageSize,
        total: page.total,
        products: page.rows.map(normalizeProduct),
        loginRequired: false,
        riskCheck: { detected: false },
      };
    });
  }

  async function runQueryTest(store, { itemId }) {
    try {
      const result = await runProductQuery(store, {
        productIds: [itemId],
        skuIds: [],
        pageNum: 1,
        pageSize: 10,
      });
      return {
        ok: result.ok,
        hit601: false,
        itemId,
        itemFound: result.products.some((product) => product.productId === itemId),
        products: result.products,
        loginRequired: false,
        mode: 'api',
      };
    } catch (error) {
      if (error.code === 'loginRequired' || error.code === 'jdRiskBlocked') {
        return {
          ok: false,
          hit601: error.code === 'jdRiskBlocked',
          itemId,
          itemFound: false,
          products: [],
          loginRequired: error.code === 'loginRequired',
          mode: 'api',
        };
      }
      throw error;
    }
  }

  async function runStatusUpdate(store, payload) {
    return withClient(store, async (client, page) => {
      const beforeRows = await queryExactProducts(client, payload.productIds);
      const beforeById = new Map(beforeRows.map((product) => [String(product.productId), product]));
      const missing = payload.productIds.filter((productId) => !beforeById.has(productId));
      if (missing.length) throw makeError(`products not found: ${missing.join(', ')}`, 404, 'productNotFound');
      const unchanged = payload.productIds.filter((productId) => productState(beforeById.get(productId)) === payload.status);
      const pending = payload.productIds.filter((productId) => !unchanged.includes(productId));
      if (pending.length) await client.updateStatus(pending, payload.status);
      const readback = await poll(
        page,
        () => queryExactProducts(client, payload.productIds),
        (rows) => payload.productIds.every((productId) => {
          const product = rows.find((row) => String(row.productId) === productId);
          return product && productState(product) === payload.status;
        }),
      );
      const afterById = new Map(readback.value.map((product) => [String(product.productId), product]));
      const failed = payload.productIds.filter((productId) => productState(afterById.get(productId)) !== payload.status);
      return {
        ok: readback.verified,
        mode: 'api',
        status: payload.status,
        updated: pending.filter((productId) => !failed.includes(productId)),
        unchanged: unchanged.filter((productId) => !failed.includes(productId)),
        failed,
        before: payload.productIds.map((productId) => normalizeProduct(beforeById.get(productId))),
        after: payload.productIds.map((productId) => (
          afterById.has(productId) ? normalizeProduct(afterById.get(productId)) : null
        )),
        verified: readback.verified,
      };
    });
  }

  async function runStockUpdate(store, payload) {
    return withClient(store, async (client, page) => {
      requireProduct(await queryExactProducts(client, [payload.productId]), payload.productId);
      const current = await client.getStocks(payload.productId);
      const beforeBySku = new Map(current.map((stock) => [String(stock.skuId), stock]));
      const missing = payload.updates.filter(({ skuId }) => !beforeBySku.has(skuId)).map(({ skuId }) => skuId);
      if (missing.length) {
        throw makeError(`SKUs not found in product ${payload.productId}: ${missing.join(', ')}`, 404, 'skuNotFound');
      }
      const pending = payload.updates.filter(({ skuId, stock }) => Number(beforeBySku.get(skuId).stock) !== stock);
      if (pending.length) await client.updateStocks(payload.productId, current, pending);
      const targets = new Map(payload.updates.map(({ skuId, stock }) => [skuId, stock]));
      const readback = await poll(
        page,
        () => client.getStocks(payload.productId),
        (stocks) => [...targets].every(([skuId, target]) => {
          const stock = stocks.find((entry) => String(entry.skuId) === skuId);
          return stock && Number(stock.stock) === target;
        }),
      );
      return mutationResult(payload, pending, beforeBySku, readback, normalizeStock, 'stock');
    });
  }

  async function runPriceUpdate(store, payload) {
    return withClient(store, async (client, page) => {
      const product = requireProduct(await queryExactProducts(client, [payload.productId]), payload.productId);
      const current = await client.queryPrices(product);
      const beforeBySku = new Map(current.map((price) => [String(price.skuId), price]));
      const missing = payload.updates.filter(({ skuId }) => !beforeBySku.has(skuId)).map(({ skuId }) => skuId);
      if (missing.length) {
        throw makeError(`SKUs not found in product ${payload.productId}: ${missing.join(', ')}`, 404, 'skuNotFound');
      }
      const pending = payload.updates.filter(({ skuId, price }) => Number(beforeBySku.get(skuId).jdPrice) !== Number(price));
      if (pending.length) await client.updatePrices(payload.productId, pending);
      const targets = new Map(payload.updates.map(({ skuId, price }) => [skuId, Number(price)]));
      const readback = await poll(
        page,
        () => client.queryPrices(product),
        (prices) => [...targets].every(([skuId, target]) => {
          const price = prices.find((entry) => String(entry.skuId) === skuId);
          return price && Number(price.jdPrice) === target;
        }),
      );
      return mutationResult(payload, pending, beforeBySku, readback, normalizePrice, 'jdPrice');
    });
  }

  function mutationResult(payload, pending, beforeBySku, readback, normalize, sourceField) {
    const afterBySku = new Map(readback.value.map((value) => [String(value.skuId), value]));
    const payloadField = sourceField === 'jdPrice' ? 'price' : 'stock';
    const failed = payload.updates.filter((update) => (
      Number(afterBySku.get(update.skuId) && afterBySku.get(update.skuId)[sourceField])
        !== Number(update[payloadField])
    )).map(({ skuId }) => skuId);
    const pendingIds = pending.map(({ skuId }) => skuId);
    return {
      ok: readback.verified,
      mode: 'api',
      productId: payload.productId,
      updated: pendingIds.filter((skuId) => !failed.includes(skuId)),
      unchanged: payload.updates
        .map(({ skuId }) => skuId)
        .filter((skuId) => !pendingIds.includes(skuId) && !failed.includes(skuId)),
      failed,
      before: payload.updates.map(({ skuId }) => normalize(beforeBySku.get(skuId))),
      after: payload.updates.map(({ skuId }) => (
        afterBySku.has(skuId) ? normalize(afterBySku.get(skuId)) : null
      )),
      verified: readback.verified,
    };
  }

  return {
    platform: 'jd',
    startLogin,
    actions: {
      'query-test': createQueryTestAction(runQueryTest),
      'query-products': createProductQueryAction(runProductQuery),
      'update-product-status': createProductStatusAction(runStatusUpdate),
      'update-sku-stock': createSkuStockAction(runStockUpdate),
      'update-sku-price': createSkuPriceAction(runPriceUpdate),
    },
  };
}

module.exports = {
  createJdPlatform,
  normalizePrice,
  normalizeProduct,
  normalizeStock,
  productPage,
  productState,
};
