const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validatePricePayload,
  validateProductQueryPayload,
  validateProductStatusPayload,
  validateStockPayload,
} = require('../src/platforms/productActions');

test('product queries normalize delimited codes, remove duplicates, and require a condition', () => {
  assert.deepEqual(validateProductQueryPayload({
    productName: ' 药品 ',
    productIds: '123, 456 123',
    skuIds: ['789', 101],
    pageSize: 50,
  }), {
    productName: '药品',
    productIds: ['123', '456'],
    skuIds: ['789', '101'],
    itemNum: undefined,
    pageNum: 1,
    pageSize: 50,
  });
  assert.throws(() => validateProductQueryPayload({}), (error) => error.code === 'missingQueryCondition');
  assert.throws(
    () => validateProductQueryPayload({ productIds: Array.from({ length: 101 }, (_, index) => String(index + 1)) }),
    /at most 100/,
  );
  assert.throws(() => validateProductQueryPayload({ skuIds: '123 bad' }), /numeric strings/);
});

test('status, stock, and price payloads enforce idempotent absolute values', () => {
  assert.deepEqual(validateProductStatusPayload({ productIds: '123 456', status: 'offline' }), {
    productIds: ['123', '456'],
    status: 'offline',
  });
  assert.deepEqual(validateStockPayload({
    productId: '123',
    updates: [{ skuId: '456', stock: 8 }],
  }), {
    productId: '123',
    updates: [{ skuId: '456', stock: 8 }],
  });
  assert.deepEqual(validatePricePayload({
    productId: '123',
    updates: [{ skuId: '456', price: '8.5' }],
  }), {
    productId: '123',
    updates: [{ skuId: '456', price: '8.50' }],
  });
  assert.throws(() => validateProductStatusPayload({ productIds: ['1'], status: 'paused' }), /online or offline/);
  assert.throws(() => validateStockPayload({ productId: '1', updates: [{ skuId: '2', stock: -1 }] }), /non-negative/);
  assert.throws(() => validatePricePayload({ productId: '1', updates: [{ skuId: '2', price: '1.234' }] }), /decimal/);
  assert.throws(() => validateStockPayload({
    productId: '1',
    updates: [{ skuId: '2', stock: 1 }, { skuId: '2', stock: 2 }],
  }), /duplicate/);
});
