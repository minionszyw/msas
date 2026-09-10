const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createJdPlatform } = require('./platforms/jdPlatform');

const SUPPORTED_PLATFORMS = ['jd', 'tb', 'pdd'];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function newJobId() {
  return `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function makeError(message, status = 500, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function sanitizeStoreId(storeId) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(storeId || '')) {
    throw makeError('storeId must match /^[a-zA-Z0-9_-]{1,64}$/', 400, 'invalidStoreId');
  }
  return storeId;
}

function sanitizePlatform(platform) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw makeError(`platform must be one of: ${SUPPORTED_PLATFORMS.join(', ')}`, 400, 'invalidPlatform');
  }
  return platform;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function publicJob(job) {
  return JSON.parse(JSON.stringify(job));
}

function createJob(jobs, type, platform, storeId, metadata = {}) {
  const job = {
    id: newJobId(),
    type,
    platform,
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

function normalizeStores(rawStores, profilesDir) {
  const normalized = {};
  for (const [storeId, raw] of Object.entries(rawStores || {})) {
    const platform = raw.platform || (storeId === 'shop_b' ? 'tb' : 'jd');
    normalized[storeId] = {
      ...raw,
      storeId: raw.storeId || storeId,
      platform,
      profileDir: raw.profileDir || path.join(profilesDir, storeId),
    };
  }
  return normalized;
}

function createAutomation(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const profilesDir = path.resolve(options.profilesDir || path.join(rootDir, 'profiles'));
  const storesFile = path.resolve(options.storesFile || path.join(rootDir, 'stores.json'));
  const jobs = new Map();
  const locks = new Map();
  const adapters = new Map([
    ['jd', createJdPlatform({ chromePath: options.chromePath, headed: options.headed })],
  ]);

  ensureDir(profilesDir);
  const stores = normalizeStores(readJson(storesFile, {}), profilesDir);

  function storeProfileDir(storeId) {
    return path.join(profilesDir, sanitizeStoreId(storeId));
  }

  function saveStores() {
    writeJson(storesFile, stores);
  }

  function ensureStore(platform, storeId, name = storeId) {
    sanitizePlatform(platform);
    sanitizeStoreId(storeId);
    if (stores[storeId] && stores[storeId].platform !== platform) {
      throw makeError(`storeId ${storeId} already exists for platform ${stores[storeId].platform}`, 409, 'storeIdConflict');
    }
    if (!stores[storeId]) {
      stores[storeId] = { storeId, name, platform, profileDir: storeProfileDir(storeId), createdAt: now(), updatedAt: now() };
    } else {
      stores[storeId] = { ...stores[storeId], name: name || stores[storeId].name, platform, updatedAt: now() };
    }
    ensureDir(stores[storeId].profileDir);
    saveStores();
    return stores[storeId];
  }

  function getStore(platform, storeId) {
    sanitizePlatform(platform);
    sanitizeStoreId(storeId);
    const store = stores[storeId];
    if (!store || store.platform !== platform) {
      throw makeError(`store ${storeId} not found for platform ${platform}`, 404, 'storeNotFound');
    }
    ensureDir(store.profileDir);
    return store;
  }

  function listStores(platform) {
    sanitizePlatform(platform);
    return Object.values(stores).filter((store) => store.platform === platform);
  }

  function getExecutableAdapter(platform) {
    sanitizePlatform(platform);
    const adapter = adapters.get(platform);
    if (!adapter) throw makeError(`platform ${platform} is registered but automation is not implemented`, 501, 'notImplemented');
    return adapter;
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
        setJob(job, { status: 'failed', error: { message: err.message, code: err.code, stack: err.stack }, finishedAt: now() });
      }
    });
    return publicJob(job);
  }

  function startLogin(platform, storeId, payload = {}) {
    const store = getStore(platform, storeId);
    const adapter = getExecutableAdapter(platform);
    const timeoutMs = payload.timeoutMs ? Number(payload.timeoutMs) : 10 * 60 * 1000;
    const job = createJob(jobs, 'login', platform, storeId, { timeoutMs });
    return enqueue(job, () => adapter.startLogin(store, { timeoutMs }));
  }

  function startAction(platform, storeId, action, payload = {}) {
    const store = getStore(platform, storeId);
    const adapter = getExecutableAdapter(platform);
    const job = createJob(jobs, action, platform, storeId, { action, ...payload });
    return enqueue(job, () => adapter.startAction(action, store, payload));
  }

  function getJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) throw makeError(`job ${jobId} not found`, 404, 'jobNotFound');
    return publicJob(job);
  }

  return {
    ensureStore,
    getStore,
    listStores,
    startLogin,
    startAction,
    getJob,
    _test: { sanitizeStoreId, sanitizePlatform, normalizeStores, supportedPlatforms: SUPPORTED_PLATFORMS },
  };
}

module.exports = { createAutomation, sanitizeStoreId, sanitizePlatform, normalizeStores };
