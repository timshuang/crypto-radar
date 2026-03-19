# 🦞 Binance Alpha API 实现文档

> 币安 Alpha 官方 API 集成指南

## 官方 API 端点

### API 基础 URL
```
https://www.binance.com/bapi/defi/v1/public/alpha-trade/
```

### 端点列表

| 功能 | 端点 | 参数 | 说明 |
|------|------|------|------|
| Token List | `/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list` | 无 | 获取所有 Alpha 代币列表 |
| Exchange Info | `/bapi/defi/v1/public/alpha-trade/get-exchange-info` | 无 | 获取交易所信息 |
| Ticker 24h | `/bapi/defi/v1/public/alpha-trade/ticker` | `symbol=ALPHA_{id}USDT` | 获取 24 小时行情 |
| Klines | `/bapi/defi/v1/public/alpha-trade/klines` | `symbol`, `interval`, `limit` | 获取 K 线数据 |

### WebSocket
```
wss://nbstream.binance.com/w3w/wsa/stream
```

**订阅格式：**
```
alpha_{token_id}usdt@aggTrade
```

**示例：**
```
alpha_173usdt@aggTrade
alpha_804usdt@aggTrade
```

---

## 实现功能

### 1. Alpha Token List 获取

**位置：** `src/web-server.js`

```javascript
async function fetchAlphaTokenList() {
  const url = 'https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list';
  const response = await fetch(url);
  const data = await response.json();
  // 返回格式：[{ alphaId: 'ALPHA_804', symbol: 'UP', name: 'Unitas', price: '0.07' }, ...]
  return data.data || [];
}
```

**特性：**
- ✅ 缓存 24 小时
- ✅ 自动重试
- ✅ 错误处理

---

### 2. 搜索功能更新

**支持格式：**
- 现货：`BTCUSDT (TRADING)`
- 新币：`PORTALUSDT (TRADING)`
- Alpha：`UP (ALPHA_804) (TRADING)`、`龙虾 (ALPHA_772) (TRADING)`

**选择后自动设置：**
- `source: "alpha"`
- `alphaId: "ALPHA_804"`

---

### 3. WebSocket 连接

**位置：** `src/ws-connector.js`

```javascript
// Alpha WebSocket 地址
const ALPHA_WS_URL = 'wss://nbstream.binance.com/w3w/wsa/stream';

// 订阅 Alpha 代币
// 流格式：alpha_{token_id}usdt@aggTrade
// 例如：alpha_173usdt@aggTrade
```

**连接逻辑：**
```javascript
if (source === 'alpha' && alphaId) {
  const tokenNum = alphaId.replace('ALPHA_', '');
  const streamName = `alpha_${tokenNum}usdt@aggTrade`;
  // 连接并订阅
}
```

**特性：**
- ✅ 自动订阅
- ✅ 断线重连（指数退避）
- ✅ 心跳检测（30 秒 ping/pong）

---

### 4. Alpha 行情获取

**位置：** `src/monitors.js`

```javascript
// 获取 Alpha 代币价格
async function fetchAlphaPrice(alphaId) {
  const url = `https://www.binance.com/bapi/defi/v1/public/alpha-trade/ticker?symbol=${alphaId}USDT`;
  const response = await fetch(url);
  const data = await response.json();
  return data.data.lastPrice; // 注意：数据在 data.data 里
}
```

**其他函数：**
- `fetchAlphaExchangeInfo()` - 获取交易所信息
- `fetchAlphaKlines(alphaId, interval, limit)` - 获取 K 线数据

---

### 5. 前端更新

**币种管理页面：**
- ✅ 显示 Alpha 代币（格式：`UP (ALPHA_804)`）
- ✅ 添加 Alpha 代币时自动识别格式
- ✅ WebSocket 连接状态显示

**自动补全：**
- 支持搜索 Alpha 代币
- 显示格式：`UP (ALPHA_804) (TRADING)`
- 选择后自动设置来源为 `alpha`

---

## 使用示例

### 添加 Alpha 代币

**通过 Web 界面：**
1. 进入"币种管理"页面
2. 点击"添加币种"
3. 输入框输入 `UP` 或 `ALPHA_804`
4. 选择 `UP (ALPHA_804) (TRADING)`
5. 来源自动设置为 `alpha`
6. 点击"添加"

**通过 API：**
```bash
curl -X POST http://localhost:3000/api/symbols \
  -H "Content-Type: application/json" \
  -H "X-API-Token: crypto_radar_token_2024" \
  -d '{
    "symbol": "UP (ALPHA_804)",
    "source": "alpha",
    "enabled": true
  }'
```

**配置文件：**
```json
{
  "symbols": [
    {
      "symbol": "UP",
      "source": "alpha",
      "alphaId": "ALPHA_804",
      "enabled": true,
      "targets": [],
      "volatility": {
        "enabled": true,
        "windowMinutes": 60,
        "thresholdPercent": 2.0,
        "stepThreshold": 0.5
      }
    }
  ]
}
```

---

## 数据格式说明

### Alpha Token List 响应
```json
{
  "code": "000000",
  "message": "success",
  "data": [
    {
      "tokenId": "ALPHA_804",
      "symbol": "UP",
      "name": "Unitas",
      "price": "0.07",
      "status": "TRADING"
    }
  ]
}
```

### Alpha Ticker 响应
```json
{
  "code": "000000",
  "message": "success",
  "data": {
    "symbol": "ALPHA_804USDT",
    "lastPrice": "0.07",
    "priceChange": "0.002",
    "priceChangePercent": "2.94",
    "volume": "1234567"
  }
}
```

### Alpha WebSocket 消息
```json
{
  "e": "aggTrade",
  "E": 1234567890,
  "s": "ALPHA_804USDT",
  "a": 12345,
  "p": "0.07",
  "q": "100",
  "f": 100,
  "l": 100,
  "T": 1234567890,
  "m": true
}
```

---

## 注意事项

### 1. 响应格式
- **重要：** Alpha API 的数据在 `response.data` 里，不是直接在 `response` 里
- 例如：`data.data.lastPrice` 而不是 `data.lastPrice`

### 2. Token List 缓存
- 缓存时间：24 小时
- 缓存键：`alphaTokenCache`
- 自动刷新：过期后自动重新获取

### 3. WebSocket 重连
- 初始重连延迟：5 秒
- 最大重连延迟：80 秒
- 退避策略：指数退避（5s → 10s → 20s → ...）

### 4. 连接数限制
- 最大连接数：20 个币种
- 包括现货 + 新币 + Alpha 的总和

---

## 测试方法

### 1. 测试 Token List
```bash
curl https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list
```

### 2. 测试 Ticker
```bash
curl "https://www.binance.com/bapi/defi/v1/public/alpha-trade/ticker?symbol=ALPHA_804USDT"
```

### 3. 测试 K 线
```bash
curl "https://www.binance.com/bapi/defi/v1/public/alpha-trade/klines?symbol=ALPHA_804USDT&interval=1m&limit=10"
```

### 4. 测试 WebSocket
使用 `wscat` 工具：
```bash
npm install -g wscat
wscat -c wss://nbstream.binance.com/w3w/wsa/stream
```

发送订阅消息：
```json
{"method": "SUBSCRIBE", "params": ["alpha_804usdt@aggTrade"], "id": 1}
```

---

## 故障排查

### 问题 1：Alpha 代币无法连接
**检查：**
- `alphaId` 格式是否正确（必须是 `ALPHA_xxx`）
- WebSocket URL 是否正确
- 是否已发送订阅消息

### 问题 2：价格数据不更新
**检查：**
- WebSocket 连接状态
- 消息格式是否解析正确
- 日志中是否有错误信息

### 问题 3：Token List 为空
**检查：**
- 网络连接
- API 响应格式
- 缓存是否过期

---

## 更新日志

### 2026-03-14
- ✅ 实现 Alpha Token List 获取（缓存 24 小时）
- ✅ 更新搜索功能支持 Alpha 代币
- ✅ 添加 Alpha WebSocket 连接
- ✅ 实现 Alpha 行情获取函数
- ✅ 更新前端支持 Alpha 代币显示
- ✅ 添加文档

---

_🦞 按官方 API 实现，这次必须搞定 Alpha！_
