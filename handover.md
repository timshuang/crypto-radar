# Crypto Radar 项目交接文档

**最后更新**: 2026-03-19 16:40 UTC

---

## 当前状态

### ✅ 已完成功能
1. 双轨监控（价格目标线 + 波动侦测线）
2. Bark 通知（校验逻辑 + 极简推送）
3. Telegram 通知
4. 网页弹窗通知
5. 配置页面（Bark + Telegram 配置）
6. 行情监控页面（Bark 开关 + 模式选择）

### ⚠️ 待修复问题
1. Bark deviceKey 脱敏值回写（优先级：低）
2. 推送标题"价格预警"是否违规（待确认）

---

## 避坑指南

### Bug 1：双重引号导致服务崩溃
- **问题**：`src/index.js` 第 20 行 require 语句缺少左引号
- **教训**：修改代码后必须执行 `node --check src/index.js`

### Bug 2：配置校验导致服务崩溃
- **问题**：Bark deviceKey 校验失败导致 `process.exit(1)`
- **教训**：配置校验应该允许系统继续运行

### Bug 3：Section 闭合标签缺失
- **问题**：删除内容时误删 `</section>`
- **教训**：修改 HTML 后必须验证标签配对

### Bug 4：Bark/TG 配置互相覆盖
- **问题**：后端保存时全量替换
- **教训**：部分更新时必须保护其他字段

### Bug 5：deviceKey 脱敏值回写
- **问题**：脱敏值被写回 config.json
- **教训**：脱敏只应用于显示，不应用于保存

---

## 文件清单

| 文件 | 状态 |
|------|------|
| `src/index.js` | ✅ 已修复 |
| `src/config.js` | ✅ 已修复 |
| `public/index.html` | ✅ 已修复 |
| `public/app.js` | ✅ 已修复 |
| `src/notification/templater.js` | ✅ 已优化 |
| `config.json` | ✅ 配置完整 |
| `history.md` | ✅ 已更新 |

---

**虾指挥 签字**: 🦐
**日期**: 2026-03-19
