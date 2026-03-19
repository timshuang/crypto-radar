# Alpha 代币格式修复报告

## 修复日期
2026-03-14

## 问题描述
之前对 Alpha 代币的理解错误：
- ❌ 错误格式：`ALPHA_173USDT`（使用 ALPHA_ 前缀 + token ID）
- ✅ 正确格式：`PORTALUSDT`、`NEWTUSDT`（和现货一样）

**根本原因**：币安没有独立的 Alpha API，所有代币都在标准 `api.binance.com` 中。

## 修复内容

### 1. 更新代币列表 (src/web-server.js)

**修改前：**
```javascript
this.alphaSymbols = [
  'ALPHA_173USDT', // 示例：ZKJ
  'ALPHA_174USDT', // 示例：QUQ
];
```

**修改后：**
```javascript
this.newTokens = [
  'PORTALUSDT',  // TRADING
  'NEWTUSDT',    // TRADING
  'ALPHAUSDT',   // BREAK - 注意：当前状态为暂停交易
];

this.newTokenStatus = {
  'PORTALUSDT': 'TRADING',
  'NEWTUSDT': 'TRADING',
  'ALPHAUSDT': 'BREAK',
};
```

### 2. 更新搜索功能 (src/web-server.js)

- 搜索时同时返回现货和新币代币
- 标注状态（TRADING / BREAK）
- 示例：`PORTALUSDT (TRADING)`、`ALPHAUSDT (BREAK)`

**修改的关键方法：**
- `getAllSymbols()` - 合并现货和新币代币列表
- `searchSymbols(query)` - 支持状态标注

### 3. 更新 WebSocket 连接 (src/ws-connector.js)

**修改前：**
```javascript
// 使用独立的 Alpha WebSocket
this.alphaWsUrl = 'wss://ws.alpha.binance.com/ws';
if (source === 'alpha') {
  wsUrl = this.alphaWsUrl;
  streamName = `alpha_${tokenId}usdt@trade`;
}
```

**修改后：**
```javascript
// 所有代币都使用现货 WebSocket
this.spotWsUrl = 'wss://stream.binance.com:9443/ws';
const streamName = `${symbolUpper.toLowerCase()}@trade`;
// 示例：PORTALUSDT -> portalusdt@trade
```

### 4. 添加代币状态检查端点 (src/web-server.js)

**新增 API 端点：**
```
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

### 5. 更新前端显示 (public/app.js)

**自动补全下拉：**
- 显示代币状态标签（TRADING / BREAK）
- 解析搜索结果中的状态标识

**币种选择器：**
- 更新 `updateSymbolSelect()` 函数显示状态

### 6. 更新样式 (public/style.css)

**状态标签样式：**
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

### 7. 更新文档

- ✅ 删除 `ALPHA_FORMAT.md`（过时文档）
- ✅ 创建 `NEW_TOKENS.md`（新文档）
  - 说明正确格式和用法
  - 包含 API 端点文档
  - 包含配置示例

## 测试验证

运行测试脚本：
```bash
node test-new-tokens.js
```

**测试结果：**
```
✅ 测试 1: 获取新币代币列表 - 通过
✅ 测试 2: 获取代币状态 - 通过
✅ 测试 3: 搜索代币 - 通过
✅ 测试 4: WebSocket 流名称格式 - 通过
✅ 测试 5: 代币状态端点 - 通过
```

## 文件修改清单

| 文件 | 修改内容 | 状态 |
|------|----------|------|
| `src/web-server.js` | 更新代币列表、搜索逻辑、新增状态端点 | ✅ |
| `src/ws-connector.js` | 简化 WebSocket 连接逻辑 | ✅ |
| `public/app.js` | 显示代币状态 | ✅ |
| `public/style.css` | 状态标签样式 | ✅ |
| `NEW_TOKENS.md` | 新文档 | ✅ |
| `ALPHA_FORMAT.md` | 删除旧文档 | ✅ |
| `test-new-tokens.js` | 新增测试脚本 | ✅ |

## 使用说明

### 添加新币代币

1. 在 `web-server.js` 中更新代币列表：
```javascript
this.newTokens = [
  'PORTALUSDT',
  'NEWTUSDT',
  'ALPHAUSDT',
  // 添加更多...
];
```

2. 更新代币状态：
```javascript
this.newTokenStatus = {
  'PORTALUSDT': 'TRADING',
  'NEWTUSDT': 'TRADING',
  'ALPHAUSDT': 'BREAK',
};
```

3. 重启服务：
```bash
pm2 restart crypto_radar
```

### 前端使用

1. 访问 Web UI：`http://localhost:3000`
2. 进入"币种管理"页面
3. 点击"添加币种"
4. 输入代币名称（如 `PORTAL`），自动补全显示状态
5. 选择代币，来源自动设置为 `new`

## 注意事项

1. **代币状态更新**：定期检查新币代币状态，更新 `newTokenStatus` 映射
2. **WebSocket 连接**：所有代币使用同一个 WebSocket 地址
3. **格式验证**：新币代币格式必须为 `SYMBOLUSDT`

## 后续计划

- [ ] 添加自动检测代币状态的机制（调用币安 API）
- [ ] 支持动态更新代币列表（无需重启服务）
- [ ] 添加更多新币代币（根据币安上新）

---

_修复人：钳子哥 🦞_
_状态：已完成 ✅_
