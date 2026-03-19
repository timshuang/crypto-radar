# DEPLOYMENT.md - 部署方案

## 1. PM2 配置详解

### 1.1 ecosystem.config.js

```javascript
module.exports = {
  apps: [{
    name: 'crypto_radar',
    script: './src/index.js',
    cwd: '/root/crypto_radar',
    
    // 实例配置
    instances: 1,              // 单实例 (内存受限)
    exec_mode: 'fork',         // fork 模式 (非 cluster)
    
    // 内存管理
    max_memory_restart: '400M', // 超过 400MB 自动重启
    node_args: [
      '--max-old-space-size=400',  // 限制堆内存
      '--expose-gc'                 // 允许手动 GC
    ],
    
    // 环境变量
    env: {
      NODE_ENV: 'production',
      CONFIG_PATH: '/root/crypto_radar/config.json'
    },
    
    // 日志配置
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    log_file: '/root/crypto_radar/logs/app.log',
    error_file: '/root/crypto_radar/logs/error.log',
    out_file: '/root/crypto_radar/logs/out.log',
    
    // 重启策略
    autorestart: true,
    watch: false,              // 生产环境禁用 watch
    max_restarts: 10,
    min_uptime: '60s',         // 60 秒内崩溃算失败
    
    // 优雅关闭
    kill_timeout: 5000,        // 5 秒超时
    wait_ready: true,          // 等待 ready 信号
    listen_timeout: 5000,      // 启动超时
    
    // 资源限制
    max_restarts: 10,
    restart_delay: 3000        // 重启间隔 3 秒
  }]
};
```

### 1.2 PM2 常用命令

```bash
# 启动
pm2 start ecosystem.config.js

# 停止
pm2 stop crypto_radar

# 重启
pm2 restart crypto_radar

# 查看状态
pm2 status

# 查看日志
pm2 logs crypto_radar --lines 100

# 监控内存
pm2 monit

# 开机自启
pm2 startup
pm2 save
```

### 1.3 内存监控告警

```javascript
// src/monitor.js
const checkMemory = () => {
  const usage = process.memoryUsage();
  const heapUsedMB = usage.heapUsed / 1024 / 1024;
  const heapTotalMB = usage.heapTotal / 1024 / 1024;
  
  logger.info(`内存：${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB`);
  
  if (heapUsedMB > 350) {
    logger.warn('内存使用超过 350MB，触发 GC');
    if (global.gc) global.gc();
  }
  
  if (heapUsedMB > 380) {
    logger.error('内存使用超过 380MB，可能即将 OOM');
  }
};

// 每 1 分钟检查
setInterval(checkMemory, 60000);
```

---

## 2. deploy.sh 脚本设计

### 2.1 完整部署脚本

```bash
#!/bin/bash

# deploy.sh - crypto_radar 部署脚本
# 用法：./deploy.sh [install|update|start|stop|restart|status|logs]

set -e

APP_NAME="crypto_radar"
APP_DIR="/root/crypto_radar"
LOG_DIR="$APP_DIR/logs"
CONFIG_FILE="$APP_DIR/config.json"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查依赖
check_dependencies() {
    log_info "检查依赖..."
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_error "Node.js 版本过低 (需要 18+)"
        exit 1
    fi
    
    if ! command -v pm2 &> /dev/null; then
        log_warn "PM2 未安装，正在安装..."
        npm install -g pm2
    fi
    
    log_info "依赖检查通过"
}

# 创建目录结构
setup_directories() {
    log_info "创建目录结构..."
    
    mkdir -p "$APP_DIR/src"
    mkdir -p "$APP_DIR/logs"
    mkdir -p "$APP_DIR/backup"
    
    log_info "目录创建完成"
}

# 安装依赖
install_dependencies() {
    log_info "安装 npm 依赖..."
    
    cd "$APP_DIR"
    npm install --production
    
    log_info "依赖安装完成"
}

# 创建默认配置
create_default_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        log_warn "配置文件不存在，创建默认配置..."
        
        cat > "$CONFIG_FILE" << 'EOF'
{
  "version": "1.0.0",
  "createdAt": "$(date -Iseconds)",
  "updatedAt": "$(date -Iseconds)",
  "bark": {
    "enabled": false,
    "deviceKey": "YOUR_DEVICE_KEY_HERE",
    "serverUrl": "https://api.day.app",
    "sound": "alarm.mp3",
    "group": "crypto_radar"
  },
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
  ],
  "settings": {
    "checkIntervalMinutes": 1,
    "alertSilenceMinutes": 5,
    "maxPriceRecordsPerSymbol": 1440,
    "maxSymbols": 20
  }
}
EOF
        
        log_info "默认配置已创建，请编辑 $CONFIG_FILE"
    fi
}

# 备份当前配置
backup_config() {
    if [ -f "$CONFIG_FILE" ]; then
        BACKUP_FILE="$APP_DIR/backup/config.$(date +%Y%m%d_%H%M%S).json"
        cp "$CONFIG_FILE" "$BACKUP_FILE"
        log_info "配置已备份到 $BACKUP_FILE"
    fi
}

# 安装
cmd_install() {
    log_info "开始安装 $APP_NAME..."
    
    check_dependencies
    setup_directories
    install_dependencies
    create_default_config
    
    log_info "安装完成！"
    log_info "请编辑 $CONFIG_FILE 配置你的币种和告警"
    log_info "然后运行：./deploy.sh start"
}

# 更新
cmd_update() {
    log_info "开始更新 $APP_NAME..."
    
    backup_config
    
    cd "$APP_DIR"
    git pull origin main
    
    install_dependencies
    
    log_info "更新完成"
    log_info "重启应用：./deploy.sh restart"
}

# 启动
cmd_start() {
    log_info "启动 $APP_NAME..."
    
    cd "$APP_DIR"
    pm2 start ecosystem.config.js
    
    sleep 2
    pm2 status
    
    log_info "启动完成"
}

# 停止
cmd_stop() {
    log_info "停止 $APP_NAME..."
    
    pm2 stop "$APP_NAME"
    
    log_info "停止完成"
}

# 重启
cmd_restart() {
    log_info "重启 $APP_NAME..."
    
    cd "$APP_DIR"
    pm2 restart "$APP_NAME"
    
    sleep 2
    pm2 status
    
    log_info "重启完成"
}

# 状态
cmd_status() {
    pm2 status "$APP_NAME"
    pm2 monit | grep -A 20 "$APP_NAME"
}

# 日志
cmd_logs() {
    pm2 logs "$APP_NAME" --lines 50
}

# 主函数
main() {
    case "${1:-}" in
        install)
            cmd_install
            ;;
        update)
            cmd_update
            ;;
        start)
            cmd_start
            ;;
        stop)
            cmd_stop
            ;;
        restart)
            cmd_restart
            ;;
        status)
            cmd_status
            ;;
        logs)
            cmd_logs
            ;;
        *)
            echo "用法：$0 {install|update|start|stop|restart|status|logs}"
            echo ""
            echo "命令说明:"
            echo "  install   - 首次安装"
            echo "  update    - 更新代码"
            echo "  start     - 启动应用"
            echo "  stop      - 停止应用"
            echo "  restart   - 重启应用"
            echo "  status    - 查看状态"
            echo "  logs      - 查看日志"
            exit 1
            ;;
    esac
}

main "$@"
```

### 2.2 脚本权限

```bash
chmod +x deploy.sh
```

### 2.3 使用示例

```bash
# 首次安装
./deploy.sh install

# 编辑配置
nano config.json

# 启动
./deploy.sh start

# 查看状态
./deploy.sh status

# 查看日志
./deploy.sh logs

# 更新代码
git pull
./deploy.sh update

# 重启
./deploy.sh restart
```

---

## 3. Git 工作流

### 3.1 仓库结构

```
crypto_radar/
├── .git/
├── .gitignore
├── README.md
├── package.json
├── ecosystem.config.js
├── deploy.sh
├── config.json.example          # 配置模板
├── src/
│   ├── index.js                 # 入口文件
│   ├── config.js                # 配置加载
│   ├── ws-connector.js          # WebSocket 连接
│   ├── data-manager.js          # 数据管理
│   ├── checker-engine.js        # 检查引擎
│   ├── target-monitor.js        # 价格目标监控
│   ├── volatility-monitor.js    # 波动监控
│   ├── alert-service.js         # 告警服务
│   └── monitor.js               # 内存监控
├── logs/                        # 日志目录 (gitignore)
├── backup/                      # 备份目录 (gitignore)
└── config.json                  # 实际配置 (gitignore)
```

### 3.2 .gitignore

```gitignore
# 依赖
node_modules/

# 日志
logs/
*.log

# 配置 (包含敏感信息)
config.json
alert_state.json
price_history.json

# 备份
backup/

# 临时文件
*.tmp
*.bak

# 系统文件
.DS_Store
Thumbs.db

# PM2
.pm2/
```

### 3.3 分支策略

```
main          - 生产分支 (稳定)
develop       - 开发分支 (新功能)
feature/*     - 功能分支 (从 develop 分出)
hotfix/*      - 热修复分支 (从 main 分出)
```

### 3.4 提交规范

```bash
# 格式：<type>(<scope>): <subject>

# 示例
git commit -m "feat(ws): 添加自动重连逻辑"
git commit -m "fix(alert): 修复 Bark API 超时问题"
git commit -m "docs: 更新部署文档"
git commit -m "perf(memory): 优化滑动窗口内存占用"
git commit -m "config: 添加默认配置模板"
```

### 3.5 发布流程

```bash
# 1. 在 develop 分支开发
git checkout develop
git checkout -b feature/new-feature
# ... 开发 ...
git commit -m "feat: 新功能"
git push origin feature/new-feature

# 2. 创建 PR，合并到 develop
# (GitHub 上操作)

# 3. 测试通过后，合并到 main
git checkout main
git merge develop
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin main --tags

# 4. 部署
./deploy.sh update
./deploy.sh restart
```

---

## 4. 512MB 环境下的启动和监控方案

### 4.1 启动前检查

```bash
#!/bin/bash
# pre-start-check.sh

echo "=== 启动前检查 ==="

# 检查内存
FREE_MEM=$(free -m | awk 'NR==2{printf "%.0f", $7}')
echo "可用内存：${FREE_MEM}MB"

if [ "$FREE_MEM" -lt 200 ]; then
    echo "警告：可用内存不足 200MB"
fi

# 检查磁盘
FREE_DISK=$(df -h / | awk 'NR==2{print $4}')
echo "可用磁盘：${FREE_DISK}"

# 检查 Node 版本
NODE_VERSION=$(node -v)
echo "Node.js 版本：${NODE_VERSION}"

# 检查 PM2
PM2_VERSION=$(pm2 -v)
echo "PM2 版本：${PM2_VERSION}"

echo "=== 检查完成 ==="
```

### 4.2 系统服务配置 (Systemd)

```ini
# /etc/systemd/system/crypto_radar.service
[Unit]
Description=Crypto Radar Monitor
After=network.target

[Service]
Type=forking
User=root
WorkingDirectory=/root/crypto_radar
Environment=NODE_ENV=production
Environment=CONFIG_PATH=/root/crypto_radar/config.json
ExecStart=/usr/bin/pm2 start ecosystem.config.js
ExecStop=/usr/bin/pm2 stop crypto_radar
ExecReload=/usr/bin/pm2 restart crypto_radar
Restart=on-failure
RestartSec=10

# 资源限制
MemoryLimit=512M
CPUQuota=100%

# 日志
StandardOutput=journal
StandardError=journal
SyslogIdentifier=crypto_radar

[Install]
WantedBy=multi-user.target
```

```bash
# 启用服务
systemctl daemon-reload
systemctl enable crypto_radar
systemctl start crypto_radar

# 查看状态
systemctl status crypto_radar

# 查看日志
journalctl -u crypto_radar -f
```

### 4.3 监控脚本

```bash
#!/bin/bash
# monitor.sh - 健康检查脚本

APP_NAME="crypto_radar"
LOG_FILE="/root/crypto_radar/logs/health.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# 检查 PM2 进程
check_pm2() {
    if ! pm2 status "$APP_NAME" | grep -q "online"; then
        log "ERROR: PM2 进程不在运行，尝试重启..."
        pm2 restart "$APP_NAME"
        sleep 5
        if ! pm2 status "$APP_NAME" | grep -q "online"; then
            log "ERROR: 重启失败，发送告警"
            # 这里可以调用 Bark API 发送告警
        fi
    fi
}

# 检查内存
check_memory() {
    MEM_USAGE=$(pm2 monit | grep "$APP_NAME" -A 5 | grep "Memory" | awk '{print $2}')
    if [ -n "$MEM_USAGE" ]; then
        MEM_MB=$(echo "$MEM_USAGE" | sed 's/M//')
        if (( $(echo "$MEM_MB > 400" | bc -l) )); then
            log "WARN: 内存使用过高 ${MEM_MB}MB"
        fi
    fi
}

# 检查日志大小
check_logs() {
    LOG_SIZE=$(du -m /root/crypto_radar/logs/*.log 2>/dev/null | awk '{sum+=$1} END {print sum}')
    if [ -n "$LOG_SIZE" ] && [ "$LOG_SIZE" -gt 100 ]; then
        log "WARN: 日志文件过大 ${LOG_SIZE}MB，考虑轮转"
        pm2 flush "$APP_NAME"
    fi
}

# 主循环
while true; do
    check_pm2
    check_memory
    check_logs
    sleep 300  # 每 5 分钟检查一次
done
```

### 4.4 日志轮转配置

```bash
# /etc/logrotate.d/crypto_radar
/root/crypto_radar/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
    postrotate
        pm2 flush crypto_radar
    endscript
}
```

### 4.5 紧急恢复方案

```bash
#!/bin/bash
# emergency-recover.sh

echo "=== 紧急恢复 ==="

# 1. 停止所有进程
pm2 stop all

# 2. 清理内存
sync
echo 3 > /proc/sys/vm/drop_caches

# 3. 检查磁盘空间
df -h

# 4. 清理旧日志
find /root/crypto_radar/logs -name "*.log" -mtime +7 -delete

# 5. 清理 PM2 日志
pm2 flush

# 6. 重启应用
pm2 start ecosystem.config.js

# 7. 验证
sleep 5
pm2 status

echo "=== 恢复完成 ==="
```

### 4.6 资源监控仪表板

```javascript
// src/dashboard.js (可选，内存占用极小)
const express = require('express');
const app = express();

app.get('/status', (req, res) => {
  const status = {
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    pid: process.pid,
    version: process.version
  };
  res.json(status);
});

// 仅在调试时启用
if (process.env.DEBUG_MODE === 'true') {
  app.listen(3001, () => {
    console.log('Dashboard running on port 3001');
  });
}
```

---

## 5. 完整部署清单

### 5.1 首次部署

```bash
# 1. 克隆仓库
git clone https://github.com/your-username/crypto_radar.git
cd crypto_radar

# 2. 运行安装脚本
./deploy.sh install

# 3. 编辑配置
nano config.json

# 4. 启动应用
./deploy.sh start

# 5. 验证
./deploy.sh status
./deploy.sh logs

# 6. 设置开机自启
pm2 startup
pm2 save
```

### 5.2 日常运维

```bash
# 查看状态
./deploy.sh status

# 查看日志
./deploy.sh logs

# 重启应用
./deploy.sh restart

# 更新代码
git pull
./deploy.sh update

# 备份配置
cp config.json backup/config.$(date +%Y%m%d).json
```

### 5.3 故障排查

```bash
# 1. 检查 PM2 状态
pm2 status

# 2. 查看详细日志
pm2 logs crypto_radar --lines 200

# 3. 检查内存
pm2 monit

# 4. 检查系统资源
free -m
df -h
top -bn1 | head -20

# 5. 重启
pm2 restart crypto_radar

# 6. 如果还不行，查看错误日志
cat logs/error.log | tail -50
```

---

## 6. 性能基准 (512MB VPS)

| 指标 | 目标值 | 测量方法 |
|------|--------|----------|
| 启动时间 | < 5 秒 | `time ./deploy.sh start` |
| 内存占用 | < 350MB | `pm2 monit` |
| CPU 占用 | < 10% | `top` |
| 检查延迟 | < 100ms | 日志时间戳 |
| 告警延迟 | < 1 秒 | Bark 接收时间 |
| 磁盘占用 | < 50MB | `du -sh .` |

---

_部署方案完成，运维人员可参考此文档进行安装、部署和监控。_
