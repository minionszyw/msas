const test = require('node:test');
const assert = require('node:assert/strict');
const { createJobManager } = require('../src/jobManager');

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitUntil(check) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = check();
    if (value) return value;
    await tick();
  }
  throw new Error('condition not reached');
}

test('jobs for one store remain queued until the previous job releases its lock', async () => {
  const manager = createJobManager();
  let releaseFirst;
  const first = manager.enqueue({ type: 'query-test', platform: 'jd', storeId: 'shop_a' }, () => (
    new Promise((resolve) => { releaseFirst = resolve; })
  ));
  const second = manager.enqueue({ type: 'query-test', platform: 'jd', storeId: 'shop_a' }, async () => 'second');

  await waitUntil(() => manager.getJob(first.id).status === 'running');
  assert.equal(manager.getJob(second.id).status, 'queued');
  releaseFirst('first');
  await waitUntil(() => manager.getJob(second.id).status === 'succeeded');
  assert.equal(manager.getJob(first.id).result, 'first');
});

test('jobs for different stores can run concurrently', async () => {
  const manager = createJobManager();
  let releaseFirst;
  const first = manager.enqueue({ type: 'query-test', platform: 'jd', storeId: 'shop_a' }, () => (
    new Promise((resolve) => { releaseFirst = resolve; })
  ));
  const second = manager.enqueue({ type: 'query-test', platform: 'jd', storeId: 'shop_b' }, async () => 'second');

  await waitUntil(() => manager.getJob(first.id).status === 'running');
  await waitUntil(() => manager.getJob(second.id).status === 'succeeded');
  assert.equal(manager.getJob(first.id).status, 'running');
  releaseFirst('first');
  await waitUntil(() => manager.getJob(first.id).status === 'succeeded');
});

test('completed job retention removes only the oldest terminal job', async () => {
  const manager = createJobManager({ maxCompletedJobs: 1 });
  const first = manager.enqueue({ type: 'one', platform: 'jd', storeId: 'a' }, async () => 1);
  await waitUntil(() => manager.getJob(first.id).status === 'succeeded');
  const second = manager.enqueue({ type: 'two', platform: 'jd', storeId: 'b' }, async () => 2);
  await waitUntil(() => manager.getJob(second.id).status === 'succeeded');

  assert.throws(() => manager.getJob(first.id), /not found/);
  assert.equal(manager.getJob(second.id).result, 2);
});
