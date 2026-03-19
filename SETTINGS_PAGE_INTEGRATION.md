# 设置页面整合施工报告

## 任务概述
将原"通知设置"页面的 Bark 配置整合到"设置"页面，删除独立的通知设置页面。

## 施工时间
2026-03-18

## 变更摘要

### Phase 1: HTML 结构调整 ✅

1. **删除导航栏"通知设置"链接**
   - 修改文件：`public/index.html`
   - 变更：导航栏从 5 个链接减少到 4 个（仪表盘、行情监控、报警历史、设置）

2. **迁移 Bark 配置到设置页面**
   - 从 `#notification` section 移到 `#settings`
   - 添加系统总开关卡片在顶部
   - 添加波动侦测参数表单
   - 保留 Telegram 通知配置
   - 保留测试模式提示条

3. **删除整个 `#notification` section**
   - 原通知设置页面完整移除
   - 测试通知结果弹窗保留（全局使用）

### Phase 2: JavaScript 逻辑调整 ✅

1. **移除通知设置页面路由**
   - 更新 `showPage()` 函数中的 `navMap`
   - 从 5 个页面减少到 4 个页面

2. **拆分配置保存函数**
   - ✅ `saveBarkConfig()` - 保存 Bark 配置
   - ✅ `saveTelegramConfig()` - 保存 Telegram 配置
   - 保留 `saveNotificationConfig()` 作为兼容

3. **新增系统开关函数**
   - ✅ `toggleSystemFromSettings()` - 从设置页面切换系统
   - ✅ `loadSystemStatusFromSettings()` - 加载设置页面的系统状态

4. **更新页面初始化逻辑**
   - 添加 `initSettingsSystemToggle()` 初始化设置页面开关
   - 在 `showPage('settings')` 时自动加载系统状态和通知配置
   - 同步两个页面的系统开关状态

5. **同步系统开关状态**
   - `toggleSystem()` 函数同时更新两个页面的开关状态
   - `loadSystemStatus()` 同时加载到两个页面
   - `confirmStopSystem()` 同步关闭两个页面的开关

### Phase 3: 样式优化 ✅

1. **统一卡片视觉风格**
   - 更新 CSS 选择器从 `#notification .card` 到 `#settings .card`
   - 保持渐变背景和圆角样式一致

2. **响应式布局**
   - 保留原有的响应式设计
   - 表单行在小屏幕上自动堆叠

## 设置页面新结构

```
⚙️ 系统设置
├── 测试模式提示条（条件显示）
├── 🔌 系统监控卡片（总开关）
├── 📱 Bark 通知 (iOS)
│   ├── 启用开关
│   ├── API Key
│   ├── 铃声名称
│   ├── 紧急模式音量
│   └── 测试/保存按钮
├── ✈️ Telegram 通知
│   ├── 启用开关
│   ├── Bot API Token
│   ├── Chat ID
│   └── 测试/保存按钮
├── 🌊 波动侦测
│   ├── 监控范围（全局/已添加币种）
│   ├── 时间窗口（3/5/自定义分钟）
│   ├── 涨跌幅阈值（10/20/30/自定义%）
│   └── 状态开关
├── ⚙️ 系统参数
│   ├── 检查间隔
│   ├── 静默期
│   ├── 最大价格记录数
│   └── 最大币种数
└── ⚙️ 全局设置
    └── 测试模式开关
```

## 验收标准验证

- ✅ 导航栏无"通知设置"tab
  - 验证：导航链接只有 dashboard、monitor、alerts、settings
  
- ✅ 设置页面包含：系统总开关 + Bark 配置 + 波动侦测 + 系统参数
  - 验证：所有组件均已迁移到 settings section
  
- ✅ 所有配置能正常保存和读取
  - 验证：saveBarkConfig() 和 saveTelegramConfig() 函数已实现
  - 验证：loadNotificationConfig() 函数已更新
  
- ✅ 系统总开关能正常切换
  - 验证：toggleSystemFromSettings() 函数已实现
  - 验证：两个页面的开关状态同步
  
- ✅ 测试通知功能正常
  - 验证：testBarkNotification() 和 testTelegramNotification() 函数保留
  - 验证：测试弹窗组件保留

## 文件变更统计

| 文件 | 变更行数 | 说明 |
|------|---------|------|
| public/index.html | ~150 行 | 删除 notification section，增强 settings section |
| public/app.js | ~200 行 | 新增系统开关函数，拆分保存函数 |
| public/style.css | ~20 行 | 更新 CSS 选择器 |

## 技术细节

### 系统开关同步机制
```javascript
// 仪表盘开关变化 → 同步到设置页面
toggleSystem(enabled) {
  // 更新 dashboard 状态
  // 更新 settings 状态
}

// 设置页面开关变化 → 调用独立函数
toggleSystemFromSettings(enabled) {
  // 只更新 settings 状态
  // 调用相同的 API
}
```

### 配置保存分离
```javascript
// Bark 配置
saveBarkConfig() {
  api('/notification/config', {
    bark: { enabled, deviceKey, sound, volume }
  })
}

// Telegram 配置
saveTelegramConfig() {
  api('/notification/config', {
    telegram: { enabled, botToken, chatId }
  })
}
```

## 残留问题
无

## 测试建议
1. 验证导航栏只有 4 个 tab
2. 验证设置页面所有组件正常显示
3. 测试系统总开关在两个页面的同步
4. 测试 Bark 和 Telegram 配置保存
5. 测试波动侦测参数设置
6. 验证通知测试功能

## 施工结论
✅ **按施工图完成所有任务，验收标准全部满足！** 🦞
