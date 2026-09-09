const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
const TEST_PRODUCT_ID = 10028128548417;
const TEST_PRODUCT_ID_TEXT = '10028128548417';
const DEFAULT_CHROME_PATH = process.env.CHROME_PATH || '/opt/google/chrome/chrome';
const DEFAULT_VIEWPORT = { width: 1365, height: 900 };

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function newJobId() {
  return `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function sanitizeStoreId(storeId) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(storeId || '')) {
    const err = new Error('storeId must match /^[a-zA-Z0-9_-]{1,64}$/');
    err.status = 400;
    throw err;
  }
  return storeId;
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

function createJob(jobs, type, storeId, metadata = {}) {
  const job = {
    id: newJobId(),
    type,
    storeId,
    status: 'queued',
    createdAt: now(),
    updatedAt: now(),
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
    metadata,
  };
  jobs.set(job.id, job);
  return job;
}

function setJob(job, patch) {
  Object.assign(job, patch, { updatedAt: now() });
}

function publicJob(job) {
  return JSON.parse(JSON.stringify(job));
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createAutomation(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const profilesDir = path.resolve(options.profilesDir || path.join(rootDir, 'profiles'));
  const storesFile = path.resolve(options.storesFile || path.join(rootDir, 'stores.json'));
  const chromePath = options.chromePath || DEFAULT_CHROME_PATH;
  const headed = options.headed !== false;
  const jobs = new Map();
  const locks = new Map();
  ensureDir(profilesDir);
  const stores = readJson(storesFile, {});

  function storeProfileDir(storeId) {
    return path.join(profilesDir, sanitizeStoreId(storeId));
  }

  function saveStores() {
    writeJson(storesFile, stores);
  }

  function ensureStore(storeId, name = storeId) {
    sanitizeStoreId(storeId);
    if (!stores[storeId]) {
      stores[storeId] = { storeId, name, profileDir: storeProfileDir(storeId), createdAt: now(), updatedAt: now() };
    } else {
      stores[storeId] = { ...stores[storeId], name: name || stores[storeId].name, updatedAt: now() };
    }
    ensureDir(stores[storeId].profileDir);
    saveStores();
    return stores[storeId];
  }

  function getStore(storeId) {
    sanitizeStoreId(storeId);
    const store = stores[storeId];
    if (!store) {
      const err = new Error(`store ${storeId} not found`);
      err.status = 404;
      throw err;
    }
    ensureDir(store.profileDir);
    return store;
  }

  async function launchContext(store) {
    return chromium.launchPersistentContext(store.profileDir, {
      headless: !headed,
      executablePath: chromePath,
      viewport: DEFAULT_VIEWPORT,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
  }

  async function withStoreLock(storeId, fn) {
    const previous = locks.get(storeId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => current);
    locks.set(storeId, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(storeId) === chained) locks.delete(storeId);
    }
  }

  function enqueue(job, fn) {
    setImmediate(async () => {
      setJob(job, { status: 'running', startedAt: now() });
      try {
        const result = await withStoreLock(job.storeId, fn);
        setJob(job, { status: 'succeeded', result, finishedAt: now() });
      } catch (err) {
        setJob(job, { status: 'failed', error: { message: err.message, stack: err.stack }, finishedAt: now() });
      }
    });
    return publicJob(job);
  }

  async function runLogin(storeId, timeoutMs = 10 * 60 * 1000) {
    const store = getStore(storeId);
    const context = await launchContext(store);
    const page = context.pages()[0] || await context.newPage();
    try {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const deadline = Date.now() + timeoutMs;
      let lastUrl = page.url();
      while (Date.now() < deadline) {
        lastUrl = page.url();
        if (lastUrl.startsWith(HOME_URL) || lastUrl.includes('shop.jd.com/jdm/home')) break;
        try {
          await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(2000);
          lastUrl = page.url();
          if (lastUrl.startsWith(HOME_URL) && !lastUrl.includes('passport.shop.jd.com')) break;
        } catch (_) {}
        await page.waitForTimeout(3000);
      }
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      const ok = finalUrl.startsWith(HOME_URL) && !finalUrl.includes('passport.shop.jd.com');
      return { ok, title, finalUrl, profileDir: store.profileDir, timeoutMs };
    } finally {
      await context.close().catch(() => {});
    }
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

  async function fillProductCode(page) {
    const formItems = page.locator('form .jd-form-item');
    await formItems.filter({ hasText: '查询设置' }).getByRole('button', { name: '重置' }).click().catch(() => {});
    await page.waitForTimeout(1000);
    const productCodeInput = formItems.nth(3).locator('input').first();
    await productCodeInput.click({ timeout: 15000 });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.type(TEST_PRODUCT_ID_TEXT);
    await productCodeInput.evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function summarize(records, bodyText) {
    const queryResponses = records.filter((r) => r.event === 'response' && r.url.includes(QUERY_API_URL_PART));
    const http601Count = records.filter((r) => String(r.status) === '601').length;
    const json601Count = records.filter((r) => /"code"\s*:\s*601/.test(r.body || '')).length;
    const badTextCount = records.filter((r) => /未经京东授权|网络环境较差/.test(r.body || '')).length;
    const bodyBadText = /未经京东授权|网络环境较差|601/.test(bodyText || '');
    const querySummaries = queryResponses.map((r) => {
      const json = parseJsonMaybe(r.body || '');
      return { httpStatus: r.status, jsonCode: json && json.code, msg: json && json.msg, hasTestProductId: (r.body || '').includes(TEST_PRODUCT_ID_TEXT) };
    });
    const queryOk = querySummaries.some((r) => r.httpStatus === 200 && Number(r.jsonCode) === 200);
    const hit601 = http601Count > 0 || json601Count > 0 || badTextCount > 0 || bodyBadText || queryResponses.some((r) => responseHas601(r.status, r.body));
    return { hit601, ok: queryOk && !hit601, http601Count, json601Count, badTextCount, bodyBadText, queryResponseCount: queryResponses.length, queryResponses: querySummaries };
  }

  async function runQuery601(storeId) {
    const store = getStore(storeId);
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
      await fillProductCode(page);
      await clickQueryButton(page);
      await page.waitForTimeout(8000);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const title = await page.title().catch(() => '');
      const finalUrl = page.url();
      return { ...summarize(records, bodyText), loginRequired: false, finalUrl, title, recordsCount: records.length };
    } finally {
      await context.close().catch(() => {});
    }
  }

  function startLogin(storeId, timeoutMs) {
    getStore(storeId);
    const job = createJob(jobs, 'login', storeId, { timeoutMs: timeoutMs || 10 * 60 * 1000 });
    return enqueue(job, () => runLogin(storeId, timeoutMs));
  }

  function startQuery601(storeId) {
    getStore(storeId);
    const job = createJob(jobs, 'query-601', storeId, { productId: TEST_PRODUCT_ID_TEXT });
    return enqueue(job, () => runQuery601(storeId));
  }

  function getJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) {
      const err = new Error(`job ${jobId} not found`);
      err.status = 404;
      throw err;
    }
    return publicJob(job);
  }

  return {
    constants: { LOGIN_URL, HOME_URL, WARE_LIST_URL, QUERY_API_NAME, TEST_PRODUCT_ID_TEXT },
    ensureStore,
    getStore,
    listStores: () => Object.values(stores),
    startLogin,
    startQuery601,
    getJob,
    _test: { responseHas601, summarize, sanitizeStoreId },
  };
}

module.exports = { createAutomation, responseHas601, sanitizeStoreId };
