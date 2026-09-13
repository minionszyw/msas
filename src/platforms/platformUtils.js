const { makeError } = require('../errors');
const { z } = require('zod');

const ITEM_ID_INPUT_SCHEMA = z.object({
  itemId: z.union([
    z.string().regex(/^\d+$/),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ]),
}).passthrough();

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function validateItemIdPayload(payload = {}) {
  const parsed = ITEM_ID_INPUT_SCHEMA.safeParse(payload);
  if (!parsed.success) throw makeError('itemId is required and must be a numeric string', 400, 'invalidItemId');
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
    batchable: false,
    run,
  };
}

module.exports = { createQueryTestAction, parseJsonMaybe, validateItemIdPayload };
