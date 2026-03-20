# 波动侦测引擎重构设计文档

**版本**: 1.0  
**日期**: 2026-03-20  
**作者**: 虾参谋  
**状态**: ✅ 已批准，待开发

---

## 📋 目录

1. [重构背景](#1-重构背景)
2. [核心决策清单](#2-核心决策清单)
3. [架构设计](#3-架构设计)
4. [数据结构](#4-数据结构)
5. [API 端点设计](#5-api-端点设计)
6. [前端逻辑](#6-前端逻辑)
7. [推送格式](#7-推送格式)
8. [开发任务清单](#8-开发任务清单)

---

## 1. 重构背景

### 1.1 当前问题

| 问题 | 描述 | 严重性 |
|------|------|--------|
| 数据耦合 | 波动侦测和价格监控共用配置和开关 | 🔴 高 |
| 参数静态 | 波动参数在启动时读取，用户修改后不生效 | 🔴 高 |
| 逻辑复杂 | 阶梯阈值管理复杂，用户体验差 | 🟡 中 |
| 推送格式 | 旧格式不符合用户需求 | 🟡 中 |

### 1.2 重构目标

- ✅ 波动侦测与价格监控完全独立
- ✅ 参数实时读取，用户修改后立即生效
- ✅ 简化阈值逻辑（取消阶梯，只用静默期）
- ✅ 统一推送格式

---

## 2. 核心决策清单

| 决策点 | 选择 | 说明 |
|--------|------|------|
| 1. 引擎独立性 | 方案 A | 完全独立引擎，新建 `volatility-engine.js` |
| 2. 参数读取时机 | 方案 A | 每次检查都从 config 读取 |
| 3. 监控范围 | 选项 2 | 全局模式 = 现货 USDT + Alpha 全量 |
| 4. 阈值逻辑 | 取消阶梯 | 只用静默期（5 分钟） |
| 5. 推送格式 | 新格式 | `[波动] 现货 BTCUSDT 5min 上涨 3.5%` |
| 6. Bark 集成 | 一致校验 | 和监控列表一样的校验逻辑 |
| 7. 开关逻辑 | 互斥开关 | 关闭时只能点开启，开启时只能点关闭 |
| 8. 配置结构 | 独立配置块 | `volatilityModule` |
| 9. 默认值 | 前端默认 | 5min / 20% / global |
| 10. 静默期 | 5 分钟 | 和报警静默期一致 |

---

## 3. 架构设计

### 3.1 模块关系图

```
┌─────────────────────────────────────────────────────────────┐
│                      crypto_radar                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │  CheckerEngine  │         │ VolatilityEngine│           │
│  │  (价格监控)     │         │ (波动侦测)      │           │
│  │                 │         │                 │           │
│  │ - 价格目标检查  │         │ - 滑动窗口计算  │           │
│  │ - 触发告警      │         │ - 波动率检测    │           │
│  │ - 静默期管理    │         │ - 静默期管理    │           │
│  └────────┬────────┘         └────────┬────────┘           │
│           │                           │                     │
│           └───────────┬───────────────┘                     │
│                       │                                     │
│              ┌────────▼────────┐                            │
│              │  AlertService   │                            │
│              │  (告警服务)     │                            │
│              └────────┬────────┘                            │
│                       │                                     │
│              ┌────────▼────────┐                            │
│              │ NotificationSvc │                            │
│              │  (通知服务)     │                            │
│              └─────────────────┘                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 运行流程

```
主程序 (index.js)
    │
    ├──→ CheckerEngine (价格监控)
    │     └── 每分钟检查启用的币种
    │
    └──→ VolatilityEngine (波动侦测) ← 新建
          └── 每分钟检查监控范围内的币种
```

### 3.3 开关状态机

```
┌────────────────────────────────────────────────────────────┐
│                    波动侦测开关                            │
└────────────────────────────────────────────────────────────┘

[关闭状态]
   │
   │ config: { enabled: false }
   │ 前端显示：默认值 或 用户上次修改的值
   │ 开关动作：只能点"开启"
   │
   │ 用户修改前端参数（不提交）
   │ 或点击"开启"
   ▼
[提交当前页面参数]
   │
   │ 写入 config.json
   │ 清空静默期
   │ 启动引擎
   ▼
[运行状态]
   │
   │ 开关动作：只能点"关闭"
   │
   │ 用户修改前端参数（不提交）
   │ 后台仍按旧参数运行
   │
   │ 用户点击"关闭"
   ▼
[删除 config 参数]
   │
   │ 清空静默期
   │ 停止引擎
   │ 前端保持当前值
   ▼
[关闭状态]
```

---

## 4. 数据结构

### 4.1 config.json 结构

```json
{
  "version": "1.2.0",
  "volatilityModule": {
    "enabled": false,
    "scope": "global",
    "windowMinutes": 5,
    "thresholdPercent": 20,
    "barkEnabled": false,
    "barkMode": "normal"
  },
  "symbols": [...],
  "bark": {...},
  "telegram": {...},
  "settings": {...}
}
```

### 4.2 alert_state.json 结构

```json
{
  "volatility": {
    "BTCUSDT": {
      "lastAlertAt": 1773950000000,
      "silenceUntil": 1773950300000
    },
    "ETHUSDT": {
      "lastAlertAt": 1773949000000,
      "silenceUntil": 1773949300000
    }
  },
  "silenceUntil": {...}
}
```

### 4.3 运行时参数

```javascript
// VolatilityEngine 内部状态
{
  isRunning: false,
  checkInterval: null,
  lastCheckTime: null,
  checkCount: 0,
  binanceSymbolsCache: null,
  binanceCacheTime: 0
}
```

---

## 5. API 端点设计

### 5.1 新增端点

| 方法 | 端点 | 说明 | 请求体 |
|------|------|------|--------|
| PUT | `/api/volatility/start` | 开启波动侦测 | `{ windowMinutes, thresholdPercent, scope }` |
| PUT | `/api/volatility/toggle` | 切换开关（兼容旧版） | `{ enabled }` |
| GET | `/api/volatility/config` | 获取当前配置 | - |

### 5.2 修改端点

| 方法 | 端点 | 变更说明 |
|------|------|----------|
| PUT | `/api/volatility/settings` | 改为只更新参数，不控制开关 |
| PUT | `/api/volatility/scope` | 保留（兼容旧版） |

---

## 6. 前端逻辑

### 6.1 开关组件

```javascript
// 开关状态
const volatilityEnabled = ref(false);

// 开关变化处理
async function onVolatilityToggle(checked) {
  if (checked) {
    // 开启：提交当前页面参数
    const params = {
      windowMinutes: parseInt(volatilityWindow.value),
      thresholdPercent: parseInt(volatilityThreshold.value),
      scope: volatilityScope.value
    };
    await api('/volatility/start', { method: 'PUT', body: JSON.stringify(params) });
  } else {
    // 关闭：删除参数
    await api('/volatility/toggle', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
    // 前端保持当前值，不重置
  }
}
```

### 6.2 参数输入框

```javascript
// 时间窗口输入
const volatilityWindow = ref(5); // 默认值

// 阈值输入
const volatilityThreshold = ref(20); // 默认值

// 监控范围
const volatilityScope = ref('global'); // 默认值

// 修改时不提交，只更新前端值
function onWindowChange(value) {
  volatilityWindow.value = value;
  // 不提交到后端
}
```

### 6.3 页面加载逻辑

```javascript
async function loadVolatilitySettings() {
  const result = await api('/volatility/config');
  const config = result.data;
  
  if (config.enabled) {
    // 运行中：显示 config 中的值
    volatilityWindow.value = config.windowMinutes || 5;
    volatilityThreshold.value = config.thresholdPercent || 20;
    volatilityScope.value = config.scope || 'global';
    volatilityEnabled.value = true;
  } else {
    // 关闭：前端保持当前值（不重置为默认）
    // 如果是首次加载，使用默认值
    if (!volatilityWindow.value) volatilityWindow.value = 5;
    if (!volatilityThreshold.value) volatilityThreshold.value = 20;
    if (!volatilityScope.value) volatilityScope.value = 'global';
    volatilityEnabled.value = false;
  }
}
```

---

## 7. 推送格式

### 7.1 新格式

```
标题：波动预警
内容：[波动] {现货/Alpha} {币种名称} {XX}min {上涨/下跌} {XX}%
```

### 7.2 示例

```
[波动] 现货 BTCUSDT 5min 上涨 3.5%
[波动] Alpha PEVERSE 3min 下跌 12.8%
```

### 7.3 实现逻辑

```javascript
// src/notification/templater.js
buildVolatilityAlert(alert) {
  const direction = alert.changePercent > 0 ? '上涨' : '下跌';
  const sourceType = alert.source === 'alpha' ? 'Alpha' : '现货';
  const title = '波动预警';
  const content = `[波动] ${sourceType} ${alert.symbol} ${alert.windowMinutes}min ${direction} ${Math.abs(alert.changePercent).toFixed(1)}%`;
  
  return { title, content };
}
```

---

## 8. 开发任务清单

### 8.1 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/volatility-engine.js` | **新建** | 独立波动侦测引擎 |
| `src/checker-engine.js` | 修改 | 移除波动侦测逻辑 |
| `src/notification/templater.js` | 修改 | 更新推送格式 |
| `src/web-server.js` | 修改 | 新增 API 端点 |
| `public/app.js` | 修改 | 更新开关逻辑 |
| `config.json` | 修改 | 新增 `volatilityModule` 配置块 |

### 8.2 开发顺序

1. ✅ 修改 `config.json` 结构
2. ✅ 新建 `volatility-engine.js`
3. ✅ 修改 `checker-engine.js`（移除波动逻辑）
4. ✅ 修改 `templater.js`（推送格式）
5. ✅ 修改 `web-server.js`（API 端点）
6. ✅ 修改 `app.js`（前端逻辑）
7. ✅ 测试验证

### 8.3 测试用例

| 用例 | 步骤 | 预期结果 |
|------|------|----------|
| TC1 | 开启波动侦测（默认参数） | config 写入 5min/20%，引擎启动 |
| TC2 | 运行中修改参数 | 前端显示更新，config 不变 |
| TC3 | 关闭后再次开启 | 提交当前页面参数 |
| TC4 | 波动触发通知 | 推送格式正确，静默期生效 |
| TC5 | 全局模式监控 | 现货+Alpha 全量监控 |
| TC6 | Bark 通知校验 | 缺失配置时弹窗提醒 |

---

## 9. 验收标准

- [ ] 波动侦测与价格监控完全独立
- [ ] 开关逻辑正确（互斥状态）
- [ ] 参数提交逻辑正确（只在开启时提交）
- [ ] 推送格式正确（新格式）
- [ ] 静默期生效（5 分钟内不重复通知）
- [ ] 全局模式监控全量币种
- [ ] Bark 通知校验正确

---

**文档结束**
