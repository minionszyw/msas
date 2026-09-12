const { createLaunchContext } = require('./browserContext');
const { createManualLoginFlow } = require('./loginFlow');
const { createQueryTestAction, parseJsonMaybe } = require('./platformUtils');

const LOGIN_URL = 'https://passport.shop.jd.com/login/index.action/jdm';
const HOME_URL = 'https://shop.jd.com/jdm/home';
const WARE_LIST_URL = 'https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0';
const ALL_WARE_SELECTOR = '#tab-AllWare > div > span';
const QUERY_BUTTON_SELECTOR = '#app > div > div:nth-child(3) > form > div > div > div.jd-form-item.asterisk-left.actions-form-item > div.jd-form-item__content > div > button.jd-button.jd-button--primary.is-plain';
const QUERY_API_NAME = 'dsm.product.manage.ProductInfoReadViewService.queryValidProductList';
const QUERY_API_URL_PART = `api=${QUERY_API_NAME}`;

function responseHas601(status, bodyText) {
  if (String(status) === '601') return true;
  const json = parseJsonMaybe(bodyText || '');
  if (json && Number(json.code) === 601) return true;
  return /未经京东授权|网络环境较差|"code"\s*:\s*601/.test(bodyText || '');
}

function summarizeQuery(records, bodyText, itemId) {
  const queryResponses = records.filter((record) => record.url.includes(QUERY_API_URL_PART));
  const http601Count = records.filter((record) => String(record.status) === '601').length;
  const json601Count = records.filter((record) => /"code"\s*:\s*601/.test(record.body || '')).length;
  const badTextCount = records.filter((record) => /未经京东授权|网络环境较差/.test(record.body || '')).length;
  const bodyBadText = responseHas601(undefined, bodyText);
  const querySummaries = queryResponses.map((record) => {
    const json = parseJsonMaybe(record.body || '');
    return {
      httpStatus: record.status,
      jsonCode: json && json.code,
      msg: json && json.msg,
      hasItemId: (record.body || '').includes(itemId),
    };
  });
  const queryOk = querySummaries.some((response) => (
    response.httpStatus === 200 && Number(response.jsonCode) === 200
  ));
  const hit601 = http601Count > 0
    || json601Count > 0
    || badTextCount > 0
    || bodyBadText
    || queryResponses.some((record) => responseHas601(record.status, record.body));
  return {
    hit601,
    ok: queryOk && !hit601,
    http601Count,
    json601Count,
    badTextCount,
    bodyBadText,
    queryResponseCount: queryResponses.length,
    queryResponses: querySummaries,
  };
}

function createJdPlatform(options = {}) {
  const launchContext = createLaunchContext(options);
  const startLogin = createManualLoginFlow({ launchContext, loginUrl: LOGIN_URL, homeUrl: HOME_URL });

  function attachResponseCapture(page, records) {
    page.on('response', async (response) => {
      const request = response.request();
      if (!['xhr', 'fetch'].includes(request.resourceType()) || !/sff\.jd\.com\/api/.test(response.url())) return;
      let body = '';
      try {
        body = await response.text();
      } catch (error) {
        body = `<read failed: ${error.message}>`;
      }
      records.push({ status: response.status(), url: response.url(), body: body.slice(0, 12000) });
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
    await productCodeInput.evaluate((element) => {
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function runQueryTest(store, payload) {
    const { itemId } = payload;
    const records = [];
    const context = await launchContext(store);
    const page = context.pages()[0] || await context.newPage();
    attachResponseCapture(page, records);
    try {
      await page.goto(WARE_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(8000);
      if (/passport\.shop\.jd\.com/.test(page.url())) {
        return {
          ok: false,
          hit601: false,
          loginRequired: true,
          finalUrl: page.url(),
          title: await page.title().catch(() => ''),
          recordsCount: records.length,
        };
      }
      await page.locator(ALL_WARE_SELECTOR).click({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3000);
      await fillProductCode(page, itemId);
      await clickQueryButton(page);
      await page.waitForTimeout(8000);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      return {
        ...summarizeQuery(records, bodyText, itemId),
        itemId,
        loginRequired: false,
        finalUrl: page.url(),
        title: await page.title().catch(() => ''),
        recordsCount: records.length,
      };
    } finally {
      await context.close().catch(() => {});
    }
  }

  return {
    platform: 'jd',
    startLogin,
    actions: { 'query-test': createQueryTestAction(runQueryTest) },
  };
}

module.exports = { createJdPlatform, responseHas601, summarizeQuery };
