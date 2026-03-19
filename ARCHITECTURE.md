# ARCHITECTURE.md - crypto_radar 系统架构设计

## 1. 系统整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        crypto_radar                              │
│                    (1C/512MB RAM VPS)                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  价格目标线   │    │  波动侦测线   │    │  Bark 通知    │      │
│  │  (Target)    │    │  (Volatility)│    │  (Alert)     │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │               │
│         └───────────────────┼───────────────────┘               │
│                             │                                   │
│                    ┌────────▼────────┐                          │
│                    │  检查引擎       │                          │
│                    │  (Checker)      │                          │
│                    │  (1min 周期)     │                          │
│                    └────────┬────────┘                          │
│                             │                                   │
│                    ┌────────▼────────┐                          │
│                    │  数据管理器     │                          │
│                    │  (DataManager)  │                          │
│                    └────────┬────────┘                          │
│                             │                                   │
│         ┌───────────────────┼───────────────────┐              │
│         │                   │                   │               │
│  ┌──────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐       │
│  │  币安现货 WS  │  │  币安 Alpha WS │  │  本地存储     │       │
│  │  (Spot)      │  │  (Alpha)      │  │  (JSON/SQLite)│       │
│  └──────────────┘  └───────────────┘  └───────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 2. 模块划分

### 2.1 价格目标线模块 (TargetMonitor)

**职责：** 监控币种价格是否达到用户设定的目标价位

**触发条件：** 价格 >= 目标价 (做多) 或 价格 <= 目标价 (做空)

**状态流转：**
```
等待中 (WAITING) → 已触发 (TRIGGERED) → 已完成 (COMPLETED)
```

**特性：**
- 一次性逻辑：触发后自动标记为"已完成"，不再重复告警
- 支持多个目标价位 per 币种
- 5 分钟静默期防止重复通知

### 2.2 波动侦测线模块 (VolatilityMonitor)

**职责：** 监控币种在指定时间窗口内的价格波动幅度

**触发条件：** (最高价 - 最低价) / 最低价 >= 阈值%

**检测窗口：** 滑动窗口，每 1 分钟检查过去 N 分钟的数据

**特性：**
- 持续性监控：不会自动完成，持续检测
- 阶梯阈值：首次触发后，后续触发需要更高阈值
- 5 分钟静默期

### 2.3 Bark 通知模块 (AlertService)

**职责：** 发送告警通知到用户 iOS 设备

**接入方式：** HTTP POST 到 Bark API

**消息格式：**
```json
{
  "title": "🦐 价格告警",
  "body": "BTCUSDT 达到目标价 $50,000",
  "level": "timeSensitive",
  "badge": "1",
  "sound": "alarm.mp3",
  "isArchive": "1",
  "group": "crypto_radar"
}
```

**特性：**
- 消息分组管理
- 支持自定义提示音
- 失败重试机制 (3 次，指数退避)

### 2.4 WebSocket 接入模块 (WSConnector)

**职责：** 维持与币安 WebSocket 的连接，接收实时价格数据

**连接策略：**
- 币安现货：`wss://stream.binance.com:9443/ws/<symbol>@trade`
- 币安 Alpha：`wss://ws.alpha.binance.com/ws/<symbol>@trade`

**特性：**
- 自动重连 (断线后 5 秒重连)
- 心跳检测 (30 秒 ping/pong)
- 连接池管理 (最多 20 个币种 concurrently)
- 内存缓冲 (最多缓存 1000 条价格记录/币种)

### 2.5 检查引擎模块 (CheckerEngine)

**职责：** 每分钟执行一次全量检查

**执行流程：**
```
1. 从 DataManager 获取最新价格快照
2. 遍历所有 active 配置
3. 执行 TargetMonitor 检查
4. 执行 VolatilityMonitor 检查
5. 收集触发的告警
6. 调用 AlertService 发送通知
7. 更新告警状态 (冷却时间、完成状态)
8. 持久化状态到存储
```

**调度方式：** Node.js `setInterval` 或 `node-cron`

### 2.6 数据管理器模块 (DataManager)

**职责：** 管理价格数据、配置数据、告警状态

**功能：**
- 价格数据写入 (来自 WS)
- 价格数据读取 (供 Checker 使用)
- 滑动窗口维护 (自动清理过期数据)
- 配置加载/保存
- 状态持久化

## 3. 数据流设计

```
┌──────────────────────────────────────────────────────────────┐
│                      数据流图                                 │
└──────────────────────────────────────────────────────────────┘

币安 WebSocket ──────► WSConnector ──────► DataManager
                                               │
                                               │ (价格数据)
                                               ▼
                                         本地存储
                                               │
                                               │ (读取)
                                               ▼
CheckerEngine (每 1 分钟) ──────► TargetMonitor
                                 │
                                 └──────► VolatilityMonitor
                                          │
                                          │ (触发告警)
                                          ▼
                                    AlertService ──────► Bark API
                                          │
                                          ▼
                                    状态更新 ──────► 本地存储
```

### 3.1 实时数据流

1. WSConnector 接收 trade 消息
2. 解析价格、时间戳
3. 写入内存缓冲区 (按币种分组)
4. 每 100 条或每 10 秒批量持久化一次

### 3.2 检查数据流

1. CheckerEngine 定时触发
2. 从内存缓冲区读取最新价格
3. 从存储读取历史价格 (计算波动)
4. 执行检查逻辑
5. 触发告警 (如需要)
6. 更新状态

## 4. 512MB 内存优化策略

### 4.1 内存预算分配

| 组件 | 预算 | 说明 |
|------|------|------|
| Node.js 运行时 | 100MB | 基础开销 |
| WSConnector | 50MB | 连接池 + 缓冲区 |
| DataManager | 150MB | 价格数据缓存 |
| CheckerEngine | 50MB | 检查逻辑 |
| 其他 (配置、状态) | 50MB | JSON 解析等 |
| 安全余量 | 112MB | 防止 OOM |
| **总计** | **512MB** | |

### 4.2 优化措施

#### 4.2.1 滑动窗口限制

```javascript
// 每个币种最多保留 1440 条记录 (24 小时 @ 1 分钟/条)
const MAX_PRICE_RECORDS_PER_SYMBOL = 1440;

// 超出时自动清理最旧记录
if (records.length > MAX_PRICE_RECORDS_PER_SYMBOL) {
  records.splice(0, records.length - MAX_PRICE_RECORDS_PER_SYMBOL);
}
```

#### 4.2.2 数据结构优化

```javascript
// ❌ 避免：对象数组 (占用内存大)
prices = [
  { time: 1234567890, price: 50000.00, volume: 1.5 },
  { time: 1234567891, price: 50001.00, volume: 2.0 },
  // ...
];

// ✅ 推荐：并行数组 (内存紧凑)
prices = {
  times: [1234567890, 1234567891, ...],    // Uint32Array
  prices: [50000.00, 50001.00, ...],       // Float64Array
  volumes: [1.5, 2.0, ...]                 // Float32Array
};
```

#### 4.2.3 连接池限制

```javascript
// 最多同时监控 20 个币种
const MAX_SYMBOLS = 20;

// 超出时提示用户升级或移除部分币种
if (config.symbols.length > MAX_SYMBOLS) {
  logger.warn(`最多支持${MAX_SYMBOLS}个币种，已截断`);
  config.symbols = config.symbols.slice(0, MAX_SYMBOLS);
}
```

#### 4.2.4 垃圾回收提示

```javascript
// 每 5 分钟手动触发 GC (需要 --expose-gc 启动参数)
setInterval(() => {
  if (global.gc) {
    global.gc();
  }
}, 5 * 60 * 1000);
```

#### 4.2.5 流式 JSON 处理

```javascript
// ❌ 避免：一次性加载大文件
const config = JSON.parse(fs.readFileSync('config.json'));

// ✅ 推荐：流式读取 (如需要处理大文件)
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
```

### 4.3 Node.js 启动参数

```bash
# PM2 配置中使用
node_args: [
  '--max-old-space-size=400',  // 限制堆内存为 400MB
  '--expose-gc'                 // 允许手动 GC
]
```

### 4.4 监控和告警

```javascript
// 内存使用监控
setInterval(() => {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  
  if (heapUsedMB > 400) {
    logger.warn(`内存使用过高：${heapUsedMB.toFixed(2)}MB`);
    if (global.gc) global.gc();
  }
}, 60 * 1000);
```

## 5. 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 运行时 | Node.js 18+ | 轻量、异步 IO 友好、WS 支持好 |
| WebSocket | `ws` 库 | 成熟稳定、内存占用低 |
| 调度 | `node-cron` | 简单可靠、低开销 |
| 存储 | JSON 文件 | 无需额外依赖、512MB 环境友好 |
| 进程管理 | PM2 | 自动重启、日志管理、内存监控 |
| HTTP 客户端 | `node-fetch` | 轻量、内置于 Node 18+ |

## 6. 边界情况处理

### 6.1 WebSocket 断线

- 检测：30 秒无消息
- 处理：关闭旧连接，5 秒后重连
- 重连失败：指数退避 (5s, 10s, 20s, 40s, 80s max)

### 6.2 价格数据缺失

- 检测：某币种超过 5 分钟无新价格
- 处理：标记为"数据异常"，跳过检查，发送告警

### 6.3 Bark API 失败

- 重试：3 次，间隔 1s, 2s, 4s
- 仍失败：记录到失败队列，下次检查时重试
- 持续失败：每小时汇总告警一次

### 6.4 磁盘空间不足

- 检测：启动时检查可用空间
- 处理：< 50MB 时警告，< 10MB 时停止写入历史数据

### 6.5 配置错误

- 检测：启动时验证配置 schema
- 处理：输出错误信息，使用默认配置继续运行

---

_架构设计完成，下一步请代码工根据此文档实现各模块。_
