const { makeError } = require('../errors');

const MAX_CODE_COUNT = 100;
const MAX_PRICE = 999999999.99;

function invalid(message, code) {
  throw makeError(message, 400, code);
}

function normalizeCode(value, name) {
  const code = String(value ?? '').trim();
  if (!/^\d+$/.test(code)) invalid(`${name} must contain numeric strings`, `invalid${name}`);
  const number = Number(code);
  if (!Number.isSafeInteger(number)) invalid(`${name} exceeds the safe integer range`, `invalid${name}`);
  return code;
}

function normalizeCodeList(value, name, options = {}) {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value : String(value).split(/[\s,]+/);
  const codes = [...new Set(values.filter((entry) => String(entry).trim()).map((entry) => (
    normalizeCode(entry, name)
  )))];
  if (!codes.length && options.required) invalid(`${name} is required`, `invalid${name}`);
  if (codes.length > MAX_CODE_COUNT) invalid(`${name} supports at most ${MAX_CODE_COUNT} values`, `tooMany${name}`);
  return codes;
}

function normalizePage(value, fallback, name, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    invalid(`${name} must be an integer between 1 and ${maximum}`, `invalid${name}`);
  }
  return number;
}

function validateProductQueryPayload(payload = {}) {
  const productName = String(payload.productName || '').trim();
  const skuIds = normalizeCodeList(payload.skuIds, 'SkuIds');
  const productIds = normalizeCodeList(payload.productIds, 'ProductIds');
  const itemNum = String(payload.itemNum || '').trim();
  if (!productName && !skuIds.length && !productIds.length && !itemNum) {
    invalid('at least one product query condition is required', 'missingQueryCondition');
  }
  return {
    productName: productName || undefined,
    skuIds,
    productIds,
    itemNum: itemNum || undefined,
    pageNum: normalizePage(payload.pageNum, 1, 'pageNum', Number.MAX_SAFE_INTEGER),
    pageSize: normalizePage(payload.pageSize, 10, 'pageSize', 100),
  };
}

function validateProductStatusPayload(payload = {}) {
  const productIds = normalizeCodeList(payload.productIds, 'ProductIds', { required: true });
  if (!['online', 'offline'].includes(payload.status)) {
    invalid('status must be online or offline', 'invalidProductStatus');
  }
  return { productIds, status: payload.status };
}

function validateUpdates(payload, valueName, normalizeValue) {
  const productId = normalizeCode(payload && payload.productId, 'ProductId');
  if (!Array.isArray(payload.updates) || !payload.updates.length) {
    invalid('updates must be a non-empty array', 'invalidUpdates');
  }
  if (payload.updates.length > MAX_CODE_COUNT) {
    invalid(`updates supports at most ${MAX_CODE_COUNT} values`, 'tooManyUpdates');
  }
  const seen = new Set();
  const updates = payload.updates.map((update) => {
    const skuId = normalizeCode(update && update.skuId, 'SkuId');
    if (seen.has(skuId)) invalid('updates contains duplicate skuId values', 'duplicateSkuId');
    seen.add(skuId);
    return { skuId, [valueName]: normalizeValue(update && update[valueName]) };
  });
  return { productId, updates };
}

function validateStockPayload(payload = {}) {
  return validateUpdates(payload, 'stock', (value) => {
    const stock = Number(value);
    if (!Number.isSafeInteger(stock) || stock < 0) {
      invalid('stock must be a non-negative safe integer', 'invalidStock');
    }
    return stock;
  });
}

function validatePricePayload(payload = {}) {
  return validateUpdates(payload, 'price', (value) => {
    const text = String(value ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) invalid('price must have at most two decimal places', 'invalidPrice');
    const price = Number(text);
    if (!Number.isFinite(price) || price < 0.01 || price > MAX_PRICE) {
      invalid(`price must be between 0.01 and ${MAX_PRICE}`, 'invalidPrice');
    }
    return price.toFixed(2);
  });
}

function createAction(validate, metadata, run) {
  return { validate, metadata, run };
}

function createProductQueryAction(run) {
  return createAction(
    validateProductQueryPayload,
    ({ productName, skuIds, productIds, itemNum, pageNum, pageSize }) => ({
      productName,
      skuIds,
      productIds,
      itemNum,
      pageNum,
      pageSize,
    }),
    run,
  );
}

function createProductStatusAction(run) {
  return createAction(
    validateProductStatusPayload,
    ({ productIds, status }) => ({ productIds, status }),
    run,
  );
}

function createSkuStockAction(run) {
  return createAction(
    validateStockPayload,
    ({ productId, updates }) => ({ productId, skuIds: updates.map(({ skuId }) => skuId) }),
    run,
  );
}

function createSkuPriceAction(run) {
  return createAction(
    validatePricePayload,
    ({ productId, updates }) => ({ productId, skuIds: updates.map(({ skuId }) => skuId) }),
    run,
  );
}

module.exports = {
  createProductQueryAction,
  createProductStatusAction,
  createSkuPriceAction,
  createSkuStockAction,
  normalizeCodeList,
  validatePricePayload,
  validateProductQueryPayload,
  validateProductStatusPayload,
  validateStockPayload,
};
