# 🦐 挑刺虾 - 代码审查报告

## 项目：crypto_radar
## 审查时间：2026-03-13 02:30 UTC
## 审查人：挑刺虾

---

## ⚠️ 发现的 Bug（必须修复）

### Bug #1: storage.js - PriceBuffer.toArray() 循环缓冲区导出逻辑错误

**位置**: `src/storage.js` Line 103-111

**问题描述**:
```javascript
toArray() {
  const records = [];
  for (let i = 0; i < this.count; i++) {
    const idx = (i + this.maxSize) % this.maxSize;  // ❌ 错误！
    records.push({
      t: this.times[idx],
      p: this.prices[idx],
      v: this.volumes[idx]
    });
  }
  return records;
}
```

当前实现从索引 0 开始遍历，但循环缓冲区的实际数据起始位置是 `(head - count + maxSize) % maxSize`。这会导致：
1. 持久化的数据顺序错误
2. 重启后恢复的价格历史时间线错乱
3. 波动计算基于错误的数据

**修复方案**:
```javascript
toArray() {
  const records = [];
  const startIdx = (this.head - this.count + this.maxSize) % this.maxSize;
  for (let i = 0; i < this.count; i++) {
    const idx = (startIdx + i) % this.maxSize;
    records.push({
      t: this.times[idx],
      p: this.prices[idx],
      v: this.volumes[idx]
    });
  }
  return records;
}
```

**严重程度**: 🔴 高（影响数据完整性）

---

### Bug #2: ws-connector.js - 重连定时器未清理

**位置**: `src/ws-connector.js` Line 158-172

**问题描述**:
当用户调用 `disconnect()` 时，如果该连接正在等待重连（断线后的重连定时器），定时器不会被清除，导致：
1. 即使手动断开，连接仍会自动重连
2. 可能产生意外的 WebSocket 连接
3. 内存泄漏风险

**修复方案**:
需要在 `connection` 对象中添加 `reconnectTimer` 字段，并在 `disconnect()` 和 `_cleanupConnection()` 中清除它。

```javascript
// 在 connection 对象中添加
reconnectTimer: null

// 在 _scheduleReconnect 中
connection.reconnectTimer = setTimeout(() => { ... }, reconnectDelay);

// 在 _cleanupConnection 中添加
if (connection.reconnectTimer) {
  clearTimeout(connection.reconnectTimer);
  connection.reconnectTimer = null;
}
```

**严重程度**: 🟡 中（影响用户体验）

---

### Bug #3: index.js - WebSocket 连接等待时间不足

**位置**: `src/index.js` Line 121

**问题描述**:
```javascript
app.wsConnector.connectMultiple(wsConfigs);
await sleep(2000);  // ❌ 2 秒可能不够
```

在网络较差的环境下，2 秒可能不足以建立所有 WebSocket 连接。这会导致：
1. 启动后立即进行检查时，部分币种无价格数据
2. 波动监控初始化时数据不足

**修复方案**:
1. 增加等待时间到 5 秒，或
2. 更好的方案：等待所有连接都显示为 "open" 状态再继续

```javascript
// 方案 1：简单增加等待时间
await sleep(5000);

// 方案 2：等待所有连接建立（推荐）
await this._waitForConnections(10000); // 最多等 10 秒
```

**严重程度**: 🟡 中（影响启动可靠性）

---

## ⚡ 优化建议

### 优化 #1: storage.js - 价格存储可改用 Float32Array

**位置**: `src/storage.js` Line 19

**当前**:
```javascript
this.prices = new Float64Array(maxSize);  // 8 字节/元素
```

**建议**:
```javascript
this.prices = new Float32Array(maxSize);  // 4 字节/元素
```

**理由**: 加密货币价格通常不需要 double 精度，float32 足够（7 位有效数字，对于 $100,000 的价格精度到 $0.01）。

**节省内存**: 每币种 1440 条记录可节省 ~11KB

**严重程度**: 🟢 低（锦上添花）

---

### 优化 #2: checker-engine.js - 可考虑更短的检查间隔

**位置**: `src/checker-engine.js` Line 27

**当前**: 默认 1 分钟检查一次

**建议**: 对于波动监控，可以考虑 30 秒甚至更短的检查间隔，以捕捉更短暂的波动。

**注意**: 需要权衡 CPU 使用率

**严重程度**: 🟢 低（功能增强）

---

## ✅ 代码优点

1. **内存优化到位**: 使用 TypedArray、滑动窗口、连接池限制
2. **错误处理完善**: 各模块都有 try-catch 和错误日志
3. **告警抑制机制**: 静默期 + 阶梯阈值设计合理
4. **持久化策略**: 原子写入（先写 tmp 再 rename）防损坏
5. **优雅关闭**: 处理了 SIGTERM/SIGINT 信号
6. **配置验证**: 启动时验证配置结构
7. **文档完整**: README.md 清晰，config.json.example 有示例

---

## 📋 测试计划

1. [ ] 启动应用，验证 WebSocket 连接
2. [ ] 测试价格目标线逻辑
3. [ ] 测试波动侦测线逻辑
4. [ ] 测试告警抑制机制
5. [ ] 验证配置 CRUD 操作
6. [ ] 测试 deploy.sh 脚本
7. [ ] 验证 PM2 配置
8. [ ] 检查内存限制

---

## 📊 总体评价

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | ⭐⭐⭐⭐ | 结构清晰，但有几个 bug 需修复 |
| 错误处理 | ⭐⭐⭐⭐⭐ | 完善 |
| 内存优化 | ⭐⭐⭐⭐⭐ | 针对 512MB 环境优化到位 |
| 文档完整性 | ⭐⭐⭐⭐⭐ | README 清晰，示例完整 |
| 部署友好性 | ⭐⭐⭐⭐ | deploy.sh 完善，但 PM2 需手动安装 |

**综合评分**: ⭐⭐⭐⭐ (4/5)

---

## ✅ Bug 修复状态

| Bug | 状态 | 修复时间 |
|-----|------|----------|
| Bug #1: PriceBuffer.toArray() 循环缓冲区导出错误 | ✅ 已修复 | 2026-03-13 02:35 |
| Bug #2: WS 重连定时器未清理 | ✅ 已修复 | 2026-03-13 02:35 |
| Bug #3: WebSocket 连接等待时间不足 | ✅ 已修复 | 2026-03-13 02:36 |

**修复验证**: 所有修复已通过 PM2 重启验证，应用正常运行。

---

_🦐 挑刺虾出品，一个 bug 都别想跑！_
