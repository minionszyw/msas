# 京东商品管理 API

## 页面与接口

- 登录页：`https://passport.shop.jd.com/login/index.action/jdm`
- 登录成功页：`https://shop.jd.com/jdm/home`
- 商品列表页：`https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0`
- 商品查询：`dsm.product.manage.ProductInfoReadViewService.queryValidProductList`
- 库存读取/写入：`getSkuStockV2` / `batchUpdateStockNum`
- 价格读取/写入：`querySkuPrice` / `updatePrices`
- 状态写入：`updateProductStatus`

首次登录使用 persistent context。登录窗口进入京东首页并关闭后，服务使用同一 `profiles/<storeId>` 启动无头 context，再次访问首页验证登录态复用。

业务动作只导航到商品列表页以加载京东安全 SDK，随后在页面环境生成 H5ST 和 EID 并直接请求 SFF API。裸 `fetch` 会返回 `code: 312`，因此签名步骤不可省略。签名、EID、Cookie 和原始响应不得进入任务结果或日志。

## 查询请求

目标接口使用 `POST https://sff.jd.com/api`，查询参数包含 `api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList`。主要请求体结构为：

```json
{
  "productListQueryReq": {
    "productName": "<商品名称或null>",
    "skuIdList": ["<SKU编码>"],
    "productIdList": ["<商品编码>"],
    "itemNum": "<货号或null>",
    "productState": "11",
    "sortMap": { "modified": "desc" },
    "pageNum": 1,
    "pageSize": 10
  },
  "accessContext": {
    "source": "web",
    "businessModel": "0"
  }
}
```

外部动作接受数字字符串，京东协议层在检查安全整数范围后转换为数值数组。商品编码和 SKU 编码支持最多 100 个，服务端通过 `pageNum` 和 `pageSize` 控制分页。

## 写入与验证

状态更新发送 `operation: "up" | "down"` 和商品 `skuGroups`。库存写入发送全部 SKU 当前库存及目标库存；价格写入仅发送要修改的 SKU。公共接口只接受库存、价格绝对目标值，以便重复提交保持幂等。

每次写操作先查询商品与 SKU 归属和当前值，写入后再调用读取 API。已经达到目标值时跳过写入；回读不一致时返回 `verified: false` 和失败编码。

## 响应与风控判断

成功要求目标 API 返回 HTTP 200 且 JSON `code` 为 200。adapter 将 HTTP/JSON 601、312、“未经京东授权”和“网络环境较差”识别为风控，将登录或授权提示识别为登录态失效。

任务结果通过 `ok` 表示查询是否成功且未命中风控，`hit601` 表示是否检测到风控，`loginRequired` 表示 persistent profile 的登录态是否失效。
