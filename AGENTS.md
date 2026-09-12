# Repository Guidelines

## Project Structure & Module Organization

This CommonJS Node.js service uses a modular architecture behind one Express gateway. `src/server.js` owns HTTP routing and validation. `src/automationService.js` owns stores, jobs, locking, persistence, and platform dispatch. Keep platform URLs, selectors, login checks, and actions in `src/platforms/<platform>Platform.js`; only JD automation is implemented. Tests live in `test/`, and platform research belongs in `docs/platforms/`.

## Engineering Principles

- Keep one public gateway and a consistent adapter contract across platforms.
- Apply DRY: reuse shared validation, job orchestration, and persistence instead of copying platform-neutral logic into adapters.
- Follow the Boy Scout Rule: leave touched code clearer and cleaner than you found it, while keeping changes scoped.
- Keep the repository clean. Do not commit generated profiles, runtime state, logs, temporary patches, or debugging artifacts.

## Business Workflow

The supported sequence is: create store, complete manual login, then run a query test. Create a store with `storeId`, `name`, and `platform`; call `/stores/:storeId/login/start` and finish login in the opened Chrome window; then call `/stores/:storeId/actions/query-test/start` with a numeric `itemId`. Browser automation runs headed by default and reuses `profiles/<storeId>/` after the first login. Use `HEADLESS=1` only when explicitly required.

## Build, Test, and Development Commands

- `npm ci` installs locked dependencies.
- `npm test` runs all `node:test` suites with `node --test`.
- `npm start` starts the API at `http://127.0.0.1:8787` by default.

There is no build step. Chrome defaults to `/opt/google/chrome/chrome`; override it with `CHROME_PATH`.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, single quotes, and trailing commas in multiline structures. Use `require`/`module.exports`, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for constants. No formatter or linter is configured; match nearby code and review diffs.

## Testing Guidelines

Add descriptive tests to `test/*.test.js` using `node:test` and `node:assert/strict`. Use temporary directories for persistence tests and mock adapters so unit tests need no browser, credentials, or network. Run `npm test` before every pull request; no coverage threshold is configured.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects such as `Fix login verification`. Keep commits focused. Pull requests should explain behavior changes, list affected endpoints or actions, include test results, and link relevant issues. Add reproduction steps, logs, or screenshots for browser automation changes.

## Security & Configuration

Never commit `profiles/`, `stores.json`, cookies, credentials, or captured session responses. Configure machine-specific paths through `PROFILES_DIR`, `STORES_FILE`, and `CHROME_PATH`.
