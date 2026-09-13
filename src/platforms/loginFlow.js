const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

async function getPageSummary(page) {
  return {
    title: await page.title().catch(() => ''),
    finalUrl: page.url(),
  };
}

function createManualLoginFlow(options) {
  const {
    launchContext,
    loginUrl,
    homeUrl,
    isLoggedIn = (url) => String(url || '').startsWith(homeUrl),
    settleMs = 0,
    saveState = async () => {},
    restoreState = async () => {},
  } = options;

  async function verifySavedLogin(store) {
    const context = await launchContext(store, true);
    try {
      const page = context.pages()[0] || await context.newPage();
      await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2000);
      let summary = await getPageSummary(page);
      if (!isLoggedIn(summary.finalUrl) && await restoreState(context, store)) {
        await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(2000);
        summary = await getPageSummary(page);
      }
      const ok = isLoggedIn(summary.finalUrl);
      return { ok, loginRequired: !ok, ...summary };
    } finally {
      await context.close().catch(() => {});
    }
  }

  return async function runLogin(store, payload = {}) {
    const timeoutMs = payload.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    const context = await launchContext(store);
    const page = context.pages()[0] || await context.newPage();
    let loginResult;
    try {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && !isLoggedIn(page.url())) {
        await page.waitForTimeout(2000);
      }
      if (isLoggedIn(page.url()) && settleMs > 0) await page.waitForTimeout(settleMs);

      const summary = await getPageSummary(page);
      const loginPageOk = isLoggedIn(summary.finalUrl);
      if (loginPageOk) await saveState(context, store);
      loginResult = { ok: loginPageOk, loginPageOk, reuseCheck: null, ...summary, timeoutMs };
    } finally {
      await context.close().catch(() => {});
    }

    if (!loginResult.loginPageOk) return loginResult;
    const reuseCheck = await verifySavedLogin(store).catch((error) => ({
      ok: false,
      loginRequired: null,
      title: '',
      finalUrl: null,
      error: error.message,
    }));
    return { ...loginResult, ok: reuseCheck.ok, reuseCheck };
  };
}

module.exports = { createManualLoginFlow };
