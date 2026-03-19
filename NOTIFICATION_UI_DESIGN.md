# 通知模块 UI 设计 (NOTIFICATION_UI_DESIGN.md)

## 1. 系统配置页面布局

### 1.1 页面结构

**文件**: `public/index.html`

**新增 Tab**: 在现有 Tab 导航中添加"通知设置"

```html
<!-- 现有 Tab 导航 -->
<div class="tabs">
  <button class="tab-btn active" data-tab="monitor">监控列表</button>
  <button class="tab-btn" data-tab="volatility">波动侦测</button>
  <button class="tab-btn" data-tab="alerts">报警历史</button>
  <!-- 新增 Tab -->
  <button class="tab-btn" data-tab="notification">通知设置</button>
  <button class="tab-btn" data-tab="settings">系统设置</button>
</div>
```

### 1.2 通知设置页面内容

```html
<!-- 通知设置 Tab 内容 -->
<div id="notification-tab" class="tab-content" style="display: none;">
  <div class="card">
    <h2>🔔 通知配置</h2>
    
    <!-- Bark 配置区域 -->
    <div class="config-section">
      <h3>📱 Bark 通知 (iOS)</h3>
      <p class="hint">紧急通知模式可在睡眠模式下响铃</p>
      
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="bark-enabled">
          <span>启用 Bark 通知</span>
        </label>
      </div>
      
      <div class="form-group">
        <label for="bark-key">Bark API Key</label>
        <input type="text" id="bark-key" placeholder="p8ZxX..." 
               autocomplete="off">
        <p class="hint">在 Bark App 中获取设备密钥</p>
      </div>
      
      <div class="form-row">
        <div class="form-group">
          <label for="bark-sound">铃声名称 (A)</label>
          <input type="text" id="bark-sound" placeholder="alarm.mp3" 
                 value="alarm.mp3">
          <p class="hint">Bark 内置铃声或自定义铃声文件名</p>
        </div>
        
        <div class="form-group">
          <label for="bark-volume">紧急模式音量 (B)</label>
          <input type="number" id="bark-volume" min="0" max="10" 
                 value="8" step="1">
          <p class="hint">范围：0-10，仅紧急模式生效</p>
        </div>
      </div>
      
      <div class="form-actions">
        <button class="btn btn-primary" onclick="testBarkNotification()">
          测试 Bark 通知
        </button>
      </div>
    </div>
    
    <!-- Telegram 配置区域 -->
    <div class="config-section">
      <h3>✈️ Telegram 通知</h3>
      
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="tg-enabled">
          <span>启用 Telegram 通知</span>
        </label>
      </div>
      
      <div class="form-group">
        <label for="tg-token">Bot API Token</label>
        <input type="text" id="tg-token" placeholder="123456:ABC..." 
               autocomplete="off">
        <p class="hint">从 @BotFather 获取 Bot Token</p>
      </div>
      
      <div class="form-group">
        <label for="tg-chat-id">接收人 Chat ID</label>
        <input type="text" id="tg-chat-id" placeholder="123456789" 
               autocomplete="off">
        <p class="hint">使用 @userinfobot 查询你的 Chat ID</p>
      </div>
      
      <div class="form-actions">
        <button class="btn btn-primary" onclick="testTelegramNotification()">
          测试 Telegram 通知
        </button>
      </div>
    </div>
    
    <!-- 全局设置 -->
    <div class="config-section">
      <h3>⚙️ 全局设置</h3>
      
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" id="test-mode-enabled">
          <span>测试模式 (仅弹窗验证，不真实发送)</span>
        </label>
      </div>
    </div>
    
    <!-- 保存按钮 -->
    <div class="form-actions">
      <button class="btn btn-primary" onclick="saveNotificationConfig()">
        保存配置
      </button>
      <button class="btn btn-secondary" onclick="loadNotificationConfig()">
        重置
      </button>
    </div>
  </div>
</div>
```

### 1.3 样式设计

**文件**: `public/style.css`

```css
/* 通知配置卡片 */
#notification-tab .card {
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9));
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 20px;
}

#notification-tab h2 {
  font-size: 24px;
  margin-bottom: 24px;
  color: #f1f5f9;
}

#notification-tab h3 {
  font-size: 18px;
  margin: 24px 0 16px 0;
  color: #e2e8f0;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

/* 配置区域 */
.config-section {
  margin-bottom: 32px;
}

.config-section:last-child {
  margin-bottom: 0;
}

/* 提示文字 */
.hint {
  font-size: 13px;
  color: #94a3b8;
  margin-top: 6px;
  line-height: 1.5;
}

/* 表单行 */
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 768px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}

/* 复选框样式 */
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 15px;
  color: #e2e8f0;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #00d9ff;
}

/* 输入框样式 */
#notification-tab input[type="text"],
#notification-tab input[type="number"] {
  width: 100%;
  padding: 10px 14px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  color: #f1f5f9;
  font-size: 14px;
  transition: all 0.2s;
}

#notification-tab input[type="text"]:focus,
#notification-tab input[type="number"]:focus {
  outline: none;
  border-color: #00d9ff;
  box-shadow: 0 0 0 3px rgba(0, 217, 255, 0.1);
}

#notification-tab input::placeholder {
  color: #64748b;
}

/* 按钮组 */
.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

/* 测试弹窗 */
.test-result-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.test-result-modal.active {
  display: flex;
}

.test-result-content {
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 16px;
  padding: 24px;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}

.test-result-content h3 {
  margin-bottom: 16px;
  color: #f1f5f9;
}

.test-url-box {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
  word-break: break-all;
}

.test-url-box label {
  display: block;
  font-size: 13px;
  color: #94a3b8;
  margin-bottom: 6px;
}

.test-url-box code {
  display: block;
  font-size: 12px;
  color: #00d9ff;
  font-family: 'Courier New', monospace;
  line-height: 1.5;
}
```

## 2. 监控页开关位置

### 2.1 监控列表模块

**文件**: `public/index.html`

**现有表格结构** (在每行添加通知开关):

```html
<!-- 监控列表表格 -->
<table class="monitor-table">
  <thead>
    <tr>
      <th>币种</th>
      <th>类型</th>
      <th>当前价</th>
      <th>方向</th>
      <th>目标价</th>
      <th>状态</th>
      <th>监控</th>
      <!-- 新增列 -->
      <th>Bark 通知</th>
      <th>模式</th>
      <th>操作</th>
    </tr>
  </thead>
  <tbody id="monitor-list">
    <!-- 动态生成 -->
  </tbody>
</table>
```

### 2.2 表格行内容

**文件**: `public/app.js`

**修改 `loadMonitor()` 函数**:

```javascript
async function loadMonitor() {
  const symbolsData = await api('/symbols');
  const symbols = symbolsData.data;
  
  const html = symbols.map(s => {
    const target = s.targets?.[0] || {};
    const sourceBadge = s.source === 'alpha' 
      ? '<span class="source-badge alpha">Alpha</span>' 
      : '<span class="source-badge spot">现货</span>';
    
    // 状态显示
    let statusBadge = '';
    if (!s.enabled) {
      statusBadge = '<span class="status-badge paused">已暂停 ⏸️</span>';
    } else {
      const hasTriggered = target.status === 'triggered';
      if (hasTriggered) {
        statusBadge = '<span class="status-badge triggered">已触发 ✅</span>';
      } else {
        statusBadge = '<span class="status-badge monitoring">监控中 🔵</span>';
      }
    }
    
    // 通知开关 (新增)
    const barkEnabledChecked = s.barkEnabled !== false ? 'checked' : '';
    const barkModeValue = s.barkMode || 'normal';
    
    return `
      <tr>
        <td>
          <div class="symbol-name">${s.symbol}</div>
          ${sourceBadge}
        </td>
        <td>${target.type === 'above' ? '上穿 🟢' : '下破 🔴'}</td>
        <td>$${formatNumber(s.currentPrice)}</td>
        <td>${target.type === 'above' ? '上破' : '下破'}</td>
        <td>$${formatNumber(target.price)}</td>
        <td>${statusBadge}</td>
        <td>
          <label class="toggle-switch">
            <input type="checkbox" 
                   data-symbol="${s.symbol}" 
                   data-type="monitor-toggle"
                   ${s.enabled ? 'checked' : ''}
                   onchange="toggleSymbol(this)">
            <span class="toggle-slider"></span>
          </label>
        </td>
        <!-- 新增 Bark 通知开关 -->
        <td>
          <label class="toggle-switch">
            <input type="checkbox" 
                   data-symbol="${s.symbol}" 
                   data-type="bark-toggle"
                   ${barkEnabledChecked}
                   onchange="toggleBarkNotification(this)">
            <span class="toggle-slider"></span>
          </label>
        </td>
        <!-- 新增模式选择 -->
        <td>
          <select data-symbol="${s.symbol}" 
                  data-type="bark-mode"
                  onchange="updateBarkMode(this)"
                  ${!s.barkEnabled ? 'disabled' : ''}>
            <option value="normal" ${barkModeValue === 'normal' ? 'selected' : ''}>
              普通
            </option>
            <option value="critical" ${barkModeValue === 'critical' ? 'selected' : ''}>
              紧急
            </option>
          </select>
        </td>
        <td>
          <button class="btn-icon edit" onclick="openEditModal('${s.symbol}')">
            ✏️
          </button>
          <button class="btn-icon delete" onclick="deleteSymbol('${s.symbol}')">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }).join('');
  
  document.getElementById('monitor-list').innerHTML = html;
}
```

### 2.3 开关切换逻辑

**文件**: `public/app.js`

**新增函数**:

```javascript
// 切换 Bark 通知开关
async function toggleBarkNotification(checkbox) {
  const symbol = checkbox.dataset.symbol;
  const enabled = checkbox.checked;
  
  try {
    const response = await api(`/symbols/${symbol}/notification`, {
      method: 'PUT',
      body: JSON.stringify({ barkEnabled: enabled })
    });
    
    if (response.success) {
      // 更新模式选择下拉框的禁用状态
      const modeSelect = document.querySelector(
        `select[data-symbol="${symbol}"][data-type="bark-mode"]`
      );
      if (modeSelect) {
        modeSelect.disabled = !enabled;
      }
      
      showToast(`${symbol} Bark 通知已${enabled ? '启用' : '禁用'}`, 'success');
    } else {
      checkbox.checked = !enabled; // 恢复状态
      showToast(response.message, 'error');
    }
  } catch (err) {
    checkbox.checked = !enabled; // 恢复状态
    showToast('操作失败：' + err.message, 'error');
  }
}

// 更新 Bark 通知模式
async function updateBarkMode(select) {
  const symbol = select.dataset.symbol;
  const mode = select.value;
  
  try {
    const response = await api(`/symbols/${symbol}/notification`, {
      method: 'PUT',
      body: JSON.stringify({ barkMode: mode })
    });
    
    if (response.success) {
      showToast(`${symbol} 通知模式已更新为${mode === 'normal' ? '普通' : '紧急'}`, 'success');
    } else {
      select.value = mode === 'normal' ? 'critical' : 'normal'; // 恢复
      showToast(response.message, 'error');
    }
  } catch (err) {
    select.value = mode === 'normal' ? 'critical' : 'normal'; // 恢复
    showToast('操作失败：' + err.message, 'error');
  }
}
```

### 2.4 样式补充

**文件**: `public/style.css`

```css
/* 表格中的开关样式 */
.monitor-table .toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.monitor-table .toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.monitor-table .toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(148, 163, 184, 0.3);
  transition: .3s;
  border-radius: 24px;
}

.monitor-table .toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .3s;
  border-radius: 50%;
}

.monitor-table input:checked + .toggle-slider {
  background-color: rgba(0, 217, 255, 0.5);
}

.monitor-table input:checked + .toggle-slider:before {
  transform: translateX(20px);
}

/* 表格中的下拉框样式 */
.monitor-table select {
  padding: 4px 8px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.3);
  border-radius: 6px;
  color: #f1f5f9;
  font-size: 13px;
  cursor: pointer;
}

.monitor-table select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.monitor-table select:focus {
  outline: none;
  border-color: #00d9ff;
}

.monitor-table select option {
  background: rgba(15, 23, 42, 0.9);
  color: #f1f5f9;
}
```

## 3. 波动侦测模块开关

### 3.1 波动侦测表格

**文件**: `public/index.html`

**修改现有表格** (添加通知开关列):

```html
<!-- 波动侦测表格 -->
<table class="volatility-table">
  <thead>
    <tr>
      <th>币种</th>
      <th>类型</th>
      <th>当前价</th>
      <th>时间窗口</th>
      <th>波动阈值</th>
      <th>状态</th>
      <th>监控</th>
      <!-- 新增列 -->
      <th>Bark 通知</th>
      <th>模式</th>
      <th>操作</th>
    </tr>
  </thead>
  <tbody id="volatility-list">
    <!-- 动态生成 -->
  </tbody>
</table>
```

### 3.2 表格行内容

**文件**: `public/app.js`

**修改 `loadVolatility()` 函数**:

```javascript
async function loadVolatility() {
  const symbolsData = await api('/symbols');
  const symbols = symbolsData.data;
  
  const html = symbols.map(s => {
    const vol = s.volatility || {};
    const sourceBadge = s.source === 'alpha' 
      ? '<span class="source-badge alpha">Alpha</span>' 
      : '<span class="source-badge spot">现货</span>';
    
    // 通知开关 (新增)
    const barkEnabledChecked = vol.barkEnabled ? 'checked' : '';
    const barkModeValue = vol.barkMode || 'normal';
    
    return `
      <tr>
        <td>
          <div class="symbol-name">${s.symbol}</div>
          ${sourceBadge}
        </td>
        <td>${s.source === 'alpha' ? 'Alpha' : '现货'}</td>
        <td>$${formatNumber(s.currentPrice)}</td>
        <td>${vol.windowMinutes || 5}分钟</td>
        <td>≥${vol.thresholdPercent || 20}%</td>
        <td>
          <span class="status-badge ${vol.enabled ? 'monitoring' : 'paused'}">
            ${vol.enabled ? '监控中 🔵' : '已暂停 ⏸️'}
          </span>
        </td>
        <td>
          <label class="toggle-switch">
            <input type="checkbox" 
                   data-symbol="${s.symbol}" 
                   data-type="volatility-toggle"
                   ${vol.enabled ? 'checked' : ''}
                   onchange="toggleVolatility(this)">
            <span class="toggle-slider"></span>
          </label>
        </td>
        <!-- 新增 Bark 通知开关 -->
        <td>
          <label class="toggle-switch">
            <input type="checkbox" 
                   data-symbol="${s.symbol}" 
                   data-type="volatility-bark-toggle"
                   ${barkEnabledChecked}
                   onchange="toggleVolatilityBark(this)">
            <span class="toggle-slider"></span>
          </label>
        </td>
        <!-- 新增模式选择 -->
        <td>
          <select data-symbol="${s.symbol}" 
                  data-type="volatility-bark-mode"
                  onchange="updateVolatilityBarkMode(this)"
                  ${!vol.barkEnabled ? 'disabled' : ''}>
            <option value="normal" ${barkModeValue === 'normal' ? 'selected' : ''}>
              普通
            </option>
            <option value="critical" ${barkModeValue === 'critical' ? 'selected' : ''}>
              紧急
            </option>
          </select>
        </td>
        <td>
          <button class="btn-icon edit" onclick="openVolatilityEditModal('${s.symbol}')">
            ✏️
          </button>
        </td>
      </tr>
    `;
  }).join('');
  
  document.getElementById('volatility-list').innerHTML = html;
}
```

### 3.3 开关切换逻辑

**文件**: `public/app.js`

**新增函数**:

```javascript
// 切换波动侦测 Bark 通知开关
async function toggleVolatilityBark(checkbox) {
  const symbol = checkbox.dataset.symbol;
  const enabled = checkbox.checked;
  
  try {
    const response = await api(`/symbols/${symbol}/notification`, {
      method: 'PUT',
      body: JSON.stringify({
        volatility: { barkEnabled: enabled }
      })
    });
    
    if (response.success) {
      const modeSelect = document.querySelector(
        `select[data-symbol="${symbol}"][data-type="volatility-bark-mode"]`
      );
      if (modeSelect) {
        modeSelect.disabled = !enabled;
      }
      
      showToast(`${symbol} 波动通知已${enabled ? '启用' : '禁用'}`, 'success');
    } else {
      checkbox.checked = !enabled;
      showToast(response.message, 'error');
    }
  } catch (err) {
    checkbox.checked = !enabled;
    showToast('操作失败：' + err.message, 'error');
  }
}

// 更新波动侦测 Bark 通知模式
async function updateVolatilityBarkMode(select) {
  const symbol = select.dataset.symbol;
  const mode = select.value;
  
  try {
    const response = await api(`/symbols/${symbol}/notification`, {
      method: 'PUT',
      body: JSON.stringify({
        volatility: { barkMode: mode }
      })
    });
    
    if (response.success) {
      showToast(`${symbol} 波动通知模式已更新`, 'success');
    } else {
      select.value = mode === 'normal' ? 'critical' : 'normal';
      showToast(response.message, 'error');
    }
  } catch (err) {
    select.value = mode === 'normal' ? 'critical' : 'normal';
    showToast('操作失败：' + err.message, 'error');
  }
}
```

## 4. 弹窗验证 UI

### 4.1 测试通知弹窗

**文件**: `public/index.html`

```html
<!-- 测试通知结果弹窗 -->
<div id="test-notification-modal" class="modal">
  <div class="modal-content">
    <h2>🧪 测试通知</h2>
    
    <div class="test-section">
      <h3>Bark 通知</h3>
      <div class="test-url-box">
        <label>拼装 URL:</label>
        <code id="test-bark-url"></code>
      </div>
      <div class="test-info">
        <div class="info-row">
          <span class="info-label">标题:</span>
          <span class="info-value" id="test-bark-title"></span>
        </div>
        <div class="info-row">
          <span class="info-label">内容:</span>
          <span class="info-value" id="test-bark-content"></span>
        </div>
        <div class="info-row">
          <span class="info-label">模式:</span>
          <span class="info-value" id="test-bark-mode"></span>
        </div>
      </div>
    </div>
    
    <div class="test-section">
      <h3>Telegram 通知</h3>
      <div class="test-url-box">
        <label>拼装 URL:</label>
        <code id="test-tg-url"></code>
      </div>
      <div class="test-info">
        <div class="info-row">
          <span class="info-label">消息文本:</span>
          <span class="info-value" id="test-tg-text"></span>
        </div>
      </div>
    </div>
    
    <div class="form-actions">
      <button class="btn btn-primary" onclick="closeModal('test-notification-modal')">
        关闭
      </button>
    </div>
  </div>
</div>
```

### 4.2 弹窗样式

**文件**: `public/style.css`

```css
/* 测试弹窗内容 */
.test-section {
  margin-bottom: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.test-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.test-section h3 {
  font-size: 16px;
  color: #e2e8f0;
  margin-bottom: 12px;
}

.test-url-box {
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(0, 217, 255, 0.3);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.test-url-box label {
  display: block;
  font-size: 13px;
  color: #94a3b8;
  margin-bottom: 6px;
}

.test-url-box code {
  display: block;
  font-size: 12px;
  color: #00d9ff;
  font-family: 'Courier New', monospace;
  line-height: 1.6;
  word-break: break-all;
}

.test-info {
  background: rgba(15, 23, 42, 0.4);
  border-radius: 8px;
  padding: 12px;
}

.info-row {
  display: flex;
  margin-bottom: 8px;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-label {
  width: 80px;
  font-size: 13px;
  color: #94a3b8;
  flex-shrink: 0;
}

.info-value {
  font-size: 14px;
  color: #f1f5f9;
  word-break: break-word;
}

/* 模式标签 */
#test-bark-mode {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
}

#test-bark-mode.normal {
  background: rgba(0, 217, 255, 0.2);
  color: #00d9ff;
}

#test-bark-mode.critical {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}
```

### 4.3 测试函数

**文件**: `public/app.js`

```javascript
// 测试 Bark 通知
async function testBarkNotification() {
  const testData = {
    type: 'target',
    symbol: 'BTCUSDT',
    targetType: 'above',
    targetPrice: 50000,
    currentPrice: 50100,
    mode: document.querySelector('input[name="test-bark-mode"]:checked')?.value || 'normal'
  };
  
  try {
    const response = await api('/notification/test', {
      method: 'POST',
      body: JSON.stringify(testData)
    });
    
    if (response.success) {
      showTestResult(response.data);
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('测试失败：' + err.message, 'error');
  }
}

// 测试 Telegram 通知
async function testTelegramNotification() {
  const testData = {
    type: 'target',
    symbol: 'BTCUSDT',
    targetType: 'above',
    targetPrice: 50000,
    currentPrice: 50100
  };
  
  try {
    const response = await api('/notification/test', {
      method: 'POST',
      body: JSON.stringify(testData)
    });
    
    if (response.success) {
      showTestResult(response.data);
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('测试失败：' + err.message, 'error');
  }
}

// 显示测试结果
function showTestResult(data) {
  document.getElementById('test-bark-url').textContent = data.bark.url;
  document.getElementById('test-bark-title').textContent = data.bark.title;
  document.getElementById('test-bark-content').textContent = data.bark.content;
  
  const modeEl = document.getElementById('test-bark-mode');
  modeEl.textContent = data.bark.mode === 'normal' ? '普通模式' : '紧急模式';
  modeEl.className = `info-value ${data.bark.mode}`;
  
  document.getElementById('test-tg-url').textContent = data.telegram.url;
  document.getElementById('test-tg-text').textContent = data.telegram.text;
  
  document.getElementById('test-notification-modal').classList.add('active');
}
```

## 5. 响应式设计

### 5.1 移动端适配

**文件**: `public/style.css`

```css
@media (max-width: 768px) {
  /* 表格滚动 */
  .monitor-table,
  .volatility-table {
    display: block;
    overflow-x: auto;
    white-space: nowrap;
  }
  
  /* 配置页面优化 */
  #notification-tab .card {
    padding: 16px;
  }
  
  #notification-tab h2 {
    font-size: 20px;
  }
  
  #notification-tab h3 {
    font-size: 16px;
  }
  
  /* 表单行堆叠 */
  .form-row {
    grid-template-columns: 1fr;
  }
  
  /* 按钮全宽 */
  .form-actions {
    flex-direction: column;
  }
  
  .form-actions .btn {
    width: 100%;
  }
}
```

## 6. UI 状态说明

### 6.1 通知开关状态

| 场景 | Bark 开关 | 模式下拉框 | 说明 |
|------|----------|-----------|------|
| 未启用通知 | 关闭 | 禁用 (灰色) | 需先启用开关 |
| 普通模式 | 开启 | 可选，选中"普通" | 正常推送 |
| 紧急模式 | 开启 | 可选，选中"紧急" | 睡眠模式响铃 |

### 6.2 测试模式提示

当启用测试模式时，在页面顶部显示提示条：

```html
<div class="test-mode-banner" id="test-mode-banner" style="display: none;">
  ⚠️ 测试模式已启用：通知仅弹窗验证，不会真实发送
  <button onclick="disableTestMode()">×</button>
</div>
```

```css
.test-mode-banner {
  background: rgba(255, 193, 7, 0.2);
  border: 1px solid rgba(255, 193, 7, 0.5);
  color: #ffc107;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.test-mode-banner button {
  background: none;
  border: none;
  color: #ffc107;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
}
```

---

_UI 设计完成，钳子哥可参考此文档实现前端页面和交互逻辑。_
