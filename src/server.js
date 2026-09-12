const express = require('express');
const { z } = require('zod');
const { createAutomation } = require('./automationService');
const { SUPPORTED_PLATFORMS } = require('./platforms/registry');

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';

function createApp(options = {}) {
  const headed = options.headed ?? process.env.HEADLESS !== '1';
  const automation = options.automation || createAutomation({
    rootDir: process.cwd(),
    profilesDir: process.env.PROFILES_DIR,
    storesFile: process.env.STORES_FILE,
    chromePath: process.env.CHROME_PATH,
    headed,
    maxCompletedJobs: process.env.MAX_COMPLETED_JOBS,
  });
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const platformSchema = z.enum(SUPPORTED_PLATFORMS);
  const storeSchema = z.object({
    storeId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    name: z.string().min(1).max(128).optional(),
    platform: platformSchema,
  });

  app.get('/health', (_req, res) => res.json({ ok: true, headed, platforms: SUPPORTED_PLATFORMS }));

  app.get('/stores', (req, res, next) => {
    try {
      const platform = req.query.platform ? platformSchema.parse(req.query.platform) : undefined;
      res.json({ stores: automation.listStores(platform) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/stores', (req, res, next) => {
    try {
      const body = storeSchema.parse(req.body);
      res.status(201).json({ store: automation.ensureStore(body.platform, body.storeId, body.name || body.storeId) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/stores/:storeId', (req, res, next) => {
    try {
      res.json({ store: automation.getStore(req.params.storeId) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/stores/:storeId/login/start', (req, res, next) => {
    try {
      res.status(202).json({ job: automation.startLogin(req.params.storeId, req.body || {}) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/stores/:storeId/actions/:action/start', (req, res, next) => {
    try {
      res.status(202).json({ job: automation.startAction(req.params.storeId, req.params.action, req.body || {}) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/jobs/:jobId', (req, res, next) => {
    try {
      res.json({ job: automation.getJob(req.params.jobId) });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    const status = error.status || (error.name === 'ZodError' ? 400 : 500);
    res.status(status).json({
      error: { message: error.message, code: error.code, details: error.issues || undefined },
    });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const host = process.env.HOST || DEFAULT_HOST;
  const headed = process.env.HEADLESS !== '1';
  createApp({ headed }).listen(port, host, () => {
    console.log(`multi-platform-store-api listening on http://${host}:${port}`);
    console.log(`Browser mode: ${headed ? 'headed' : 'headless'} Playwright-Stealth, one persistent profile per store.`);
  });
}

module.exports = { createApp };
