# 京东商品列表页查询 API

- 页面：`https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0`
- Tab：点击 `#tab-AllWare > div > span`（全部商品）
- 查询按钮：`#app > div > div:nth-child(3) > form > div > div > div.jd-form-item.asterisk-left.actions-form-item > div.jd-form-item__content > div > button.jd-button.jd-button--primary.is-plain`


## Playwright-Stealth 有头验证

- 验证目的：普通有头 Playwright 复用 Playwright-mcp 登录态执行商品列表查询时可能触发 601/环境异常，因此补充使用 `playwright-extra` + `puppeteer-extra-plugin-stealth` 的有头模式验证。
- 登录态复用：沿用 Playwright-mcp 的用户数据目录 `.playwright-mcp`，通过 `chromium.launchPersistentContext(userDataDir, { headless: false, executablePath: "/opt/google/chrome/chrome" })` 启动。
- Stealth 插件：`chromium.use(StealthPlugin())`，并保留 `--disable-blink-features=AutomationControlled` 等启动参数。
- 实测操作：进入商品列表页，点击“全部商品”，在“商品编码”输入 `10028128548417`，点击查询按钮，并监听 `fetch/xhr` 请求。
- 实测结果：查询接口 `dsm.product.manage.ProductInfoReadViewService.queryValidProductList` 返回 HTTP `200`，JSON `code:200`，`msg:"成功"`。
- 601 检测结果：HTTP `601` 次数为 `0`；响应体 JSON `code:601` 次数为 `0`；响应体未出现“未经京东授权”或“网络环境较差”。
- 结论：使用 `playwright-stealth` 有头复用 `.playwright-mcp` 登录态执行商品列表查询，未出现 601 报错。

### Playwright-Stealth 参考脚本

```js
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const context = await chromium.launchPersistentContext('.playwright-mcp', {
  headless: false,
  executablePath: '/opt/google/chrome/chrome',
  viewport: { width: 1365, height: 900 },
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check'
  ]
});

const page = context.pages()[0] || await context.newPage();
await page.goto('https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0');
await page.locator('#tab-AllWare > div > span').click();

page.on('response', async (res) => {
  if (res.url().includes('dsm.product.manage.ProductInfoReadViewService.queryValidProductList')) {
    console.log(res.status(), await res.text());
  }
});
```

## 核心接口

- Method：`POST`
- URL：`https://sff.jd.com/api?v=1.0&appId=3MC69M4R3HFKCQ4S01DN&api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList`
- 主要请求体结构：`productListQueryReq` + `accessContext`

## 四种查询字段映射

| 查询项 | 请求字段 | 示例值 |
|---|---|---|
| 商品名称 | `productListQueryReq.productName` | `硫酸沙丁胺醇吸入气雾剂` |
| 商品编码 | `productListQueryReq.productIdList` | `[10028128548417]` |
| SKU编码 | `productListQueryReq.skuIdList` | `[10028128548417]` |
| 货号 | `productListQueryReq.itemNum` | `1045513` |

## 请求样例

### 商品名称
- URL：`https://sff.jd.com/api?v=1.0&appId=3MC69M4R3HFKCQ4S01DN&api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList`
```json
{
  "productListQueryReq": {
    "productName": "硫酸沙丁胺醇吸入气雾剂",
    "skuIdList": null,
    "categoryIdList": null,
    "productIdList": null,
    "salesVolume": null,
    "jdPrice": null,
    "shopCategory": null,
    "stockNum": null,
    "brandIdList": [],
    "itemNum": null,
    "productState": "11",
    "modified": null,
    "productType": null,
    "startOnlineTime": null,
    "endOnlineTime": null,
    "startOfflineTime": null,
    "endOfflineTime": null,
    "startCreated": null,
    "endCreated": null,
    "startModified": null,
    "endModified": null,
    "categoryIds": [],
    "minSalesVolume": null,
    "maxSalesVolume": null,
    "minJdPrice": null,
    "maxJdPrice": null,
    "minStockNum": null,
    "maxStockNum": null,
    "supplyProductIdList": null,
    "supplySkuIdList": null,
    "supplyIdList": null,
    "sortMap": {
      "modified": "desc"
    },
    "pageNum": 1,
    "pageSize": 10
  },
  "accessContext": {
    "source": "web",
    "businessModel": "0",
    "proxyBelongBizId": "",
    "originType": null
  }
}
```

### 商品编码
- URL：`https://sff.jd.com/api?v=1.0&appId=3MC69M4R3HFKCQ4S01DN&api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList`
```json
{
  "productListQueryReq": {
    "productName": null,
    "skuIdList": null,
    "categoryIdList": null,
    "productIdList": [
      10028128548417
    ],
    "salesVolume": null,
    "jdPrice": null,
    "shopCategory": null,
    "stockNum": null,
    "brandIdList": [],
    "itemNum": null,
    "productState": "11",
    "modified": null,
    "productType": null,
    "startOnlineTime": null,
    "endOnlineTime": null,
    "startOfflineTime": null,
    "endOfflineTime": null,
    "startCreated": null,
    "endCreated": null,
    "startModified": null,
    "endModified": null,
    "categoryIds": [],
    "minSalesVolume": null,
    "maxSalesVolume": null,
    "minJdPrice": null,
    "maxJdPrice": null,
    "minStockNum": null,
    "maxStockNum": null,
    "supplyProductIdList": null,
    "supplySkuIdList": null,
    "supplyIdList": null,
    "sortMap": {
      "modified": "desc"
    },
    "pageNum": 1,
    "pageSize": 10
  },
  "accessContext": {
    "source": "web",
    "businessModel": "0",
    "proxyBelongBizId": "",
    "originType": null
  }
}
```

### SKU编码
- URL：`https://sff.jd.com/api?v=1.0&appId=3MC69M4R3HFKCQ4S01DN&api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList`
```json
{
  "productListQueryReq": {
    "productName": null,
    "skuIdList": [
      10028128548417
    ],
    "categoryIdList": null,
    "productIdList": null,
    "salesVolume": null,
    "jdPrice": null,
    "shopCategory": null,
    "stockNum": null,
    "brandIdList": [],
    "itemNum": null,
    "productState": "11",
    "modified": null,
    "productType": null,
    "startOnlineTime": null,
    "endOnlineTime": null,
    "startOfflineTime": null,
    "endOfflineTime": null,
    "startCreated": null,
    "endCreated": null,
    "startModified": null,
    "endModified": null,
    "categoryIds": [],
    "minSalesVolume": null,
    "maxSalesVolume": null,
    "minJdPrice": null,
    "maxJdPrice": null,
    "minStockNum": null,
    "maxStockNum": null,
    "supplyProductIdList": null,
    "supplySkuIdList": null,
    "supplyIdList": null,
    "sortMap": {
      "modified": "desc"
    },
    "pageNum": 1,
    "pageSize": 10
  },
  "accessContext": {
    "source": "web",
    "businessModel": "0",
    "proxyBelongBizId": "",
    "originType": null
  }
}
```

### 货号
- URL：`https://sff.jd.com/api?v=1.0&appId=3MC69M4R3HFKCQ4S01DN&api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList`
```json
{
  "productListQueryReq": {
    "productName": null,
    "skuIdList": null,
    "categoryIdList": null,
    "productIdList": null,
    "salesVolume": null,
    "jdPrice": null,
    "shopCategory": null,
    "stockNum": null,
    "brandIdList": [],
    "itemNum": "1045513",
    "productState": "11",
    "modified": null,
    "productType": null,
    "startOnlineTime": null,
    "endOnlineTime": null,
    "startOfflineTime": null,
    "endOfflineTime": null,
    "startCreated": null,
    "endCreated": null,
    "startModified": null,
    "endModified": null,
    "categoryIds": [],
    "minSalesVolume": null,
    "maxSalesVolume": null,
    "minJdPrice": null,
    "maxJdPrice": null,
    "minStockNum": null,
    "maxStockNum": null,
    "supplyProductIdList": null,
    "supplySkuIdList": null,
    "supplyIdList": null,
    "sortMap": {
      "modified": "desc"
    },
    "pageNum": 1,
    "pageSize": 10
  },
  "accessContext": {
    "source": "web",
    "businessModel": "0",
    "proxyBelongBizId": "",
    "originType": null
  }
}
```
