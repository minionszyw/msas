const crypto = require('crypto');
const { parseJsonMaybe } = require('./platformUtils');

const QUERY_API_NAME = 'mtop.taobao.sell.pc.manage.async';
const QUERY_API_ORIGIN = 'https://h5api.m.taobao.com';
const MTOP_APP_KEY = '12574478';
const MTOP_TTID = '11320@taobao_WEB_9.9.99';

function parseInnerResult(outer) {
  const result = outer && outer.data && outer.data.result;
  if (typeof result === 'string') return parseJsonMaybe(result);
  return result && typeof result === 'object' ? result : null;
}

function outerMtopSucceeded(outer) {
  return Array.isArray(outer && outer.ret) && outer.ret.some((value) => String(value).includes('SUCCESS'));
}

function normalizeTbItem(row = {}) {
  const descriptions = row.itemDesc && Array.isArray(row.itemDesc.desc) ? row.itemDesc.desc : [];
  const titleNode = descriptions.find((entry) => entry && entry.text && !String(entry.text).startsWith('ID:'))
    || descriptions[0]
    || {};
  return {
    itemId: row.itemId ? String(row.itemId) : undefined,
    catId: row.catId,
    title: titleNode.text,
    itemUrl: row.itemDesc && row.itemDesc.imgLink && row.itemDesc.imgLink.href,
    price: row.managerPrice && row.managerPrice.currentPrice,
    quantity: row.managerQuantityNew && row.managerQuantityNew.text,
    monthlySoldQuantity: row.monthlySoldQuantity && row.monthlySoldQuantity.value,
    status: row.upShelfDate_m && row.upShelfDate_m.status && row.upShelfDate_m.status.text,
    createdTime: row.upShelfDate_m && row.upShelfDate_m.value,
  };
}

function summarizeQueryResponse(records, itemId) {
  const parsedResponses = records.map((record) => {
    const outer = parseJsonMaybe(record.body || '');
    const inner = parseInnerResult(outer);
    const table = inner && inner.data && inner.data.table;
    const pagination = inner && inner.data && inner.data.pagination;
    const rows = table && Array.isArray(table.dataSource) ? table.dataSource : [];
    const matchedRow = rows.find((row) => String(row.itemId) === itemId);
    return {
      httpStatus: record.status,
      outerRet: outer && outer.ret,
      outerSuccess: outerMtopSucceeded(outer),
      innerSuccess: Boolean(inner && inner.success === true),
      total: pagination && Number(pagination.total),
      rowsCount: rows.length,
      matched: Boolean(matchedRow),
      item: matchedRow ? normalizeTbItem(matchedRow) : null,
    };
  });
  const successful = [...parsedResponses].reverse().find((response) => (
    response.httpStatus === 200 && response.outerSuccess && response.innerSuccess
  ));
  const matched = [...parsedResponses].reverse().find((response) => response.matched);
  const finalResponse = parsedResponses[parsedResponses.length - 1] || {};
  const finalRet = JSON.stringify(finalResponse.outerRet || []);
  const loginRequired = !successful && /SESSION|TOKEN|LOGIN|AUTH|登录|令牌/i.test(finalRet);
  const riskDetected = !successful && /RGV|USER_VALIDATE|SECURITY|CAPTCHA|风控|验证/i.test(finalRet);
  return {
    ok: Boolean(successful),
    itemFound: Boolean(matched),
    itemId,
    total: matched ? matched.total : (successful && successful.total),
    item: matched ? matched.item : null,
    loginRequired,
    riskCheck: { detected: riskDetected, ret: finalResponse.outerRet || [] },
    queryResponseCount: parsedResponses.length,
    queryResponses: parsedResponses,
  };
}

function createTableRequestData(itemId) {
  return JSON.stringify({
    url: '/taobao/manager/table.htm',
    jsonBody: JSON.stringify({
      tab: 'all',
      pagination: { current: 1, pageSize: 20 },
      filtertab: '',
      filter: { queryItemId: itemId },
      table: {},
    }),
  });
}

function extractMtopToken(cookies = []) {
  const cookie = cookies.find((entry) => (
    entry.name === '_m_h5_tk'
      && /taobao\.com$/.test(String(entry.domain || '').replace(/^\./, ''))
  ));
  return cookie && cookie.value ? String(cookie.value).split('_')[0] : null;
}

function mtopSign(token, timestamp, data) {
  return crypto.createHash('md5').update(`${token}&${timestamp}&${MTOP_APP_KEY}&${data}`).digest('hex');
}

function createMtopUrl(timestamp, sign) {
  const params = new URLSearchParams({
    jsv: '2.6.1',
    appKey: MTOP_APP_KEY,
    t: timestamp,
    sign,
    api: QUERY_API_NAME,
    v: '1.0',
    ttid: MTOP_TTID,
    type: 'originaljson',
    dataType: 'json',
  });
  return `${QUERY_API_ORIGIN}/h5/${QUERY_API_NAME}/1.0/?${params.toString()}`;
}

function tokenRefreshRequired(outer) {
  const ret = JSON.stringify((outer && outer.ret) || []);
  return !outerMtopSucceeded(outer) && /TOKEN|SESSION|ILLEGAL_ACCESS/i.test(ret);
}

module.exports = {
  QUERY_API_ORIGIN,
  createMtopUrl,
  createTableRequestData,
  extractMtopToken,
  mtopSign,
  summarizeQueryResponse,
  tokenRefreshRequired,
};
