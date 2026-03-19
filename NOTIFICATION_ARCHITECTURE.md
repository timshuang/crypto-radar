# 通知模块架构设计 (NOTIFICATION_ARCHITECTURE.md)

## 1. 系统整体架构

### 1.1 通知模块在系统中的位置

```
┌─────────────────────────────────────────────────────────────────┐
│                        crypto_radar                              │
│                    (1C/512MB RAM VPS)                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  价格目标线   │    │  波动侦测线   │    │  通知服务    │      │
│  │  (Target)    │    │  (Volatility)│    │  (Notifier)  │      │
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
│  │  (Spot)      │  │  (Alpha)      │  │  (JSON)       │       │
│  └──────────────┘  └───────────────┘  └───────────────┘       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │              通知通道 (Notification Channels)          │      │
│  ├──────────────────────────────────────────────────────┤      │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │      │
│  │  │   Bark      │  │  Telegram   │  │  网页弹窗   │  │      │
│  │  │  (iOS)      │  │  (Bot)      │  │  (WebSocket)│  │      │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 通知模块架构

```
┌──────────────────────────────────────────────────────────────┐
│                     通知服务层 (NotificationService)          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              通知路由器 (NotificationRouter)             │ │
│  │  - 根据配置选择通知通道 (Bark / Telegram / 网页)           │ │
│  │  - 支持多通道并行发送                                     │ │
│  │  - 支持测试模式 (仅弹窗验证)                               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                             │                                 │
│         ┌───────────────────┼───────────────────┐            │
│         │                   │                   │             │
│  ┌──────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐     │
│  │  BarkSender  │  │  TgSender     │  │  WebSender    │     │
│  │  - URL 拼装   │  │  - URL 拼装    │  │  - WebSocket  │     │
│  │  - 模式选择   │  │  - 消息格式化  │  │  - 广播消息   │     │
│  │  - 紧急/普通  │  │  - Bot API    │  │               │     │
│  └──────┬───────┘  └───────┬───────┘  └───────┬───────┘     │
│         │                   │                   │             │
│         └───────────────────┼───────────────────┘             │
│                             │                                 │
│                    ┌────────▼────────┐                        │
│                    │  消息模板引擎    │                        │
│                    │  (Templater)    │                        │
│                    │  - 价格预警     │                        │
│                    │  - 波动预警     │                        │
│                    │  - URL 编码     │                        │
│                    └─────────────────┘                        │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## 2. 与现有报警系统的集成方式

### 2.1 现有报警流程

```
CheckerEngine (每分钟)
    │
    ├─► TargetMonitor.check() ──► 触发？───► AlertService.sendTargetAlert()
    │                                    │
    │                                    ├─► 保存到 alert_history.json
    │                                    ├─► WebSocket 推送 (网页弹窗)
    │                                    └─► [新增] NotificationService.send()
    │
    └─► VolatilityMonitor.check() ──► 触发？──► AlertService.sendVolatilityAlert()
                                         │
                                         ├─► 保存到 alert_history.json
                                         ├─► WebSocket 推送 (网页弹窗)
                                         └─► [新增] NotificationService.send()
```

### 2.2 集成点

#### 2.2.1 AlertService 扩展

**文件**: `src/alert-service.js`

**新增方法**:
```javascript
class AlertService {
  // ... 现有方法 ...

  /**
   * 发送外部通知 (Bark / Telegram)
   * @param {Object} alert - 告警对象
   * @param {Object} options - 通知选项
   * @param {boolean} options.useBark - 是否发送 Bark
   * @param {boolean} options.useTelegram - 是否发送 Telegram
   * @param {string} options.mode - 通知模式：'normal' | 'critical'
   * @param {boolean} options.testMode - 测试模式 (仅弹窗验证)
   */
  async sendExternalNotification(alert, options) {
    // 调用 NotificationService
  }
}
```

#### 2.2.2 CheckerEngine 调用

**文件**: `src/checker-engine.js`

**修改点**:
```javascript
// 在 handleTrigger 中增加外部通知调用
async handleTrigger(symbol, target, currentPrice, source) {
  // ... 现有逻辑 ...

  const alert = {
    symbol,
    type: target.type,
    targetPrice: target.price,
    currentPrice,
    source, // 'target' 或 'volatility'
    triggeredAt: Date.now()
  };

  const options = {
    useBark: symbolConfig.barkEnabled ?? true,
    useTelegram: this.configManager.getConfig().telegram?.enabled ?? false,
    mode: symbolConfig.barkMode ?? 'normal', // 'normal' | 'critical'
    testMode: process.env.NOTIFY_TEST_MODE === 'true'
  };

  await this.alertService.sendExternalNotification(alert, options);
}
```

## 3. 数据流设计

### 3.1 通知触发数据流

```
┌─────────────────┐
│  价格/波动触发   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│  AlertService.sendExternalNotification() │
│  - 构建 alert 对象                        │
│  - 读取通知配置 (bark/telegram)           │
│  - 读取用户模式选择 (normal/critical)     │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│     NotificationRouter.route()          │
│  - 根据配置选择通道                       │
│  - 并行发送 (如同时启用 Bark+TG)          │
└────────┬────────────────────────────────┘
         │
         ├──────────────────┬──────────────────┐
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   BarkSender    │ │   TgSender      │ │   WebSender     │
│                 │ │                 │ │                 │
│ 1. 读取配置     │ │ 1. 读取配置     │ │ 1. WebSocket    │
│ 2. 拼装 URL     │ │ 2. 拼装 URL     │ │    广播         │
│ 3. HTTP GET     │ │ 3. HTTP GET     │ │                 │
│ 4. 返回结果     │ │ 4. 返回结果     │ │                 │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │  结果汇总返回    │
                   │  - 成功/失败    │
                   │  - 测试模式弹窗  │
                   └─────────────────┘
```

### 3.2 配置读取流程

```
CheckerEngine 触发
    │
    ▼
AlertService.sendExternalNotification()
    │
    ├─► 读取 config.json
    │   ├─► bark.deviceKey
    │   ├─► bark.sound (A)
    │   ├─► bark.volume (B)
    │   ├─► telegram.botToken
    │   └─► telegram.chatId
    │
    ├─► 读取 symbol 配置
    │   ├─► barkEnabled (开关)
    │   └─► barkMode (模式)
    │
    └─► 读取 .env (敏感信息)
        ├─► BARK_KEY
        ├─► TG_BOT_TOKEN
        └─► TG_CHAT_ID
```

### 3.3 URL 拼装流程

```
┌─────────────────────────────────────────┐
│  Templater.buildBarkUrl()               │
│                                         │
│  输入:                                   │
│  - barkKey: "YOUR_KEY"                  │
│  - title: "价格预警"                     │
│  - content: "[现货] BTCUSDT | ..."      │
│  - sound: "alarm.mp3" (A)               │
│  - volume: 8 (B)                        │
│  - mode: 'critical'                     │
│                                         │
│  处理:                                   │
│  1. encodeURIComponent(title)           │
│  2. encodeURIComponent(content)         │
│  3. 根据模式选择参数                     │
│                                         │
│  输出:                                   │
│  https://api.day.app/YOUR_KEY/          │
│    %E4%BB%B7%E6%A0%BC%E9%A2%84%E8%AD%A6/│
│    %5B%E7%8E%B0%E8%B4%A7%5D%20BTC...   │
│    ?sound=alarm.mp3                     │
│    &level=critical                      │
│    &volume=8                            │
└─────────────────────────────────────────┘
```

## 4. 通知通道详细设计

### 4.1 Bark 通道

**特性**:
- 推送至 iOS 设备
- 支持普通/紧急两种模式
- 紧急模式可突破静音模式响铃

**普通模式 URL**:
```
https://api.day.app/{bark_key}/{title}/{content}?sound={sound}
```

**紧急模式 URL**:
```
https://api.day.app/{bark_key}/{title}/{content}?sound={sound}&level=critical&volume={volume}
```

**参数说明**:
| 参数 | 说明 | 必填 | 示例 |
|------|------|------|------|
| bark_key | 设备密钥 | 是 | `p8ZxX...` |
| title | 通知标题 | 是 | `价格预警` |
| content | 通知内容 | 是 | `[现货] BTCUSDT...` |
| sound | 铃声名称 | 否 | `alarm.mp3` |
| level | 通知级别 | 仅紧急 | `critical` |
| volume | 音量 (0-10) | 仅紧急 | `8` |

### 4.2 Telegram 通道

**特性**:
- 推送至 Telegram 聊天
- 支持 Markdown 格式化
- 无紧急/普通模式区分

**URL**:
```
https://api.telegram.org/bot{tg_bot_token}/sendMessage?chat_id={tg_chat_id}&text={title}\n{content}
```

**参数说明**:
| 参数 | 说明 | 必填 | 示例 |
|------|------|------|------|
| tg_bot_token | Bot API Token | 是 | `123456:ABC...` |
| tg_chat_id | 接收人 ID | 是 | `123456789` |
| text | 消息文本 | 是 | `标题\n内容` |

### 4.3 网页弹窗通道 (现有)

**特性**:
- 通过 WebSocket 推送
- 已在现有系统中实现
- 无需额外配置

**集成方式**:
- 保持现有 `AlertService.sendWebAlert()` 不变
- 作为通知路由的默认通道

## 5. 安全设计

### 5.1 API Key 保护

**原则**:
- ❌ 严禁将 API Key 存入代码库
- ❌ 严禁将 API Key 存入 config.json
- ✅ 存入 `.env` 文件
- ✅ `.env` 加入 `.gitignore`

**文件结构**:
```
crypto_radar/
├── .env                  # 敏感信息 (不提交到 Git)
├── .gitignore            # 忽略 .env
├── config.json           # 非敏感配置
├── src/
│   └── notification/
│       └── notification-service.js
```

### 5.2 .env 文件格式

```bash
# Bark 配置
BARK_KEY=p8ZxX...
BARK_SOUND=alarm.mp3
BARK_VOLUME=8

# Telegram 配置
TG_BOT_TOKEN=123456:ABC...
TG_CHAT_ID=123456789

# 测试模式
NOTIFY_TEST_MODE=true
```

### 5.3 .gitignore 配置

```gitignore
# 环境文件
.env
.env.local
.env.*.local

# 配置文件 (可选)
config.json
alert_state.json

# 日志
logs/
*.log
```

### 5.4 配置加载逻辑

```javascript
// src/notification/notification-service.js
require('dotenv').config();

class NotificationService {
  constructor() {
    // 从环境变量读取敏感信息
    this.barkKey = process.env.BARK_KEY;
    this.barkSound = process.env.BARK_SOUND || 'alarm.mp3';
    this.barkVolume = parseInt(process.env.BARK_VOLUME) || 8;
    
    this.tgBotToken = process.env.TG_BOT_TOKEN;
    this.tgChatId = process.env.TG_CHAT_ID;
    
    // 测试模式
    this.testMode = process.env.NOTIFY_TEST_MODE === 'true';
  }
}
```

## 6. 错误处理与重试

### 6.1 错误类型

| 错误类型 | 处理方式 | 重试 |
|---------|---------|------|
| 网络超时 | 记录日志，不阻塞主流程 | 否 |
| API 返回错误 | 记录日志，不阻塞主流程 | 否 |
| 配置缺失 | 跳过该通道，记录警告 | 否 |
| URL 拼装失败 | 抛出错误，中断通知 | 否 |

### 6.2 错误日志

```javascript
try {
  await this.barkSender.send(alert, options);
} catch (err) {
  console.error(`[Notification] Bark 发送失败: ${err.message}`);
  // 不抛出，继续处理其他通道
}
```

### 6.3 测试模式

**环境变量**: `NOTIFY_TEST_MODE=true`

**行为**:
- 不真实发送 HTTP 请求
- 仅弹窗显示拼装的 URL
- 用于验证 URL 拼装是否正确

**弹窗内容**:
```
【测试模式】Bark 通知
URL: https://api.day.app/...
标题: 价格预警
内容: [现货] BTCUSDT | ...
```

---

_架构设计完成，下一步请钳子哥根据此文档实现通知服务模块。_
