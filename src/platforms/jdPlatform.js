const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const LOGIN_URL = 'https://passport.shop.jd.com/login/index.action/jdm';
const HOME_URL = 'https://shop.jd.com/jdm/home';
const WARE_LIST_URL = 'https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0';
const ALL_WARE_SELECTOR = '#tab-AllWare > div > span';
const QUERY_BUTTON_SELECTOR = '#app > div > div:nth-child(3) > form > div > div > div.jd-form-item.asterisk-left.actions-form-item > div.jd-form-item__content > div > button.jd-button.jd-button--primary.is-plain';
const QUERY_API_NAME = 'dsm.product.manage.ProductInfoReadViewService.queryValidProductList';
const QUERY_API_URL_PART = `api=${QUERY_API_NAME}`;
const DEFAULT_CHROME_PATH = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
const DEFAULT_VIEWPORT = { width: 1365, height: 900 };

function now() {
  return new Date().toISOString();
}

function parseJsonMaybe(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

function responseHas601(status, bodyText) {
  if (String(status) === '601') return true;
  const json = parseJsonMaybe(bodyText || '');
  if (json && Number(json.code) === 601) return true;
  return /未经京东授权|网络环境较差|"code"\s*:\s*601/.test(bodyText || '');
}

function createJdPlatform(options = {}) {
  const chromePath = options.chromePath || DEFAULT_CHROME_PATH;
  const headed = options.headed !== false;
  const launchPersistentContext = options.launchPersistentContext || ((profileDir, launchOptions) => chromium.launchPersistentContext(profileDir, launchOptions));

  async function launchContext(store, headless = !headed) {
    return launchPersistentContext(store.profileDir, {
      headless,
      executablePath: chromePath,
      viewport: DEFAULT_VIEWPORT,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
  }

  function isHomeUrl(url) {
    return String(url || '').startsWith(HOME_URL);
  }

  async function verifySavedLogin(store) {
    const context = await launchContext(store, true);
    const page = context.pages()[0] || await context.newPage();
    try {
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
    let loginResult;
    try {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const currentUrl = page.url();
        if (isHomeUrl(currentUrl)) break;
        await page.waitForTimeout(2000);
      }

      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      const loginPageOk = isHomeUrl(finalUrl);
      loginResult = { ok: loginPageOk, loginPageOk, reuseCheck: null, title, finalUrl, profileDir: store.profileDir, timeoutMs };
    } finally {
      await context.close().catch(() => {});
    }

    if (!loginResult.loginPageOk) return loginResult;
    const reuseCheck = await verifySavedLogin(store).catch((err) => ({
      ok: false,
      loginRequired: null,
      title: '',
      finalUrl: null,
      error: err.message,
    }));
    return { ...loginResult, ok: reuseCheck.ok, reuseCheck };
  }

  function attachCapture(page, records, phaseRef) {
    page.on('request', (req) => {
      if ((req.resourceType() === 'xhr' || req.resourceType() === 'fetch') && /sff\.jd\.com\/api/.test(req.url())) {
        records.push({ phase: phaseRef.value, event: 'request', method: req.method(), url: req.url(), postData: req.postData(), ts: now() });
      }
    });
    page.on('response', async (res) => {
      const req = res.request();
      if ((req.resourceType() === 'xhr' || req.resourceType() === 'fetch') && /sff\.jd\.com\/api/.test(res.url())) {
        let body = '';
        try { body = await res.text(); } catch (e) { body = `<read failed: ${e.message}>`; }
        records.push({ phase: phaseRef.value, event: 'response', status: res.status(), url: res.url(), body: body.slice(0, 12000), ts: now() });
      }
    });
  }

  async function clickQueryButton(page) {
    try {
      await page.locator(QUERY_BUTTON_SELECTOR).click({ timeout: 10000 });
    } catch (_) {
      await page.getByRole('button', { name: /^查询$/ }).first().click({ timeout: 15000 });
    }
  }

  async function fillProductCode(page, itemId) {
    const formItems = page.locator('form .jd-form-item');
    await formItems.filter({ hasText: '查询设置' }).getByRole('button', { name: '重置' }).click().catch(() => {});
    await page.waitForTimeout(1000);
    const productCodeInput = formItems.nth(3).locator('input').first();
    await productCodeInput.click({ timeout: 15000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(itemId);
    await productCodeInput.evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function summarize(records, bodyText, itemId) {
    const queryResponses = records.filter((r) => r.event === 'response' && r.url.includes(QUERY_API_URL_PART));
    const http601Count = records.filter((r) => String(r.status) === '601').length;
    const json601Count = records.filter((r) => /"code"\s*:\s*601/.test(r.body || '')).length;
    const badTextCount = records.filter((r) => /未经京东授权|网络环境较差/.test(r.body || '')).length;
    const bodyBadText = /未经京东授权|网络环境较差|601/.test(bodyText || '');
    const querySummaries = queryResponses.map((r) => {
      const json = parseJsonMaybe(r.body || '');
      return { httpStatus: r.status, jsonCode: json && json.code, msg: json && json.msg, hasItemId: (r.body || '').includes(itemId) };
    });
    const queryOk = querySummaries.some((r) => r.httpStatus === 200 && Number(r.jsonCode) === 200);
    const hit601 = http601Count > 0 || json601Count > 0 || badTextCount > 0 || bodyBadText || queryResponses.some((r) => responseHas601(r.status, r.body));
    return { hit601, ok: queryOk && !hit601, http601Count, json601Count, badTextCount, bodyBadText, queryResponseCount: queryResponses.length, queryResponses: querySummaries };
  }

  async function runQueryTest(store, payload) {
    const { itemId } = validateQueryTestPayload(payload);
    const records = [];
    const phaseRef = { value: 'open' };
    const context = await launchContext(store);
    const page = context.pages()[0] || await context.newPage();
    attachCapture(page, records, phaseRef);
    try {
      await page.goto(WARE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(8000);
      if (/passport\.shop\.jd\.com/.test(page.url())) {
        return { ok: false, hit601: false, loginRequired: true, finalUrl: page.url(), title: await page.title().catch(() => ''), recordsCount: records.length };
      }
      await page.locator(ALL_WARE_SELECTOR).click({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3000);
      phaseRef.value = 'query-product-code';
      await fillProductCode(page, itemId);
      await clickQueryButton(page);
      await page.waitForTimeout(8000);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      return { ...summarize(records, bodyText, itemId), itemId, loginRequired: false, finalUrl, title, recordsCount: records.length };
    } finally {
      await context.close().catch(() => {});
    }
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

  function validateActionPayload(action, payload = {}) {
    if (action === 'query-test') return validateQueryTestPayload(payload);
    const err = new Error(`action ${action} not supported for platform jd`);
    err.status = 404;
    err.code = 'actionNotFound';
    throw err;
  }

  function createActionMetadata(action, payload = {}) {
    if (action === 'query-test') return { action, itemId: payload.itemId };
    return { action };
  }

  return {
    platform: 'jd',
    actions: ['query-test'],
    startLogin: (store, payload = {}) => runLogin(store, payload.timeoutMs),
    validateActionPayload,
    createActionMetadata,
    startAction: (action, store, payload = {}) => {
      const normalizedPayload = validateActionPayload(action, payload);
      if (action === 'query-test') return runQueryTest(store, normalizedPayload);
      throw new Error(`unreachable action ${action}`);
    },
    _test: { responseHas601, summarize, validateQueryTestPayload, isHomeUrl },
  };
}

module.exports = { createJdPlatform, responseHas601 };
