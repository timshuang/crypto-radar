# 通知模块数据结构设计 (NOTIFICATION_DATA_MODELS.md)

## 1. 配置数据结构

### 1.1 config.json 扩展

**文件位置**: `/root/.openclaw/workspace/xia-zhihui/projects/crypto_radar/config.json`

**新增字段**:

```json
{
  "version": "1.1.0",
  "createdAt": "2026-03-12T10:00:00Z",
  "updatedAt": "2026-03-17T19:44:00Z",
  
  "bark": {
    "enabled": false,
    "deviceKey": "",
    "serverUrl": "https://api.day.app",
    "sound": "alarm.mp3",
    "volume": 8,
    "group": "crypto_radar"
  },
  
  "telegram": {
    "enabled": false,
    "botToken": "",
    "chatId": ""
  },
  
  "symbols": [
    {
      "symbol": "BTCUSDT",
      "enabled": true,
      "source": "spot",
      "alphaId": null,
      "barkEnabled": true,
      "barkMode": "normal",
      "targets": [...],
      "volatility": {
        "enabled": false,
        "barkEnabled": false,
        "barkMode": "normal",
        "windowMinutes": 5,
        "thresholdPercent": 20,
        "stepThreshold": 0.5
      }
    }
  ],
  
  "settings": {
    "checkIntervalMinutes": 1,
    "alertSilenceMinutes": 5,
    "maxPriceRecordsPerSymbol": 1440,
    "maxSymbols": 30,
    "notificationTestMode": false
  }
}
```

### 1.2 字段详细说明

#### 1.2.1 Bark 全局配置 (`bark` 对象)

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `enabled` | boolean | 是 | `false` | 全局 Bark 开关 |
| `deviceKey` | string | 是 | `""` | Bark 设备密钥 (前端显示用，实际从 .env 读取) |
| `serverUrl` | string | 否 | `"https://api.day.app"` | Bark 服务器地址 |
| `sound` | string | 否 | `"alarm.mp3"` | 默认铃声 (参数 A) |
| `volume` | number | 否 | `8` | 紧急模式音量 (参数 B, 0-10) |
| `group` | string | 否 | `"crypto_radar"` | 通知分组 |

#### 1.2.2 Telegram 全局配置 (`telegram` 对象)

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `enabled` | boolean | 是 | `false` | Telegram 通知开关 |
| `botToken` | string | 是 | `""` | Bot API Token (前端显示用，实际从 .env 读取) |
| `chatId` | string | 是 | `""` | 接收人 Chat ID (前端显示用，实际从 .env 读取) |

#### 1.2.3 币种级别通知配置 (`symbols[].barkEnabled` 等)

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `barkEnabled` | boolean | 是 | `true` | 价格目标通知开关 (监控列表模块) |
| `barkMode` | string | 是 | `"normal"` | 通知模式：`"normal"` 或 `"critical"` |
| `volatility.barkEnabled` | boolean | 是 | `false` | 波动侦测通知开关 |
| `volatility.barkMode` | string | 是 | `"normal"` | 波动侦测通知模式 |

### 1.3 配置示例

```json
{
  "bark": {
    "enabled": true,
    "deviceKey": "p8ZxX...",
    "serverUrl": "https://api.day.app",
    "sound": "alarm.mp3",
    "volume": 8,
    "group": "crypto_radar"
  },
  
  "telegram": {
    "enabled": true,
    "botToken": "123456:ABC...",
    "chatId": "123456789"
  },
  
  "symbols": [
    {
      "symbol": "BTCUSDT",
      "enabled": true,
      "source": "spot",
      "barkEnabled": true,
      "barkMode": "normal",
      "volatility": {
        "enabled": true,
        "barkEnabled": false,
        "barkMode": "normal",
        "windowMinutes": 5,
        "thresholdPercent": 20,
        "stepThreshold": 0.5
      }
    }
  ],
  
  "settings": {
    "notificationTestMode": true
  }
}
```

## 2. .env 文件结构

### 2.1 文件格式

**文件位置**: `/root/.openclaw/workspace/xia-zhihui/projects/crypto_radar/.env`

```bash
# Bark 配置
BARK_KEY=p8ZxX...
BARK_SOUND=alarm.mp3
BARK_VOLUME=8

# Telegram 配置
TG_BOT_TOKEN=123456:ABC...
TG_CHAT_ID=123456789

# 测试模式 (true/false)
NOTIFY_TEST_MODE=false
```

### 2.2 字段说明

| 变量名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `BARK_KEY` | string | 否 | Bark 设备密钥 |
| `BARK_SOUND` | string | 否 | 铃声文件名 |
| `BARK_VOLUME` | number | 否 | 紧急模式音量 (0-10) |
| `TG_BOT_TOKEN` | string | 否 | Telegram Bot Token |
| `TG_CHAT_ID` | string | 否 | Telegram Chat ID |
| `NOTIFY_TEST_MODE` | boolean | 否 | 测试模式开关 |

### 2.3 配置优先级

```
环境变量 (.env) > config.json > 默认值

示例:
- BARK_KEY 从 .env 读取 (敏感信息)
- bark.deviceKey 从 config.json 读取 (仅用于前端显示)
- 如果 .env 中不存在，使用 config.json 中的值 (不推荐)
```

## 3. 通知模式数据结构

### 3.1 通知模式枚举

```typescript
type NotificationMode = 'normal' | 'critical';

interface NotificationOptions {
  mode: NotificationMode;
  useBark: boolean;
  useTelegram: boolean;
  testMode: boolean;
}
```

### 3.2 模式参数映射

| 模式 | URL 参数 | 说明 |
|------|---------|------|
| `normal` | `?sound={A}` | 普通通知，使用默认音量 |
| `critical` | `?sound={A}&level=critical&volume={B}` | 紧急通知，可突破静音模式 |

### 3.3 前端 UI 数据结构

```typescript
// 监控列表模块
interface MonitorItemNotificationConfig {
  symbol: string;
  barkEnabled: boolean;
  barkMode: 'normal' | 'critical';
}

// 波动侦测模块
interface VolatilityItemNotificationConfig {
  symbol: string;
  volatilityBarkEnabled: boolean;
  volatilityBarkMode: 'normal' | 'critical';
}
```

## 4. 通知消息数据结构

### 4.1 告警对象 (Alert)

```typescript
interface Alert {
  // 基本信息
  symbol: string;           // 币种代码
  source: 'target' | 'volatility';  // 触发源
  type?: 'above' | 'below'; // 仅 target 类型
  
  // 价格信息
  targetPrice?: number;     // 目标价 (仅 target)
  currentPrice: number;     // 当前价
  
  // 波动信息 (仅 volatility)
  windowMinutes?: number;   // 时间窗口
  changePercent?: number;   // 波动百分比
  direction?: 'up' | 'down'; // 波动方向
  
  // 元数据
  triggeredAt: number;      // 触发时间戳
}
```

### 4.2 消息模板

#### 4.2.1 价格预警模板

```typescript
interface PriceAlertTemplate {
  title: string;  // 固定："价格预警"
  content: string; // 动态拼装
}

// 内容格式
// [类型：现货/Alpha] {币种名称} | 动作：{上穿/下破} | 目标价：{设定价格}

// 示例
{
  title: "价格预警",
  content: "[现货] BTCUSDT | 动作：上穿 | 目标价：$50,000"
}
```

#### 4.2.2 波动预警模板

```typescript
interface VolatilityAlertTemplate {
  title: string;  // 固定："重大波动提醒"
  content: string; // 动态拼装
}

// 内容格式
// [类型：现货/Alpha] {币种名称} | 异动：{XX}分钟内 {上涨/下跌} {XXX}%

// 示例
{
  title: "重大波动提醒",
  content: "[现货] BTCUSDT | 异动：5分钟内 上涨 3.5%"
}
```

### 4.3 拼装后的消息对象

```typescript
interface NotificationMessage {
  // Bark 专用
  barkUrl?: string;
  
  // Telegram 专用
  tgUrl?: string;
  
  // 通用
  title: string;
  content: string;
  mode: 'normal' | 'critical';
}
```

## 5. 持久化方案

### 5.1 方案对比

| 配置项 | 存储位置 | 理由 |
|--------|---------|------|
| API Key | `.env` | 敏感信息，不提交 Git |
| 通知开关 | `config.json` | 用户配置，需持久化 |
| 通知模式 | `config.json` | 用户配置，需持久化 |
| 铃声/音量 | `config.json` + `.env` | 默认值在 config，敏感值在 .env |
| 测试模式 | `.env` | 环境配置 |

### 5.2 配置文件结构

```
crypto_radar/
├── .env                      # 敏感配置 (不提交)
│   ├── BARK_KEY=...
│   ├── BARK_SOUND=...
│   ├── BARK_VOLUME=...
│   ├── TG_BOT_TOKEN=...
│   ├── TG_CHAT_ID=...
│   └── NOTIFY_TEST_MODE=...
│
├── config.json               # 非敏感配置 (可提交)
│   ├── bark: { enabled, deviceKey, sound, volume }
│   ├── telegram: { enabled, botToken, chatId }
│   ├── symbols: [{ barkEnabled, barkMode, ... }]
│   └── settings: { notificationTestMode }
│
├── .gitignore                # Git 忽略配置
│   └── .env
│
└── .env.example              # 示例文件 (可提交)
    ├── BARK_KEY=YOUR_BARK_KEY_HERE
    ├── BARK_SOUND=alarm.mp3
    ├── BARK_VOLUME=8
    ├── TG_BOT_TOKEN=YOUR_BOT_TOKEN_HERE
    ├── TG_CHAT_ID=YOUR_CHAT_ID_HERE
    └── NOTIFY_TEST_MODE=false
```

### 5.3 配置加载顺序

```javascript
// src/config.js
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor() {
    // 1. 加载 .env
    dotenv.config({ path: path.join(__dirname, '../.env') });
    
    // 2. 加载 config.json
    this.config = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8')
    );
  }

  // 获取 Bark 配置 (合并 .env 和 config.json)
  getBarkConfig() {
    return {
      // 敏感信息从 .env 读取
      key: process.env.BARK_KEY || this.config.bark?.deviceKey,
      sound: process.env.BARK_SOUND || this.config.bark?.sound || 'alarm.mp3',
      volume: parseInt(process.env.BARK_VOLUME) || this.config.bark?.volume || 8,
      
      // 非敏感信息从 config.json 读取
      enabled: this.config.bark?.enabled || false,
      serverUrl: this.config.bark?.serverUrl || 'https://api.day.app',
      group: this.config.bark?.group || 'crypto_radar'
    };
  }

  // 获取 Telegram 配置
  getTelegramConfig() {
    return {
      // 敏感信息从 .env 读取
      botToken: process.env.TG_BOT_TOKEN || this.config.telegram?.botToken,
      chatId: process.env.TG_CHAT_ID || this.config.telegram?.chatId,
      
      // 非敏感信息从 config.json 读取
      enabled: this.config.telegram?.enabled || false
    };
  }

  // 获取测试模式
  isTestMode() {
    return process.env.NOTIFY_TEST_MODE === 'true' ||
           this.config.settings?.notificationTestMode === true;
  }
}
```

### 5.4 配置验证 Schema

```javascript
const notificationConfigSchema = {
  bark: {
    enabled: { type: 'boolean', required: true },
    deviceKey: { type: 'string', required: false },
    serverUrl: { type: 'string', required: false },
    sound: { type: 'string', required: false },
    volume: { type: 'number', min: 0, max: 10, required: false },
    group: { type: 'string', required: false }
  },
  
  telegram: {
    enabled: { type: 'boolean', required: true },
    botToken: { type: 'string', required: false },
    chatId: { type: 'string', required: false }
  },
  
  symbols: {
    type: 'array',
    items: {
      barkEnabled: { type: 'boolean', required: true },
      barkMode: { type: 'string', enum: ['normal', 'critical'], required: true },
      volatility: {
        barkEnabled: { type: 'boolean', required: true },
        barkMode: { type: 'string', enum: ['normal', 'critical'], required: true }
      }
    }
  },
  
  settings: {
    notificationTestMode: { type: 'boolean', required: false }
  }
};
```

## 6. 完整数据结构示例

### 6.1 config.json 完整示例

```json
{
  "version": "1.1.0",
  "createdAt": "2026-03-12T10:00:00Z",
  "updatedAt": "2026-03-17T19:44:00Z",
  
  "bark": {
    "enabled": true,
    "deviceKey": "p8ZxX...",
    "serverUrl": "https://api.day.app",
    "sound": "alarm.mp3",
    "volume": 8,
    "group": "crypto_radar"
  },
  
  "telegram": {
    "enabled": true,
    "botToken": "123456:ABC...",
    "chatId": "123456789"
  },
  
  "symbols": [
    {
      "symbol": "BTCUSDT",
      "enabled": true,
      "source": "spot",
      "alphaId": null,
      "barkEnabled": true,
      "barkMode": "normal",
      "targets": [
        {
          "id": "target_1",
          "type": "above",
          "price": 50000,
          "enabled": true,
          "status": "waiting"
        }
      ],
      "volatility": {
        "enabled": true,
        "barkEnabled": false,
        "barkMode": "normal",
        "windowMinutes": 5,
        "thresholdPercent": 20,
        "stepThreshold": 0.5
      }
    },
    {
      "symbol": "ETHUSDT",
      "enabled": true,
      "source": "spot",
      "alphaId": null,
      "barkEnabled": true,
      "barkMode": "critical",
      "targets": [],
      "volatility": {
        "enabled": false,
        "barkEnabled": false,
        "barkMode": "normal",
        "windowMinutes": 5,
        "thresholdPercent": 20,
        "stepThreshold": 0.5
      }
    }
  ],
  
  "settings": {
    "checkIntervalMinutes": 1,
    "alertSilenceMinutes": 5,
    "maxPriceRecordsPerSymbol": 1440,
    "maxSymbols": 30,
    "notificationTestMode": false
  }
}
```

### 6.2 .env 完整示例

```bash
# Bark 配置
BARK_KEY=p8ZxX...
BARK_SOUND=alarm.mp3
BARK_VOLUME=8

# Telegram 配置
TG_BOT_TOKEN=123456:ABC...
TG_CHAT_ID=123456789

# 测试模式
NOTIFY_TEST_MODE=false
```

### 6.3 运行时内存结构

```javascript
// 全局通知配置 (单例)
const notificationConfig = {
  bark: {
    enabled: true,
    key: 'p8ZxX...',      // 从 .env 加载
    sound: 'alarm.mp3',   // 从 .env 或 config 加载
    volume: 8,            // 从 .env 或 config 加载
    serverUrl: 'https://api.day.app',
    group: 'crypto_radar'
  },
  
  telegram: {
    enabled: true,
    botToken: '123456:ABC...',  // 从 .env 加载
    chatId: '123456789'         // 从 .env 加载
  },
  
  symbols: new Map([
    ['BTCUSDT', {
      barkEnabled: true,
      barkMode: 'normal',
      volatilityBarkEnabled: false,
      volatilityBarkMode: 'normal'
    }],
    ['ETHUSDT', {
      barkEnabled: true,
      barkMode: 'critical',
      volatilityBarkEnabled: false,
      volatilityBarkMode: 'normal'
    }]
  ]),
  
  testMode: false
};
```

---

_数据结构设计完成，钳子哥可参考此文档实现配置管理和持久化。_
