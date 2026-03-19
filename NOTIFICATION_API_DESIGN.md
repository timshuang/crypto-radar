# 通知模块 API 设计 (API_DESIGN.md)

## 1. API 概览

### 1.1 API 端点列表

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/api/notification/config` | GET | ✅ | 获取通知配置 |
| `/api/notification/config` | PUT | ✅ | 保存通知配置 |
| `/api/notification/test` | POST | ✅ | 测试通知 (模拟模式) |
| `/api/symbols/:symbol` | PUT | ✅ | 更新币种通知设置 |

### 1.2 认证方式

所有 API 端点均需携带 `X-API-Token` 请求头：

```http
X-API-Token: crypto_radar_token_2024
```

## 2. 配置管理 API

### 2.1 获取通知配置

**端点**: `GET /api/notification/config`

**认证**: 必需

**请求示例**:
```bash
curl -H "X-API-Token: crypto_radar_token_2024" \
  http://localhost:3000/api/notification/config
```

**响应格式**:
```json
{
  "success": true,
  "data": {
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
    "settings": {
      "notificationTestMode": false
    }
  }
}
```

**字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| `bark.enabled` | boolean | Bark 全局开关 |
| `bark.deviceKey` | string | 设备密钥 (脱敏显示) |
| `bark.serverUrl` | string | 服务器地址 |
| `bark.sound` | string | 铃声名称 (参数 A) |
| `bark.volume` | number | 紧急模式音量 (参数 B) |
| `telegram.enabled` | boolean | Telegram 开关 |
| `telegram.botToken` | string | Bot Token (脱敏显示) |
| `telegram.chatId` | string | Chat ID |
| `settings.notificationTestMode` | boolean | 测试模式开关 |

**后端实现**:
```javascript
// src/web-server.js
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
```

---

### 2.2 保存通知配置

**端点**: `PUT /api/notification/config`

**认证**: 必需

**请求示例**:
```bash
curl -X PUT -H "X-API-Token: crypto_radar_token_2024" \
  -H "Content-Type: application/json" \
  -d '{
    "bark": {
      "enabled": true,
      "deviceKey": "p8ZxX...",
      "sound": "alarm.mp3",
      "volume": 8
    },
    "telegram": {
      "enabled": true,
      "botToken": "123456:ABC...",
      "chatId": "123456789"
    },
    "settings": {
      "notificationTestMode": false
    }
  }' \
  http://localhost:3000/api/notification/config
```

**请求体格式**:
```json
{
  "bark": {
    "enabled": true,
    "deviceKey": "p8ZxX...",
    "sound": "alarm.mp3",
    "volume": 8
  },
  "telegram": {
    "enabled": true,
    "botToken": "123456:ABC...",
    "chatId": "123456789"
  },
  "settings": {
    "notificationTestMode": false
  }
}
```

**响应格式**:
```json
{
  "success": true,
  "message": "配置已保存",
  "data": {
    "updatedAt": "2026-03-17T19:44:00Z"
  }
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "INVALID_CONFIG",
  "message": "Bark deviceKey 不能为空"
}
```

**后端实现**:
```javascript
// src/web-server.js
async _saveNotificationConfig(data) {
  try {
    // 验证必填字段
    if (data.bark?.enabled && !data.bark.deviceKey) {
      throw new Error('Bark 启用时必须填写 deviceKey');
    }
    if (data.telegram?.enabled && (!data.telegram.botToken || !data.telegram.chatId)) {
      throw new Error('Telegram 启用时必须填写 botToken 和 chatId');
    }
    
    // 更新配置
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
    
    // 保存配置
    await this.configManager.save();
    
    return {
      success: true,
      message: '配置已保存',
      data: {
        updatedAt: new Date().toISOString()
      }
    };
  } catch (err) {
    return {
      success: false,
      error: 'SAVE_FAILED',
      message: err.message
    };
  }
}
```

## 3. 币种通知设置 API

### 3.1 更新币种通知设置

**端点**: `PUT /api/symbols/:symbol/notification`

**认证**: 必需

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `symbol` | string | 币种代码 (如 BTCUSDT) |

**请求示例**:
```bash
curl -X PUT -H "X-API-Token: crypto_radar_token_2024" \
  -H "Content-Type: application/json" \
  -d '{
    "barkEnabled": true,
    "barkMode": "critical",
    "volatility": {
      "barkEnabled": false,
      "barkMode": "normal"
    }
  }' \
  http://localhost:3000/api/symbols/BTCUSDT/notification
```

**请求体格式**:
```json
{
  "barkEnabled": true,
  "barkMode": "critical",
  "volatility": {
    "barkEnabled": false,
    "barkMode": "normal"
  }
}
```

**响应格式**:
```json
{
  "success": true,
  "message": "币种通知设置已更新",
  "data": {
    "symbol": "BTCUSDT",
    "barkEnabled": true,
    "barkMode": "critical",
    "volatility": {
      "barkEnabled": false,
      "barkMode": "normal"
    }
  }
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "SYMBOL_NOT_FOUND",
  "message": "币种 BTCUSDT 不存在"
}
```

**后端实现**:
```javascript
// src/web-server.js
async _updateSymbolNotification(symbol, data) {
  try {
    const config = this.configManager.config;
    const symbolConfig = config.symbols.find(
      s => s.symbol === symbol.toUpperCase()
    );
    
    if (!symbolConfig) {
      throw new Error(`币种 ${symbol} 不存在`);
    }
    
    // 更新价格目标通知设置
    if (data.barkEnabled !== undefined) {
      symbolConfig.barkEnabled = data.barkEnabled;
    }
    if (data.barkMode !== undefined) {
      if (!['normal', 'critical'].includes(data.barkMode)) {
        throw new Error('barkMode 必须是 normal 或 critical');
      }
      symbolConfig.barkMode = data.barkMode;
    }
    
    // 更新波动侦测通知设置
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
    
    // 保存配置
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
```

## 4. 通知发送 API (模拟模式)

### 4.1 测试通知

**端点**: `POST /api/notification/test`

**认证**: 必需

**用途**: 测试通知拼装是否正确 (不真实发送)

**请求示例**:
```bash
curl -X POST -H "X-API-Token: crypto_radar_token_2024" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "target",
    "symbol": "BTCUSDT",
    "targetType": "above",
    "targetPrice": 50000,
    "currentPrice": 50100,
    "mode": "critical"
  }' \
  http://localhost:3000/api/notification/test
```

**请求体格式**:
```json
{
  "type": "target" | "volatility",
  "symbol": "BTCUSDT",
  "targetType": "above" | "below",  // 仅 target 类型
  "targetPrice": 50000,              // 仅 target 类型
  "currentPrice": 50100,
  "windowMinutes": 5,                // 仅 volatility 类型
  "changePercent": 3.5,              // 仅 volatility 类型
  "direction": "up" | "down",        // 仅 volatility 类型
  "mode": "normal" | "critical"
}
```

**响应格式**:
```json
{
  "success": true,
  "message": "测试通知已生成",
  "data": {
    "bark": {
      "url": "https://api.day.app/p8ZxX/...",
      "title": "价格预警",
      "content": "[现货] BTCUSDT | 动作：上穿 | 目标价：$50,000",
      "mode": "critical",
      "params": {
        "sound": "alarm.mp3",
        "level": "critical",
        "volume": 8
      }
    },
    "telegram": {
      "url": "https://api.telegram.org/bot123456:ABC.../sendMessage?...",
      "text": "价格预警\n[现货] BTCUSDT | 动作：上穿 | 目标价：$50,000"
    },
    "testMode": true
  }
}
```

**后端实现**:
```javascript
// src/web-server.js
async _testNotification(data) {
  try {
    const config = this.configManager.config;
    const notificationService = this.notificationService;
    
    // 构建告警对象
    const alert = {
      symbol: data.symbol,
      source: data.type, // 'target' 或 'volatility'
      currentPrice: data.currentPrice
    };
    
    if (data.type === 'target') {
      alert.type = data.targetType;
      alert.targetPrice = data.targetPrice;
    } else if (data.type === 'volatility') {
      alert.windowMinutes = data.windowMinutes;
      alert.changePercent = data.changePercent;
      alert.direction = data.direction;
    }
    
    // 生成通知 URL (测试模式，不真实发送)
    const barkUrl = notificationService.buildBarkUrl(
      alert,
      config.bark,
      data.mode || 'normal'
    );
    
    const tgUrl = notificationService.buildTelegramUrl(
      alert,
      config.telegram
    );
    
    // 获取消息内容
    const message = notificationService.buildMessage(alert);
    
    return {
      success: true,
      message: '测试通知已生成',
      data: {
        bark: {
          url: barkUrl,
          title: message.title,
          content: message.content,
          mode: data.mode || 'normal',
          params: {
            sound: config.bark?.sound || 'alarm.mp3',
            level: data.mode === 'critical' ? 'critical' : undefined,
            volume: data.mode === 'critical' ? config.bark?.volume : undefined
          }
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
```

## 5. 路由配置

### 5.1 端点注册

**文件**: `src/web-server.js`

```javascript
class WebServer {
  setupRoutes() {
    // ... 现有路由 ...
    
    // 通知配置 API
    else if (pathname === '/api/notification/config' && method === 'GET') {
      result = this._getNotificationConfig();
    }
    else if (pathname === '/api/notification/config' && method === 'PUT') {
      result = await this._saveNotificationConfig(body);
    }
    else if (pathname === '/api/notification/test' && method === 'POST') {
      result = await this._testNotification(body);
    }
    else if (pathname.match(/^\/api\/symbols\/[^/]+\/notification$/) && method === 'PUT') {
      const symbol = pathname.split('/')[4];
      result = await this._updateSymbolNotification(symbol, body);
    }
  }
}
```

### 5.2 API 权限控制

```javascript
// 所有通知 API 都需要认证
async handleRequest(req, res) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  
  // 检查是否需要认证
  if (pathname.startsWith('/api/notification') ||
      pathname.match(/\/api\/symbols\/[^/]+\/notification/)) {
    const token = req.headers['x-api-token'];
    if (!token || token !== this.apiToken) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }
  
  // ... 处理请求 ...
}
```

## 6. 前端调用示例

### 6.1 获取通知配置

```javascript
// public/app.js
async function loadNotificationConfig() {
  const response = await api('/notification/config');
  const config = response.data;
  
  // 填充表单
  document.getElementById('bark-enabled').checked = config.bark.enabled;
  document.getElementById('bark-key').value = config.bark.deviceKey;
  document.getElementById('bark-sound').value = config.bark.sound;
  document.getElementById('bark-volume').value = config.bark.volume;
  
  document.getElementById('tg-enabled').checked = config.telegram.enabled;
  document.getElementById('tg-token').value = config.telegram.botToken;
  document.getElementById('tg-chat-id').value = config.telegram.chatId;
}
```

### 6.2 保存通知配置

```javascript
async function saveNotificationConfig() {
  const config = {
    bark: {
      enabled: document.getElementById('bark-enabled').checked,
      deviceKey: document.getElementById('bark-key').value.trim(),
      sound: document.getElementById('bark-sound').value.trim(),
      volume: parseInt(document.getElementById('bark-volume').value)
    },
    telegram: {
      enabled: document.getElementById('tg-enabled').checked,
      botToken: document.getElementById('tg-token').value.trim(),
      chatId: document.getElementById('tg-chat-id').value.trim()
    },
    settings: {
      notificationTestMode: document.getElementById('test-mode-enabled').checked
    }
  };
  
  const response = await api('/notification/config', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  
  if (response.success) {
    showToast('配置已保存', 'success');
  } else {
    showToast(response.message, 'error');
  }
}
```

### 6.3 更新币种通知设置

```javascript
async function updateSymbolNotification(symbol, settings) {
  const response = await api(`/symbols/${symbol}/notification`, {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
  
  if (response.success) {
    showToast('设置已更新', 'success');
  } else {
    showToast(response.message, 'error');
  }
}

// 使用示例
updateSymbolNotification('BTCUSDT', {
  barkEnabled: true,
  barkMode: 'critical',
  volatility: {
    barkEnabled: false,
    barkMode: 'normal'
  }
});
```

### 6.4 测试通知

```javascript
async function testNotification() {
  const testData = {
    type: 'target',
    symbol: 'BTCUSDT',
    targetType: 'above',
    targetPrice: 50000,
    currentPrice: 50100,
    mode: 'critical'
  };
  
  const response = await api('/notification/test', {
    method: 'POST',
    body: JSON.stringify(testData)
  });
  
  if (response.success) {
    // 显示测试弹窗
    showTestResult(response.data);
  } else {
    showToast(response.message, 'error');
  }
}

function showTestResult(data) {
  const modal = document.getElementById('test-result-modal');
  document.getElementById('test-bark-url').textContent = data.bark.url;
  document.getElementById('test-tg-url').textContent = data.telegram.url;
  modal.classList.add('active');
}
```

## 7. 错误处理

### 7.1 错误码定义

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `INVALID_CONFIG` | 400 | 配置验证失败 |
| `SYMBOL_NOT_FOUND` | 404 | 币种不存在 |
| `UNAUTHORIZED` | 401 | 认证失败 |
| `SAVE_FAILED` | 500 | 保存配置失败 |
| `TEST_FAILED` | 500 | 测试通知失败 |

### 7.2 错误响应格式

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "人类可读的错误描述"
}
```

### 7.3 前端错误处理

```javascript
async function api(endpoint, options = {}) {
  try {
    const response = await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': API_TOKEN,
        ...options.headers
      }
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.message || '请求失败');
    }
    
    return data;
  } catch (err) {
    console.error(`[API] ${endpoint} 错误:`, err.message);
    throw err;
  }
}
```

---

_API 设计完成，钳子哥可参考此文档实现后端接口和前端调用。_
