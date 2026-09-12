const path = require('path');
const { makeError } = require('./errors');
const { createJobManager } = require('./jobManager');
const { createPlatformAdapters } = require('./platforms/registry');
const {
  createStoreRepository,
  publicStore,
  sanitizePlatform,
} = require('./storeRepository');

const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LOGIN_TIMEOUT_MS = 60 * 60 * 1000;

function normalizePositiveInteger(value, fallback, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw makeError(`${name} must be an integer between 1 and ${maximum}`, 400, `invalid${name[0].toUpperCase()}${name.slice(1)}`);
  }
  return normalized;
}

function createAutomation(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const profilesDir = path.resolve(options.profilesDir || path.join(rootDir, 'profiles'));
  const storesFile = path.resolve(options.storesFile || path.join(rootDir, 'stores.json'));
  const maxCompletedJobs = normalizePositiveInteger(options.maxCompletedJobs, 1000, 'maxCompletedJobs');
  const adapters = options.adapters
    ? new Map(Object.entries(options.adapters))
    : createPlatformAdapters({ chromePath: options.chromePath, headed: options.headed });
  const storeRepository = createStoreRepository({ profilesDir, storesFile });
  const jobManager = createJobManager({ maxCompletedJobs });

  function getExecutableAdapter(platform) {
    sanitizePlatform(platform);
    const adapter = adapters.get(platform);
    if (!adapter) {
      throw makeError(`platform ${platform} is registered but automation is not implemented`, 501, 'notImplemented');
    }
    return adapter;
  }

  function ensureStore(platform, storeId, name = storeId) {
    return publicStore(storeRepository.ensureStore(platform, storeId, name));
  }

  function getStore(storeId, platform) {
    return publicStore(storeRepository.getStore(storeId, platform));
  }

  function listStores(platform) {
    return storeRepository.listStores(platform).map(publicStore);
  }

  function startLogin(storeId, payload = {}) {
    const store = storeRepository.getStore(storeId);
    const adapter = getExecutableAdapter(store.platform);
    const timeoutMs = normalizePositiveInteger(
      payload.timeoutMs,
      DEFAULT_LOGIN_TIMEOUT_MS,
      'timeoutMs',
      MAX_LOGIN_TIMEOUT_MS,
    );
    return jobManager.enqueue({
      type: 'login',
      platform: store.platform,
      storeId,
      metadata: { timeoutMs },
    }, () => adapter.startLogin(store, { timeoutMs }));
  }

  function startAction(storeId, action, payload = {}) {
    const store = storeRepository.getStore(storeId);
    const adapter = getExecutableAdapter(store.platform);
    const actionDefinition = adapter.actions && Object.hasOwn(adapter.actions, action)
      ? adapter.actions[action]
      : null;
    if (!actionDefinition) {
      throw makeError(`action ${action} not supported for platform ${store.platform}`, 404, 'actionNotFound');
    }
    const normalizedPayload = actionDefinition.validate(payload);
    const metadata = { action, ...actionDefinition.metadata(normalizedPayload) };
    return jobManager.enqueue({ type: action, platform: store.platform, storeId, metadata }, () => (
      actionDefinition.run(store, normalizedPayload)
    ));
  }

  return {
    ensureStore,
    getStore,
    listStores,
    startLogin,
    startAction,
    getJob: jobManager.getJob,
  };
}

module.exports = {
  createAutomation,
};
