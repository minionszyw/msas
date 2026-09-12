const { makeError } = require('../errors');

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function validateItemIdPayload(payload = {}) {
  const itemId = String(payload.itemId || '').trim();
  if (!/^\d+$/.test(itemId)) {
    throw makeError('itemId is required and must be a numeric string', 400, 'invalidItemId');
  }
  return { ...payload, itemId };
}

function createQueryTestAction(run) {
  return {
    validate: validateItemIdPayload,
    metadata: ({ itemId }) => ({ itemId }),
    run,
  };
}

module.exports = { createQueryTestAction, parseJsonMaybe, validateItemIdPayload };
