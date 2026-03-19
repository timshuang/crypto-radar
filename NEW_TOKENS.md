# 新币代币格式说明

## 重要更新

✅ **币安没有独立的 Alpha API**，所有代币（包括新币）都在标准 `api.binance.com` 中。

### 正确格式

```
SYMBOLUSDT
```

**示例：**
- ✅ `PORTALUSDT` - 和现货格式一样
- ✅ `NEWTUSDT` - 和现货格式一样
- ✅ `ALPHAUSDT` - 和现货格式一样（注意：当前状态为 BREAK）
- ❌ `ALPHA_173USDT` - 错误格式，不要使用

### 代币状态

新币代币可能有两种状态：

| 状态 | 说明 | 颜色标识 |
|------|------|----------|
| `TRADING` | 可正常交易 | 🟢 绿色 |
| `BREAK` | 暂停交易 | ⚪ 灰色 |

**当前代币状态：**
- `PORTALUSDT` - TRADING
- `NEWTUSDT` - TRADING
- `ALPHAUSDT` - BREAK（暂停交易）

## WebSocket 订阅

所有代币（现货 + 新币）都使用同一个 WebSocket 地址：

```
wss://stream.binance.com:9443/ws/<stream_name>
```

**流名称格式：**
- 小写符号 + `@trade`
- 示例：`portalusdt@trade`、`newtusdt@trade`、`alphausdt@trade`

## API 端点

### 获取代币状态

```bash
GET /api/symbols/status
```

**响应示例：**
```json
{
  "success": true,
  "data": {
    "PORTALUSDT": "TRADING",
    "NEWTUSDT": "TRADING",
    "ALPHAUSDT": "BREAK"
  }
}
```

### 搜索代币

```bash
GET /api/symbols/search?q=PORTAL
```

**响应示例：**
```json
{
  "success": true,
  "data": [
    "PORTALUSDT (TRADING)"
  ]
}
```

## 代码配置

### web-server.js

```javascript
// 新币代币列表
this.newTokens = [
  'PORTALUSDT',  // TRADING
  'NEWTUSDT',    // TRADING
  'ALPHAUSDT',   // BREAK
];

// 代币状态映射
this.newTokenStatus = {
  'PORTALUSDT': 'TRADING',
  'NEWTUSDT': 'TRADING',
  'ALPHAUSDT': 'BREAK',
};
```

### ws-connector.js

```javascript
// 所有代币都使用现货 WebSocket
const wsUrl = 'wss://stream.binance.com:9443/ws';
const streamName = `${symbolUpper.toLowerCase()}@trade`;
// 示例：PORTALUSDT -> portalusdt@trade
```

## 前端显示

### 自动补全下拉

搜索时显示代币状态：
- `PORTALUSDT (TRADING)` - 绿色标签
- `ALPHAUSDT (BREAK)` - 灰色标签

### 样式

```css
/* 绿色 = TRADING */
.autocomplete-status.status-trading {
  background: rgba(40, 167, 69, 0.3);
  color: #28a745;
}

/* 灰色 = BREAK */
.autocomplete-status.status-break {
  background: rgba(108, 117, 125, 0.3);
  color: #6c757d;
}
```

## 配置示例

### 添加新币代币到 config.json

```json
{
  "symbols": [
    {
      "symbol": "PORTALUSDT",
      "enabled": true,
      "source": "new",
      "targets": [
        {
          "id": "target_123",
          "type": "above",
          "price": 1.50,
          "enabled": true,
          "status": "waiting"
        }
      ],
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

## 更新代币状态

定期更新 `web-server.js` 中的 `newTokenStatus` 映射：

```javascript
this.newTokenStatus = {
  'PORTALUSDT': 'TRADING',  // 如果开始交易，改为 TRADING
  'NEWTUSDT': 'TRADING',
  'ALPHAUSDT': 'BREAK',     // 如果暂停交易，改为 BREAK
};
```

## 参考资料

- 币安 API 文档：https://developers.binance.com/docs/
- 币安现货 API：https://developers.binance.com/docs/binance-spot-api-docs/
- WebSocket 流：https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams

---

_更新时间：2026-03-14_
_更新人：钳子哥 🦞_
