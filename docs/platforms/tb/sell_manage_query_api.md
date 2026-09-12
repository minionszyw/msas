# 淘宝商品管理查询 API

## 页面与接口

- 登录页：`https://loginmyseller.taobao.com/`
- 登录成功页：`https://myseller.taobao.com/home.htm/QnworkbenchHome/`
- 商品管理页：`https://myseller.taobao.com/home.htm/SellManage/all`
- MTOP API：`mtop.taobao.sell.pc.manage.async`，版本 `1.0`

查询测试使用已登录 persistent context 打开商品管理页以初始化浏览器环境，随后通过页面原生 `fetch` 直接调用 MTOP。代码不读取、定位或操作商品页 DOM；浏览器网络栈负责 Cookie、Origin 和 Referer。

## 查询请求

请求使用 `application/x-www-form-urlencoded`，表单字段 `data` 是 JSON 字符串：

```json
{
  "url": "/taobao/manager/table.htm",
  "jsonBody": "{\"tab\":\"all\",\"pagination\":{\"current\":1,\"pageSize\":20},\"filtertab\":\"\",\"filter\":{\"queryItemId\":\"1073633522598\"},\"table\":{}}"
}
```

请求参数包含 `appKey=12574478`、`ttid=11320@taobao_WEB_9.9.99` 和时间戳。签名算法为：

```text
md5(<_m_h5_tk token>&<timestamp>&<appKey>&<data>)
```

若首次调用缺少或刷新 `_m_h5_tk`，读取响应更新后的 Cookie 并只重试一次。

## 响应解析

响应外层通过 `ret` 判断 MTOP 成功；`data.result` 是第二层 JSON 字符串。商品列表位于 `data.table.dataSource`，分页信息位于 `data.pagination`。查询结果按 `itemId` 精确匹配，并标准化标题、链接、价格、库存、销量、状态和创建时间。

2026-09-12 使用商品 ID `1073633522598` 验证：HTTP 200、`SUCCESS::调用成功`，返回一条匹配商品。
