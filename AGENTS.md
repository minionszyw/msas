# Repository Guidelines

## Architecture

This CommonJS Node.js service exposes one Express gateway. `src/server.js` owns routes and request validation; `src/automationService.js` owns stores, jobs, per-store locking, persistence, and adapter dispatch. Platform behavior belongs in `src/platforms/<platform>Platform.js`. Reuse `src/platforms/browserContext.js` for persistent Playwright-Stealth contexts. JD and Taobao are executable; PDD is registration-only. Keep platform research in `docs/platforms/<platform>/` and tests in `test/`.

## Engineering Rules

- Keep the gateway and adapter contract consistent across platforms.
- Apply DRY: share platform-neutral browser, validation, persistence, and orchestration logic.
- Prefer authenticated platform APIs to DOM interaction. Use DOM operations only when an API cannot perform the required action, and document the reason.
- Follow the Boy Scout Rule while keeping changes scoped. Remove stale helpers, temporary files, logs, and debugging artifacts.

## Required Business Workflow

Every executable platform supports: create store, manual login, then `query-test`. Store creation accepts `storeId`, `name`, and `platform`. Login uses the shared `launchContext()` and is headed by default. After reaching the platform home page, close the login context and use the same `profiles/<storeId>` in a forced-headless context to verify reuse. Query tests accept a numeric-string `itemId` and reuse that profile. `HEADLESS=1` changes the default only when explicitly requested.

## Extending a Platform Adapter

1. Add `<platform>Platform.js` implementing `platform`, `actions`, `startLogin`, `validateActionPayload`, `createActionMetadata`, and `startAction`.
2. Expose only the common `query-test` action. Return consistent `ok`, `loginRequired`, and platform-specific risk fields.
3. Add the platform code to the gateway allowlist and register its adapter in `automationService`; this applies when implementing PDD or adding providers such as Douyin.
4. Keep URLs, authentication checks, API signing, response parsing, and risk detection inside the adapter. Never expose cookies or tokens in job results or logs.
5. Document login, success, query pages, API contracts, and fallback behavior under `docs/platforms/<platform>/`.

## Commands, Style, and Tests

Use `npm ci`, `npm test`, and `npm start`; there is no build step. Use two-space indentation, semicolons, single quotes, CommonJS modules, `camelCase` names, and `UPPER_SNAKE_CASE` constants. No formatter or linter is configured.

Use `node:test` and `node:assert/strict` in `test/*.test.js`. Mock adapters and browser contexts; cover login success/failure, post-close reuse, payload validation, API success, auth expiry, risk responses, and cleanup. Use temporary directories and run `npm test` before committing.

## Git and Security

Use short imperative commit subjects. Never commit `profiles/`, `stores.json`, credentials, cookies, session responses, or machine-specific paths. Keep configuration in `PROFILES_DIR`, `STORES_FILE`, and `CHROME_PATH`.
