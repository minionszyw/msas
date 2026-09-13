# Repository Guidelines

## Architecture

This Node.js service has one Express gateway. `src/automationService.js` composes persistence, jobs, sessions, and adapters. `src/jobManager.js` serializes each store; `src/browserSessionManager.js` reuses its context for ten idle minutes. `src/batchService.js` runs mixed mutations. JD and Taobao are executable; PDD is registration-only.

## Engineering Rules

- Keep one public gateway and one platform registry. Never duplicate platform allowlists.
- Apply DRY to platform-neutral validation, login verification, persistence, and orchestration.
- Reuse one context per store across serial jobs. Do not add adapter-local session caches or bypass the store lock.
- Prefer authenticated platform APIs. Use DOM interaction only when an API cannot perform the action, and document the reason.
- Make mutations idempotent with absolute target values. Read before writing, validate resource ownership, and read back after writing.
- Keep `.agents/skills/msas-store-automation/SKILL.md` aligned with public gateway actions and payloads.
- Follow the Boy Scout Rule. Remove dead helpers, stale branches, logs, and temporary artifacts.
- Keep secrets and machine details internal. Never return or log cookies, tokens, profile paths, auth-state paths, or server stacks.

## Required Workflow

Every executable platform supports: create store, manual login, then `query-test`. Login uses `createManualLoginFlow()` and is headed by default. Close any cached session before login; then close the login context and verify the same profile in a forced-headless context. Business actions create the configured-mode session lazily and reuse it. `HEADLESS=1` affects business and login launch defaults only; reuse verification remains headless.

## Extending an Adapter

Register each platform once in `src/platforms/registry.js`. Implement `platform`, `startLogin`, `closeSession`, and `actions`. Actions provide `validate`, `metadata`, and `run`; batchable actions also provide `targetCount`. Reuse common action factories where semantics match. Keep URLs, signing, parsing, authentication, and risk detection in a platform protocol module. Update the project skill when public actions change; keep research under `docs/platforms/<platform>/`.

## Commands, Style, and Tests

Use `npm ci`, `npm test`, and `npm start`; there is no build step. Use two-space indentation, semicolons, single quotes, trailing commas in multiline structures, CommonJS modules, `camelCase`, and `UPPER_SNAKE_CASE`. No formatter or linter is configured.

Use `node:test` and `node:assert/strict` in `test/*.test.js`. Mock browsers and APIs. Cover validation, login reuse, auth expiry, risk, locking, session lifecycle, ordered 100-operation batches, and partial failures. Run `npm test` and syntax checks before committing.

## Git and Security

Use short imperative commit subjects. Never commit `profiles/`, `stores.json`, credentials, cookies, captured responses, logs, or machine-specific paths. Configure runtime state with `PROFILES_DIR`, `STORES_FILE`, `CHROME_PATH`, and `MAX_COMPLETED_JOBS`.
