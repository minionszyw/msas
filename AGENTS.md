# Repository Guidelines

## Architecture

This CommonJS Node.js service exposes one Express gateway. `src/server.js` owns routes and HTTP validation. `src/automationService.js` composes store persistence, job scheduling, and adapter dispatch. `src/storeRepository.js` owns portable store records and profile-path derivation; `src/jobManager.js` owns job state, retention, and per-store locks. Keep browser and platform code in `src/platforms/`. JD and Taobao are executable; PDD is registration-only.

## Engineering Rules

- Keep one public gateway and one platform registry. Never duplicate platform allowlists.
- Apply DRY to platform-neutral validation, login verification, persistence, and orchestration.
- Prefer authenticated platform APIs. Use DOM interaction only when an API cannot perform the action, and document the reason.
- Make mutations idempotent with absolute target values. Read before writing, validate resource ownership, and read back after writing.
- Follow the Boy Scout Rule while keeping changes scoped. Remove dead helpers, stale compatibility branches, logs, and temporary artifacts.
- Keep secrets and machine details internal. Never return or log cookies, tokens, profile paths, auth-state paths, or server stacks.

## Required Workflow

Every executable platform supports: create store, manual login, then `query-test`. Login uses `createManualLoginFlow()` and is headed by default. After login, close the context and use the same `profiles/<storeId>` in a forced-headless context to verify reuse. `HEADLESS=1` changes the normal launch default only; reuse verification remains headless. Query tests accept a numeric-string `itemId`.

## Extending an Adapter

Register the platform once in `src/platforms/registry.js`. Implement `platform`, `startLogin`, and an `actions` map; every action provides `validate`, `metadata`, and `run`. Reuse common action names and validators where semantics match. Use `createQueryTestAction()` for the common query contract. Keep URLs, selectors, signing, response parsing, authentication checks, and risk detection in a platform-specific protocol module. Add concise research under `docs/platforms/<platform>/`.

## Commands, Style, and Tests

Use `npm ci`, `npm test`, and `npm start`; there is no build step. Use two-space indentation, semicolons, single quotes, trailing commas in multiline structures, CommonJS modules, `camelCase`, and `UPPER_SNAKE_CASE`. No formatter or linter is configured.

Use `node:test` and `node:assert/strict` in `test/*.test.js`. Mock browser contexts and APIs. Cover validation, login failure, post-close reuse, auth expiry, risk responses, locking, migration, and cleanup. Run `npm test` and syntax checks before committing.

## Git and Security

Use short imperative commit subjects. Never commit `profiles/`, `stores.json`, credentials, cookies, captured responses, logs, or machine-specific paths. Configure runtime state with `PROFILES_DIR`, `STORES_FILE`, `CHROME_PATH`, and `MAX_COMPLETED_JOBS`.
