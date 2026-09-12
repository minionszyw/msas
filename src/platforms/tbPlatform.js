const fs = require('fs');
const path = require('path');
const { makeError } = require('../errors');
const { createLaunchContext } = require('./browserContext');
const { createManualLoginFlow } = require('./loginFlow');
const { createQueryTestAction, parseJsonMaybe } = require('./platformUtils');
const {
  QUERY_API_ORIGIN,
  createMtopUrl,
  createTableRequestData,
  extractMtopToken,
  mtopSign,
  summarizeQueryResponse,
  tokenRefreshRequired,
} = require('./tbMtop');

const LOGIN_URL = 'https://loginmyseller.taobao.com/';
const HOME_URL = 'https://myseller.taobao.com/home.htm/QnworkbenchHome/';
const SELL_MANAGE_URL = 'https://myseller.taobao.com/home.htm/SellManage/all';
const LOGIN_SETTLE_MS = 6000;

function authStatePath(store) {
  return path.join(store.profileDir, 'auth-state.json');
}

async function restoreSavedCookies(context, store) {
  const state = parseJsonMaybe(fs.readFileSync(authStatePath(store), 'utf8'));
  const cookies = state && Array.isArray(state.cookies) ? state.cookies : [];
  if (cookies.length) await context.addCookies(cookies);
  return cookies.length;
}

function createTbPlatform(options = {}) {
  const launchContext = createLaunchContext(options);
  const startLogin = createManualLoginFlow({
    launchContext,
    loginUrl: LOGIN_URL,
    homeUrl: HOME_URL,
    settleMs: LOGIN_SETTLE_MS,
    saveState: (context, store) => context.storageState({ path: authStatePath(store) }),
    restoreState: restoreSavedCookies,
  });

  async function sendMtopRequest(context, page, data, records) {
    const cookies = await context.cookies([QUERY_API_ORIGIN]);
    const token = extractMtopToken(cookies);
    const timestamp = String(Date.now());
    const requestUrl = createMtopUrl(timestamp, token ? mtopSign(token, timestamp, data) : '0');
    const response = await page.evaluate(async ({ requestUrl: url, requestData }) => {
      const result = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ data: requestData }).toString(),
        credentials: 'include',
      });
      return { status: result.status, body: await result.text() };
    }, { requestUrl, requestData: data });
    records.push({ status: response.status, body: response.body.slice(0, 30000) });
    return { outer: parseJsonMaybe(response.body), token };
  }

  async function callMtop(context, page, itemId, records) {
    const data = createTableRequestData(itemId);
    let result = await sendMtopRequest(context, page, data, records);
    if (!result.token || tokenRefreshRequired(result.outer)) {
      const refreshedToken = extractMtopToken(await context.cookies([QUERY_API_ORIGIN]));
      if (refreshedToken) result = await sendMtopRequest(context, page, data, records);
    }
    return result;
  }

  async function runQueryTest(store, payload) {
    const { itemId } = payload;
    const records = [];
    if (!fs.existsSync(authStatePath(store))) {
      throw makeError('login state not found; run login/start first', 401, 'loginRequired');
    }
    const context = await launchContext(store);
    try {
      await restoreSavedCookies(context, store);
      const page = context.pages()[0] || await context.newPage();
      await page.goto(SELL_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      if (/loginmyseller\.taobao\.com|login\.taobao\.com/.test(page.url())) {
        return {
          ok: false,
          itemFound: false,
          itemId,
          loginRequired: true,
          riskCheck: { detected: false, ret: [] },
          mode: 'api',
          finalUrl: page.url(),
          title: await page.title().catch(() => ''),
          recordsCount: 0,
        };
      }
      await callMtop(context, page, itemId, records);
      return {
        ...summarizeQueryResponse(records, itemId),
        mode: 'api',
        finalUrl: page.url(),
        title: await page.title().catch(() => ''),
        recordsCount: records.length,
      };
    } finally {
      await context.close().catch(() => {});
    }
  }

  return {
    platform: 'tb',
    startLogin,
    actions: { 'query-test': createQueryTestAction(runQueryTest) },
  };
}

module.exports = { createTbPlatform };
