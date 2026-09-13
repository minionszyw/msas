const { z } = require('zod');
const { MAX_BATCH_OPERATIONS, MAX_BATCH_TARGETS } = require('./batchService');

function platformCapabilities(platform, adapter, sessionIdleTimeoutMs) {
  if (!adapter) return { platform, executable: false, actions: [], batch: null, session: null };
  const actions = Object.entries(adapter.actions || {}).map(([name, definition]) => ({
    name,
    description: definition.description,
    mutation: definition.mutation === true,
    batchable: definition.batchable === true,
    inputSchema: definition.inputSchema ? z.toJSONSchema(definition.inputSchema) : null,
  }));
  const batchActions = actions.filter(({ batchable }) => batchable);
  return {
    platform,
    executable: true,
    actions,
    batch: batchActions.length ? {
      endpoint: '/stores/{storeId}/actions/batch/start',
      method: 'POST',
      maxOperations: MAX_BATCH_OPERATIONS,
      maxTargets: MAX_BATCH_TARGETS,
      execution: 'ordered-continue-on-error',
      inputSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          operations: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_BATCH_OPERATIONS,
            items: {
              oneOf: batchActions.map((action) => ({
                type: 'object',
                properties: {
                  action: { const: action.name },
                  payload: action.inputSchema,
                },
                required: ['action', 'payload'],
                additionalProperties: false,
              })),
            },
          },
        },
        required: ['operations'],
        additionalProperties: false,
      },
    } : null,
    session: {
      idleTimeoutMs: sessionIdleTimeoutMs,
      status: { method: 'GET', endpoint: '/stores/{storeId}/session' },
      close: { method: 'DELETE', endpoint: '/stores/{storeId}/session' },
    },
  };
}

module.exports = { platformCapabilities };
