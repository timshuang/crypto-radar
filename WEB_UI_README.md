# Web UI 实现说明

## 概述

为 crypto_radar 项目添加了轻量级 Web 管理界面，无需重型框架，内存占用 <50MB。

## 技术选型

- **后端**: Node.js 原生 HTTP 服务器（无 Express/Koa 依赖）
- **前端**: 纯 HTML + CSS + JavaScript（无构建步骤）
- **内存占用**: ~67MB（含 Web 服务器）

## 文件结构

```
crypto_radar/
├── src/
│   └── web-server.js      # Web 服务器（新增）
├── public/                # 前端静态文件（新增）
│   ├── index.html         # 主页面
│   ├── style.css          # 样式表
│   └── app.js             # 前端逻辑
└── ...
```

## API 端点

### 公开端点（无需 Token）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 系统状态 |

### 受保护端点（需要 X-API-Token）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/symbols` | GET | 获取币种列表 |
| `/api/symbols` | POST | 添加币种 |
| `/api/symbols/:symbol` | PUT | 更新币种配置 |
| `/api/symbols/:symbol` | DELETE | 删除币种 |
| `/api/targets` | GET | 获取价格目标列表 |
| `/api/targets` | POST | 添加价格目标 |
| `/api/targets/:id` | PUT | 更新价格目标 |
| `/api/targets/:id` | DELETE | 删除价格目标 |
| `/api/volatility` | GET | 获取波动配置 |
| `/api/volatility/:symbol` | PUT | 更新波动配置 |
| `/api/alerts` | GET | 获取告警历史 |
| `/api/settings` | GET | 获取系统设置 |
| `/api/settings` | PUT | 更新系统设置 |
| `/api/system/toggle` | POST | 系统总开关 |

## 安全配置

### API Token

默认 Token: `crypto_radar_token_2024`

通过环境变量自定义：
```bash
export API_TOKEN='your_secure_token'
```

或在 `ecosystem.config.js` 中配置：
```javascript
env: {
  API_TOKEN: 'your_secure_token'
}
```

## 使用方式

### 1. 启动应用

```bash
cd crypto_radar
./deploy.sh start
# 或
pm2 start crypto_radar
```

### 2. 访问 Web 界面

浏览器访问：`http://服务器IP:3000`

### 3. 自定义端口

```bash
export WEB_PORT=8080
pm2 restart crypto_radar
```

## 页面功能

### 仪表盘 (`/`)
- 系统总开关（一键启停）
- 实时状态（运行时间、内存、币种数）
- 币种价格卡片

### 币种管理 (`/symbols`)
- 添加新币种
- 启用/禁用币种
- 删除币种

### 价格目标 (`/targets`)
- 添加价格目标（突破/跌破）
- 查看目标状态
- 删除目标

### 波动侦测 (`/volatility`)
- 启用/禁用波动监控
- 配置时间窗口
- 配置阈值和阶梯增量

### 告警历史 (`/alerts`)
- 查看历史告警
- 按币种筛选

### 设置 (`/settings`)
- Bark 配置
- 检查间隔
- 静默期配置

## 内存优化

- 使用原生 HTTP 模块，无框架开销
- 静态文件直接读取，无缓存层
- 简单 JSON 解析，无重型依赖
- 总内存占用：~67MB（含主应用）

## API 调用示例

```bash
# 获取系统状态（无需 Token）
curl http://localhost:3000/api/status

# 获取币种列表（需要 Token）
curl -H "X-API-Token: crypto_radar_token_2024" \
  http://localhost:3000/api/symbols

# 添加币种
curl -X POST \
  -H "X-API-Token: crypto_radar_token_2024" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"ETHUSDT","source":"spot"}' \
  http://localhost:3000/api/symbols

# 添加价格目标
curl -X POST \
  -H "X-API-Token: crypto_radar_token_2024" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","type":"above","price":50000}' \
  http://localhost:3000/api/targets
```

## 故障排查

### Web 界面无法访问

1. 检查应用状态：`pm2 status`
2. 查看日志：`pm2 logs crypto_radar`
3. 确认端口：`netstat -tlnp | grep 3000`

### API 返回 401 Unauthorized

确保请求头包含正确的 Token：
```
X-API-Token: crypto_radar_token_2024
```

### 内存过高

1. 减少监控币种数量
2. 检查 PM2 配置中的内存限制
3. 重启应用：`pm2 restart crypto_radar`

---

_🦐 虾指挥出品，代码要能跑！_
