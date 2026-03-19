#!/bin/bash

# deploy.sh - crypto_radar 部署脚本
# 用法：./deploy.sh [install|update|start|stop|restart|status|logs]

set -e

APP_NAME="crypto_radar"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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
  "createdAt": "2026-03-12T10:00:00Z",
  "updatedAt": "2026-03-12T10:00:00Z",
  "bark": {
    "enabled": true,
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
        },
        {
          "id": "target_2",
          "type": "below",
          "price": 45000,
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
    },
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
        log_warn "重要：请修改 bark.deviceKey 为你的 Bark 设备密钥"
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
    
    log_info ""
    log_info "=========================================="
    log_info "安装完成！"
    log_info "=========================================="
    log_info ""
    log_info "下一步："
    log_info "1. 编辑配置文件：nano $CONFIG_FILE"
    log_info "2. 修改 Bark deviceKey（从 Bark App 获取）"
    log_info "3. 配置你的币种和价格目标"
    log_info "4. 运行：./deploy.sh start"
    log_info ""
}

# 更新
cmd_update() {
    log_info "开始更新 $APP_NAME..."
    
    backup_config
    
    cd "$APP_DIR"
    
    if [ -d ".git" ]; then
        git pull origin main
    else
        log_warn "非 Git 仓库，跳过代码更新"
    fi
    
    install_dependencies
    
    log_info ""
    log_info "更新完成"
    log_info "重启应用：./deploy.sh restart"
}

# 启动
cmd_start() {
    log_info "启动 $APP_NAME..."
    
    cd "$APP_DIR"
    
    # 检查配置
    if [ ! -f "$CONFIG_FILE" ]; then
        log_error "配置文件不存在，请先运行：./deploy.sh install"
        exit 1
    fi
    
    # 检查 deviceKey
    if grep -q "YOUR_DEVICE_KEY_HERE" "$CONFIG_FILE"; then
        log_warn "⚠️  Bark deviceKey 未配置，告警将无法发送"
        log_warn "请编辑 $CONFIG_FILE 并修改 deviceKey"
    fi
    
    pm2 start ecosystem.config.js
    
    sleep 2
    pm2 status
    
    log_info ""
    log_info "启动完成"
    log_info "查看日志：./deploy.sh logs"
    log_info "查看状态：./deploy.sh status"
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
    echo ""
    log_info "内存监控:"
    pm2 monit | grep -A 20 "$APP_NAME" || true
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
