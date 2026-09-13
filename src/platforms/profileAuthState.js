const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { makeError } = require('../errors');
const { ensurePrivateDirectory } = require('../privateStorage');

const PRIVATE_FILE_MODE = 0o600;

function authStatePath(store) {
  return path.join(store.profileDir, 'auth-state.json');
}

function ensurePrivateProfileDirectory(store) {
  ensurePrivateDirectory(store.profileDir);
}

function validState(state) {
  return state
    && typeof state === 'object'
    && !Array.isArray(state)
    && Array.isArray(state.cookies)
    && Array.isArray(state.origins);
}

function readAuthState(store) {
  const file = authStatePath(store);
  try {
    ensurePrivateProfileDirectory(store);
    fs.chmodSync(file, PRIVATE_FILE_MODE);
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!validState(state)) throw new Error('invalid shape');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw makeError('saved login state is invalid; run login/start again', 401, 'loginRequired');
  }
}

async function saveAuthState(context, store) {
  let state;
  try {
    state = await context.storageState();
  } catch (_) {
    throw makeError('could not read browser login state', 500, 'authStateSaveFailed');
  }
  if (!validState(state)) {
    throw makeError('browser returned an invalid login state', 500, 'authStateSaveFailed');
  }
  let temporaryFile;
  try {
    ensurePrivateProfileDirectory(store);
    const file = authStatePath(store);
    temporaryFile = path.join(
      store.profileDir,
      `.auth-state.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
    );
    fs.writeFileSync(temporaryFile, `${JSON.stringify(state)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: PRIVATE_FILE_MODE,
    });
    fs.renameSync(temporaryFile, file);
    fs.chmodSync(file, PRIVATE_FILE_MODE);
  } catch (_) {
    throw makeError('could not save browser login state', 500, 'authStateSaveFailed');
  } finally {
    if (temporaryFile) {
      try {
        fs.unlinkSync(temporaryFile);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw makeError('could not clean up browser login state', 500, 'authStateSaveFailed');
        }
      }
    }
  }
}

async function restoreAuthState(context, store) {
  const state = readAuthState(store);
  if (!state) return false;
  if (state.cookies.length) await context.addCookies(state.cookies);
  if (state.origins.length) {
    await context.addInitScript((savedOrigins) => {
      const saved = savedOrigins.find(({ origin }) => origin === window.location.origin);
      if (!saved || !Array.isArray(saved.localStorage)) return;
      for (const { name, value } of saved.localStorage) window.localStorage.setItem(name, value);
    }, state.origins);
  }
  return state.cookies.length > 0 || state.origins.length > 0;
}

module.exports = {
  authStatePath,
  ensurePrivateProfileDirectory,
  readAuthState,
  restoreAuthState,
  saveAuthState,
};
