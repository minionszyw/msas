# JD Stealth Store API

本地多店铺 Playwright-Stealth 自动化接口。每个店铺使用独立持久化 Chrome profile，默认有头模式。

## 启动

```bash
npm install
npm start
```

默认监听：`http://127.0.0.1:8787`

## 使用

```bash
curl -X POST http://127.0.0.1:8787/stores \
  -H 'content-type: application/json' \
  -d '{"storeId":"shop_a","name":"店铺A"}'

curl -X POST http://127.0.0.1:8787/stores/shop_a/login/start \
  -H 'content-type: application/json' \
  -d '{}'

curl http://127.0.0.1:8787/jobs/<jobId>

curl -X POST http://127.0.0.1:8787/stores/shop_a/tests/query-601 \
  -H 'content-type: application/json' \
  -d '{}'
```

`query-601` 会打开商品列表页，点击全部商品，用商品编码 `10028128548417` 查询，并检查 HTTP 601、JSON `code:601`、以及“未经京东授权/网络环境较差”文案。

## 环境变量

- `PORT`：端口，默认 `8787`
- `HOST`：监听地址，默认 `127.0.0.1`
- `PROFILES_DIR`：profile 根目录，默认 `./profiles`
- `CHROME_PATH`：Chrome 路径，默认 `/opt/google/chrome/chrome`
- `HEADLESS=1`：切到无头；默认有头
