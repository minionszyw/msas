const { makeError } = require('../errors');
const { parseJsonMaybe } = require('./platformUtils');

const SFF_ORIGIN = 'https://sff.jd.com';
const SFF_APP_ID = '3MC69M4R3HFKCQ4S01DN';
const SFF_SIGN_APP_ID = '0248a';
const SFF_VERSION = '1.0';
const REQUEST_TIMEOUT_MS = 30000;

const APIS = Object.freeze({
  queryProducts: 'dsm.product.manage.ProductInfoReadViewService.queryValidProductList',
  getStocks: 'dsm.wareshopv2.ware.wareListService.getSkuStockV2',
  queryPrices: 'dsm.product.manage.PriceReadViewService.querySkuPrice',
  updateStatus: 'dsm.product.manage.ProductStatusUpdateViewService.updateProductStatus',
  updateStocks: 'dsm.wareshopv2.ware.stockService.batchUpdateStockNum',
  updatePrices: 'dsm.product.manage.PriceWriteViewService.updatePrices',
});

function accessContext(stock = false) {
  return {
    source: 'web',
    businessModel: '0',
    proxyBelongBizId: '',
    ...(stock ? { belongType: 1, accountType: 1 } : {}),
    originType: null,
  };
}

function jdNumber(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw makeError(`${name} exceeds the safe integer range`, 400, `invalid${name}`);
  return number;
}

function responseError(api, response) {
  const json = parseJsonMaybe(response.body || '');
  const code = json && Number(json.code);
  const message = String((json && (json.msg || json.message)) || `JD API ${api} failed`);
  if (response.status === 601 || code === 601 || code === 312 || /未经京东授权|网络环境较差/.test(message)) {
    return makeError(`JD API security check failed (${code || response.status})`, 502, 'jdRiskBlocked');
  }
  if ([401, 403].includes(Number(response.status))
    || [401, 403].includes(code)
    || /登录|授权|login|auth/i.test(message)) {
    return makeError('JD login state expired; run login/start again', 401, 'loginRequired');
  }
  return makeError(`JD API ${api} failed: ${message}`, 502, 'jdApiFailed');
}

function protocolError(api) {
  return makeError(`JD API ${api} returned an invalid response`, 502, 'jdProtocolInvalid');
}

function unwrap(api, response, validateData = () => true) {
  const json = parseJsonMaybe(response.body || '');
  if (response.status === 200 && !json) throw protocolError(api);
  if (response.status !== 200 || !json || Number(json.code) !== 200) throw responseError(api, response);
  if (!validateData(json.data)) throw protocolError(api);
  return json.data;
}

function withTimeout(operation, timeoutMs) {
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(makeError('JD API request timed out', 504, 'jdApiTimeout')), timeoutMs);
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timeout));
}

function createJdSffClient(page, options = {}) {
  const requestTimeoutMs = options.requestTimeoutMs || REQUEST_TIMEOUT_MS;

  async function ready() {
    try {
      await page.waitForFunction(() => (
        typeof window.ParamsSign === 'function'
        && window.CryptoJS
        && typeof window.getJsToken === 'function'
      ), null, { timeout: REQUEST_TIMEOUT_MS });
    } catch (_) {
      throw makeError('JD security SDK is unavailable', 502, 'jdProtocolInvalid');
    }
  }

  async function call(api, body, validateData) {
    let response;
    try {
      response = await withTimeout(page.evaluate(async (request) => {
        const controller = new AbortController();
        const abortTimer = window.setTimeout(() => controller.abort(), request.timeoutMs);
        try {
          const data = JSON.stringify(request.body);
          const hash = window.CryptoJS.SHA256(data).toString().toUpperCase();
          const signer = new window.ParamsSign({
            appId: request.signAppId,
            preRequest: false,
            debug: false,
            onSign() {},
          });
          const signed = await signer.sign({
            body: hash,
            appId: request.appId,
            api: request.api,
            v: request.version,
          });
          const eid = await new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
              if (settled) return;
              settled = true;
              resolve(value || '');
            };
            try {
              window.getJsToken((result) => finish(result && result.jsToken), 1000);
              window.setTimeout(() => finish(''), 1500);
            } catch (_) {
              finish('');
            }
          });
          const url = `${request.origin}/api?v=${request.version}&appId=${request.appId}&api=${encodeURIComponent(request.api)}`;
          const result = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              'dsm-eid': eid,
              'dsm-platform': 'pc',
              h5st: encodeURI((signed && signed.h5st) || ''),
              'x-requested-with': 'XMLHttpRequest',
            },
            body: data,
            signal: controller.signal,
          });
          return { status: result.status, body: await result.text() };
        } finally {
          window.clearTimeout(abortTimer);
        }
      }, {
        api,
        body,
        origin: SFF_ORIGIN,
        appId: SFF_APP_ID,
        signAppId: SFF_SIGN_APP_ID,
        version: SFF_VERSION,
        timeoutMs: requestTimeoutMs,
      }), requestTimeoutMs);
    } catch (error) {
      if (error.code === 'jdApiTimeout' || /AbortError|aborted/i.test(error.message || '')) {
        throw makeError('JD API request timed out', 504, 'jdApiTimeout');
      }
      throw makeError('JD API request could not be completed', 502, 'jdApiFailed');
    }
    return unwrap(api, response, validateData);
  }

  function queryProducts(filters) {
    return call(APIS.queryProducts, {
      productListQueryReq: {
        productName: filters.productName || null,
        skuIdList: filters.skuIds && filters.skuIds.length ? filters.skuIds.map((id) => jdNumber(id, 'SkuId')) : null,
        categoryIdList: null,
        productIdList: filters.productIds && filters.productIds.length
          ? filters.productIds.map((id) => jdNumber(id, 'ProductId'))
          : null,
        salesVolume: null,
        jdPrice: null,
        shopCategory: null,
        stockNum: null,
        brandIdList: [],
        itemNum: filters.itemNum || null,
        productState: '11',
        modified: null,
        productType: null,
        startOnlineTime: null,
        endOnlineTime: null,
        startOfflineTime: null,
        endOfflineTime: null,
        startCreated: null,
        endCreated: null,
        startModified: null,
        endModified: null,
        categoryIds: [],
        minSalesVolume: null,
        maxSalesVolume: null,
        minJdPrice: null,
        maxJdPrice: null,
        minStockNum: null,
        maxStockNum: null,
        supplyProductIdList: null,
        supplySkuIdList: null,
        supplyIdList: null,
        sortMap: { modified: 'desc' },
        pageNum: filters.pageNum || 1,
        pageSize: filters.pageSize || 10,
      },
      accessContext: accessContext(),
    }, (data) => data && typeof data === 'object' && Array.isArray(data.data));
  }

  function getStocks(productId) {
    return call(APIS.getStocks, {
      accessContext: accessContext(true),
      skuStockListQuery: { wareId: jdNumber(productId, 'ProductId'), channelType: 0 },
    }, Array.isArray);
  }

  function queryPrices(product) {
    const categoryId = product.categoryDetailVO && product.categoryDetailVO.lastCategoryId;
    const brandId = product.brandVO && product.brandVO.brandId;
    return call(APIS.queryPrices, {
      req: {
        skuPriceQueries: [{
          lastCategoryId: categoryId,
          productId: jdNumber(product.productId, 'ProductId'),
          brandId,
          skuIds: [],
          categoryId,
          productType: null,
        }],
      },
      accessContext: accessContext(),
    }, Array.isArray);
  }

  function updateStatus(productIds, status) {
    return call(APIS.updateStatus, {
      productStatusReq: {
        operation: status === 'online' ? 'up' : 'down',
        skuGroups: productIds.map((productId) => ({ productId: jdNumber(productId, 'ProductId') })),
        ...(status === 'offline' ? { downReason: '' } : {}),
      },
      accessContext: accessContext(),
    });
  }

  function updateStocks(productId, currentStocks, updates) {
    const targetBySku = new Map(updates.map((update) => [update.skuId, update.stock]));
    return call(APIS.updateStocks, {
      accessContext: accessContext(true),
      updateStockNumParams: [],
      batchUpdateStockNumParam: {
        updateStockNumParams: currentStocks.map((stock) => {
          const skuId = String(stock.skuId);
          const target = targetBySku.has(skuId) ? targetBySku.get(skuId) : Number(stock.stock);
          const delta = target - Number(stock.stock);
          return {
            productId: jdNumber(productId, 'ProductId'),
            stockNum: target,
            skuId: jdNumber(skuId, 'SkuId'),
            addStockNum: delta || null,
          };
        }),
        updateStockModel: 'incrStockIn',
      },
    });
  }

  function updatePrices(productId, updates) {
    return call(APIS.updatePrices, {
      updatePriceQuery: {
        updatePrices: updates.map(({ skuId, price }) => ({
          productId: jdNumber(productId, 'ProductId'),
          skuId: jdNumber(skuId, 'SkuId'),
          jdPrice: Number(price),
        })),
      },
      accessContext: accessContext(),
    });
  }

  return { ready, queryProducts, getStocks, queryPrices, updateStatus, updateStocks, updatePrices };
}

module.exports = { APIS, createJdSffClient };
