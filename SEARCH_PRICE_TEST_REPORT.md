# 搜索显示价格功能 - 终检测试报告

**测试日期**: 2026-03-15 17:01 UTC  
**测试人**: 挑刺虾 🦐  
**测试状态**: ❌ **FAIL** (部分失败)

---

## 测试任务概览

| 测试项 | 状态 | 详情 |
|--------|------|------|
| 1. 现货搜索 API | ✅ PASS | BTCUSDT 返回正确，价格正常 |
| 2. Alpha 搜索 API | ❌ FAIL | CYS 返回价格 "N/A"，应为实际价格 |
| 3. 前端显示 | ⚠️ 待验证 | 依赖后端修复后验证 |
| 4. 性能测试 | ✅ PASS | 响应时间 17-20ms (<100ms) |

---

## 详细测试结果

### 1. 现货搜索 API 测试 ✅

**测试命令**:
```bash
curl -s -H "X-API-Token: crypto_radar_token_2024" "http://localhost:3000/api/symbols/search?q=BTC&source=spot"
```

**实际返回**:
```json
{
  "success": true,
  "data": [
    {
      "symbol": "BTCUSDT",
      "source": "spot",
      "price": 71420,
      "status": "TRADING"
    },
    {
      "symbol": "WBTCUSDT",
      "source": "spot",
      "price": "N/A",
      "status": "TRADING"
    }
  ]
}
```

**预期返回**:
```json
{
  "success": true,
  "data": [
    {"symbol": "BTCUSDT", "source": "spot", "price": 71427.98, "status": "TRADING"}
  ]
}
```

**结论**: ✅ **PASS**
- 格式正确
- 价格数据正常 (71420 vs 预期 71427.98，价格波动属正常)
- 状态字段正确

---

### 2. Alpha 搜索 API 测试 ❌

**测试命令**:
```bash
curl -s -H "X-API-Token: crypto_radar_token_2024" "http://localhost:3000/api/symbols/search?q=CYS&source=alpha"
```

**实际返回**:
```json
{
  "success": true,
  "data": [
    {
      "symbol": "CYS (ALPHA_495)",
      "source": "alpha",
      "price": "N/A",
      "status": "TRADING"
    }
  ]
}
```

**预期返回**:
```json
{
  "success": true,
  "data": [
    {"symbol": "CYS", "source": "alpha", "price": 0.43, "status": "TRADING"}
  ]
}
```

**结论**: ❌ **FAIL**
- 格式正确 ✅
- 价格字段错误 ❌：返回 "N/A"，应为实际价格 (如 0.43)
- 状态字段正确 ✅

---

### 3. 前端显示验证 ⚠️

**状态**: 等待后端修复后验证

**预期显示**:
- `BTCUSDT (现货) - $71,427.98` ✅ (应该正常)
- `CYS (Alpha) - $0.43` ❌ (当前会显示 "暂无价格")

---

### 4. 性能测试 ✅

**现货搜索 (5 次连续)**:
```
Test 1: 17ms
Test 2: 18ms
Test 3: 20ms
Test 4: 18ms
Test 5: 17ms
```

**Alpha 搜索 (5 次连续)**:
```
Test 1: 17ms
Test 2: 17ms
Test 3: 18ms
Test 4: 17ms
Test 5: 19ms
```

**结论**: ✅ **PASS**
- 所有响应时间 <100ms
- 响应时间稳定

---

## 问题根源分析

### 问题描述
Alpha 代币搜索返回价格 "N/A"，无法显示实际价格。

### 根本原因
**文件**: `src/web-server.js`  
**函数**: `searchSymbols()` (约第 170-190 行)

**问题代码逻辑**:
```javascript
// 获取价格数据
const prices = this._getPrices().data || {};

// 返回时附带价格
return results.slice(0, 10).map(s => {
  const priceSymbol = s.source === 'alpha' ? s.symbol.split(' ')[0] : s.symbol;
  const price = prices[priceSymbol] || prices[priceSymbol + 'USDT'] || 'N/A';
  // ...
});
```

**`_getPrices()` 函数逻辑**:
```javascript
_getPrices() {
  const config = this.configManager?.config;
  const symbols = config?.symbols || [];
  
  const prices = {};
  symbols.forEach(s => {
    const latest = this.storage?.getLatestPrice(s.symbol);
    if (latest?.price) {
      prices[s.symbol] = latest.price;
      // ...
    }
  });
  // ...
}
```

**问题链**:
1. `_getPrices()` 从 `storage.getLatestPrice()` 获取价格
2. `storage` 的价格数据来自 WebSocket 连接推送
3. **Alpha 代币没有 WebSocket 连接**，只有现货代币有
4. 因此 Alpha 代币价格永远为 "N/A"

### 正确做法
Alpha 代币价格应该通过 `fetchAlphaPrice()` 函数从 Alpha API 实时获取：
```javascript
// monitors.js 中已有此函数
async function fetchAlphaPrice(alphaId) {
  const url = `https://www.binance.com/bapi/defi/v1/public/alpha-trade/ticker?symbol=${alphaId}USDT`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.data && data.data.lastPrice) {
    return data.data.lastPrice;
  }
  return null;
}
```

---

## 修复方案

### 需要修改的文件
- `src/web-server.js`

### 修复步骤

1. **导入 `fetchAlphaPrice` 函数**:
```javascript
// 在文件顶部添加
const { fetchAlphaPrice } = require('./monitors');
```

2. **修改 `searchSymbols()` 函数**:
```javascript
async searchSymbols(query, source = 'spot') {
  // ... 现有代码 ...
  
  // 获取价格数据
  const prices = this._getPrices().data || {};
  
  // 返回时附带价格
  return await Promise.all(results.slice(0, 10).map(async s => {
    const priceSymbol = s.source === 'alpha' ? s.symbol.split(' ')[0] : s.symbol;
    let price = prices[priceSymbol] || prices[priceSymbol + 'USDT'] || 'N/A';
    
    // Alpha 代币需要实时获取价格
    if (s.source === 'alpha' && price === 'N/A') {
      const alphaMatch = s.symbol.match(/\((ALPHA_\d+)\)/);
      if (alphaMatch) {
        const alphaPrice = await fetchAlphaPrice(alphaMatch[1]);
        price = alphaPrice || 'N/A';
      }
    }
    
    return {
      symbol: s.symbol,
      source: s.source,
      price: price,
      status: s.status
    };
  }));
}
```

---

## 修复后验证步骤

1. 重启服务：`pm2 restart crypto_radar`
2. 重新测试 Alpha 搜索：
   ```bash
   curl -s -H "X-API-Token: crypto_radar_token_2024" "http://localhost:3000/api/symbols/search?q=CYS&source=alpha"
   ```
3. 验证返回价格不是 "N/A"
4. 前端验证：搜索 CYS，检查是否显示实际价格

---

## 测试结论

**整体状态**: ❌ **FAIL**

**通过项**:
- ✅ 现货搜索 API
- ✅ 性能测试 (响应时间 <100ms)

**失败项**:
- ❌ Alpha 搜索 API (价格显示 "N/A")
- ⚠️ 前端显示 (等待后端修复后验证)

**下一步行动**:
1. **强制钳子哥修复** `src/web-server.js`
2. 修复后重新运行本测试
3. 验证前端显示

---

**测试人**: 挑刺虾 🦐  
**时间**: 2026-03-15 17:01 UTC
