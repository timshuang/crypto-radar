# 通知模块实现方案 (NOTIFICATION_IMPLEMENTATION.md)

## 1. 文件修改清单

### 1.1 新增文件

| 文件路径 | 说明 | 优先级 |
|---------|------|--------|
| `src/notification/notification-service.js` | 通知服务核心 | P0 |
| `src/notification/bark-sender.js` | Bark 发送器 | P0 |
| `src/notification/telegram-sender.js` | Telegram 发送器 | P0 |
| `src/notification/templater.js` | 消息模板引擎 | P0 |
| `.env.example` | 环境变量示例 | P1 |

### 1.2 修改文件

| 文件路径 | 修改内容 | 优先级 |
|---------|---------|--------|
| `src/alert-service.js` | 增加外部通知调用 | P0 |
| `src/web-server.js` | 新增通知 API 端点 | P0 |
| `src/config.js` | 增加通知配置字段 | P0 |
| `public/index.html` | 新增通知设置 Tab 和开关 | P1 |
| `public/app.js` | 新增通知交互逻辑 | P1 |
| `public/style.css` | 新增通知相关样式 | P1 |
| `.gitignore` | 添加 .env 忽略规则 | P1 |
| `config.json` | 添加通知配置字段 | P1 |

### 1.3 文件结构

```
crypto_radar/
├── .env                          # 新增：敏感配置
├── .env.example                  # 新增：示例文件
├── .gitignore                    # 修改：添加 .env
├── config.json                   # 修改：添加通知配置
│
├── src/
│   ├── notification/             # 新增目录
│   │   ├── notification-service.js
│   │   ├── bark-sender.js
│   │   ├── telegram-sender.js
│   │   └── templater.js
│   │
│   ├── alert-service.js          # 修改
│   ├── web-server.js             # 修改
│   ├── config.js                 # 修改
│   └── index.js                  # 修改：初始化通知服务
│
└── public/
    ├── index.html                # 修改
    ├── app.js                    # 修改
    └── style.css                 # 修改
```

## 2. 代码实现步骤

### 2.1 第一步：创建通知服务核心

**文件**: `src/notification/notification-service.js`

```javascript
/**
 * 通知服务 - 核心路由器
 * 负责根据配置选择通知通道并发送通知
 */

const BarkSender = require('./bark-sender');
const TelegramSender = require('./telegram-sender');
const Templater = require('./templater');

class NotificationService {
  constructor(configManager) {
    this.configManager = configManager;
    this.barkSender = new BarkSender();
    this.telegramSender = new TelegramSender();
    this.templater = new Templater();
    
    // 测试模式
    this.testMode = process.env.NOTIFY_TEST_MODE === 'true';
  }

  /**
   * 发送外部通知
   * @param {Object} alert - 告警对象
   * @param {Object} options - 通知选项
   * @returns {Object} 发送结果
   */
  async send(alert, options = {}) {
    const config = this.configManager.config;
    const results = {
      bark: null,
      telegram: null,
      testMode: this.testMode
    };

    // 构建消息
    const message = this.templater.buildMessage(alert);

    // 发送 Bark 通知
    if (options.useBark && config.bark?.enabled) {
      try {
        const barkConfig = {
          key: process.env.BARK_KEY || config.bark.deviceKey,
          sound: process.env.BARK_SOUND || config.bark.sound || 'alarm.mp3',
          volume: parseInt(process.env.BARK_VOLUME) || config.bark.volume || 8,
          serverUrl: config.bark.serverUrl || 'https://api.day.app'
        };

        if (this.testMode) {
          results.bark = {
            success: true,
            testMode: true,
            url: this.barkSender.buildUrl(barkConfig, message, options.mode),
            title: message.title,
            content: message.content
          };
        } else {
          results.bark = await this.barkSender.send(barkConfig, message, options.mode);
        }
      } catch (err) {
        console.error(`[Notification] Bark 发送失败：${err.message}`);
        results.bark = { success: false, error: err.message };
      }
    }

    // 发送 Telegram 通知
    if (options.useTelegram && config.telegram?.enabled) {
      try {
        const tgConfig = {
          botToken: process.env.TG_BOT_TOKEN || config.telegram.botToken,
          chatId: process.env.TG_CHAT_ID || config.telegram.chatId
        };

        if (this.testMode) {
          results.telegram = {
            success: true,
            testMode: true,
            url: this.telegramSender.buildUrl(tgConfig, message),
            text: `${message.title}\n${message.content}`
          };
        } else {
          results.telegram = await this.telegramSender.send(tgConfig, message);
        }
      } catch (err) {
        console.error(`[Notification] Telegram 发送失败：${err.message}`);
        results.telegram = { success: false, error: err.message };
      }
    }

    return results;
  }

  /**
   * 构建 Bark URL (用于测试)
   */
  buildBarkUrl(alert, barkConfig, mode) {
    const message = this.templater.buildMessage(alert);
    const config = {
      key: process.env.BARK_KEY || barkConfig.key,
      sound: process.env.BARK_SOUND || barkConfig.sound || 'alarm.mp3',
      volume: parseInt(process.env.BARK_VOLUME) || barkConfig.volume || 8
    };
    return this.barkSender.buildUrl(config, message, mode);
  }

  /**
   * 构建 Telegram URL (用于测试)
   */
  buildTelegramUrl(alert, tgConfig) {
    const message = this.templater.buildMessage(alert);
    const config = {
      botToken: process.env.TG_BOT_TOKEN || tgConfig.botToken,
      chatId: process.env.TG_CHAT_ID || tgConfig.chatId
    };
    return this.telegramSender.buildUrl(config, message);
  }

  /**
   * 构建消息 (用于测试)
   */
  buildMessage(alert) {
    return this.templater.buildMessage(alert);
  }
}

module.exports = NotificationService;
```

---

### 2.2 第二步：创建 Bark 发送器

**文件**: `src/notification/bark-sender.js`

```javascript
/**
 * Bark 通知发送器
 * 支持普通模式和紧急模式
 */

const https = require('https');

class BarkSender {
  /**
   * 构建 Bark URL
   * @param {Object} config - Bark 配置
   * @param {Object} message - 消息对象
   * @param {string} mode - 通知模式：'normal' | 'critical'
   * @returns {string} 完整的 URL
   */
  buildUrl(config, message, mode = 'normal') {
    const baseUrl = config.serverUrl || 'https://api.day.app';
    
    // URL 编码标题和内容
    const encodedTitle = encodeURIComponent(message.title);
    const encodedContent = encodeURIComponent(message.content);
    
    // 基础参数
    let url = `${baseUrl}/${config.key}/${encodedTitle}/${encodedContent}?sound=${encodeURIComponent(config.sound)}`;
    
    // 紧急模式参数
    if (mode === 'critical') {
      url += `&level=critical&volume=${config.volume}`;
    }
    
    return url;
  }

  /**
   * 发送 Bark 通知
   * @param {Object} config - Bark 配置
   * @param {Object} message - 消息对象
   * @param {string} mode - 通知模式
   * @returns {Promise<Object>} 发送结果
   */
  async send(config, message, mode = 'normal') {
    const url = this.buildUrl(config, message, mode);

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve({
              success: result.code === 200,
              message: result.message,
              mode
            });
          } catch (err) {
            resolve({
              success: res.statusCode === 200,
              message: data,
              mode
            });
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }
}

module.exports = BarkSender;
```

---

### 2.3 第三步：创建 Telegram 发送器

**文件**: `src/notification/telegram-sender.js`

```javascript
/**
 * Telegram 通知发送器
 * 通过 Bot API 发送消息
 */

const https = require('https');

class TelegramSender {
  /**
   * 构建 Telegram API URL
   * @param {Object} config - Telegram 配置
   * @param {Object} message - 消息对象
   * @returns {string} 完整的 URL
   */
  buildUrl(config, message) {
    const baseUrl = 'https://api.telegram.org';
    const text = encodeURIComponent(`${message.title}\n${message.content}`);
    
    return `${baseUrl}/bot${config.botToken}/sendMessage?chat_id=${config.chatId}&text=${text}`;
  }

  /**
   * 发送 Telegram 消息
   * @param {Object} config - Telegram 配置
   * @param {Object} message - 消息对象
   * @returns {Promise<Object>} 发送结果
   */
  async send(config, message) {
    const url = this.buildUrl(config, message);

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve({
              success: result.ok === true,
              message_id: result.result?.message_id
            });
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }
}

module.exports = TelegramSender;
```

---

### 2.4 第四步：创建消息模板引擎

**文件**: `src/notification/templater.js`

```javascript
/**
 * 消息模板引擎
 * 负责拼装通知标题和内容
 */

class Templater {
  /**
   * 构建消息对象
   * @param {Object} alert - 告警对象
   * @returns {Object} 消息对象 { title, content }
   */
  buildMessage(alert) {
    if (alert.source === 'target') {
      return this.buildTargetAlert(alert);
    } else if (alert.source === 'volatility') {
      return this.buildVolatilityAlert(alert);
    } else {
      throw new Error(`未知的告警类型：${alert.source}`);
    }
  }

  /**
   * 构建价格预警消息
   */
  buildTargetAlert(alert) {
    const sourceType = alert.sourceType || '现货'; // '现货' 或 'Alpha'
    const action = alert.type === 'above' ? '上穿' : '下破';
    
    const title = '价格预警';
    const content = `[${sourceType}] ${alert.symbol} | 动作：${action} | 目标价：$${this.formatPrice(alert.targetPrice)}`;
    
    return { title, content };
  }

  /**
   * 构建波动预警消息
   */
  buildVolatilityAlert(alert) {
    const sourceType = alert.sourceType || '现货';
    const direction = alert.direction === 'up' ? '上涨' : '下跌';
    
    const title = '重大波动提醒';
    const content = `[${sourceType}] ${alert.symbol} | 异动：${alert.windowMinutes}分钟内 ${direction} ${alert.changePercent.toFixed(2)}%`;
    
    return { title, content };
  }

  /**
   * 格式化价格
   */
  formatPrice(price) {
    if (typeof price !== 'number') {
      price = parseFloat(price);
    }
    
    // 小于 1 的价格显示更多小数位
    if (price < 1) {
      return price.toFixed(6);
    } else if (price < 100) {
      return price.toFixed(2);
    } else {
      return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
}

module.exports = Templater;
```

---

### 2.5 第五步：修改 AlertService

**文件**: `src/alert-service.js`

**新增方法**:

```javascript
class AlertService {
  constructor(storage, wsServer, configManager, notificationService) {
    this.storage = storage;
    this.wsServer = wsServer;
    this.configManager = configManager;
    this.notificationService = notificationService; // 新增
  }

  // ... 现有方法 ...

  /**
   * 发送外部通知 (Bark / Telegram)
   * @param {Object} alert - 告警对象
   * @param {Object} options - 通知选项
   */
  async sendExternalNotification(alert, options = {}) {
    if (!this.notificationService) {
      console.warn('[Alert] 通知服务未初始化，跳过外部通知');
      return;
    }

    try {
      const config = this.configManager.config;
      const symbolConfig = config.symbols.find(s => s.symbol === alert.symbol);

      // 获取币种级别的通知设置
      const useBark = options.useBark ?? (symbolConfig?.barkEnabled !== false);
      const useTelegram = options.useTelegram ?? config.telegram?.enabled;
      const mode = options.mode ?? (symbolConfig?.barkMode || 'normal');

      // 发送通知
      const results = await this.notificationService.send(alert, {
        useBark,
        useTelegram,
        mode,
        testMode: options.testMode
      });

      // 记录日志
      if (results.bark?.success) {
        console.log(`[Alert] Bark 通知已发送：${alert.symbol}`);
      } else if (results.bark?.error) {
        console.error(`[Alert] Bark 通知失败：${results.bark.error}`);
      }

      if (results.telegram?.success) {
        console.log(`[Alert] Telegram 通知已发送：${alert.symbol}`);
      } else if (results.telegram?.error) {
        console.error(`[Alert] Telegram 通知失败：${results.telegram.error}`);
      }

      return results;
    } catch (err) {
      console.error(`[Alert] 外部通知发送失败：${err.message}`);
    }
  }
}
```

**修改构造函数调用**:

```javascript
// 在 index.js 中
const NotificationService = require('./notification/notification-service');

app.notificationService = new NotificationService(app.configManager);
app.alertService = new AlertService(app.storage, app.wsServer, app.configManager, app.notificationService);
```

---

### 2.6 第六步：修改 WebServer 添加 API

**文件**: `src/web-server.js`

**新增路由**:

```javascript
class WebServer {
  async handleRequest(req, res) {
    // ... 现有代码 ...

    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    const method = req.method;

    // 通知配置 API
    if (pathname === '/api/notification/config' && method === 'GET') {
      const result = this._getNotificationConfig();
      this._sendJson(res, result);
      return;
    }

    if (pathname === '/api/notification/config' && method === 'PUT') {
      const body = await this._parseBody(req);
      const result = await this._saveNotificationConfig(body);
      this._sendJson(res, result);
      return;
    }

    if (pathname === '/api/notification/test' && method === 'POST') {
      const body = await this._parseBody(req);
      const result = await this._testNotification(body);
      this._sendJson(res, result);
      return;
    }

    if (pathname.match(/^\/api\/symbols\/[^/]+\/notification$/) && method === 'PUT') {
      const symbol = pathname.split('/')[4];
      const body = await this._parseBody(req);
      const result = await this._updateSymbolNotification(symbol, body);
      this._sendJson(res, result);
      return;
    }

    // ... 现有代码 ...
  }

  // 新增方法
  _getNotificationConfig() {
    const config = this.configManager.config;
    
    return {
      success: true,
      data: {
        bark: {
          enabled: config.bark?.enabled || false,
          deviceKey: this._maskSecret(config.bark?.deviceKey || ''),
          serverUrl: config.bark?.serverUrl || 'https://api.day.app',
          sound: config.bark?.sound || 'alarm.mp3',
          volume: config.bark?.volume || 8,
          group: config.bark?.group || 'crypto_radar'
        },
        telegram: {
          enabled: config.telegram?.enabled || false,
          botToken: this._maskSecret(config.telegram?.botToken || ''),
          chatId: config.telegram?.chatId || ''
        },
        settings: {
          notificationTestMode: config.settings?.notificationTestMode || false
        }
      }
    };
  }

  _maskSecret(secret) {
    if (!secret || secret.length < 8) return '***';
    return secret.substring(0, 4) + '...' + secret.substring(secret.length - 4);
  }

  async _saveNotificationConfig(data) {
    try {
      if (data.bark?.enabled && !data.bark.deviceKey) {
        throw new Error('Bark 启用时必须填写 deviceKey');
      }
      if (data.telegram?.enabled && (!data.telegram.botToken || !data.telegram.chatId)) {
        throw new Error('Telegram 启用时必须填写 botToken 和 chatId');
      }

      const config = this.configManager.config;

      config.bark = {
        ...config.bark,
        enabled: data.bark?.enabled || false,
        deviceKey: data.bark?.deviceKey || '',
        sound: data.bark?.sound || 'alarm.mp3',
        volume: data.bark?.volume || 8,
        serverUrl: data.bark?.serverUrl || 'https://api.day.app',
        group: data.bark?.group || 'crypto_radar'
      };

      config.telegram = {
        ...config.telegram,
        enabled: data.telegram?.enabled || false,
        botToken: data.telegram?.botToken || '',
        chatId: data.telegram?.chatId || ''
      };

      config.settings = {
        ...config.settings,
        notificationTestMode: data.settings?.notificationTestMode || false
      };

      await this.configManager.save();

      return {
        success: true,
        message: '配置已保存',
        data: { updatedAt: new Date().toISOString() }
      };
    } catch (err) {
      return {
        success: false,
        error: 'SAVE_FAILED',
        message: err.message
      };
    }
  }

  async _updateSymbolNotification(symbol, data) {
    try {
      const config = this.configManager.config;
      const symbolConfig = config.symbols.find(s => s.symbol === symbol.toUpperCase());

      if (!symbolConfig) {
        throw new Error(`币种 ${symbol} 不存在`);
      }

      if (data.barkEnabled !== undefined) {
        symbolConfig.barkEnabled = data.barkEnabled;
      }
      if (data.barkMode !== undefined) {
        if (!['normal', 'critical'].includes(data.barkMode)) {
          throw new Error('barkMode 必须是 normal 或 critical');
        }
        symbolConfig.barkMode = data.barkMode;
      }

      if (data.volatility) {
        if (!symbolConfig.volatility) {
          symbolConfig.volatility = {};
        }
        if (data.volatility.barkEnabled !== undefined) {
          symbolConfig.volatility.barkEnabled = data.volatility.barkEnabled;
        }
        if (data.volatility.barkMode !== undefined) {
          symbolConfig.volatility.barkMode = data.volatility.barkMode;
        }
      }

      await this.configManager.save();

      return {
        success: true,
        message: '币种通知设置已更新',
        data: symbolConfig
      };
    } catch (err) {
      return {
        success: false,
        error: 'UPDATE_FAILED',
        message: err.message
      };
    }
  }

  async _testNotification(data) {
    try {
      const config = this.configManager.config;
      const alert = {
        symbol: data.symbol,
        source: data.type,
        currentPrice: data.currentPrice,
        sourceType: config.symbols.find(s => s.symbol === data.symbol)?.source === 'alpha' ? 'Alpha' : '现货'
      };

      if (data.type === 'target') {
        alert.type = data.targetType;
        alert.targetPrice = data.targetPrice;
      } else if (data.type === 'volatility') {
        alert.windowMinutes = data.windowMinutes;
        alert.changePercent = data.changePercent;
        alert.direction = data.direction;
      }

      const barkUrl = this.notificationService.buildBarkUrl(alert, config.bark, data.mode);
      const tgUrl = this.notificationService.buildTelegramUrl(alert, config.telegram);
      const message = this.notificationService.buildMessage(alert);

      return {
        success: true,
        message: '测试通知已生成',
        data: {
          bark: {
            url: barkUrl,
            title: message.title,
            content: message.content,
            mode: data.mode || 'normal'
          },
          telegram: {
            url: tgUrl,
            text: `${message.title}\n${message.content}`
          },
          testMode: true
        }
      };
    } catch (err) {
      return {
        success: false,
        error: 'TEST_FAILED',
        message: err.message
      };
    }
  }
}
```

---

### 2.7 第七步：修改配置文件

**文件**: `config.json`

**新增字段**:

```json
{
  "version": "1.1.0",
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
      "barkEnabled": true,
      "barkMode": "normal",
      "volatility": {
        "enabled": true,
        "barkEnabled": false,
        "barkMode": "normal"
      }
    }
  ],
  "settings": {
    "notificationTestMode": false
  }
}
```

---

### 2.8 第八步：创建环境文件

**文件**: `.env.example`

```bash
# Bark 配置
BARK_KEY=YOUR_BARK_KEY_HERE
BARK_SOUND=alarm.mp3
BARK_VOLUME=8

# Telegram 配置
TG_BOT_TOKEN=YOUR_BOT_TOKEN_HERE
TG_CHAT_ID=YOUR_CHAT_ID_HERE

# 测试模式 (true/false)
NOTIFY_TEST_MODE=false
```

**文件**: `.gitignore`

```gitignore
# 环境文件
.env
.env.local
.env.*.local

# 配置文件
config.json
alert_state.json
alert_history.json
price_history.json

# 日志
logs/
*.log
npm-debug.log*

# 依赖
node_modules/
```

---

### 2.9 第九步：前端实现

参见 `NOTIFICATION_UI_DESIGN.md` 中的完整 HTML、JS、CSS 代码。

## 3. 测试计划

### 3.1 单元测试

**测试文件**: `test/notification.test.js`

```javascript
const assert = require('assert');
const Templater = require('../src/notification/templater');
const BarkSender = require('../src/notification/bark-sender');

describe('NotificationService', () => {
  describe('Templater', () => {
    it('应正确构建价格预警消息', () => {
      const templater = new Templater();
      const alert = {
        source: 'target',
        sourceType: '现货',
        symbol: 'BTCUSDT',
        type: 'above',
        targetPrice: 50000,
        currentPrice: 50100
      };

      const message = templater.buildMessage(alert);
      assert.strictEqual(message.title, '价格预警');
      assert.strictEqual(message.content, '[现货] BTCUSDT | 动作：上穿 | 目标价：$50,000.00');
    });

    it('应正确构建波动预警消息', () => {
      const templater = new Templater();
      const alert = {
        source: 'volatility',
        sourceType: '现货',
        symbol: 'BTCUSDT',
        windowMinutes: 5,
        changePercent: 3.5,
        direction: 'up'
      };

      const message = templater.buildMessage(alert);
      assert.strictEqual(message.title, '重大波动提醒');
      assert.strictEqual(message.content, '[现货] BTCUSDT | 异动：5 分钟内 上涨 3.50%');
    });
  });

  describe('BarkSender', () => {
    it('应正确构建普通模式 URL', () => {
      const sender = new BarkSender();
      const config = {
        key: 'test_key',
        sound: 'alarm.mp3',
        serverUrl: 'https://api.day.app'
      };
      const message = { title: '测试', content: '内容' };

      const url = sender.buildUrl(config, message, 'normal');
      assert.strictEqual(url, 'https://api.day.app/test_key/%E6%B5%8B%E8%AF%95/%E5%86%85%E5%AE%B9?sound=alarm.mp3');
    });

    it('应正确构建紧急模式 URL', () => {
      const sender = new BarkSender();
      const config = {
        key: 'test_key',
        sound: 'alarm.mp3',
        volume: 8
      };
      const message = { title: '测试', content: '内容' };

      const url = sender.buildUrl(config, message, 'critical');
      assert.ok(url.includes('&level=critical&volume=8'));
    });
  });
});
```

### 3.2 集成测试

**测试步骤**:

1. **配置测试**:
   ```bash
   # 启动服务
   pm2 start crypto_radar

   # 获取配置
   curl -H "X-API-Token: crypto_radar_token_2024" \
     http://localhost:3000/api/notification/config

   # 保存配置
   curl -X PUT -H "X-API-Token: ..." -H "Content-Type: application/json" \
     -d '{"bark":{"enabled":true,"deviceKey":"test"}}' \
     http://localhost:3000/api/notification/config
   ```

2. **测试通知**:
   ```bash
   curl -X POST -H "X-API-Token: ..." -H "Content-Type: application/json" \
     -d '{"type":"target","symbol":"BTCUSDT","targetType":"above","targetPrice":50000,"currentPrice":50100,"mode":"critical"}' \
     http://localhost:3000/api/notification/test
   ```

3. **验证 URL 拼装**:
   - 检查返回的 URL 是否包含正确的参数
   - 检查标题和内容是否正确编码

### 3.3 端到端测试

**测试场景**:

| 场景 | 预期结果 | 验证方法 |
|------|---------|---------|
| 价格触发 + 普通 Bark | 收到 Bark 通知 | 查看 iOS 设备 |
| 价格触发 + 紧急 Bark | 收到 Bark 通知 (响铃) | 睡眠模式下测试 |
| 价格触发 + Telegram | 收到 Telegram 消息 | 查看 Telegram |
| 波动触发 + Bark | 收到 Bark 通知 | 查看 iOS 设备 |
| 测试模式 | 仅弹窗，不真实发送 | 检查日志 |
| 开关关闭 | 不发送通知 | 检查日志 |

### 3.4 验收标准

- [ ] 配置页面可正常访问和保存
- [ ] 监控列表 Bark 开关可切换
- [ ] 模式选择下拉框正常工作
- [ ] 测试通知弹窗显示正确 URL
- [ ] 价格触发时正确发送 Bark 通知
- [ ] 价格触发时正确发送 Telegram 通知
- [ ] 紧急模式 URL 包含 level 和 volume 参数
- [ ] 测试模式下不真实发送通知
- [ ] API Key 不泄露到代码库

## 4. 部署步骤

### 4.1 安装依赖

```bash
cd /root/.openclaw/workspace/xia-zhihui/projects/crypto_radar
npm install dotenv
```

### 4.2 创建环境文件

```bash
cp .env.example .env
# 编辑 .env 填入真实的 API Key
```

### 4.3 更新配置

```bash
# 编辑 config.json，添加通知配置字段
```

### 4.4 重启服务

```bash
pm2 restart crypto_radar
pm2 logs crypto_radar
```

### 4.5 验证部署

```bash
# 检查 API 端点
curl -H "X-API-Token: ..." http://localhost:3000/api/notification/config

# 检查日志
pm2 logs crypto_radar | grep -i notification
```

---

_实现方案完成，钳子哥可按此文档逐步施工！_
