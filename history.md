# Crypto Radar - 开发历史

## 2026-03-19 14:26 - Bark 通知校验和优化 - 开发完成

### 执行者
**钳子哥** (Coder)

### 开发时间
2026-03-19 14:26 UTC

### 需求描述
按老板需求实现 Bark 通知的防御性设计和极致极简推送格式。

**核心需求**：
1. **开启校验逻辑** - 点击 Bark 开关时立即校验配置，未配置时强制关闭
2. **运行状态控制** - 开关 OFF 时绝对静默（0 资源浪费），ON 时无差别推送
3. **推送内容规范** - 极致极简格式，禁止辅助性汉字
4. **URL 链接拼装** - 根据模式动态拼装（普通/紧急）

### 修改内容

#### 1. public/app.js - 前端校验逻辑

**toggleMonitorBark() 函数增强**：
```javascript
async function toggleMonitorBark() {
  const checkbox = document.getElementById('monitor-bark-toggle');
  const enabled = checkbox.checked;
  
  // 如果尝试开启，先校验配置
  if (enabled) {
    try {
      const config = await api('/notification/config');
      const bark = config.data?.bark || {};
      
      // 校验 API Key 和铃声
      if (!bark.deviceKey || !bark.sound) {
        alert('请先在配置页面完成 Bark API Key 与铃声名称的设置');
        checkbox.checked = false;  // 强制关闭
        updateMonitorModeVisibility(false);
        return;
      }
    } catch (err) {
      console.error('[toggleMonitorBark] 配置校验失败:', err);
      checkbox.checked = false;
      updateMonitorModeVisibility(false);
      showToast('配置校验失败：' + err.message, 'error');
      return;
    }
  }
  
  // ... 原有逻辑
}
```

**toggleVolatilityBark() 函数增强**：
- 添加相同的配置校验逻辑
- 未配置时弹出提示并强制关闭开关

#### 2. src/notification/templater.js - 推送内容格式优化

**buildTargetAlert() 函数修改**：
```javascript
// 旧格式
const content = `[${sourceType}] ${alert.symbol} | 动作：${action} | 目标价：$${this.formatPrice(alert.targetPrice)}`;

// 新格式（极致极简）
const content = `[${sourceType}] ${alert.symbol} ${action} ${this.formatPrice(alert.targetPrice)}`;
// 示例：[现货] BTCUSDT 上穿 69900
```

**formatPrice() 函数优化**：
```javascript
formatPrice(price) {
  if (typeof price !== 'number') {
    price = parseFloat(price);
  }
  
  // 小于 1 的价格显示更多小数位（去除末尾零）
  if (price < 1) {
    return parseFloat(price.toFixed(6)).toString();
  } else if (price < 100) {
    return parseFloat(price.toFixed(2)).toString();
  } else {
    // 整数价格不显示小数位，避免千分位逗号
    return Math.round(price).toString();
  }
}
```

#### 3. src/notification/notification-service.js - 开关状态检查

**send() 函数增强**：
```javascript
async send(alert, options = {}) {
  const config = this.configManager.config;
  const message = this.templater.buildMessage(alert);

  if (options.useBark && config.bark?.enabled) {
    const isMonitorAlert = alert.source === 'target';
    const isVolatilityAlert = alert.source === 'volatility';
    
    // 检查开关状态
    if (isMonitorAlert && config.bark.monitorEnabled === false) {
      console.log('[Bark] 监控列表开关关闭，跳过推送');
      results.bark = { success: false, skipped: true, reason: 'monitorEnabled=false' };
    } else if (isVolatilityAlert && config.bark.volatilityEnabled !== true) {
      console.log('[Bark] 波动侦测开关关闭，跳过推送');
      results.bark = { success: false, skipped: true, reason: 'volatilityEnabled=false' };
    } else {
      // 开关已开启，执行推送
      // ... 发送逻辑
    }
  }
  
  return results;
}
```

### 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `public/app.js` | `toggleMonitorBark()` 和 `toggleVolatilityBark()` 添加配置校验逻辑 |
| `src/notification/templater.js` | 推送内容格式改为极致极简，优化 `formatPrice()` 去除千分位逗号 |
| `src/notification/notification-service.js` | `send()` 函数添加开关状态检查，实现 0 资源浪费 |

### 测试验证

#### 测试 1: 推送内容格式（极致极简）✅
```
测试用例 1: 现货上穿
  内容：[现货] BTCUSDT 上穿 69900
  预期：[现货] BTCUSDT 上穿 69900
  结果：✅ PASS

测试用例 2: Alpha 下破
  内容：[Alpha] ETHUSDT 下破 3500
  预期：[Alpha] ETHUSDT 下破 3500
  结果：✅ PASS
```

#### 测试 2: URL 链接拼装✅
```
普通模式 URL:
  https://api.day.app/test_key/价格预警/[现货]%20BTCUSDT%20上穿%2069900?sound=minuet
  检查：包含 sound=minuet ✅
  检查：不包含 level=critical ✅

紧急模式 URL:
  https://api.day.app/test_key/价格预警/[现货]%20BTCUSDT%20上穿%2069900?sound=minuet&level=critical&volume=5
  检查：包含 level=critical ✅
  检查：包含 volume=5 ✅
```

#### 测试 3: 内容禁令检查 ✅
```
禁词列表：['价格预警', '动作', '币种类型', '目标价', '|']
结果：✅ 内容不包含任何禁词
```

#### 测试 4: 开关状态检查（集成测试）✅
```
测试 1: 监控列表开关开启 → 发送通知 ✅ PASS
测试 2: 监控列表开关关闭 → 跳过推送 ✅ PASS（0 资源浪费）
测试 3: 波动侦测开关关闭 → 跳过推送 ✅ PASS（0 资源浪费）
测试 4: 波动侦测开关开启 → 发送通知 ✅ PASS
```

#### 测试 5: 前端配置校验（手动验证）
```
场景 1: 未配置 Bark API Key 时，尝试开启开关
  预期：弹出提示"请先在配置页面完成 Bark API Key 与铃声名称的设置"，开关强制关闭
  结果：✅ PASS

场景 2: 配置齐全后，开启开关
  预期：成功开启，模式选择可见
  结果：✅ PASS
```

### 功能特性

1. **防御性设计** ✅
   - 开启开关前强制校验配置
   - 未配置时弹出明确提示
   - 开关强制重置为 OFF 状态

2. **0 资源浪费** ✅
   - 开关 OFF 时跳过所有推送逻辑
   - 不消耗网络请求
   - 不产生任何 API 调用

3. **极致极简格式** ✅
   - 格式：`[现货/Alpha] {币种名称} {上穿/下破} {目标价格}`
   - 示例：`[现货] BTCUSDT 上穿 69900`
   - 禁止："价格预警"、"动作"、"币种类型"、"目标价"、"|"等辅助字符

4. **URL 动态拼装** ✅
   - 普通模式：`https://api.day.app/{key}/{title}/{content}?sound={A}`
   - 紧急模式：`https://api.day.app/{key}/{title}/{content}?sound={A}&level=critical&volume={B}`

### 价格格式化规则

| 价格范围 | 格式化规则 | 示例 |
|---------|-----------|------|
| < 1 | 6 位小数，去除末尾零 | 0.123456 → "0.123456" |
| 1-100 | 2 位小数，去除末尾零 | 45.60 → "45.6" |
| ≥ 100 | 整数，无千分位逗号 | 69900.00 → "69900" |

### 验收标准

| 验收项 | 状态 |
|--------|------|
| 1. 未配置 API Key 时开启开关 → 弹出提示，强制关闭 | ✅ |
| 2. 配置齐全后开启开关 → 成功开启 | ✅ |
| 3. 开关关闭时触发价格 → 不推送（0 资源浪费） | ✅ |
| 4. 开关开启时触发价格 → 推送，内容为极简格式 | ✅ |
| 5. 推送内容不包含禁词 | ✅ |
| 6. URL 拼装符合规范（普通/紧急模式） | ✅ |

### 测试脚本

- `test-bark-validation.js` - 验证推送格式和 URL 拼装
- `test-bark-switch-integration.js` - 验证开关状态检查逻辑

### 残留风险

无。所有功能已测试通过。

---

## 2026-03-18 14:30 - Bark 通知控制条功能 - 开发完成

### 执行者
**钳子哥** (Coder)

### 开发时间
2026-03-18 14:30 UTC

### 需求描述
按老板正确需求重做 Bark 通知功能，在监控列表和波动侦测模块添加 Bark 控制条。

**技术要求**：
1. **按钮形式** - 不是勾选框，是按钮
2. **状态切换** - 点击切换启用/禁用，按钮文案和样式随之变化
3. **配置持久化** - 刷新页面后保持状态
4. **UI 一致性** - 与现有页面风格保持一致

### 修改内容

#### 1. config.json - 新增字段
```json
{
  "bark": {
    "monitorEnabled": true,      // 监控列表 Bark 通知（默认启用）
    "monitorMode": "normal",     // 监控列表模式（normal/critical）
    "volatilityEnabled": false,  // 波动侦测 Bark 通知（默认禁用）
    "volatilityMode": "normal"   // 波动侦测模式（normal/critical）
  }
}
```

#### 2. public/style.css - 新增样式
```css
/* Bark 控制条样式 */
.bark-control-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(15, 23, 42, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(0, 217, 255, 0.2);
  margin-top: 15px;
}

.bark-toggle-btn.enabled {
  background: linear-gradient(135deg, #00d9ff 0%, #0099cc 100%);
  color: #000;
}

.bark-toggle-btn.disabled {
  background: rgba(108, 117, 125, 0.3);
  color: #6c757d;
  border: 1px solid rgba(108, 117, 125, 0.5);
}

.bark-mode-select {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid rgba(0, 217, 255, 0.3);
  background: rgba(15, 23, 42, 0.6);
  color: #f1f5f9;
}
```

#### 3. public/index.html - 新增 UI 控件

**监控列表 Bark 控制条**：
```html
<div class="bark-control-bar">
  <span class="bark-control-label">🔔 监控列表 Bark 通知：</span>
  <button type="button" id="monitor-bark-toggle" class="bark-toggle-btn enabled" onclick="toggleMonitorBark()">
    <span id="monitor-bark-icon">🔔</span>
    <span id="monitor-bark-text">启用 Bark 通知</span>
  </button>
  <div class="bark-control-divider"></div>
  <label for="monitor-bark-mode" class="bark-control-label">模式：</label>
  <select id="monitor-bark-mode" class="bark-mode-select" onchange="saveMonitorBarkMode()">
    <option value="normal">普通</option>
    <option value="critical">紧急</option>
  </select>
</div>
```

**波动侦测 Bark 控制条**：
```html
<div class="bark-control-bar volatility-bark-control">
  <span class="bark-control-label">🔔 Bark 通知：</span>
  <button type="button" id="volatility-bark-toggle" class="bark-toggle-btn disabled" onclick="toggleVolatilityBark()">
    <span id="volatility-bark-icon">🔕</span>
    <span id="volatility-bark-text">禁用 Bark 通知</span>
  </button>
  <div class="bark-control-divider"></div>
  <label for="volatility-bark-mode" class="bark-control-label">模式：</label>
  <select id="volatility-bark-mode" class="bark-mode-select" onchange="saveVolatilityBarkMode()">
    <option value="normal">普通</option>
    <option value="critical">紧急</option>
  </select>
</div>
```

#### 4. public/app.js - 新增 JS 逻辑

**加载 Bark 全局配置**：
```javascript
async function loadBarkGlobalConfig() {
  const response = await api('/notification/config');
  const config = response.data;
  
  // 加载监控列表 Bark 设置
  const monitorEnabled = config.bark.monitorEnabled !== false;
  const monitorMode = config.bark.monitorMode || 'normal';
  updateMonitorBarkUI(monitorEnabled, monitorMode);
  
  // 加载波动侦测 Bark 设置
  const volatilityEnabled = config.bark.volatilityEnabled === true;
  const volatilityMode = config.bark.volatilityMode || 'normal';
  updateVolatilityBarkUI(volatilityEnabled, volatilityMode);
}
```

**切换监控列表 Bark 通知**：
```javascript
async function toggleMonitorBark() {
  const response = await api('/notification/config/bark/monitor', {
    method: 'PUT',
    body: JSON.stringify({})
  });
  
  if (response.success) {
    const enabled = response.data.enabled;
    updateMonitorBarkUI(enabled, response.data.mode);
    showToast(enabled ? '已启用监控列表 Bark 通知' : '已禁用监控列表 Bark 通知', 'success');
  }
}
```

**保存监控列表 Bark 模式**：
```javascript
async function saveMonitorBarkMode() {
  const mode = document.getElementById('monitor-bark-mode').value;
  
  const response = await api('/notification/config/bark/monitor/mode', {
    method: 'PUT',
    body: JSON.stringify({ mode })
  });
  
  if (response.success) {
    showToast('模式已保存', 'success');
  }
}
```

#### 5. src/web-server.js - 新增 API 端点

**路由**：
```javascript
// PUT /api/notification/config/bark/monitor - 切换监控列表 Bark 通知
else if (pathname === '/api/notification/config/bark/monitor' && method === 'PUT') {
  result = await this._toggleBarkMonitor();
}
// PUT /api/notification/config/bark/monitor/mode - 保存监控列表 Bark 模式
else if (pathname === '/api/notification/config/bark/monitor/mode' && method === 'PUT') {
  result = await this._saveBarkMonitorMode(body);
}
// PUT /api/notification/config/bark/volatility - 切换波动侦测 Bark 通知
else if (pathname === '/api/notification/config/bark/volatility' && method === 'PUT') {
  result = await this._toggleBarkVolatility();
}
// PUT /api/notification/config/bark/volatility/mode - 保存波动侦测 Bark 模式
else if (pathname === '/api/notification/config/bark/volatility/mode' && method === 'PUT') {
  result = await this._saveBarkVolatilityMode(body);
}
```

**处理函数**：
```javascript
async _toggleBarkMonitor() {
  const config = this.configManager.config;
  const currentEnabled = config.bark?.monitorEnabled !== false;
  const newEnabled = !currentEnabled;
  
  config.bark = config.bark || {};
  config.bark.monitorEnabled = newEnabled;
  config.bark.monitorMode = config.bark.monitorMode || 'normal';
  
  await this.configManager.save();
  
  return {
    success: true,
    message: `监控列表 Bark 通知已${newEnabled ? '启用' : '禁用'}`,
    data: { enabled: newEnabled, mode: config.bark.monitorMode }
  };
}

async _saveBarkMonitorMode(data) {
  if (!data.mode || !['normal', 'critical'].includes(data.mode)) {
    throw new Error('模式必须是 normal 或 critical');
  }
  
  const config = this.configManager.config;
  config.bark = config.bark || {};
  config.bark.monitorMode = data.mode;
  
  await this.configManager.save();
  
  return {
    success: true,
    message: '监控列表 Bark 模式已保存',
    data: { mode: data.mode }
  };
}
```

**更新 _getNotificationConfig**：
```javascript
_getNotificationConfig() {
  return {
    success: true,
    data: {
      bark: {
        enabled: config.bark?.enabled || false,
        deviceKey: this._maskSecret(config.bark?.deviceKey || ''),
        serverUrl: config.bark?.serverUrl || 'https://api.day.app',
        sound: config.bark?.sound || 'alarm.mp3',
        volume: config.bark?.volume || 8,
        group: config.bark?.group || 'crypto_radar',
        monitorEnabled: config.bark?.monitorEnabled !== false, // 默认 true
        monitorMode: config.bark?.monitorMode || 'normal',
        volatilityEnabled: config.bark?.volatilityEnabled === true, // 默认 false
        volatilityMode: config.bark?.volatilityMode || 'normal'
      },
      // ...
    }
  };
}
```

### 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `config.json` | 新增 `bark.monitorEnabled`, `bark.monitorMode`, `bark.volatilityEnabled`, `bark.volatilityMode` 字段 |
| `public/style.css` | 新增 Bark 控制条样式（约 80 行） |
| `public/index.html` | 监控列表和波动侦测模块添加 Bark 控制条 UI |
| `public/app.js` | 新增 `loadBarkGlobalConfig()`, `toggleMonitorBark()`, `saveMonitorBarkMode()`, `toggleVolatilityBark()`, `saveVolatilityBarkMode()` 等函数 |
| `src/web-server.js` | 新增 4 个 API 端点和处理函数，更新 `_getNotificationConfig()` |

### API 测试验证

#### 1. 获取通知配置 ✅
```bash
$ curl -s -H "X-API-Token: crypto_radar_token_2024" "http://localhost:3000/api/notification/config"
{
  "success": true,
  "data": {
    "bark": {
      "monitorEnabled": true,
      "monitorMode": "normal",
      "volatilityEnabled": false,
      "volatilityMode": "normal",
      ...
    }
  }
}
```

#### 2. 切换监控列表 Bark 通知 ✅
```bash
$ curl -s -X PUT -H "X-API-Token: crypto_radar_token_2024" "http://localhost:3000/api/notification/config/bark/monitor"
{
  "success": true,
  "message": "监控列表 Bark 通知已禁用",
  "data": {
    "enabled": false,
    "mode": "normal"
  }
}
```

#### 3. 保存监控列表 Bark 模式 ✅
```bash
$ curl -s -X PUT -H "X-API-Token: crypto_radar_token_2024" \
  -H "Content-Type: application/json" \
  -d '{"mode":"critical"}' \
  "http://localhost:3000/api/notification/config/bark/monitor/mode"
{
  "success": true,
  "message": "监控列表 Bark 模式已保存",
  "data": {
    "mode": "critical"
  }
}
```

#### 4. 切换波动侦测 Bark 通知 ✅
```bash
$ curl -s -X PUT -H "X-API-Token: crypto_radar_token_2024" "http://localhost:3000/api/notification/config/bark/volatility"
{
  "success": true,
  "message": "波动侦测 Bark 通知已启用",
  "data": {
    "enabled": true,
    "mode": "normal"
  }
}
```

#### 5. 保存波动侦测 Bark 模式 ✅
```bash
$ curl -s -X PUT -H "X-API-Token: crypto_radar_token_2024" \
  -H "Content-Type: application/json" \
  -d '{"mode":"critical"}' \
  "http://localhost:3000/api/notification/config/bark/volatility/mode"
{
  "success": true,
  "message": "波动侦测 Bark 模式已保存",
  "data": {
    "mode": "critical"
  }
}
```

#### 6. 配置持久化验证 ✅
```bash
$ cat config.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['bark'], indent=2))"
{
  "enabled": false,
  "deviceKey": "YOUR_DEVICE_KEY_HERE",
  "serverUrl": "https://api.day.app",
  "sound": "alarm.mp3",
  "volume": 8,
  "group": "crypto_radar",
  "monitorEnabled": true,
  "monitorMode": "normal",
  "volatilityEnabled": false,
  "volatilityMode": "normal"
}
```

### 功能特性

1. **按钮形式** ✅
   - 使用 `<button>` 元素，不是 checkbox
   - 点击切换启用/禁用状态

2. **状态切换** ✅
   - 启用状态：蓝色渐变背景，🔔图标，"启用 Bark 通知"文字
   - 禁用状态：灰色背景，🔕图标，"禁用 Bark 通知"文字
   - 悬停效果：颜色加深，轻微上移

3. **配置持久化** ✅
   - 切换到 config.json
   - 刷新页面后通过 `loadBarkGlobalConfig()` 恢复状态

4. **UI 一致性** ✅
   - 使用现有配色方案（蓝色渐变、深色背景）
   - 与现有控件风格一致
   - 响应式设计

### 默认状态

| 模块 | 默认启用状态 | 默认模式 |
|------|-------------|---------|
| 监控列表 | ✅ 启用 | 普通 |
| 波动侦测 | ❌ 禁用 | 普通 |

### 测试验收
**挑刺虾验收通过！✅** - 2026-03-18 15:24 UTC

#### 测试结果
| 测试项 | 状态 |
|--------|------|
| 1. 监控列表 Bark 控制条（开关 + 单选按钮） | ✅ PASS |
| 2. 波动侦测 Bark 控制条（开关存在，模式隐藏） | ✅ PASS |
| 3. 开关切换 → 模式淡入显示 | ✅ PASS |
| 4. 关闭开关 → 模式隐藏，配置保留 | ✅ PASS |
| 5. 再次打开 → 模式显示且保持上次选择 | ✅ PASS |
| 6. CSS 淡入动画 | ✅ PASS |

#### 验收结论
**全部通过！功能符合 v3 需求！**

---

## 2026-03-17 00:30 - 修复触发后自动关闭开关逻辑 - 终检测试报告

（之前的历史记录保持不变）
