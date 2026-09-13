---
name: msas-store-automation
description: "Operate MSAS seller stores through its local HTTP gateway: create JD, Taobao, or PDD stores; run manual login; query products; change JD product status, SKU stock, or SKU price; submit batches; poll jobs; and manage browser sessions. Use for repository tasks involving store automation, product lookup, listing state, inventory, price, or login state."
---

# MSAS Store Automation

Use the unified gateway at `http://127.0.0.1:8787` by default. Start it with `npm start` when needed. Keep the default headed mode unless the user sets `HEADLESS=1`. Never bypass the gateway to call platform APIs or manipulate product-page DOM.

## Platforms and workflow

- JD (`jd`) supports the full workflow and all product actions below.
- Taobao (`tb`) supports the full workflow and `query-test`.
- PDD (`pdd`) supports store registration only.

For executable platforms, follow: create store, manual login, then `query-test`. Create a store with `POST /stores` and `{ "storeId", "name", "platform" }`. Start login with `POST /stores/{storeId}/login/start`; it opens Chrome for the user, closes it after login, and verifies profile reuse headlessly. Poll every asynchronous operation through `GET /jobs/{jobId}` until `succeeded` or `failed`.

## Actions

Start an action with `POST /stores/{storeId}/actions/{action}/start`.

- `query-test`: `{ "itemId": "<numeric ID>" }` on JD or Taobao.
- `query-products` (JD): provide at least one of `productName`, `skuIds`, `productIds`, or `itemNum`; optional `pageNum` and `pageSize`. Code lists accept arrays or comma/space-delimited values, up to 100.
- `update-product-status` (JD): `{ "productIds": ["<product ID>"], "status": "online" | "offline" }`.
- `update-sku-stock` (JD): `{ "productId": "<product ID>", "updates": [{ "skuId": "<SKU ID>", "stock": 88 }] }`.
- `update-sku-price` (JD): `{ "productId": "<product ID>", "updates": [{ "skuId": "<SKU ID>", "price": "19.90" }] }`.

Submit mixed JD mutations with `POST /stores/{storeId}/actions/batch/start` and `{ "operations": [{ "action", "payload" }] }`. A batch accepts at most 100 operations and 100 total targets, preserves input order, and continues after individual failures.

## Mutation and session rules

Use absolute status, stock, and price targets. For a relative request, query current values first and calculate the target; never guess. The service validates ownership, skips unchanged values, and reads back mutations. Check `verified`, per-target failures, and the terminal job status before reporting success.

Jobs for one store run serially and reuse one browser context; different stores can run concurrently. Inspect a context with `GET /stores/{storeId}/session` and close it with `DELETE /stores/{storeId}/session`. Sessions close after ten idle minutes.
