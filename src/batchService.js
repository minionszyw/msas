const { makeError } = require('./errors');

const MAX_BATCH_OPERATIONS = 100;
const MAX_BATCH_TARGETS = 100;

function normalizeBatch(adapter, payload) {
  if (!payload || !Array.isArray(payload.operations) || !payload.operations.length) {
    throw makeError('operations must be a non-empty array', 400, 'invalidBatch');
  }
  if (payload.operations.length > MAX_BATCH_OPERATIONS) {
    throw makeError(`batch supports at most ${MAX_BATCH_OPERATIONS} operations`, 400, 'tooManyBatchOperations');
  }
  let targetCount = 0;
  const operations = payload.operations.map((operation, index) => {
    const action = operation && operation.action;
    const definition = typeof action === 'string'
      && adapter.actions
      && Object.hasOwn(adapter.actions, action)
      && adapter.actions[action];
    if (!definition || !definition.batchable) {
      throw makeError(`operation ${index} action is not batchable`, 400, 'actionNotBatchable');
    }
    const normalizedPayload = definition.validate(operation.payload || {});
    targetCount += definition.targetCount(normalizedPayload);
    return { index, action, definition, payload: normalizedPayload };
  });
  if (targetCount > MAX_BATCH_TARGETS) {
    throw makeError(`batch supports at most ${MAX_BATCH_TARGETS} target resources`, 400, 'tooManyBatchTargets');
  }
  return { operations, targetCount };
}

function batchMetadata(batch) {
  const countsByAction = {};
  for (const { action } of batch.operations) countsByAction[action] = (countsByAction[action] || 0) + 1;
  return {
    operationCount: batch.operations.length,
    targetCount: batch.targetCount,
    countsByAction,
  };
}

async function runBatch(batch, store) {
  const results = [];
  for (const operation of batch.operations) {
    try {
      const result = await operation.definition.run(store, operation.payload);
      results.push({
        index: operation.index,
        action: operation.action,
        status: 'completed',
        ok: result && result.ok !== false,
        result,
        error: null,
      });
    } catch (error) {
      results.push({
        index: operation.index,
        action: operation.action,
        status: 'failed',
        ok: false,
        result: null,
        error: { message: error.message, code: error.code },
      });
    }
  }
  return {
    ok: results.every(({ ok }) => ok),
    operationCount: results.length,
    completedCount: results.filter(({ status }) => status === 'completed').length,
    failedCount: results.filter(({ status }) => status === 'failed').length,
    operations: results,
  };
}

module.exports = {
  MAX_BATCH_OPERATIONS,
  MAX_BATCH_TARGETS,
  batchMetadata,
  normalizeBatch,
  runBatch,
};
