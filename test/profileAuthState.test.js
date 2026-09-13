const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readAuthState,
  restoreAuthState,
  saveAuthState,
} = require('../src/platforms/profileAuthState');

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-auth-'));
  const profileDir = path.join(root, 'shop_a');
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o755 });
  return { profileDir };
}

test('auth state is written atomically with private permissions and can be restored', async () => {
  const store = createStore();
  const state = {
    cookies: [{ name: 'session', value: 'secret', domain: '.example.com', path: '/' }],
    origins: [{ origin: 'https://example.com', localStorage: [{ name: 'token', value: 'secret' }] }],
  };
  const restored = { cookies: null, origins: null };
  await saveAuthState({ storageState: async () => state }, store);

  assert.equal(fs.statSync(store.profileDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(store.profileDir, 'auth-state.json')).mode & 0o777, 0o600);
  assert.deepEqual(readAuthState(store), state);
  assert.deepEqual(fs.readdirSync(store.profileDir), ['auth-state.json']);

  const didRestore = await restoreAuthState({
    addCookies: async (cookies) => { restored.cookies = cookies; },
    addInitScript: async (_script, origins) => { restored.origins = origins; },
  }, store);
  assert.equal(didRestore, true);
  assert.deepEqual(restored.cookies, state.cookies);
  assert.deepEqual(restored.origins, state.origins);
});

test('reading an existing snapshot tightens permissions and rejects malformed state safely', () => {
  const store = createStore();
  const file = path.join(store.profileDir, 'auth-state.json');
  fs.writeFileSync(file, JSON.stringify({ cookies: [], origins: [] }), { mode: 0o644 });

  assert.deepEqual(readAuthState(store), { cookies: [], origins: [] });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  fs.writeFileSync(file, '{broken');
  assert.throws(
    () => readAuthState(store),
    (error) => error.code === 'loginRequired' && !error.message.includes(store.profileDir),
  );
});

test('missing snapshots are optional and invalid browser state is not written', async () => {
  const store = createStore();
  assert.equal(readAuthState(store), null);
  assert.equal(await restoreAuthState({}, store), false);
  await assert.rejects(
    () => saveAuthState({ storageState: async () => ({ cookies: [] }) }, store),
    (error) => error.code === 'authStateSaveFailed',
  );
  assert.deepEqual(fs.readdirSync(store.profileDir), []);
});

test('auth state refuses a symbolic-link profile directory without exposing its path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-auth-link-'));
  const target = path.join(root, 'target');
  const profileDir = path.join(root, 'shop_a');
  fs.mkdirSync(target);
  fs.symlinkSync(target, profileDir);

  await assert.rejects(
    () => saveAuthState({ storageState: async () => ({ cookies: [], origins: [] }) }, { profileDir }),
    (error) => error.code === 'authStateSaveFailed' && !error.message.includes(profileDir),
  );
  assert.deepEqual(fs.readdirSync(target), []);
});
