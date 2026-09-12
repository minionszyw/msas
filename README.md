# Multi-Platform Store API

本地多平台店铺 Playwright-Stealth 自动化接口。每个店铺使用独立持久化 Chrome profile，默认有头模式。当前实现京东和淘宝的登录与查询测试，拼多多可先登记店铺信息。

## 启动

```bash
npm install
npm start
```

默认监听：`http://127.0.0.1:8787`

## 业务流程

### 1. 创建店铺

```bash
curl -X POST http://127.0.0.1:8787/stores \
  -H 'content-type: application/json' \
  -d '{"storeId":"shop_jd","name":"京东店铺","platform":"jd"}'

curl -X POST http://127.0.0.1:8787/stores \
  -H 'content-type: application/json' \
  -d '{"storeId":"shop_tb","name":"淘宝店铺","platform":"tb"}'
```

创建参数包括店铺 ID、店铺名和平台。

### 2. 首次人工登录

```bash
curl -X POST http://127.0.0.1:8787/stores/shop_jd/login/start \
  -H 'content-type: application/json' \
  -d '{}'

curl -X POST http://127.0.0.1:8787/stores/shop_tb/login/start \
  -H 'content-type: application/json' \
  -d '{}'

curl http://127.0.0.1:8787/jobs/<jobId>
```

在打开的 Chrome 中完成人工登录。进入平台首页并关闭浏览器后，服务会使用同一 `profiles/<storeId>/` 启动无头 Chrome，再次访问首页以验证登录态能够复用。登录任务仅在 `loginPageOk` 和 `reuseCheck.ok` 都为 `true` 时返回 `ok: true`。

### 3. 查询测试

```bash
curl -X POST http://127.0.0.1:8787/stores/shop_jd/actions/query-test/start \
  -H 'content-type: application/json' \
  -d '{"itemId":"<商品ID>"}'

curl -X POST http://127.0.0.1:8787/stores/shop_tb/actions/query-test/start \
  -H 'content-type: application/json' \
  -d '{"itemId":"<商品ID>"}'

curl http://127.0.0.1:8787/jobs/<jobId>
```

`query-test` 使用数字字符串 `itemId`。京东通过商品列表页查询并检测 601 风控；淘宝直接调用 `mtop.taobao.sell.pc.manage.async`，不依赖商品页 DOM。淘宝结果通过 `itemFound` 和 `item` 返回匹配商品，通过 `loginRequired` 和 `riskCheck.detected` 区分登录失效与安全验证。

## 环境变量

- `PORT`：端口，默认 `8787`
- `HOST`：监听地址，默认 `127.0.0.1`
- `PROFILES_DIR`：profile 根目录，默认 `./profiles`
- `STORES_FILE`：店铺数据文件，默认 `./stores.json`
- `CHROME_PATH`：Chrome 路径，默认 `/opt/google/chrome/chrome`
- `HEADLESS=1`：切到无头；默认有头
- `MAX_COMPLETED_JOBS`：内存中保留的已完成任务数，必须为正整数，默认 `1000`

`timeoutMs` 可用于调整人工登录等待时间，必须是 `1` 到 `3600000` 之间的整数，默认十分钟。

服务启动时会规范化旧版 `stores.json`：保留店铺业务字段，并根据当前 `PROFILES_DIR` 重新派生 profile 路径。文件损坏或结构非法时服务会明确报错，不会将其当作空数据覆盖。
超过保留上限后，最旧的已完成任务会被移除，再次查询其 job ID 将返回 `404`；排队或运行中的任务不会被移除。

## 架构

- `src/server.js`：统一 HTTP 网关。
- `src/automationService.js`：组合店铺、任务与平台动作的业务编排。
- `src/storeRepository.js`：店铺持久化和旧数据迁移。
- `src/jobManager.js`：任务生命周期、同店铺串行锁和完成任务清理。
- `src/platforms/`：平台注册表、共享登录流程和平台 adapter；平台 API 协议与页面操作相互隔离。
- `docs/platforms/`：平台专属验证资料。
