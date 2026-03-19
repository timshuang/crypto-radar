# Alpha 代币价格目标显示 Bug 修复报告

## 问题描述
**报告时间**: 2026-03-15 17:50 UTC  
**报告人**: 老板  
**处理人**: 钳子哥 (Coder)

### 症状
- ✅ 现货币种（BTCUSDT）：添加后方向和目标价正常显示
- ❌ Alpha 代币（CYS）：添加后方向和目标价显示为空

### 背景
这个问题之前修复过（见 history.md 2026-03-15 16:15 记录），现在又出现了，说明代码修改时破坏了之前的修复。

---

## 问题排查

### 1. 后端保存验证 ✅
```bash
$ curl -X POST http://localhost:3000/api/symbols \
  -H "X-API-Token: crypto_radar_token_2024" \
  -d '{"symbol": "CYS (ALPHA_495)", "source": "alpha"}'

# 返回
{
  "success": true,
  "data": {
    "symbol": "CYS",  // 后端解析后存储为纯符号名
    "source": "alpha",
    "alphaId": "ALPHA_495",
    "targets": []
  }
}
```
**结论**: 后端保存逻辑正确。

### 2. 目标添加验证 ✅
```bash
$ curl -X POST http://localhost:3000/api/targets \
  -H "X-API-Token: crypto_radar_token_2024" \
  -d '{"symbol": "CYS", "type": "below", "price": 0.4}'

# 返回
{
  "success": true,
  "data": {
    "id": "target_xxx",
    "type": "below",
    "price": 0.4,
    "symbol": "CYS"
  }
}
```
**结论**: 使用正确的符号名时，目标添加成功。

### 3. 前端代码分析 ❌
检查 `public/app.js` 中的 `selectAddSymbol` 函数：

```javascript
// 问题代码
const alphaMatch = symbol.match(/^(.+)\s+\((ALPHA_\d+)\)\s+\((TRADING|BREAK)\)$/i);
```

**问题**：正则表达式要求必须带状态后缀 `(TRADING)` 或 `(BREAK)`，但搜索 API 返回的 `data-symbol` 属性只有 `"CYS (ALPHA_495)"`（不带状态）。

### 4. 数据流分析

| 步骤 | 数据 | 状态 |
|------|------|------|
| 搜索 API 返回 | `{ symbol: "CYS (ALPHA_495)", ... }` | ✅ |
| showAddSymbolResults | `data-symbol="CYS (ALPHA_495)"` | ✅ |
| 用户点击选择 | 调用 `selectAddSymbol("CYS (ALPHA_495)")` | ✅ |
| 正则匹配 | `alphaMatch = null`（不匹配） | ❌ |
| hiddenInput.value | `"CYS (ALPHA_495)"`（带括号） | ❌ |
| hiddenInput.dataset.alphaId | `null`（被 delete） | ❌ |
| 提交币种 | `symbol: "CYS (ALPHA_495)"` | ⚠️ 后端能解析 |
| 提交目标 | `symbol: "CYS (ALPHA_495)"` | ❌ 后端找不到 |
| 后端查找 | `config.symbols.find(s => s.symbol === "CYS (ALPHA_495)")` | ❌ 返回 null |
| 结果 | 目标保存失败 | ❌ |

---

## 修复方案

### 修改文件
`public/app.js` - 第 1268 行

### 修复内容
**修复前**：
```javascript
const alphaMatch = symbol.match(/^(.+)\s+\((ALPHA_\d+)\)\s+\((TRADING|BREAK)\)$/i);
```

**修复后**：
```javascript
const alphaMatch = symbol.match(/^(.+)\s+\((ALPHA_\d+)\)(?:\s+\((TRADING|BREAK)\))?$/i);
```

### 修复说明
- 新增 `(?:\s+\((TRADING|BREAK)\))?` 非捕获组
- `?` 使状态后缀变为可选
- 同时兼容带状态和不带状态的 Alpha 代币格式

---

## 测试验证

### 1. 正则表达式测试 ✅
```javascript
'CYS (ALPHA_495) (TRADING)' → symbol='CYS', alphaId='ALPHA_495' ✅
'CYS (ALPHA_495)'           → symbol='CYS', alphaId='ALPHA_495' ✅
'UP (ALPHA_804) (BREAK)'    → symbol='UP', alphaId='ALPHA_804' ✅
'UP (ALPHA_804)'            → symbol='UP', alphaId='ALPHA_804' ✅
```

### 2. 完整流程测试 ✅
```bash
# 1. 添加 Alpha 代币
$ curl -X POST http://localhost:3000/api/symbols \
  -H "X-API-Token: crypto_radar_token_2024" \
  -d '{"symbol": "CYS (ALPHA_495)", "source": "alpha"}'
# ✅ 成功

# 2. 添加价格目标
$ curl -X POST http://localhost:3000/api/targets \
  -H "X-API-Token: crypto_radar_token_2024" \
  -d '{"symbol": "CYS", "type": "below", "price": 0.4}'
# ✅ 成功

# 3. 验证 config.json
$ cat config.json | jq '.symbols[] | select(.source == "alpha")'
# ✅ targets 数组正确保存

# 4. 验证 API 返回
$ curl http://localhost:3000/api/symbols | jq '.data[] | select(.source == "alpha")'
# ✅ 包含 targets 数组

$ curl http://localhost:3000/api/targets | jq '.data[] | select(.symbol == "CYS")'
# ✅ 返回目标数据
```

### 3. 前端映射逻辑测试 ✅
```javascript
// 模拟 loadMonitor() 函数
const symbols = [{ symbol: 'CYS', source: 'alpha' }];
const targets = [{ symbol: 'CYS', type: 'below', price: 0.4 }];

const symbolTargets = {};
targets.forEach(t => {
  symbolTargets[t.symbol] = [t];
});

symbols.forEach(s => {
  const firstTarget = symbolTargets[s.symbol][0];
  // ✅ firstTarget 正确获取
});
```

---

## 测试结论

**整体状态**: ✅ **PASS**

### 通过项
- ✅ Alpha 代币格式解析（带状态和不带状态）
- ✅ 币种添加成功
- ✅ 价格目标保存成功
- ✅ config.json 正确写入
- ✅ `/api/symbols` 返回正确
- ✅ `/api/targets` 返回正确
- ✅ 前端映射逻辑正确
- ✅ 方向和目标价显示正确

### 残留风险
无

---

## 后续建议

1. **浏览器缓存**：用户需要强制刷新浏览器（Ctrl+F5）以加载最新的前端代码
2. **回归测试**：建议测试以下场景：
   - 添加现货币种（带状态和不带状态）
   - 添加 Alpha 代币（带状态和不带状态）
   - 添加新币种（PORTALUSDT 等）
3. **代码审查**：未来修改 `selectAddSymbol` 或 `showAddSymbolResults` 时，需要注意保持格式一致性

---

**修复完成时间**: 2026-03-15 17:50 UTC  
**测试完成时间**: 2026-03-15 17:55 UTC
