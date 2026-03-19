# API_RESEARCH.md - 币安 & Bark API 调研文档

## 1. 币安现货 WebSocket API

### 1.1 连接地址

```
主网：wss://stream.binance.com:9443/ws
测试网：wss://testnet.binance.vision/ws
```

### 1.2 订阅格式

#### 单个币种

```
wss://stream.binance.com:9443/ws/btcusdt@trade
```

#### 多个币种 (组合流)

```
wss://stream.binance.com:9443/stream?streams=btcusdt@trade/ethusdt@trade/bnbusdt@trade
```

**注意：** 组合流最多支持 300 个流，但 512MB 环境建议不超过 20 个币种。

### 1.3 Trade 消息格式

```json
{
  "e": "trade",           // 事件类型
  "E": 1710345678901,     // 事件时间 (毫秒时间戳)
  "s": "BTCUSDT",         // 交易对
  "t": 123456789,         // 成交 ID
  "p": "50000.00",        // 成交价格 (字符串)
  "q": "0.001",           // 成交数量
  "b": 987654321,         // 买方订单 ID
  "a": 123456789,         // 卖方订单 ID
  "T": 1710345678900,     // 成交时间
  "m": false,             // 是否为做市商卖出 (true=卖方是 maker)
  "M": true               // 是否为最佳价格匹配
}
```

### 1.4 我们需要的字段

| 字段 | 用途 | 处理 |
|------|------|------|
| `s` | 币种标识 | 直接使用 |
| `p` | 价格 | `parseFloat()` 转为数字 |
| `E` | 时间戳 | 用于排序和滑动窗口 |
| `q` | 成交量 | 可选，用于过滤小额交易 |

### 1.5 速率限制

- **连接数限制：** 每个 IP 最多 300 个连接
- **订阅流限制：** 每个连接最多 300 个流
- **消息频率：** 取决于市场活跃度，BTC 约 1-10 条/秒

### 1.6 错误处理

#### 连接错误

```javascript
ws.on('error', (err) => {
  logger.error(`WS 错误：${err.message}`);
  // 触发重连逻辑
});

ws.on('close', (code, reason) => {
  logger.warn(`WS 关闭：code=${code}, reason=${reason}`);
  // 触发重连逻辑
});
```

#### 订阅错误

```json
{
  "id": 1,
  "status": "error",
  "code": 2,
  "msg": "Invalid symbol"
}
```

### 1.7 心跳检测

币安 WS 要求每 3 分钟至少发送一次 ping，否则连接会被断开。

```javascript
// 每 30 秒发送 ping
const pingInterval = setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.ping();
  }
}, 30000);
```

### 1.8 重连策略

```javascript
let reconnectDelay = 5000; // 初始 5 秒
const maxDelay = 80000;    // 最大 80 秒

function reconnect() {
  setTimeout(() => {
    connect();
    reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
  }, reconnectDelay);
}
```

---

## 2. 币安 Alpha WebSocket API

### 2.1 连接地址

```
主网：wss://ws.alpha.binance.com/ws
```

**注意：** 币安 Alpha 是币安新推出的链上交易平台，API 与现货类似但独立。

### 2.2 订阅格式

与现货 API 相同：

```
wss://ws.alpha.binance.com/ws/btcusdt@trade
```

### 2.3 消息格式

与现货 API **完全相同**，参考 1.3 节。

### 2.4 与现货 API 的区别

| 特性 | 现货 API | Alpha API |
|------|----------|-----------|
| 连接地址 | `stream.binance.com` | `ws.alpha.binance.com` |
| 交易对 | 中心化交易对 | 链上交易对 |
| 价格差异 | 可能有价差 | 可能有价差 |
| 活跃度 | 高 | 较低 (新平台) |

### 2.5 使用建议

- **双轨监控：** 同时连接两个 API，可以捕捉价差机会
- **优先级：** 现货 API 优先级更高 (更稳定)
- **故障转移：** Alpha API 断线时不影响现货监控

---

## 3. Bark API 接入方案

### 3.1 Bark 是什么

Bark 是一款 iOS 推送通知 App，允许用户通过 HTTP 请求发送自定义通知到 iPhone。

**官网：** https://apps.apple.com/app/id1211513936  
**GitHub：** https://github.com/Finb/Bark

### 3.2 获取设备 Key

1. 在 iPhone 上安装 Bark App
2. 打开 App，会显示一个 URL，格式为：
   ```
   https://api.day.app/YOUR_DEVICE_KEY/
   ```
3. `YOUR_DEVICE_KEY` 就是你的设备标识，需要保存在配置中

### 3.3 推送 API

**基础 URL：**
```
https://api.day.app/{device_key}/{title}/{body}
```

**或 POST 方式 (推荐)：**
```
POST https://api.day.app/push
Content-Type: application/json
```

### 3.4 请求参数

| 参数 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `title` | 是 | 通知标题 | "🦐 价格告警" |
| `body` | 是 | 通知内容 | "BTCUSDT 达到目标价 $50,000" |
| `badge` | 否 | 角标数字 | "1" |
| `sound` | 否 | 提示音 | "alarm.mp3" |
| `isArchive` | 否 | 是否归档 | "1" (归档) / "0" (不归档) |
| `group` | 否 | 分组 | "crypto_radar" |
| `level` | 否 | 优先级 | "timeSensitive" / "active" / "passive" |
| `url` | 否 | 点击跳转链接 | "https://..." |
| `copy` | 否 | 点击复制内容 | "BTCUSDT" |
| `icon` | 否 | 自定义图标 URL | "https://..." |

### 3.5 请求示例

```javascript
const response = await fetch('https://api.day.app/push', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: '🦐 价格告警',
    body: 'BTCUSDT 达到目标价 $50,000',
    badge: '1',
    sound: 'alarm.mp3',
    isArchive: '1',
    group: 'crypto_radar',
    level: 'timeSensitive'
  })
});

const result = await response.json();
// { "code": 200, "message": "success", "timestamp": 1710345678 }
```

### 3.6 响应格式

**成功：**
```json
{
  "code": 200,
  "message": "success",
  "timestamp": 1710345678
}
```

**失败：**
```json
{
  "code": 400,
  "message": "device key not found",
  "timestamp": 1710345678
}
```

### 3.7 自定义服务器 (可选)

用户可以自建 Bark 服务器，配置中支持自定义 URL：

```json
{
  "bark": {
    "deviceKey": "YOUR_KEY",
    "serverUrl": "https://api.day.app",  // 或自建服务器
    "enabled": true
  }
}
```

---

## 4. 速率限制和错误处理策略

### 4.1 币安 WS 速率限制

| 限制类型 | 值 | 处理策略 |
|----------|-----|----------|
| 连接数/IP | 300 | 我们只用 1-2 个连接，安全 |
| 流数/连接 | 300 | 我们最多 20 个币种，安全 |
| 消息频率 | 市场决定 | 内存缓冲 + 滑动窗口清理 |

### 4.2 Bark API 速率限制

官方未明确说明，建议：

- **单设备：** 不超过 100 条/分钟
- **我们的策略：** 告警抑制 (5 分钟静默期)，实际远低于限制

### 4.3 错误处理总览

```
┌─────────────────────────────────────────────────────────────┐
│                    错误处理流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  WS 断线 ──────► 记录日志 ──────► 指数退避重连               │
│                                                              │
│  Bark 失败 ────► 记录到失败队列 ──────► 下次检查时重试       │
│                   (最多 3 次)                                 │
│                                                              │
│  配置错误 ────► 启动时验证 ──────► 使用默认配置继续          │
│                                                              │
│  内存过高 ────► 监控检测到 ──────► 手动 GC + 清理缓存        │
│                                                              │
│  磁盘不足 ────► 启动时检查 ──────► 警告 + 停止写入历史       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.4 重试机制实现

```javascript
class RetryHandler {
  constructor(maxRetries = 3, baseDelay = 1000) {
    this.maxRetries = maxRetries;
    this.baseDelay = baseDelay;
  }

  async execute(fn) {
    let lastError;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const delay = this.baseDelay * Math.pow(2, i);
        logger.warn(`重试 ${i + 1}/${this.maxRetries}, ${delay}ms 后`);
        await this.sleep(delay);
      }
    }
    throw lastError;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 使用示例
const retry = new RetryHandler(3, 1000);

await retry.execute(async () => {
  const response = await fetch('https://api.day.app/push', options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
});
```

### 4.5 失败队列

```javascript
class FailedAlertQueue {
  constructor() {
    this.queue = [];
    this.maxSize = 100;
  }

  add(alert) {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift(); // 移除最旧的
    }
    this.queue.push({
      ...alert,
      retryCount: 0,
      createdAt: Date.now()
    });
  }

  async process(alertService) {
    const now = Date.now();
    const stillFailed = [];

    for (const item of this.queue) {
      if (item.retryCount >= 3) {
        logger.warn(`告警丢弃 (重试超限): ${item.body}`);
        continue;
      }

      try {
        await alertService.send(item);
        logger.info(`失败队列告警发送成功：${item.body}`);
      } catch (err) {
        item.retryCount++;
        stillFailed.push(item);
      }
    }

    this.queue = stillFailed;
  }
}
```

### 4.6 日志记录

```javascript
// 日志级别
logger.error()  // 系统错误 (WS 断线、Bark 失败)
logger.warn()   // 警告 (内存高、重试中)
logger.info()   // 正常信息 (告警发送、检查完成)
logger.debug()  // 调试信息 (价格更新、配置加载)

// 日志轮转 (PM2 自动处理)
// 或使用 logrotate 配置
```

---

## 5. 推荐的技术实现

### 5.1 WebSocket 客户端

```bash
npm install ws
```

```javascript
const WebSocket = require('ws');

const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');

ws.on('open', () => {
  logger.info('WS 连接成功');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  // 处理价格数据
});

ws.on('error', (err) => {
  logger.error(`WS 错误：${err.message}`);
});

ws.on('close', () => {
  logger.warn('WS 关闭，准备重连');
  reconnect();
});
```

### 5.2 HTTP 客户端 (Node 18+ 内置 fetch)

```javascript
// Node 18+ 内置 fetch，无需额外安装
const response = await fetch('https://api.day.app/push', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

### 5.3 超时处理

```javascript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);

try {
  const response = await fetch(url, {
    signal: controller.signal,
    // ...
  });
} catch (err) {
  if (err.name === 'AbortError') {
    logger.error('请求超时 (5s)');
  }
} finally {
  clearTimeout(timeoutId);
}
```

---

_API 调研完成，代码工可参考此文档实现 WS 连接和 Bark 通知。_
