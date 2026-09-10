# Multi-Platform Store API

本地多平台店铺 Playwright-Stealth 自动化接口。每个店铺使用独立持久化 Chrome profile，默认有头模式。架构支持拓展淘宝、拼多多等平台；首版实现京东平台能力，淘宝/拼多多可先登记店铺信息。

## 启动

```bash
npm install
npm start
```

默认监听：`http://127.0.0.1:8787`

## 使用

```bash
curl -X POST http://127.0.0.1:8787/platforms/jd/stores \
  -H 'content-type: application/json' \
  -d '{"storeId":"shop_a","name":"店铺A"}'

curl -X POST http://127.0.0.1:8787/platforms/tb/stores \
  -H 'content-type: application/json' \
  -d '{"storeId":"shop_b","name":"店铺B"}'

curl -X POST http://127.0.0.1:8787/platforms/jd/stores/shop_a/login/start \
  -H 'content-type: application/json' \
  -d '{}'

curl http://127.0.0.1:8787/jobs/<jobId>

curl -X POST http://127.0.0.1:8787/platforms/jd/stores/shop_a/actions/query-601/start \
  -H 'content-type: application/json' \
  -d '{}'
```

`query-601` 是京东平台首版动作，会打开商品列表页，点击全部商品，用商品编码 `10028128548417` 查询，并检查 HTTP 601、JSON `code:601`、以及“未经京东授权/网络环境较差”文案。

## 环境变量

- `PORT`：端口，默认 `8787`
- `HOST`：监听地址，默认 `127.0.0.1`
- `PROFILES_DIR`：profile 根目录，默认 `./profiles`
- `STORES_FILE`：店铺数据文件，默认 `./stores.json`
- `CHROME_PATH`：Chrome 路径，默认 `/opt/google/chrome/chrome`
- `HEADLESS=1`：切到无头；默认有头

## 架构

- `src/server.js`：统一 HTTP 网关。
- `src/automationService.js`：平台无关的店铺、任务、锁和分发逻辑。
- `src/platforms/`：平台 adapter，平台专属 URL、选择器和动作只放在对应 adapter 内。
- `docs/platforms/`：平台专属验证资料。
