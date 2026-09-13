const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function createBrowserSessionManager(options = {}) {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const entries = new Map();

  function keyFor(store) {
    return store.storeId || store.profileDir;
  }

  function clearIdleTimer(entry) {
    if (entry && entry.timer) clearTimeout(entry.timer);
    if (entry) entry.timer = null;
  }

  async function closeEntry(key, entry, options = {}) {
    if (!entry) return false;
    clearIdleTimer(entry);
    if (entries.get(key) === entry) entries.delete(key);
    await entry.session.close(options).catch(() => {});
    return true;
  }

  function scheduleClose(key, entry) {
    clearIdleTimer(entry);
    entry.expiresAt = new Date(Date.now() + idleTimeoutMs).toISOString();
    entry.timer = setTimeout(() => closeEntry(key, entry), idleTimeoutMs);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
  }

  async function use(store, createSession, run) {
    const key = keyFor(store);
    let entry = entries.get(key);
    if (entry && entry.session.isUsable && !entry.session.isUsable()) {
      await closeEntry(key, entry);
      entry = null;
    }
    if (!entry) {
      entry = {
        session: await createSession(store),
        timer: null,
        lastUsedAt: null,
        expiresAt: null,
      };
      entries.set(key, entry);
    }
    clearIdleTimer(entry);
    try {
      return await run(entry.session);
    } finally {
      if (entries.get(key) === entry) {
        entry.lastUsedAt = new Date().toISOString();
        scheduleClose(key, entry);
      }
    }
  }

  function status(store) {
    const entry = entries.get(keyFor(store));
    if (!entry) return { state: 'closed', mode: null, lastUsedAt: null, expiresAt: null };
    return {
      state: 'open',
      mode: entry.session.mode,
      lastUsedAt: entry.lastUsedAt,
      expiresAt: entry.expiresAt,
    };
  }

  function close(store, options) {
    const key = keyFor(store);
    return closeEntry(key, entries.get(key), options);
  }

  async function closeAll() {
    await Promise.all([...entries].map(([key, entry]) => closeEntry(key, entry)));
  }

  return { close, closeAll, status, use };
}

module.exports = { DEFAULT_IDLE_TIMEOUT_MS, createBrowserSessionManager };
