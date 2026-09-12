const test = require('node:test');
const assert = require('node:assert/strict');
const { responseHas601, summarizeQuery } = require('../src/platforms/jdPlatform');

test('jd 601 detector handles transport, JSON, and environment messages without generic number matches', () => {
  assert.equal(responseHas601(601, '{"code":200}'), true);
  assert.equal(responseHas601(200, '{"code":601,"msg":"x"}'), true);
  assert.equal(responseHas601(200, '尊敬的商家您好，经识别您正在使用未经京东授权的软件操作'), true);
  assert.equal(responseHas601(200, '商品 601 正常展示'), false);
});

test('jd query summaries require a successful target API response and reject 601 signals', () => {
  const ok = summarizeQuery([{
    status: 200,
    url: 'https://sff.jd.com/api?api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList',
    body: '{"code":200,"data":["998877"]}',
  }], '', '998877');
  const blocked = summarizeQuery([{
    status: 200,
    url: 'https://sff.jd.com/api?api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList',
    body: '{"code":601,"msg":"网络环境较差"}',
  }], '', '998877');

  assert.equal(ok.ok, true);
  assert.equal(ok.hit601, false);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.hit601, true);
});
