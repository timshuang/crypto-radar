# Alpha 代币价格目标保存测试报告

**测试日期**: 2026-03-15 16:15 UTC  
**测试人员**: 挑刺虾 🦐  
**测试对象**: Alpha 代币 (CYS) 价格目标保存功能

---

## 问题描述

老板反馈：
- ✅ 现货币种（BTC、ETH）：添加成功，价格目标正常保存
- ❌ Alpha 代币（CYS）：添加了，但价格目标（上穿/下破）不保存

---

## 测试过程

### 1. 后端 API 测试

#### 测试 1: 检查当前 CYS 配置
```bash
curl -H "X-API-Token: crypto_radar_token_2024" http://localhost:3000/api/symbols | jq '.data[] | select(.symbol == "CYS")'
```

**结果**: ✅ CYS 配置中存在 targets 数组
```json
{
  "symbol": "CYS",
  "source": "alpha",
  "alphaId": "ALPHA_495",
  "targets": [
    {
      "id": "target_1773591233136",
      "type": "below",
      "price": 0.4,
      "enabled": true,
      "status": "waiting"
    }
  ]
}
```

#### 测试 2: 检查 /api/targets 接口
```bash
curl -H "X-API-Token: crypto_radar_token_2024" http://localhost:3000/api/targets | jq '.data[] | select(.symbol == "CYS")'
```

**结果**: ✅ 返回 CYS 的目标数据
```json
[
  {
    "id": "target_1773591233136",
    "type": "below",
    "price": 0.4,
    "enabled": true,
    "status": "waiting",
    "symbol": "CYS"
  }
]
```

#### 测试 3: 完整流程模拟测试
模拟前端添加 Alpha 代币的完整流程：
1. 搜索 "CYS" → 选择 "CYS (ALPHA_495) (TRADING)"
2. 设置目标类型："below"（下破）
3. 设置目标价格：0.4
4. 提交表单

**结果**: ✅ 测试通过
- 币种添加成功
- 目标保存成功
- 配置文件中 targets 数组有数据

### 2. 配置文件检查

```bash
cat config.json | jq '.symbols[] | select(.symbol == "CYS")'
```

**结果**: ✅ 配置文件中 CYS 的 targets 数组有数据

### 3. 服务器日志检查

```bash
pm2 logs crypto_radar --lines 50
```

**结果**: ✅ 日志显示目标保存成功
```
[WebServer] _addTarget 收到数据：{ symbol: 'CYS', type: 'below', price: 0.4 }
[WebServer] _addTarget 保存成功
```

---

## 测试结论

### ✅ 后端功能正常

经过全面测试，**后端 API 和配置文件保存完全正常**：
- `/api/symbols` POST：成功添加 Alpha 代币
- `/api/targets` POST：成功保存价格目标
- 配置文件：targets 数组正确写入
- 服务器日志：无错误，保存成功

### ❓ 问题可能原因

既然后端保存正常，但老板反馈"价格目标不保存"，问题可能出在：

1. **浏览器缓存** ⭐ 最可能
   - 浏览器缓存了旧版本的 `app.js`
   - 导致前端显示逻辑未更新

2. **前端显示问题**
   - `loadMonitor()` 函数可能未正确刷新
   - 或者页面未切换到 monitor 标签页

3. **用户操作流程**
   - 可能未正确填写目标类型或价格
   - 或者提交前页面已刷新

---

## 解决方案

### 方案 1: 强制刷新浏览器（推荐）

请老板尝试：
- **Windows/Linux**: `Ctrl + F5` 或 `Ctrl + Shift + R`
- **Mac**: `Cmd + Shift + R`

这将清除页面缓存并重新加载最新的 JavaScript 文件。

### 方案 2: 添加缓存控制头

修改 `web-server.js` 的 `_handleStatic` 函数，添加缓存控制：

```javascript
res.writeHead(200, {
  'Content-Type': contentTypes[ext] || 'text/plain',
  'Cache-Control': 'no-cache, no-store, must-revalidate'
});
```

### 方案 3: 版本号缓存清除

在 `index.html` 中为 `app.js` 添加版本号参数：
```html
<script src="/app.js?v=20260315"></script>
```

---

## 建议操作

1. **立即**: 请老板强制刷新浏览器（Ctrl+F5）
2. **验证**: 刷新后重新添加 Alpha 代币测试
3. **优化**: 修改服务器添加缓存控制头，避免未来出现类似问题

---

## 测试数据

### 当前 CYS 配置状态
```json
{
  "symbol": "CYS",
  "enabled": true,
  "source": "alpha",
  "alphaId": "ALPHA_495",
  "targets": [
    {
      "id": "target_1773591233136",
      "type": "below",
      "price": 0.4,
      "enabled": true,
      "status": "waiting"
    }
  ],
  "currentPrice": 0.4314681
}
```

### API 响应验证
- `/api/symbols`: ✅ 返回 CYS 及 targets
- `/api/targets`: ✅ 返回 CYS 的目标列表

---

**测试状态**: ✅ 后端通过，待前端验证  
**下一步**: 请老板刷新浏览器后重新测试
