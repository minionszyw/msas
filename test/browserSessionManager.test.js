const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrowserSessionManager } = require('../src/browserSessionManager');

test('browser sessions are reused, exposed safely, closed manually, and expire when idle', async () => {
  const manager = createBrowserSessionManager({ idleTimeoutMs: 10 });
  const store = { storeId: 'shop_a' };
  let created = 0;
  let closed = 0;
  const createSession = async () => {
    created += 1;
    return {
      id: created,
      mode: 'headed',
      isUsable: () => true,
      close: async () => { closed += 1; },
    };
  };

  assert.equal(await manager.use(store, createSession, ({ id }) => id), 1);
  assert.equal(await manager.use(store, createSession, ({ id }) => id), 1);
  assert.equal(created, 1);
  assert.equal(manager.status(store).state, 'open');
  assert.equal(manager.status(store).mode, 'headed');
  assert.equal(await manager.close(store), true);
  assert.equal(closed, 1);
  assert.equal(manager.status(store).state, 'closed');

  await manager.use(store, createSession, ({ id }) => id);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(manager.status(store).state, 'closed');
  assert.equal(closed, 2);
});

test('browser sessions recreate unusable entries and close all stores', async () => {
  const manager = createBrowserSessionManager();
  const usable = new Map();
  let created = 0;
  let closed = 0;
  const createSession = async (store) => {
    created += 1;
    usable.set(store.storeId, true);
    return {
      mode: 'headless',
      isUsable: () => usable.get(store.storeId),
      close: async () => { closed += 1; },
    };
  };
  const first = { storeId: 'first' };
  const second = { storeId: 'second' };
  await manager.use(first, createSession, async () => {});
  usable.set('first', false);
  await manager.use(first, createSession, async () => {});
  await manager.use(second, createSession, async () => {});

  assert.equal(created, 3);
  assert.equal(closed, 1);
  await manager.closeAll();
  assert.equal(closed, 3);
});

test('session invalidation forwards the no-persist close policy', async () => {
  const manager = createBrowserSessionManager();
  const store = { storeId: 'shop_a' };
  let closeOptions;
  await manager.use(store, async () => ({
    mode: 'headed',
    close: async (options) => { closeOptions = options; },
  }), async () => {});

  await manager.close(store, { persist: false });
  assert.deepEqual(closeOptions, { persist: false });
});
