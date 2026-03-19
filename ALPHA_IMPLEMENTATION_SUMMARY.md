# 🦞 Alpha API 实现总结

## 完成时间
2026-03-14

## 实现内容

### 1. 核心功能 ✅

#### 1.1 Alpha Token List 获取
- **文件**: `src/web-server.js`
- **函数**: `fetchAlphaTokenList()`
- **API**: `https://www.binance.com/bapi/defi/v1/public/alpha-trade/get-exchange-info`
- **缓存**: 24 小时
- **返回格式**: `[{ alphaId: 'ALPHA_505', symbol: '505', name: 'ALPHA_505', status: 'TRADING' }, ...]`

#### 1.2 搜索功能更新
- **文件**: `src/web-server.js`
- **方法**: `getAllSymbols()`, `searchSymbols()`
- **功能**: 
  - 搜索时同时返回现货 + 新币 + Alpha 代币
  - Alpha 代币显示格式：`505 (ALPHA_505) (TRADING)`
  - 选择后自动设置 `source: "alpha"` 和 `alphaId: "ALPHA_505"`

#### 1.3 WebSocket 连接
- **文件**: `src/ws-connector.js`
- **地址**: `wss://nbstream.binance.com/w3w/wsa/stream`
- **流格式**: `alpha_{token_id}usdt@aggTrade`（如 `alpha_505usdt@aggTrade`）
- **功能**:
  - 自动订阅（连接后发送 SUBSCRIBE 消息）
  - 断线重连（指数退避：5s → 10s → 20s → ...）
  - 心跳检测（30 秒 ping/pong）

#### 1.4 Alpha 行情获取
- **文件**: `src/monitors.js`
- **函数**: 
  - `fetchAlphaPrice(alphaId)` - 获取价格
  - `fetchAlphaExchangeInfo()` - 获取交易所信息
  - `fetchAlphaKlines(alphaId, interval, limit)` - 获取 K 线数据
- **API 端点**:
  - Ticker: `https://www.binance.com/bapi/defi/v1/public/alpha-trade/ticker?symbol={alphaId}USDT`
  - Klines: `https://www.binance.com/bapi/defi/v1/public/alpha-trade/klines?symbol={alphaId}USDT&interval={interval}&limit={limit}`

### 2. 前端更新 ✅

#### 2.1 币种选择器
- **文件**: `public/app.js`
- **更新**:
  - `updateSymbolSelect()` - 显示 Alpha 代币（格式：`505 (ALPHA_505)`）
  - `selectSymbol()` - 解析 Alpha 代币格式并自动设置来源
  - `showAutocomplete()` - 自动补全支持 Alpha 代币

#### 2.2 添加币种
- **文件**: `src/web-server.js`
- **方法**: `_addSymbol()`
- **功能**:
  - 支持格式：`SYMBOL (ALPHA_xxx)`
  - 自动验证 Alpha 代币格式
  - 保存 `alphaId` 字段到配置

### 3. 配置更新 ✅

#### 3.1 索引文件
- **文件**: `src/index.js`
- **更新**: WebSocket 连接时传递 `alphaId` 参数

#### 3.2 WebSocket 连接器
- **文件**: `src/ws-connector.js`
- **更新**:
  - 添加 `alphaWsUrl` 配置
  - `connect()` 方法支持 `alphaId` 参数
  - `connectMultiple()` 方法传递 `alphaId`
  - `_onOpen()` 自动订阅 Alpha 流
  - `_onMessage()` 解析 Alpha aggTrade 格式

### 4. 文档 ✅

- **ALPHA_API_IMPLEMENTATION.md** - 详细 API 文档
- **README.md** - 更新使用说明和配置示例
- **test-alpha-api.js** - API 测试脚本

---

## 测试结果

```bash
$ node test-alpha-api.js

🦞 Alpha API 测试开始
============================================================

=== 测试 1: 获取 Alpha 代币列表 ===
✅ 请求成功
Alpha 代币数量：512

前 10 个 Alpha 代币:
  - ALPHA_105 (TRADING)
  - ALPHA_118 (TRADING)
  - ALPHA_142 (TRADING)
  - ALPHA_23 (TRADING)
  - ALPHA_48 (TRADING)
  - ALPHA_7 (TRADING)
  - ALPHA_15 (DELISTED)
  - ALPHA_133 (TRADING)
  - ALPHA_38 (DELISTED)
  - ALPHA_44 (TRADING)

=== 测试 2: 获取 ALPHA_105 价格 ===
✅ ALPHA_105 价格：$2.27331543

=== 测试 2: 获取 ALPHA_804 价格 ===
✅ ALPHA_804 价格：$0.07259130

=== 测试 2: 获取 ALPHA_173 价格 ===
✅ ALPHA_173 价格：$0.02589849

=== 测试 3: 获取交易所信息 ===
✅ 请求成功

=== 测试 4: 获取 ALPHA_105 K 线数据 ===
✅ 获取到 5 条 K 线

============================================================
✅ Alpha API 测试完成
============================================================
```

---

## 使用示例

### 添加 Alpha 代币

**Web 界面:**
1. 进入"币种管理"页面
2. 点击"添加币种"
3. 输入 `505` 或 `ALPHA_505`
4. 选择 `505 (ALPHA_505) (TRADING)`
5. 来源自动设置为 `alpha`
6. 点击"添加"

**配置文件:**
```json
{
  "symbols": [
    {
      "symbol": "505",
      "source": "alpha",
      "alphaId": "ALPHA_505",
      "enabled": true,
      "targets": [],
      "volatility": {
        "enabled": true,
        "windowMinutes": 60,
        "thresholdPercent": 5.0,
        "stepThreshold": 1.0
      }
    }
  ]
}
```

**API:**
```bash
curl -X POST http://localhost:3000/api/symbols \
  -H "Content-Type: application/json" \
  -H "X-API-Token: crypto_radar_token_2024" \
  -d '{
    "symbol": "505 (ALPHA_505)",
    "source": "alpha",
    "enabled": true
  }'
```

---

## 注意事项

### 1. Alpha ID 格式
- **Token List API** 返回 hex 格式 tokenId（如 `6EEEBBD81CA5B439933BBC6398BCD071`）
- **Ticker/Klines API** 使用 `ALPHA_xxx` 格式（如 `ALPHA_505`）
- **实现**: 使用 `get-exchange-info` API 获取正确的 `ALPHA_xxx` 格式

### 2. 响应格式
- Alpha API 的数据在 `response.data` 里
- 例如：`data.data.lastPrice` 而不是 `data.lastPrice`

### 3. WebSocket 订阅
- Alpha WebSocket 需要主动发送 SUBSCRIBE 消息
- 流格式：`alpha_{token_id}usdt@aggTrade`
- 消息格式：`{"method": "SUBSCRIBE", "params": ["alpha_505usdt@aggTrade"], "id": 1}`

### 4. 缓存策略
- Token List 缓存 24 小时
- 缓存键：`alphaTokenCache`
- 自动刷新：过期后自动重新获取

---

## 文件清单

| 文件 | 修改内容 |
|------|----------|
| `src/web-server.js` | 添加 `fetchAlphaTokenList()`, 更新 `getAllSymbols()`, `searchSymbols()`, `_addSymbol()` |
| `src/ws-connector.js` | 添加 Alpha WebSocket 支持，更新 `connect()`, `_onOpen()`, `_onMessage()` |
| `src/monitors.js` | 添加 `fetchAlphaPrice()`, `fetchAlphaExchangeInfo()`, `fetchAlphaKlines()` |
| `src/index.js` | 更新 WebSocket 连接传递 `alphaId` |
| `public/app.js` | 更新 `updateSymbolSelect()`, `selectSymbol()`, `showAutocomplete()` |
| `README.md` | 添加 Alpha 使用说明和配置示例 |
| `ALPHA_API_IMPLEMENTATION.md` | 创建详细 API 文档 |
| `test-alpha-api.js` | 创建 API 测试脚本 |

---

## 下一步

- [ ] 添加 Alpha 代币状态定期更新（每 24 小时）
- [ ] 优化 WebSocket 连接池管理
- [ ] 添加 Alpha 代币价格图表
- [ ] 支持 Alpha 代币价格目标告警

---

_🦞 按官方 API 实现，这次必须搞定 Alpha！_
