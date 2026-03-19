# Bark 通知功能 UI 重设计 (第 3 版 - 按老板最新需求)

**文档版本**: v3.0  
**创建时间**: 2026-03-18  
**需求来源**: 老板最新指示  
**执行角色**: 虾参谋 (需求策划) → 钳子哥 (施工) → 挑刺虾 (验收)

---

## 📋 需求变更说明

### 与上一版 (v2) 的核心差异

| 项目 | v2 (旧版) | v3 (新版) | 变更原因 |
|------|-----------|-----------|----------|
| 开关形式 | 按钮 (Button) | 开关 (Toggle Switch) | 老板要求与监控列表币种开关风格一致 |
| 模式选择 | 下拉框 (Select) | 单选按钮 (Radio) | 老板明确要求单选按钮 |
| 显示逻辑 | 模式始终显示 | 开关打开后才显示模式 | 条件显示，减少界面干扰 |
| 文案 | "启用/禁用 Bark 通知" | "启用 Bark 通知" (固定) | 开关状态本身已表达启用/禁用 |

---

## 1️⃣ UI 布局图

### 1.1 监控列表 Bark 控制条

```
┌─────────────────────────────────────────────────────────────────────────┐
│  📋 监控列表                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 🔔 启用 Bark 通知    [●━━━━━]  ○ 普通模式  ○ 紧急模式            │  │
│  │                          ↑                                        │  │
│  │                          └── 开关打开后才显示此区域               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 币种    │ 类型   │ 当前价  │ 方向  │ 目标价  │ 状态    │ 监控    │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │ BTC     │ Alpha  │ $50000  │ 上破  │ $51000  │ 监控中  │ [●━━]   │  │
│  │ ETH     │ 现货   │ $3000   │ 下破  │ $2900   │ 监控中  │ [●━━]   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 波动侦测 Bark 控制条

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🌊 波动侦测                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  监控范围：○ 全局监控（所有币种）  ○ 仅已添加币种                       │
│  时间窗口：5 分钟                                                        │
│  涨跌幅：≥20%                                                           │
│  状态：[●━━━━━] 启用                                                   │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 🔔 启用 Bark 通知    [━━━━━○]  (开关关闭，不显示模式选择)        │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 币种    │ 类型   │ 当前价  │ 时间窗口 │ 波动阈值 │ 状态    │ 监控  │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │ BTC     │ Alpha  │ $50000  │ 5 分钟    │ ≥20%     │ 监控中  │ [●━━]│  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 开关打开后的波动侦测 Bark 控制条

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🌊 波动侦测                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 🔔 启用 Bark 通知    [●━━━━━]  ○ 普通模式  ○ 紧急模式            │  │
│  │                          ↑                                        │  │
│  │                          └── 开关打开后，模式选择区域出现         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2️⃣ 控件设计

### 2.1 开关样式 (Toggle Switch)

**复用现有样式** - 与系统总开关、监控列表币种开关保持一致：

```css
/* 复用现有的 .toggle-switch 和 .toggle-slider 样式 */
/* 位置：public/style.css 第 801-847 行 */

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 60px;
  height: 34px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255,255,255,0.3);
  transition: .4s;
  border-radius: 34px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 26px;
  width: 26px;
  left: 4px;
  bottom: 4px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
}

input:checked + .toggle-slider {
  background-color: #48bb78;  /* 绿色表示启用 */
}

input:checked + .toggle-slider:before {
  transform: translateX(26px);
}
```

**视觉效果**:
- 关闭状态：灰色滑块，白色圆点在左侧
- 开启状态：绿色滑块 (`#48bb78`)，白色圆点在右侧

### 2.2 单选按钮样式 (Radio Buttons)

**新增样式** - 需要自定义样式以匹配项目主题：

```css
/* Bark 模式单选按钮组 */
.bark-mode-radio-group {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-left: 12px;
}

.bark-mode-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #e2e8f0;
  transition: color 0.2s;
}

.bark-mode-radio:hover {
  color: #00d9ff;
}

.bark-mode-radio input[type="radio"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #00d9ff;  /* 选中时的颜色 */
  margin: 0;
}

.bark-mode-radio-label {
  user-select: none;
}
```

**视觉效果**:
- 未选中：空心圆圈 + 灰色文字
- 选中：蓝色填充圆圈 (`#00d9ff`) + 高亮文字
- 悬停：文字变蓝色

### 2.3 模式选择容器 (条件显示)

```css
/* 模式选择容器 - 默认隐藏 */
.bark-mode-container {
  display: none;  /* 关键：默认隐藏 */
  align-items: center;
  margin-left: 8px;
  transition: opacity 0.3s ease;
}

/* 当开关打开时，通过 JS 添加 .visible 类来显示 */
.bark-mode-container.visible {
  display: flex;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

---

## 3️⃣ 交互逻辑

### 3.1 状态流转图

```
┌─────────────────────────────────────────────────────────────────┐
│                     Bark 通知开关状态机                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐         点击开关         ┌──────────────┐    │
│  │   关闭状态   │ ───────────────────────→ │   开启状态   │    │
│  │              │                          │              │    │
│  │ • 滑块在左   │                          │ • 滑块在右   │    │
│  │ • 灰色背景   │                          │ • 绿色背景   │    │
│  │ • 模式隐藏   │                          │ • 模式显示   │    │
│  └──────────────┘                          └──────────────┘    │
│         ↑                                    │                  │
│         │                                    │                  │
│         └────────────────────────────────────┘                  │
│                        点击开关                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 详细交互逻辑

#### 场景 1: 页面加载时

```javascript
// 监控列表：默认开启
async function loadBarkGlobalConfig() {
  const config = await api('/notification/config');
  
  // 监控列表 Bark 设置
  const monitorEnabled = config.data.bark.monitorEnabled !== false;  // 默认 true
  const monitorMode = config.data.bark.monitorMode || 'normal';
  
  // 更新 UI
  document.getElementById('monitor-bark-toggle').checked = monitorEnabled;
  updateMonitorModeVisibility(monitorEnabled);  // 根据开关状态显示/隐藏模式
  document.querySelector(`input[name="monitor-bark-mode"][value="${monitorMode}"]`).checked = true;
  
  // 波动侦测 Bark 设置
  const volatilityEnabled = config.data.bark.volatilityEnabled === true;  // 默认 false
  const volatilityMode = config.data.bark.volatilityMode || 'normal';
  
  document.getElementById('volatility-bark-toggle').checked = volatilityEnabled;
  updateVolatilityModeVisibility(volatilityEnabled);
  document.querySelector(`input[name="volatility-bark-mode"][value="${volatilityMode}"]`).checked = true;
}
```

#### 场景 2: 用户点击开关

```javascript
// 监控列表 Bark 开关切换
async function toggleMonitorBark() {
  const checkbox = document.getElementById('monitor-bark-toggle');
  const enabled = checkbox.checked;
  
  try {
    const response = await api('/notification/config/bark/monitor', {
      method: 'PUT',
      body: JSON.stringify({})
    });
    
    if (response.success) {
      // 关键：根据开关状态显示/隐藏模式选择
      updateMonitorModeVisibility(enabled);
      
      showToast(
        enabled ? '已启用监控列表 Bark 通知' : '已禁用监控列表 Bark 通知',
        'success'
      );
    } else {
      checkbox.checked = !enabled;  // 恢复状态
      showToast(response.message, 'error');
    }
  } catch (err) {
    checkbox.checked = !enabled;  // 恢复状态
    showToast('操作失败：' + err.message, 'error');
  }
}

// 更新模式选择可见性 (监控列表)
function updateMonitorModeVisibility(isVisible) {
  const container = document.getElementById('monitor-bark-mode-container');
  if (isVisible) {
    container.classList.add('visible');
  } else {
    container.classList.remove('visible');
  }
}
```

#### 场景 3: 用户切换模式

```javascript
// 保存监控列表 Bark 模式
async function saveMonitorBarkMode() {
  const mode = document.querySelector('input[name="monitor-bark-mode"]:checked').value;
  
  try {
    const response = await api('/notification/config/bark/monitor/mode', {
      method: 'PUT',
      body: JSON.stringify({ mode })
    });
    
    if (response.success) {
      showToast('模式已保存', 'success');
    } else {
      // 恢复选中状态
      document.querySelector(`input[name="monitor-bark-mode"][value="${oldMode}"]`).checked = true;
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('操作失败：' + err.message, 'error');
  }
}
```

### 3.3 默认状态配置

| 模块 | 开关默认状态 | 模式默认状态 | 模式选择可见性 |
|------|-------------|-------------|---------------|
| 监控列表 | ✅ 开启 (checked) | 普通模式 (normal) | 可见 (visible) |
| 波动侦测 | ❌ 关闭 (unchecked) | 普通模式 (normal) | 隐藏 (hidden) |

---

## 4️⃣ 实现步骤 (钳子哥施工指南)

### 步骤 1: 修改 HTML 结构

**文件**: `public/index.html`

#### 4.1.1 监控列表 Bark 控制条 (替换现有按钮版本)

**旧代码** (约第 95-105 行):
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

**新代码** (替换为):
```html
<div class="bark-control-bar">
  <span class="bark-control-label">🔔 启用 Bark 通知</span>
  
  <!-- 开关 -->
  <label class="toggle-switch">
    <input type="checkbox" id="monitor-bark-toggle" checked onchange="toggleMonitorBark()">
    <span class="toggle-slider"></span>
  </label>
  
  <!-- 模式选择容器 (条件显示) -->
  <div id="monitor-bark-mode-container" class="bark-mode-container visible">
    <label class="bark-mode-radio">
      <input type="radio" name="monitor-bark-mode" value="normal" checked onchange="saveMonitorBarkMode()">
      <span class="bark-mode-radio-label">普通模式</span>
    </label>
    <label class="bark-mode-radio">
      <input type="radio" name="monitor-bark-mode" value="critical" onchange="saveMonitorBarkMode()">
      <span class="bark-mode-radio-label">紧急模式</span>
    </label>
  </div>
</div>
```

#### 4.1.2 波动侦测 Bark 控制条 (替换现有按钮版本)

**旧代码** (约第 165-175 行):
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

**新代码** (替换为):
```html
<div class="bark-control-bar volatility-bark-control">
  <span class="bark-control-label">🔔 启用 Bark 通知</span>
  
  <!-- 开关 -->
  <label class="toggle-switch">
    <input type="checkbox" id="volatility-bark-toggle" onchange="toggleVolatilityBark()">
    <span class="toggle-slider"></span>
  </label>
  
  <!-- 模式选择容器 (条件显示) -->
  <div id="volatility-bark-mode-container" class="bark-mode-container">
    <label class="bark-mode-radio">
      <input type="radio" name="volatility-bark-mode" value="normal" checked onchange="saveVolatilityBarkMode()">
      <span class="bark-mode-radio-label">普通模式</span>
    </label>
    <label class="bark-mode-radio">
      <input type="radio" name="volatility-bark-mode" value="critical" onchange="saveVolatilityBarkMode()">
      <span class="bark-mode-radio-label">紧急模式</span>
    </label>
  </div>
</div>
```

---

### 步骤 2: 新增 CSS 样式

**文件**: `public/style.css`

在文件末尾 (Bark 控制条样式之后) 添加:

```css
/* ==================== Bark 模式单选按钮样式 ==================== */

/* 模式选择容器 */
.bark-mode-container {
  display: none;  /* 默认隐藏 */
  align-items: center;
  margin-left: 8px;
  gap: 16px;
}

.bark-mode-container.visible {
  display: flex;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* 单选按钮标签 */
.bark-mode-radio {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #e2e8f0;
  transition: color 0.2s;
  user-select: none;
}

.bark-mode-radio:hover {
  color: #00d9ff;
}

.bark-mode-radio input[type="radio"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #00d9ff;
  margin: 0;
}

.bark-mode-radio-label {
  user-select: none;
}

/* 优化 Bark 控制条布局 */
.bark-control-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(15, 23, 42, 0.5);
  border-radius: 8px;
  border: 1px solid rgba(0, 217, 255, 0.2);
  margin-top: 15px;
  flex-wrap: wrap;  /* 允许换行，适配小屏幕 */
}

/* 移除旧的按钮样式 (保留但不再使用) */
/* .bark-toggle-btn { ... }  */
/* .bark-mode-select { ... } */
```

---

### 步骤 3: 更新 JavaScript 逻辑

**文件**: `public/app.js`

#### 4.3.1 新增辅助函数

在文件适当位置添加:

```javascript
// ==================== Bark 通知开关辅助函数 ====================

/**
 * 更新监控列表模式选择可见性
 * @param {boolean} isVisible - 是否显示模式选择
 */
function updateMonitorModeVisibility(isVisible) {
  const container = document.getElementById('monitor-bark-mode-container');
  if (container) {
    if (isVisible) {
      container.classList.add('visible');
    } else {
      container.classList.remove('visible');
    }
  }
}

/**
 * 更新波动侦测模式选择可见性
 * @param {boolean} isVisible - 是否显示模式选择
 */
function updateVolatilityModeVisibility(isVisible) {
  const container = document.getElementById('volatility-bark-mode-container');
  if (container) {
    if (isVisible) {
      container.classList.add('visible');
    } else {
      container.classList.remove('visible');
    }
  }
}
```

#### 4.3.2 修改 `loadBarkGlobalConfig()` 函数

**旧代码**:
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

**新代码** (替换为):
```javascript
async function loadBarkGlobalConfig() {
  try {
    const response = await api('/notification/config');
    const config = response.data;
    
    // 加载监控列表 Bark 设置
    const monitorEnabled = config.bark.monitorEnabled !== false;  // 默认 true
    const monitorMode = config.bark.monitorMode || 'normal';
    
    // 更新开关状态
    const monitorToggle = document.getElementById('monitor-bark-toggle');
    if (monitorToggle) {
      monitorToggle.checked = monitorEnabled;
    }
    
    // 更新模式选择可见性
    updateMonitorModeVisibility(monitorEnabled);
    
    // 更新单选按钮选中状态
    const monitorModeRadio = document.querySelector(`input[name="monitor-bark-mode"][value="${monitorMode}"]`);
    if (monitorModeRadio) {
      monitorModeRadio.checked = true;
    }
    
    // 加载波动侦测 Bark 设置
    const volatilityEnabled = config.bark.volatilityEnabled === true;  // 默认 false
    const volatilityMode = config.bark.volatilityMode || 'normal';
    
    const volatilityToggle = document.getElementById('volatility-bark-toggle');
    if (volatilityToggle) {
      volatilityToggle.checked = volatilityEnabled;
    }
    
    updateVolatilityModeVisibility(volatilityEnabled);
    
    const volatilityModeRadio = document.querySelector(`input[name="volatility-bark-mode"][value="${volatilityMode}"]`);
    if (volatilityModeRadio) {
      volatilityModeRadio.checked = true;
    }
  } catch (err) {
    console.error('加载 Bark 配置失败:', err);
  }
}
```

#### 4.3.3 修改 `toggleMonitorBark()` 函数

**旧代码**:
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

**新代码** (替换为):
```javascript
async function toggleMonitorBark() {
  const checkbox = document.getElementById('monitor-bark-toggle');
  const enabled = checkbox.checked;
  
  try {
    const response = await api('/notification/config/bark/monitor', {
      method: 'PUT',
      body: JSON.stringify({})
    });
    
    if (response.success) {
      // 关键：根据开关状态显示/隐藏模式选择
      updateMonitorModeVisibility(enabled);
      
      showToast(
        enabled ? '已启用监控列表 Bark 通知' : '已禁用监控列表 Bark 通知',
        'success'
      );
    } else {
      checkbox.checked = !enabled;  // 恢复状态
      showToast(response.message, 'error');
    }
  } catch (err) {
    checkbox.checked = !enabled;  // 恢复状态
    showToast('操作失败：' + err.message, 'error');
  }
}
```

#### 4.3.4 修改 `saveMonitorBarkMode()` 函数

**旧代码**:
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

**新代码** (替换为):
```javascript
async function saveMonitorBarkMode() {
  const mode = document.querySelector('input[name="monitor-bark-mode"]:checked')?.value;
  
  if (!mode) {
    console.warn('未选中任何 Bark 模式');
    return;
  }
  
  try {
    const response = await api('/notification/config/bark/monitor/mode', {
      method: 'PUT',
      body: JSON.stringify({ mode })
    });
    
    if (response.success) {
      showToast('模式已保存', 'success');
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('操作失败：' + err.message, 'error');
  }
}
```

#### 4.3.5 修改 `toggleVolatilityBark()` 函数

**旧代码**:
```javascript
async function toggleVolatilityBark() {
  const response = await api('/notification/config/bark/volatility', {
    method: 'PUT',
    body: JSON.stringify({})
  });
  
  if (response.success) {
    const enabled = response.data.enabled;
    updateVolatilityBarkUI(enabled, response.data.mode);
    showToast(enabled ? '已启用波动侦测 Bark 通知' : '已禁用波动侦测 Bark 通知', 'success');
  }
}
```

**新代码** (替换为):
```javascript
async function toggleVolatilityBark() {
  const checkbox = document.getElementById('volatility-bark-toggle');
  const enabled = checkbox.checked;
  
  try {
    const response = await api('/notification/config/bark/volatility', {
      method: 'PUT',
      body: JSON.stringify({})
    });
    
    if (response.success) {
      // 关键：根据开关状态显示/隐藏模式选择
      updateVolatilityModeVisibility(enabled);
      
      showToast(
        enabled ? '已启用波动侦测 Bark 通知' : '已禁用波动侦测 Bark 通知',
        'success'
      );
    } else {
      checkbox.checked = !enabled;  // 恢复状态
      showToast(response.message, 'error');
    }
  } catch (err) {
    checkbox.checked = !enabled;  // 恢复状态
    showToast('操作失败：' + err.message, 'error');
  }
}
```

#### 4.3.6 修改 `saveVolatilityBarkMode()` 函数

**旧代码**:
```javascript
async function saveVolatilityBarkMode() {
  const mode = document.getElementById('volatility-bark-mode').value;
  
  const response = await api('/notification/config/bark/volatility/mode', {
    method: 'PUT',
    body: JSON.stringify({ mode })
  });
  
  if (response.success) {
    showToast('模式已保存', 'success');
  }
}
```

**新代码** (替换为):
```javascript
async function saveVolatilityBarkMode() {
  const mode = document.querySelector('input[name="volatility-bark-mode"]:checked')?.value;
  
  if (!mode) {
    console.warn('未选中任何 Bark 模式');
    return;
  }
  
  try {
    const response = await api('/notification/config/bark/volatility/mode', {
      method: 'PUT',
      body: JSON.stringify({ mode })
    });
    
    if (response.success) {
      showToast('模式已保存', 'success');
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('操作失败：' + err.message, 'error');
  }
}
```

#### 4.3.7 删除旧函数

删除以下不再使用的函数:
- `updateMonitorBarkUI()`
- `updateVolatilityBarkUI()`

---

### 步骤 4: 验证 API 端点 (后端无需修改)

**后端 API 保持不变** - `src/web-server.js` 中的 API 端点无需修改:

| API 端点 | 方法 | 功能 | 状态 |
|---------|------|------|------|
| `/api/notification/config` | GET | 获取通知配置 | ✅ 保持不变 |
| `/api/notification/config/bark/monitor` | PUT | 切换监控列表 Bark 开关 | ✅ 保持不变 |
| `/api/notification/config/bark/monitor/mode` | PUT | 保存监控列表 Bark 模式 | ✅ 保持不变 |
| `/api/notification/config/bark/volatility` | PUT | 切换波动侦测 Bark 开关 | ✅ 保持不变 |
| `/api/notification/config/bark/volatility/mode` | PUT | 保存波动侦测 Bark 模式 | ✅ 保持不变 |

---

### 步骤 5: 自测清单 (钳子哥施工后自检)

**文件**: `public/index.html`

- [ ] 监控列表 Bark 开关默认 **开启** (checked)
- [ ] 波动侦测 Bark 开关默认 **关闭** (unchecked)
- [ ] 监控列表模式选择 **可见** (有 visible 类)
- [ ] 波动侦测模式选择 **隐藏** (无 visible 类)
- [ ] 使用 `<input type="checkbox">` 而非 `<button>`
- [ ] 使用 `<input type="radio">` 而非 `<select>`
- [ ] 单选按钮 name 属性正确分组 (`monitor-bark-mode` / `volatility-bark-mode`)

**文件**: `public/style.css`

- [ ] `.bark-mode-container` 默认 `display: none`
- [ ] `.bark-mode-container.visible` 为 `display: flex`
- [ ] 有 `@keyframes fadeIn` 动画定义
- [ ] `.bark-mode-radio` 样式完整
- [ ] `accent-color: #00d9ff` 设置正确

**文件**: `public/app.js`

- [ ] `updateMonitorModeVisibility()` 函数存在
- [ ] `updateVolatilityModeVisibility()` 函数存在
- [ ] `loadBarkGlobalConfig()` 调用上述两个函数
- [ ] `toggleMonitorBark()` 调用 `updateMonitorModeVisibility()`
- [ ] `toggleVolatilityBark()` 调用 `updateVolatilityModeVisibility()`
- [ ] `saveMonitorBarkMode()` 使用 `querySelector(...:checked)`
- [ ] `saveVolatilityBarkMode()` 使用 `querySelector(...:checked)`
- [ ] 删除了 `updateMonitorBarkUI()` 和 `updateVolatilityBarkUI()`

---

### 步骤 6: 功能测试 (挑刺虾验收)

**测试场景 1: 页面加载**
- [ ] 监控列表 Bark 开关显示为 **开启** 状态 (绿色)
- [ ] 监控列表模式选择 **可见** (普通模式/紧急模式单选按钮)
- [ ] 波动侦测 Bark 开关显示为 **关闭** 状态 (灰色)
- [ ] 波动侦测模式选择 **不可见**

**测试场景 2: 切换监控列表 Bark 开关**
- [ ] 点击开关 → 开关变为关闭 (灰色)
- [ ] 模式选择 **立即隐藏** (有淡出动画)
- [ ] 再次点击 → 开关变为开启 (绿色)
- [ ] 模式选择 **立即显示** (有淡入动画)
- [ ] Toast 提示正确 ("已启用/已禁用监控列表 Bark 通知")

**测试场景 3: 切换波动侦测 Bark 开关**
- [ ] 点击开关 → 开关变为开启 (绿色)
- [ ] 模式选择 **从无到有显示** (有淡入动画)
- [ ] 再次点击 → 开关变为关闭 (灰色)
- [ ] 模式选择 **从有到无隐藏** (有淡出动画)
- [ ] Toast 提示正确

**测试场景 4: 切换模式**
- [ ] 开关开启状态下，点击"普通模式" → 选中状态切换
- [ ] 点击"紧急模式" → 选中状态切换
- [ ] Toast 提示 "模式已保存"
- [ ] 刷新页面 → 模式保持

**测试场景 5: 配置持久化**
- [ ] 切换监控列表 Bark 开关 → 刷新页面 → 状态保持
- [ ] 切换波动侦测 Bark 开关 → 刷新页面 → 状态保持
- [ ] 切换模式 → 刷新页面 → 模式保持
- [ ] `config.json` 中 `bark` 字段正确保存

---

## 📝 修改文件清单

| 文件 | 修改类型 | 修改内容 |
|------|---------|----------|
| `public/index.html` | 替换 | 监控列表 Bark 控制条 HTML (按钮 → 开关 + 单选) |
| `public/index.html` | 替换 | 波动侦测 Bark 控制条 HTML (按钮 → 开关 + 单选) |
| `public/style.css` | 新增 |