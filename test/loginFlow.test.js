const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJdPlatform } = require('../src/platforms/jdPlatform');
const { createTbPlatform } = require('../src/platforms/tbPlatform');
const { createFakeContext, createFakePage } = require('./helpers/browserFakes.cjs');

async function assertLoginReuse(createPlatform, profileDir, urls) {
  const launches = [];
  const closes = [];
  const visitedUrls = [];
  const contexts = [
    createFakeContext(createFakePage(urls.home, { onGoto: (url) => visitedUrls.push(url) }), () => closes.push('login')),
    createFakeContext(createFakePage(urls.home, { onGoto: (url) => visitedUrls.push(url) }), () => closes.push('verify')),
  ];
  const platform = createPlatform({
    headed: true,
    launchPersistentContext: async (directory, options) => {
      launches.push({ directory, options });
      return contexts.shift();
    },
  });

  const result = await platform.startLogin({ profileDir }, { timeoutMs: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.loginPageOk, true);
  assert.equal(result.reuseCheck.ok, true);
  assert.equal(result.profileDir, undefined);
  assert.equal(result.authStatePath, undefined);
  assert.deepEqual(closes, ['login', 'verify']);
  assert.equal(launches[0].options.headless, false);
  assert.equal(launches[1].options.headless, true);
  assert.equal(launches[0].directory, launches[1].directory);
  assert.deepEqual(visitedUrls, [urls.login, urls.home]);
}

test('jd login saves cookies, closes its headed context, and verifies the profile headlessly', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-login-'));
  const profileDir = path.join(root, 'shop_a');
  await assertLoginReuse(createJdPlatform, profileDir, {
    login: 'https://passport.shop.jd.com/login/index.action/jdm',
    home: 'https://shop.jd.com/jdm/home',
  });
  assert.equal(fs.existsSync(path.join(profileDir, 'auth-state.json')), true);
});

test('tb login saves cookies before verifying the same profile headlessly', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-login-'));
  await assertLoginReuse(createTbPlatform, path.join(root, 'tb_a'), {
    login: 'https://loginmyseller.taobao.com/',
    home: 'https://myseller.taobao.com/home.htm/QnworkbenchHome/',
  });
  assert.equal(fs.existsSync(path.join(root, 'tb_a', 'auth-state.json')), true);
});

test('login reports failed reuse verification and skips it when manual login fails', async () => {
  const failedReuse = createJdPlatform({
    launchPersistentContext: (() => {
      let launches = 0;
      return async () => {
        launches += 1;
        if (launches === 2) throw new Error('verification launch failed');
        return createFakeContext(createFakePage('https://shop.jd.com/jdm/home'));
      };
    })(),
  });
  const failedProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-failed-reuse-'));
  const failed = await failedReuse.startLogin({ profileDir: failedProfile }, { timeoutMs: 1 });
  assert.equal(failed.ok, false);
  assert.equal(failed.reuseCheck.loginRequired, null);
  assert.match(failed.reuseCheck.error, /verification launch failed/);

  let launches = 0;
  const noLogin = createJdPlatform({
    launchPersistentContext: async () => {
      launches += 1;
      return createFakeContext(createFakePage('https://passport.shop.jd.com/login/index.action/jdm'));
    },
  });
  const result = await noLogin.startLogin({ profileDir: '/profiles/a' }, { timeoutMs: 0 });
  assert.equal(result.loginPageOk, false);
  assert.equal(result.reuseCheck, null);
  assert.equal(launches, 1);
});

test('login marks a redirected reuse check as expired', async () => {
  const contexts = [
    createFakeContext(createFakePage('https://shop.jd.com/jdm/home')),
    createFakeContext(createFakePage('https://passport.shop.jd.com/login/index.action/jdm')),
  ];
  const platform = createJdPlatform({ launchPersistentContext: async () => contexts.shift() });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-redirected-reuse-'));

  const result = await platform.startLogin({ profileDir }, { timeoutMs: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.loginPageOk, true);
  assert.equal(result.reuseCheck.ok, false);
  assert.equal(result.reuseCheck.loginRequired, true);
});
