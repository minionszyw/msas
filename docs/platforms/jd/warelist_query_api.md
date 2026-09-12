# 京东商品管理查询 API

## 页面与接口

- 登录页：`https://passport.shop.jd.com/login/index.action/jdm`
- 登录成功页：`https://shop.jd.com/jdm/home`
- 商品列表页：`https://wares-jdm.jd.com/ware/wareList?activeTab=OnsaleWare&businessModel=0`
- 查询 API：`dsm.product.manage.ProductInfoReadViewService.queryValidProductList`

首次登录使用 persistent context。登录窗口进入京东首页并关闭后，服务使用同一 `profiles/<storeId>` 启动无头 context，再次访问首页验证登录态复用。

查询测试打开商品列表页，填写调用方提供的 `itemId` 并触发查询，同时监听目标 API 的请求与响应。平台专属页面操作和风控解析均封装在京东 adapter 内。

## 查询请求

目标接口使用 `POST https://sff.jd.com/api`，查询参数包含 `api=dsm.product.manage.ProductInfoReadViewService.queryValidProductList`。主要请求体结构为：

```json
{
  "productListQueryReq": {
    "productIdList": ["<itemId>"],
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

## 响应与风控判断

查询成功要求目标 API 返回 HTTP 200 且 JSON `code` 为 200。adapter 同时检查 HTTP 601、JSON `code:601`、“未经京东授权”和“网络环境较差”等风控信号。

任务结果通过 `ok` 表示查询是否成功且未命中风控，`hit601` 表示是否检测到风控，`loginRequired` 表示 persistent profile 的登录态是否失效。
