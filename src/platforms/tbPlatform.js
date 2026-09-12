const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLaunchContext } = require('./browserContext');

const LOGIN_URL = 'https://loginmyseller.taobao.com/';
const HOME_URL = 'https://myseller.taobao.com/home.htm/QnworkbenchHome/';
const SELL_MANAGE_URL = 'https://myseller.taobao.com/home.htm/SellManage/all';
const QUERY_API_NAME = 'mtop.taobao.sell.pc.manage.async';
const QUERY_API_ORIGIN = 'https://h5api.m.taobao.com';
const MTOP_APP_KEY = '12574478';
const MTOP_TTID = '11320@taobao_WEB_9.9.99';
const LOGIN_SETTLE_MS = 6000;

function now() {
  return new Date().toISOString();
}

function parseJsonMaybe(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

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
  const titleNode = descriptions.find((entry) => entry && entry.text && !String(entry.text).startsWith('ID:')) || descriptions[0] || {};
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
  const parsedResponses = records
    .filter((record) => record.event === 'response')
    .map((record) => {
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
  const successful = [...parsedResponses].reverse().find((response) => response.httpStatus === 200 && response.outerSuccess && response.innerSuccess);
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

function validateQueryTestPayload(payload = {}) {
  const itemId = String(payload.itemId || '').trim();
  if (!/^\d+$/.test(itemId)) {
    const err = new Error('itemId is required and must be a numeric string');
    err.status = 400;
    err.code = 'invalidItemId';
    throw err;
  }
  return { ...payload, itemId };
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
  const cookie = cookies.find((entry) => entry.name === '_m_h5_tk' && /taobao\.com$/.test(String(entry.domain || '').replace(/^\./, '')));
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

function authStatePath(store) {
  return path.join(store.profileDir, 'auth-state.json');
}

async function restoreSavedCookies(context, statePath) {
  const state = parseJsonMaybe(fs.readFileSync(statePath, 'utf8'));
  const cookies = state && Array.isArray(state.cookies) ? state.cookies : [];
  if (cookies.length) await context.addCookies(cookies);
  return cookies.length;
}

function createTbPlatform(options = {}) {
  const launchContext = createLaunchContext(options);

  function isHomeUrl(url) {
    return String(url || '').startsWith(HOME_URL);
  }

  async function verifySavedLogin(store, statePath) {
    const context = await launchContext(store, true);
    try {
      await restoreSavedCookies(context, statePath);
      const page = context.pages()[0] || await context.newPage();
      await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2000);
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      const ok = isHomeUrl(finalUrl);
      return { ok, loginRequired: !ok, title, finalUrl };
    } finally {
      await context.close().catch(() => {});
    }
  }

  async function runLogin(store, timeoutMs = 10 * 60 * 1000) {
    const context = await launchContext(store);
    const page = context.pages()[0] || await context.newPage();
    const statePath = authStatePath(store);
    let loginResult;
    try {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (isHomeUrl(page.url())) break;
        await page.waitForTimeout(2000);
      }
      if (isHomeUrl(page.url())) await page.waitForTimeout(LOGIN_SETTLE_MS);
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      const loginPageOk = isHomeUrl(finalUrl);
      if (loginPageOk) await context.storageState({ path: statePath });
      loginResult = { ok: loginPageOk, loginPageOk, reuseCheck: null, title, finalUrl, profileDir: store.profileDir, authStatePath: statePath, timeoutMs };
    } finally {
      await context.close().catch(() => {});
    }

    if (!loginResult.loginPageOk) return loginResult;
    const reuseCheck = await verifySavedLogin(store, statePath).catch((err) => ({
      ok: false,
      loginRequired: null,
      title: '',
      finalUrl: null,
      error: err.message,
    }));
    return { ...loginResult, ok: reuseCheck.ok, reuseCheck };
  }

  async function sendMtopRequest(context, page, data, phase, records) {
    const cookies = await context.cookies([QUERY_API_ORIGIN]);
    const token = extractMtopToken(cookies);
    const timestamp = String(Date.now());
    const url = createMtopUrl(timestamp, token ? mtopSign(token, timestamp, data) : '0');
    const response = await page.evaluate(async ({ requestUrl, requestData }) => {
      const res = await fetch(requestUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: requestData }).toString(),
        credentials: 'include',
      });
      return { status: res.status, body: await res.text() };
    }, { requestUrl: url, requestData: data });
    const body = response.body;
    records.push({ phase, event: 'response', status: response.status, url, body: body.slice(0, 30000), ts: now() });
    return { outer: parseJsonMaybe(body), token };
  }

  async function callMtop(context, page, itemId, records) {
    const data = createTableRequestData(itemId);
    let result = await sendMtopRequest(context, page, data, 'api-query', records);
    if (!result.token || tokenRefreshRequired(result.outer)) {
      const refreshedToken = extractMtopToken(await context.cookies([QUERY_API_ORIGIN]));
      if (refreshedToken) result = await sendMtopRequest(context, page, data, 'api-query-retry', records);
    }
    return result;
  }

  async function runQueryTest(store, payload) {
    const { itemId } = validateQueryTestPayload(payload);
    const records = [];
    const statePath = authStatePath(store);
    if (!fs.existsSync(statePath)) {
      const err = new Error('login state not found; run login/start first');
      err.status = 401;
      err.code = 'loginRequired';
      throw err;
    }
    const context = await launchContext(store);
    try {
      await restoreSavedCookies(context, statePath);
      const page = context.pages()[0] || await context.newPage();
      await page.goto(SELL_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      if (/loginmyseller\.taobao\.com|login\.taobao\.com/.test(page.url())) {
        return { ok: false, itemFound: false, itemId, loginRequired: true, riskCheck: { detected: false, ret: [] }, mode: 'api', finalUrl: page.url(), title: await page.title().catch(() => ''), recordsCount: 0 };
      }
      await callMtop(context, page, itemId, records);
      return { ...summarizeQueryResponse(records, itemId), mode: 'api', finalUrl: page.url(), title: await page.title().catch(() => ''), recordsCount: records.length };
    } finally {
      await context.close().catch(() => {});
    }
  }

  function validateActionPayload(action, payload = {}) {
    if (action === 'query-test') return validateQueryTestPayload(payload);
    const err = new Error(`action ${action} not supported for platform tb`);
    err.status = 404;
    err.code = 'actionNotFound';
    throw err;
  }

  function createActionMetadata(action, payload = {}) {
    if (action === 'query-test') return { action, itemId: payload.itemId };
    return { action };
  }

  return {
    platform: 'tb',
    actions: ['query-test'],
    startLogin: (store, payload = {}) => runLogin(store, payload.timeoutMs),
    validateActionPayload,
    createActionMetadata,
    startAction: (action, store, payload = {}) => {
      const normalizedPayload = validateActionPayload(action, payload);
      if (action === 'query-test') return runQueryTest(store, normalizedPayload);
      throw new Error(`unreachable action ${action}`);
    },
    _test: { authStatePath, isHomeUrl, restoreSavedCookies },
  };
}

module.exports = {
  createTbPlatform,
  createTableRequestData,
  extractMtopToken,
  mtopSign,
  normalizeTbItem,
  summarizeQueryResponse,
  validateQueryTestPayload,
};
