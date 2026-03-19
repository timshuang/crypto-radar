# 🦐 crypto_radar - Web3 双轨行情雷达系统

> 轻量化加密货币价格监控工具，专为 1C/512MB RAM VPS 设计

## 功能特性

- **双轨监控**：价格目标线 + 波动侦测线
- **三源接入**：币安现货 + 新币 + Alpha WebSocket
- **智能告警**：5 分钟静默期 + 阶梯阈值抑制
- **Bark 推送**：iOS 实时通知（支持分级）
- **内存优化**：TypedArray 滑动窗口，512MB 友好
- **持久化**：JSON 文件存储，原子写入防损坏
- **Web 管理界面**：轻量级可视化操作界面（<50MB 内存）
- **代币缓存**：5 分钟自动刷新，搜索响应 <50ms

## 快速开始

### 1. 环境要求

- Node.js >= 18.0.0
- PM2（安装脚本会自动安装）
- 512MB+ RAM（推荐 1GB）

### 2. 安装

```bash
# 进入项目目录
cd crypto_radar

# 运行安装脚本
./deploy.sh install
```

### 3. 配置

编辑 `config.json`：

```bash
nano config.json
```

#### 3.1 配置 Bark（必填）

1. 在 iPhone 上安装 [Bark App](https://apps.apple.com/app/id1211513936)
2. 打开 App，复制设备密钥（类似：`abc123xyz456`）
3. 填入配置：

```json
{
  "bark": {
    "enabled": true,
    "deviceKey": "你的设备密钥",
    "serverUrl": "https://api.day.app",
    "sound": "alarm.mp3",
    "group": "crypto_radar"
  }
}
```

#### 3.2 配置币种

```json
{
  "symbols": [
    {
      "symbol": "BTCUSDT",
      "enabled": true,
      "source": "spot",
      "targets": [
        {
          "id": "target_1",
          "type": "above",
          "price": 50000,
          "enabled": true,
          "status": "waiting"
        }
      ],
      "volatility": {
        "enabled": true,
        "windowMinutes": 60,
        "thresholdPercent": 2.0,
        "stepThreshold": 0.5
      }
    }
  ]
}
```

**配置说明：**

| 字段 | 说明 | 示例 |
|------|------|------|
| `symbol` | 币种代码（大写） | `BTCUSDT` |
| `source` | 数据源 | `spot`（现货）、`new`（新币）或 `alpha`（Alpha） |
| `alphaId` | Alpha 代币 ID（仅 Alpha 源需要） | `ALPHA_804` |
| `targets` | 价格目标列表 | 见下方 |
| `volatility.enabled` | 是否启用波动监控 | `true` / `false` |
| `volatility.windowMinutes` | 滑动窗口（分钟） | `60` |
| `volatility.thresholdPercent` | 触发阈值（%） | `2.0` |
| `volatility.stepThreshold` | 阶梯增量（%） | `0.5` |

**价格目标类型：**

- `type: "above"` - 价格**突破**目标价时告警
- `type: "below"` - 价格**跌破**目标价时告警

### 4. 启动

```bash
# 启动应用
./deploy.sh start

# 查看状态
./deploy.sh status

# 查看日志
./deploy.sh logs
```

### 5. 开机自启

```bash
# 设置 PM2 开机自启
pm2 startup
pm2 save
```

### 6. 访问 Web 管理界面

启动应用后，Web 界面会自动运行在 **3000 端口**：

```bash
# 在浏览器访问
http://你的服务器 IP:3000
```

**Web 界面功能：**

| 页面 | 功能 |
|------|------|
| 仪表盘 | 系统总开关、实时状态、币种价格卡片 |
| 币种管理 | 添加/编辑/删除币种、启用/禁用监控 |
| 价格目标 | 配置价格突破/跌破目标线 |
| 波动侦测 | 配置时间窗口、阈值、阶梯阈值 |
| 告警历史 | 查看历史告警记录、按币种筛选 |
| 设置 | Bark 配置、检查间隔、静默期 |

**API Token 验证：**

Web API 需要 Token 验证（`/api/status` 和 `/api/cache/status` 除外），默认 Token 为：
```
crypto_radar_token_2024
```

可通过环境变量自定义：
```bash
export API_TOKEN='your_custom_token'
```

**代币缓存机制：**

Web 服务器启动时会自动加载代币列表缓存（现货 + Alpha），并每 5 分钟刷新一次：

- **现货数据**：来自 `https://api.binance.com/api/v3/exchangeInfo`
- **Alpha 数据**：来自 `https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list`
- **缓存 TTL**：5 分钟（300 秒）
- **搜索性能**：缓存命中后响应时间 <50ms

**缓存状态 API：**

```bash
# 查看缓存状态（无需 Token）
curl http://localhost:3000/api/cache/status

# 示例响应
{
  "success": true,
  "data": {
    "cached": true,
    "count": 2500,
    "loadedAt": 1710408000000,
    "age": 120000,
    "ttl": 300000
  }
}
```

**搜索 API：**

```bash
# 搜索代币（需要 Token）
curl -H "X-API-Token: crypto_radar_token_2024" "http://localhost:3000/api/symbols/search?q=CYS"

# 示例响应
{
  "success": true,
  "data": [
    "CYS (ALPHA_495) (TRADING)"
  ]
}
```

## 部署命令

```bash
# 首次安装
./deploy.sh install

# 启动
./deploy.sh start

# 停止
./deploy.sh stop

# 重启
./deploy.sh restart

# 查看状态
./deploy.sh status

# 查看日志
./deploy.sh logs

# 更新代码
git pull
./deploy.sh update
```

## 告警说明

### 价格目标告警

当币种价格达到设定的目标价时触发：

```
📈 突破
BTCUSDT 突破 $50,000
当前价：$50,123
```

**特性：**
- 一次性逻辑：触发后自动标记为"已完成"，不再重复告警
- 5 分钟静默期：防止重复通知

### 波动告警

当币种在指定时间窗口内波动超过阈值时触发：

```
🌊 波动侦测
BTCUSDT 波动 2.35% (阈值 2.0%)
区间：$49,800 - $51,200
```

**特性：**
- 持续性监控：不会自动完成，持续检测
- 阶梯阈值：每次触发后阈值自动累加（如 2.0% → 2.5% → 3.0%）
- 5 分钟静默期

## 配置示例

### 示例 1：监控 BTC 突破 $50,000

```json
{
  "symbols": [
    {
      "symbol": "BTCUSDT",
      "enabled": true,
      "source": "spot",
      "targets": [
        {
          "id": "btc_breakout",
          "type": "above",
          "price": 50000,
          "enabled": true,
          "status": "waiting"
        }
      ],
      "volatility": {
        "enabled": false
      }
    }
  ]
}
```

### 示例 2：监控 ETH 60 分钟波动超过 3%

```json
{
  "symbols": [
    {
      "symbol": "ETHUSDT",
      "enabled": true,
      "source": "spot",
      "targets": [],
      "volatility": {
        "enabled": true,
        "windowMinutes": 60,
        "thresholdPercent": 3.0,
        "stepThreshold": 0.5
      }
    }
  ]
}
```

### 示例 3：多币种 + 双轨监控

```json
{
  "symbols": [
    {
      "symbol": "BTCUSDT",
      "enabled": true,
      "source": "spot",
      "targets": [
        { "id": "t1", "type": "above", "price": 50000, "enabled": true, "status": "waiting" },
        { "id": "t2", "type": "below", "price": 45000, "enabled": true, "status": "waiting" }
      ],
      "volatility": {
        "enabled": true,
        "windowMinutes": 60,
        "thresholdPercent": 2.0,
        "stepThreshold": 0.5
      }
    },
    {
      "symbol": "ETHUSDT",
      "enabled": true,
      "source": "new",
      "targets": [],
      "volatility": {
        "enabled": true,
        "windowMinutes": 30,
        "thresholdPercent": 3.0,
        "stepThreshold": 0.5
      }
    }
  ]
}
```

### 示例 4：Alpha 代币配置

```json
{
  "symbols": [
    {
      "symbol": "UP",
      "enabled": true,
      "source": "alpha",
      "alphaId": "ALPHA_804",
      "targets": [
        {
          "id": "up_target_1",
          "type": "above",
          "price": 0.1,
          "enabled": true,
          "status": "waiting"
        }
      ],
      "volatility": {
        "enabled": true,
        "windowMinutes": 60,
        "thresholdPercent": 5.0,
        "stepThreshold": 1.0
      }
    },
    {
      "symbol": "龙虾",
      "enabled": true,
      "source": "alpha",
      "alphaId": "ALPHA_772",
      "targets": [],
      "volatility": {
        "enabled": true,
        "windowMinutes": 30,
        "thresholdPercent": 3.0,
        "stepThreshold": 0.5
      }
    }
  ]
}
```

**Alpha 代币说明：**
- `source` 必须设置为 `"alpha"`
- `alphaId` 格式：`ALPHA_xxx`（如 `ALPHA_804`）
- WebSocket 自动连接到 `wss://nbstream.binance.com/w3w/wsa/stream`
- 流格式：`alpha_{token_id}usdt@aggTrade`

## 项目结构

```
crypto_radar/
├── src/
│   ├── index.js           # 主程序入口
│   ├── config.js          # 配置管理
│   ├── storage.js         # 数据存储（价格历史 + 告警状态）
│   ├── ws-connector.js    # WebSocket 连接器
│   ├── alert-service.js   # Bark 告警服务
│   ├── monitors.js        # 监控器（价格目标 + 波动）
│   ├── checker-engine.js  # 检查引擎（每分钟全量检查）
│   ├── monitor.js         # 系统监控（内存 + 健康检查）
│   └── web-server.js      # Web 管理界面服务器
├── public/                # Web 前端静态文件
│   ├── index.html         # 主页面
│   ├── style.css          # 样式表
│   └── app.js             # 前端 JavaScript
├── logs/                  # 日志目录（PM2 管理）
├── backup/                # 配置备份
├── config.json            # 用户配置（需自行创建）
├── config.json.example    # 配置模板
├── ecosystem.config.js    # PM2 配置
├── deploy.sh              # 部署脚本
├── package.json           # 依赖管理
└── README.md              # 本文档
```

## 内存优化

本项目针对 512MB RAM VPS 进行了深度优化：

| 优化项 | 说明 |
|--------|------|
| TypedArray | 使用 Uint32Array/Float64Array 存储价格数据，减少 60% 内存 |
| 滑动窗口 | 每币种最多 1440 条记录（24 小时），自动清理过期数据 |
| 连接池限制 | 最多 20 个币种并发连接 |
| PM2 内存限制 | 超过 450MB 自动重启（含 Web UI） |
| 手动 GC | 每 5 分钟触发垃圾回收 |
| 单实例模式 | 禁用 cluster 模式，减少内存开销 |
| Web UI | 原生 HTTP 服务器，无框架依赖，<50MB |

## 故障排查

### 1. 查看日志

```bash
./deploy.sh logs
```

### 2. 检查内存

```bash
pm2 monit
```

### 3. 重启应用

```bash
./deploy.sh restart
```

### 4. 常见问题

**Q: 告警不发送？**
- 检查 `config.json` 中 `bark.deviceKey` 是否正确
- 确认 Bark App 在 iPhone 上正常运行
- 查看日志是否有 "DeviceKey 未配置" 警告

**Q: 价格数据不更新？**
- 检查网络连接
- 查看日志中 WS 连接状态
- 确认币种代码正确（大写，如 `BTCUSDT`）

**Q: 内存过高？**
- 减少监控币种数量
- 降低 `maxPriceRecordsPerSymbol` 配置
- 检查 PM2 日志是否有 OOM 重启记录

## 技术栈

- **运行时**: Node.js 18+
- **WebSocket**: ws 库（现货 + Alpha）
- **进程管理**: PM2
- **存储**: JSON 文件（原子写入）
- **推送**: Bark API
- **数据源**: 
  - 币安现货 API (`api.binance.com`)
  - 币安 Alpha API (`bapi/defi/v1/public/alpha-trade`)

## Alpha API 说明

本项目已集成币安 Alpha 官方 API，支持：

- ✅ Alpha 代币列表获取（缓存 24 小时）
- ✅ Alpha WebSocket 实时行情
- ✅ Alpha 代币搜索和添加
- ✅ Alpha 价格目标监控
- ✅ Alpha 波动监控

**详见：** [ALPHA_API_IMPLEMENTATION.md](./ALPHA_API_IMPLEMENTATION.md)

## 许可证

MIT License

---

_🦐 虾指挥出品，代码要能跑！_
