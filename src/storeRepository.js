const fs = require('fs');
const path = require('path');
const { makeError } = require('./errors');
const { ensurePrivateDirectory } = require('./privateStorage');
const { SUPPORTED_PLATFORMS } = require('./platforms/registry');

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function ensurePrivateDir(directory) {
  try {
    ensurePrivateDirectory(directory);
  } catch (_) {
    throw makeError('cannot prepare the store browser profile', 500, 'profileUnavailable');
  }
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

function readStoresFile(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('root value must be an object');
    return { exists: true, value };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, value: {} };
    throw makeError(`cannot read stores file ${file}: ${error.message}`, 500, 'invalidStoresFile');
  }
}

function publicStore(store) {
  const { storeId, name, platform, createdAt, updatedAt } = store;
  return { storeId, name, platform, createdAt, updatedAt };
}

function serializeStores(stores) {
  return Object.fromEntries(Object.entries(stores).map(([storeId, store]) => [storeId, publicStore(store)]));
}

function normalizeStores(rawStores, profilesDir) {
  const normalized = Object.create(null);
  for (const [key, rawValue] of Object.entries(rawStores || {})) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
      throw makeError(`store ${key} must be an object`, 500, 'invalidStoresFile');
    }
    const raw = rawValue;
    const storeId = sanitizeStoreId(raw.storeId || key);
    const platform = sanitizePlatform(raw.platform || (storeId === 'shop_b' ? 'tb' : 'jd'));
    if (normalized[storeId]) {
      throw makeError(`duplicate storeId ${storeId} in stores file`, 500, 'invalidStoresFile');
    }
    normalized[storeId] = {
      storeId,
      name: typeof raw.name === 'string' && raw.name ? raw.name : storeId,
      platform,
      profileDir: path.join(profilesDir, storeId),
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null,
    };
  }
  return normalized;
}

function createStoreRepository(options) {
  const { profilesDir, storesFile } = options;
  ensureDir(profilesDir);
  const loaded = readStoresFile(storesFile);
  let stores;
  try {
    stores = normalizeStores(loaded.value, profilesDir);
  } catch (error) {
    if (error.code === 'invalidStoresFile') throw error;
    throw makeError(`cannot normalize stores file ${storesFile}: ${error.message}`, 500, 'invalidStoresFile');
  }

  function save() {
    ensureDir(path.dirname(storesFile));
    const temporaryFile = `${storesFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryFile, `${JSON.stringify(serializeStores(stores), null, 2)}\n`);
      fs.renameSync(temporaryFile, storesFile);
    } finally {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    }
  }

  if (loaded.exists && JSON.stringify(loaded.value) !== JSON.stringify(serializeStores(stores))) save();

  function ensureStore(platform, storeId, name = storeId) {
    sanitizePlatform(platform);
    sanitizeStoreId(storeId);
    if (typeof name !== 'string' || name.length < 1 || name.length > 128) {
      throw makeError('name must be a string between 1 and 128 characters', 400, 'invalidStoreName');
    }
    if (stores[storeId] && stores[storeId].platform !== platform) {
      throw makeError(`storeId ${storeId} already exists for platform ${stores[storeId].platform}`, 409, 'storeIdConflict');
    }
    const timestamp = new Date().toISOString();
    if (!stores[storeId]) {
      stores[storeId] = {
        storeId,
        name,
        platform,
        profileDir: path.join(profilesDir, storeId),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    } else {
      stores[storeId] = { ...stores[storeId], name: name || stores[storeId].name, updatedAt: timestamp };
    }
    ensurePrivateDir(stores[storeId].profileDir);
    save();
    return stores[storeId];
  }

  function getStore(storeId, platform) {
    sanitizeStoreId(storeId);
    if (platform) sanitizePlatform(platform);
    const store = stores[storeId];
    if (!store || (platform && store.platform !== platform)) {
      const suffix = platform ? ` for platform ${platform}` : '';
      throw makeError(`store ${storeId} not found${suffix}`, 404, 'storeNotFound');
    }
    ensurePrivateDir(store.profileDir);
    return store;
  }

  function listStores(platform) {
    if (platform) sanitizePlatform(platform);
    return Object.values(stores).filter((store) => !platform || store.platform === platform);
  }

  return { ensureStore, getStore, listStores };
}

module.exports = {
  createStoreRepository,
  publicStore,
  sanitizePlatform,
  sanitizeStoreId,
};
