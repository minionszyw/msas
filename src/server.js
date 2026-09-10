const express = require('express');
const { z } = require('zod');
const { createAutomation } = require('./automationService');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PLATFORMS = ['jd', 'tb', 'pdd'];

const automation = createAutomation({
  rootDir: process.cwd(),
  profilesDir: process.env.PROFILES_DIR,
  storesFile: process.env.STORES_FILE,
  chromePath: process.env.CHROME_PATH,
  headed: process.env.HEADLESS !== '1',
});

const app = express();
app.use(express.json({ limit: '1mb' }));

const platformSchema = z.enum(PLATFORMS);
const storeSchema = z.object({
  storeId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().min(1).max(128).optional(),
});

function parsePlatform(req) {
  return platformSchema.parse(req.params.platform);
}

app.get('/health', (_req, res) => res.json({ ok: true, headed: process.env.HEADLESS !== '1', platforms: PLATFORMS }));

app.get('/platforms/:platform/stores', (req, res, next) => {
  try { res.json({ stores: automation.listStores(parsePlatform(req)) }); } catch (err) { next(err); }
});

app.post('/platforms/:platform/stores', (req, res, next) => {
  try {
    const platform = parsePlatform(req);
    const body = storeSchema.parse(req.body);
    res.status(201).json({ store: automation.ensureStore(platform, body.storeId, body.name || body.storeId) });
  } catch (err) { next(err); }
});

app.get('/platforms/:platform/stores/:storeId', (req, res, next) => {
  try { res.json({ store: automation.getStore(parsePlatform(req), req.params.storeId) }); } catch (err) { next(err); }
});

app.post('/platforms/:platform/stores/:storeId/login/start', (req, res, next) => {
  try {
    res.status(202).json({ job: automation.startLogin(parsePlatform(req), req.params.storeId, req.body || {}) });
  } catch (err) { next(err); }
});

app.post('/platforms/:platform/stores/:storeId/actions/:action/start', (req, res, next) => {
  try {
    res.status(202).json({ job: automation.startAction(parsePlatform(req), req.params.storeId, req.params.action, req.body || {}) });
  } catch (err) { next(err); }
});

app.get('/jobs/:jobId', (req, res, next) => {
  try { res.json({ job: automation.getJob(req.params.jobId) }); } catch (err) { next(err); }
});

app.use((err, _req, res, _next) => {
  const status = err.status || (err.name === 'ZodError' ? 400 : 500);
  res.status(status).json({ error: { message: err.message, code: err.code, details: err.issues || undefined } });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`multi-platform-store-api listening on http://${HOST}:${PORT}`);
    console.log('Default mode: headed Playwright-Stealth, one persistent profile per store.');
  });
}

module.exports = app;
