const crypto = require('crypto');
const { makeError } = require('./errors');

function now() {
  return new Date().toISOString();
}

function publicJob(job) {
  return JSON.parse(JSON.stringify(job));
}

function createJobManager(options = {}) {
  const maxCompletedJobs = options.maxCompletedJobs ?? 1000;
  const jobs = new Map();
  const locks = new Map();

  async function withStoreLock(storeId, run) {
    const previous = locks.get(storeId) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => current);
    locks.set(storeId, chained);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (locks.get(storeId) === chained) locks.delete(storeId);
    }
  }

  function updateJob(job, patch) {
    Object.assign(job, patch, { updatedAt: now() });
  }

  function pruneCompletedJobs() {
    const completed = [...jobs.values()]
      .filter((job) => job.status === 'succeeded' || job.status === 'failed')
      .sort((left, right) => String(left.finishedAt).localeCompare(String(right.finishedAt)));
    for (const job of completed.slice(0, Math.max(0, completed.length - maxCompletedJobs))) jobs.delete(job.id);
  }

  function enqueue(input, run) {
    const timestamp = now();
    const job = {
      id: `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      type: input.type,
      platform: input.platform,
      storeId: input.storeId,
      status: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
      metadata: input.metadata || {},
    };
    jobs.set(job.id, job);
    setImmediate(async () => {
      try {
        const result = await withStoreLock(job.storeId, async () => {
          updateJob(job, { status: 'running', startedAt: now() });
          return run();
        });
        updateJob(job, { status: 'succeeded', result, finishedAt: now() });
      } catch (error) {
        updateJob(job, {
          status: 'failed',
          error: { message: error.message, code: error.code },
          finishedAt: now(),
        });
      } finally {
        pruneCompletedJobs();
      }
    });
    return publicJob(job);
  }

  function getJob(jobId) {
    const job = jobs.get(jobId);
    if (!job) throw makeError(`job ${jobId} not found`, 404, 'jobNotFound');
    return publicJob(job);
  }

  return { enqueue, getJob };
}

module.exports = { createJobManager };
