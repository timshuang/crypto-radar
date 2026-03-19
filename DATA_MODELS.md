# DATA_MODELS.md - 数据结构设计

## 1. 用户配置数据结构

### 1.1 配置文件格式 (config.json)

```json
{
  "version": "1.0.0",
  "createdAt": "2026-03-12T10:00:00Z",
  "updatedAt": "2026-03-12T10:00:00Z",
  
  "bark": {
    "enabled": true,
    "deviceKey": "YOUR_DEVICE_KEY_HERE",
    "serverUrl": "https://api.day.app",
    "sound": "alarm.mp3",
    "group": "crypto_radar"
  },
  
  "symbols": [
    {
      "symbol": "BTCUSDT",
      "enabled": true,
      "source": "spot",
      "targets": [
        {
          "id": "target_1",
          "type": "above",
          "price": 50000,
          "enabled": true,
          "status": "waiting"
        },
        {
          "id": "target_2",
          "type": "below",
          "price": 45000,
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
    },
    {
      "symbol": "ETHUSDT",
      "enabled": true,
      "source": "spot",
      "targets": [],
      "volatility": {
        "enabled": false,
        "windowMinutes": 60,
        "thresholdPercent": 3.0,
        "stepThreshold": 0.5
      }
    }
  ],
  
  "settings": {
    "checkIntervalMinutes": 1,
    "alertSilenceMinutes": 5,
    "maxPriceRecordsPerSymbol": 1440,
    "maxSymbols": 20
  }
}
```

### 1.2 配置字段说明

#### 根级别

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `version` | string | 是 | 配置文件版本 |
| `createdAt` | string | 是 | 创建时间 (ISO 8601) |
| `updatedAt` | string | 是 | 最后更新时间 |
| `bark` | object | 是 | Bark 通知配置 |
| `symbols` | array | 是 | 币种列表 |
| `settings` | object | 是 | 全局设置 |

#### Bark 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 是 | 是否启用通知 |
| `deviceKey` | string | 是 | Bark 设备密钥 |
| `serverUrl` | string | 否 | 服务器 URL (默认 api.day.app) |
| `sound` | string | 否 | 提示音文件名 |
| `group` | string | 否 | 通知分组 |

#### 币种配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `symbol` | string | 是 | 币种代码 (大写) |
| `enabled` | boolean | 是 | 是否启用此币种 |
| `source` | string | 是 | 数据源 (`spot` 或 `alpha`) |
| `targets` | array | 是 | 价格目标列表 |
| `volatility` | object | 是 | 波动侦测配置 |

#### 价格目标 (Target)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识 (UUID 或自增) |
| `type` | string | 是 | `above` (高于) 或 `below` (低于) |
| `price` | number | 是 | 目标价格 |
| `enabled` | boolean | 是 | 是否启用 |
| `status` | string | 是 | `waiting` / `triggered` / `completed` |

#### 波动侦测配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `enabled` | boolean | 是 | 是否启用 |
| `windowMinutes` | number | 是 | 滑动窗口大小 (分钟) |
| `thresholdPercent` | number | 是 | 触发阈值 (%) |
| `stepThreshold` | number | 是 | 阶梯增量 (%) |

#### 全局设置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `checkIntervalMinutes` | number | 是 | 检查间隔 (分钟) |
| `alertSilenceMinutes` | number | 是 | 告警静默期 (分钟) |
| `maxPriceRecordsPerSymbol` | number | 是 | 每币种最大价格记录数 |
| `maxSymbols` | number | 是 | 最大币种数量 |

### 1.3 配置验证 Schema

```javascript
const configSchema = {
  version: { type: 'string', pattern: /^\d+\.\d+\.\d+$/ },
  bark: {
    enabled: { type: 'boolean' },
    deviceKey: { type: 'string', minLength: 1 },
    serverUrl: { type: 'string', optional: true },
    sound: { type: 'string', optional: true },
    group: { type: 'string', optional: true }
  },
  symbols: {
    type: 'array',
    items: {
      symbol: { type: 'string', pattern: /^[A-Z]+$/ },
      enabled: { type: 'boolean' },
      source: { type: 'string', enum: ['spot', 'alpha'] },
      targets: { type: 'array' },
      volatility: { type: 'object' }
    }
  },
  settings: {
    checkIntervalMinutes: { type: 'number', min: 1, max: 60 },
    alertSilenceMinutes: { type: 'number', min: 1, max: 60 },
    maxPriceRecordsPerSymbol: { type: 'number', min: 60, max: 10080 },
    maxSymbols: { type: 'number', min: 1, max: 50 }
  }
};
```

---

## 2. 价格历史记录数据结构

### 2.1 内存中的数据结构 (优化版)

```javascript
// 使用并行 TypedArray 减少内存占用
class PriceBuffer {
  constructor(maxSize = 1440) {
    this.maxSize = maxSize;
    this.times = new Uint32Array(maxSize);      // 秒级时间戳
    this.prices = new Float64Array(maxSize);    // 价格
    this.volumes = new Float32Array(maxSize);   // 成交量
    this.head = 0;                               // 写入位置
    this.count = 0;                              // 实际记录数
  }

  push(time, price, volume = 0) {
    const idx = this.head % this.maxSize;
    this.times[idx] = Math.floor(time / 1000);  // 转为秒
    this.prices[idx] = price;
    this.volumes[idx] = volume;
    this.head++;
    if (this.count < this.maxSize) this.count++;
  }

  // 获取滑动窗口内的最高价和最低价
  getWindowStats(windowMinutes) {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (windowMinutes * 60);
    
    let min = Infinity;
    let max = -Infinity;
    let found = false;

    // 从后向前遍历 (最新的数据)
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + this.maxSize) % this.maxSize;
      const time = this.times[idx];
      
      if (time < windowStart) break;
      
      const price = this.prices[idx];
      if (price < min) min = price;
      if (price > max) max = price;
      found = true;
    }

    return found ? { min, max } : null;
  }

  // 获取最新价格
  getLatest() {
    if (this.count === 0) return null;
    const idx = (this.head - 1 + this.maxSize) % this.maxSize;
    return {
      time: this.times[idx] * 1000,
      price: this.prices[idx],
      volume: this.volumes[idx]
    };
  }
}
```

### 2.2 持久化的数据结构 (JSON)

```json
{
  "BTCUSDT": {
    "lastUpdate": 1710345678901,
    "latestPrice": 50000.00,
    "records": [
      { "t": 1710345600, "p": 49998.50, "v": 1.5 },
      { "t": 1710345660, "p": 50000.00, "v": 2.0 },
      { "t": 1710345720, "p": 50001.50, "v": 1.8 }
    ]
  },
  "ETHUSDT": {
    "lastUpdate": 1710345678901,
    "latestPrice": 3000.00,
    "records": [
      { "t": 1710345600, "p": 2998.00, "v": 10.5 },
      { "t": 1710345660, "p": 3000.00, "v": 12.0 }
    ]
  }
}
```

**字段缩写说明：**
- `t`: timestamp (秒级，节省空间)
- `p`: price
- `v`: volume

### 2.3 滑动窗口计算

```javascript
function calculateVolatility(records, windowMinutes) {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (windowMinutes * 60);
  
  const windowRecords = records.filter(r => r.t >= windowStart);
  
  if (windowRecords.length < 2) {
    return null; // 数据不足
  }
  
  const prices = windowRecords.map(r => r.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  
  const volatility = ((max - min) / min) * 100;
  
  return {
    min,
    max,
    volatility,
    recordCount: windowRecords.length
  };
}

// 使用示例
const stats = calculateVolatility(priceData['BTCUSDT'].records, 60);
if (stats && stats.volatility >= threshold) {
  // 触发告警
}
```

---

## 3. 告警状态数据结构

### 3.1 告警状态文件 (alert_state.json)

```json
{
  "version": "1.0.0",
  "lastUpdate": "2026-03-12T10:00:00Z",
  
  "targets": {
    "target_1": {
      "symbol": "BTCUSDT",
      "type": "above",
      "price": 50000,
      "status": "completed",
      "triggeredAt": 1710345678901,
      "completedAt": 1710345680000,
      "lastAlertAt": 1710345678901,
      "alertCount": 1
    },
    "target_2": {
      "symbol": "BTCUSDT",
      "type": "below",
      "price": 45000,
      "status": "waiting",
      "triggeredAt": null,
      "completedAt": null,
      "lastAlertAt": null,
      "alertCount": 0
    }
  },
  
  "volatility": {
    "BTCUSDT": {
      "enabled": true,
      "currentThreshold": 2.0,
      "lastTriggeredAt": 1710340000000,
      "lastAlertAt": 1710340000000,
      "triggerCount": 3
    },
    "ETHUSDT": {
      "enabled": false,
      "currentThreshold": 3.0,
      "lastTriggeredAt": null,
      "lastAlertAt": null,
      "triggerCount": 0
    }
  },
  
  "silenceUntil": {
    "BTCUSDT_target": 1710346000000,
    "BTCUSDT_volatility": 1710346000000
  }
}
```

### 3.2 字段说明

#### Target 状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `symbol` | string | 币种 |
| `type` | string | `above` / `below` |
| `price` | number | 目标价格 |
| `status` | string | `waiting` / `triggered` / `completed` |
| `triggeredAt` | number | 首次触发时间戳 (ms) |
| `completedAt` | number | 完成时间戳 (ms) |
| `lastAlertAt` | number | 最后告警时间戳 (ms) |
| `alertCount` | number | 告警次数 |

#### Volatility 状态

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用 |
| `currentThreshold` | number | 当前阈值 (阶梯累加后) |
| `lastTriggeredAt` | number | 最后触发时间戳 |
| `lastAlertAt` | number | 最后告警时间戳 |
| `triggerCount` | number | 触发次数 |

#### SilenceUntil (静默期)

| 键 | 值 | 说明 |
|-----|-----|------|
| `BTCUSDT_target` | timestamp | 价格目标告警静默截止时间 |
| `BTCUSDT_volatility` | timestamp | 波动告警静默截止时间 |

### 3.3 状态流转逻辑

#### 价格目标状态机

```
┌─────────────┐
│   WAITING   │ ◄──── 初始状态
└──────┬──────┘
       │ 价格触达
       ▼
┌─────────────┐
│  TRIGGERED  │ ◄──── 发送告警
└──────┬──────┘
       │ 告警成功
       ▼
┌─────────────┐
│  COMPLETED  │ ◄──── 一次性逻辑，不再检查
└─────────────┘
```

#### 波动侦测状态机

```
┌─────────────┐
│   MONITOR   │ ◄──── 持续监控
└──────┬──────┘
       │ 波动超阈值
       ▼
┌─────────────┐
│  TRIGGERED  │ ◄──── 发送告警
└──────┬──────┘
       │ 静默期结束
       ▼
┌─────────────┐
│   MONITOR   │ ◄──── 阈值累加 (stepThreshold)
└─────────────┘
```

### 3.4 告警抑制实现

```javascript
class AlertThrottle {
  constructor(silenceMinutes = 5) {
    this.silenceMs = silenceMinutes * 60 * 1000;
    this.silenceUntil = new Map(); // key => timestamp
  }

  canAlert(key) {
    const now = Date.now();
    const until = this.silenceUntil.get(key);
    return !until || now >= until;
  }

  setSilence(key) {
    this.silenceUntil.set(key, Date.now() + this.silenceMs);
  }

  // 持久化
  toJSON() {
    return Object.fromEntries(this.silenceUntil);
  }

  // 恢复
  fromJSON(data) {
    this.silenceUntil = new Map(Object.entries(data));
  }
}

// 使用示例
const throttle = new AlertThrottle(5);

const targetKey = `BTCUSDT_target_1`;
if (throttle.canAlert(targetKey)) {
  await sendAlert(...);
  throttle.setSilence(targetKey);
}
```

### 3.5 阶梯阈值实现

```javascript
class StepThreshold {
  constructor(baseThreshold, stepIncrement) {
    this.baseThreshold = baseThreshold;
    this.stepIncrement = stepIncrement;
    this.currentThreshold = baseThreshold;
    this.triggerCount = 0;
  }

  trigger() {
    this.triggerCount++;
    this.currentThreshold = this.baseThreshold + 
      (this.stepIncrement * (this.triggerCount - 1));
  }

  reset() {
    this.currentThreshold = this.baseThreshold;
    this.triggerCount = 0;
  }

  toJSON() {
    return {
      baseThreshold: this.baseThreshold,
      stepIncrement: this.stepIncrement,
      currentThreshold: this.currentThreshold,
      triggerCount: this.triggerCount
    };
  }

  fromJSON(data) {
    this.baseThreshold = data.baseThreshold;
    this.stepIncrement = data.stepIncrement;
    this.currentThreshold = data.currentThreshold;
    this.triggerCount = data.triggerCount;
  }
}

// 使用示例
const volatility = new StepThreshold(2.0, 0.5);
// 第 1 次触发：阈值 2.0%
// 第 2 次触发：阈值 2.5%
// 第 3 次触发：阈值 3.0%
```

---

## 4. 持久化方案

### 4.1 方案对比

| 方案 | 优点 | 缺点 | 推荐场景 |
|------|------|------|----------|
| **JSON 文件** | 无需依赖、易调试、512MB 友好 | 并发写入需锁、大文件性能差 | **推荐 (本项目)** |
| SQLite | 查询强大、并发好、事务支持 | 需要依赖、增加内存开销 | 数据量 > 10 万条 |
| LevelDB | 写入快、压缩好 | 需要依赖、调试困难 | 高频写入场景 |

### 4.2 JSON 文件方案 (推荐)

#### 文件结构

```
crypto_radar/
├── config.json          # 用户配置
├── alert_state.json     # 告警状态
├── price_history.json   # 价格历史 (可选，用于恢复)
└── logs/
    └── app.log          # 应用日志 (PM2 管理)
```

#### 写入策略

```javascript
const fs = require('fs').promises;
const path = require('path');

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {};
    this.writeQueue = Promise.resolve();
    this.pendingWrites = 0;
  }

  async load() {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.data = {};
      } else {
        throw err;
      }
    }
  }

  async save() {
    // 队列化写入，避免并发冲突
    this.writeQueue = this.writeQueue.then(async () => {
      const content = JSON.stringify(this.data, null, 2);
      await fs.writeFile(this.filePath, content, 'utf8');
    });
    return this.writeQueue;
  }

  // 批量更新 (减少写入次数)
  batchUpdate(updates) {
    Object.assign(this.data, updates);
    this.pendingWrites++;
    
    // 防抖：1 秒内多次更新只写入一次
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save().then(() => {
        this.pendingWrites = 0;
      });
    }, 1000);
  }
}
```

#### 原子写入 (防止损坏)

```javascript
async function atomicWrite(filePath, data) {
  const tmpPath = filePath + '.tmp';
  const content = JSON.stringify(data, null, 2);
  
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, filePath); // 原子操作
}
```

### 4.3 数据恢复策略

```javascript
class DataManager {
  async recoverFromCrash() {
    // 1. 尝试加载主文件
    try {
      await this.stateStore.load();
      logger.info('状态文件加载成功');
      return;
    } catch (err) {
      logger.warn(`主文件损坏：${err.message}`);
    }

    // 2. 尝试加载备份
    try {
      await fs.rename(
        this.stateStore.filePath + '.bak',
        this.stateStore.filePath
      );
      await this.stateStore.load();
      logger.info('从备份恢复成功');
      return;
    } catch (err) {
      logger.warn('备份文件也不存在');
    }

    // 3. 使用默认状态
    this.stateStore.data = this.getDefaultState();
    logger.warn('使用默认状态启动');
  }

  async createBackup() {
    const backupPath = this.stateStore.filePath + '.bak';
    await fs.copyFile(this.stateStore.filePath, backupPath);
  }
}
```

### 4.4 定期清理策略

```javascript
class DataCleanup {
  constructor(dataManager, maxRecords = 1440) {
    this.dataManager = dataManager;
    this.maxRecords = maxRecords;
  }

  // 每 5 分钟清理一次过期数据
  start() {
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  cleanup() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 小时

    for (const symbol of Object.keys(this.dataManager.priceData)) {
      const records = this.dataManager.priceData[symbol].records;
      
      // 移除超过 24 小时的记录
      const validRecords = records.filter(r => {
        return now - (r.t * 1000) < maxAge;
      });

      // 限制最大记录数
      if (validRecords.length > this.maxRecords) {
        validRecords.splice(0, validRecords.length - this.maxRecords);
      }

      this.dataManager.priceData[symbol].records = validRecords;
    }

    logger.debug('数据清理完成');
  }
}
```

---

## 5. 完整数据结构示例

### 5.1 初始化状态

```javascript
const initialState = {
  config: {
    version: "1.0.0",
    bark: {
      enabled: true,
      deviceKey: "",
      serverUrl: "https://api.day.app",
      sound: "alarm.mp3",
      group: "crypto_radar"
    },
    symbols: [],
    settings: {
      checkIntervalMinutes: 1,
      alertSilenceMinutes: 5,
      maxPriceRecordsPerSymbol: 1440,
      maxSymbols: 20
    }
  },
  
  alertState: {
    version: "1.0.0",
    lastUpdate: new Date().toISOString(),
    targets: {},
    volatility: {},
    silenceUntil: {}
  },
  
  priceData: {}
};
```

### 5.2 运行时内存结构

```javascript
// 全局状态 (单例)
const appState = {
  config: { /* 加载的 config.json */ },
  alertState: { /* 加载的 alert_state.json */ },
  
  priceBuffers: new Map(),  // symbol => PriceBuffer
  wsConnections: new Map(), // symbol => WebSocket
  throttle: new AlertThrottle(5),
  
  checkerInterval: null,
  cleanupInterval: null
};
```

---

_数据结构设计完成，代码工可参考此文档实现数据管理和持久化。_
