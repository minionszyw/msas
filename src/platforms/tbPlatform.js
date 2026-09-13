const { createBrowserSessionManager } = require('../browserSessionManager');
const { makeError } = require('../errors');
const { createLaunchContext } = require('./browserContext');
const { createManualLoginFlow } = require('./loginFlow');
const { createQueryTestAction, parseJsonMaybe } = require('./platformUtils');
const { restoreAuthState, saveAuthState } = require('./profileAuthState');
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

function createTbPlatform(options = {}) {
  const launchContext = createLaunchContext(options);
  const sessionManager = options.sessionManager || createBrowserSessionManager();
  const runManualLogin = createManualLoginFlow({
    launchContext,
    loginUrl: LOGIN_URL,
    homeUrl: HOME_URL,
    settleMs: LOGIN_SETTLE_MS,
    saveState: saveAuthState,
    restoreState: restoreAuthState,
  });

  async function createSession(store, restoreFirst = false) {
    const context = await launchContext(store);
    try {
      const page = context.pages()[0] || await context.newPage();
      if (restoreFirst) await restoreAuthState(context, store);
      await page.goto(SELL_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      if (/loginmyseller\.taobao\.com|login\.taobao\.com/.test(page.url()) && await restoreAuthState(context, store)) {
        await page.goto(SELL_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);
      }
      if (/loginmyseller\.taobao\.com|login\.taobao\.com/.test(page.url())) {
        throw makeError('Taobao login state expired; run login/start again', 401, 'loginRequired');
      }
      return {
        context,
        page,
        mode: options.headed === false ? 'headless' : 'headed',
        isUsable: () => typeof page.isClosed !== 'function' || !page.isClosed(),
        ensureReady: async () => {
          if (!/^https:\/\/myseller\.taobao\.com\/home\.htm\/SellManage\//.test(page.url())) {
            await page.goto(SELL_MANAGE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(5000);
          }
          if (/loginmyseller\.taobao\.com|login\.taobao\.com/.test(page.url())) {
            throw makeError('Taobao login state expired; run login/start again', 401, 'loginRequired');
          }
        },
        close: async ({ persist = true } = {}) => {
          if (persist) await saveAuthState(context, store).catch(() => {});
          await context.close().catch(() => {});
        },
      };
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
  }

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
    try {
      const execute = (restoreFirst = false) => sessionManager.use(
        store,
        (target) => createSession(target, restoreFirst),
        async ({ context, ensureReady, page }) => {
          await ensureReady();
          const records = [];
          await callMtop(context, page, itemId, records);
          const result = {
            ...summarizeQueryResponse(records, itemId),
            mode: 'api',
            finalUrl: page.url(),
            title: await page.title().catch(() => ''),
            recordsCount: records.length,
          };
          if (result.ok) await saveAuthState(context, store);
          return result;
        },
      );
      let result = await execute();
      if (result.loginRequired) {
        await sessionManager.close(store, { persist: false });
        result = await execute(true);
      }
      if (result.loginRequired || (result.riskCheck && result.riskCheck.detected)) {
        await sessionManager.close(store, { persist: false });
      }
      return result;
    } catch (error) {
      if (error.code === 'loginRequired') await sessionManager.close(store, { persist: false });
      throw error;
    }
  }

  async function startLogin(store, payload) {
    await sessionManager.close(store);
    return runManualLogin(store, payload);
  }

  return {
    platform: 'tb',
    startLogin,
    closeSession: (store) => sessionManager.close(store),
    actions: { 'query-test': createQueryTestAction(runQueryTest) },
  };
}

module.exports = { createTbPlatform };
