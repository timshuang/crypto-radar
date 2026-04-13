#!/bin/bash

# deploy.sh - ChainPulse 部署脚本
# 用法：./deploy.sh [install|update|upgrade|start|stop|restart|status|logs]

set -e

APP_NAME="crypto_radar"
DISPLAY_NAME="chainpulse"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$APP_DIR/logs"
CONFIG_FILE="$APP_DIR/config.json"
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR="$APP_DIR/backup"
VERSION_FILE="$APP_DIR/VERSION"
VERSION_META_FILE="$APP_DIR/VERSION_META"
INSTALL_VERSION_FILE="$APP_DIR/.chainpulse-version"
DEFAULT_BRANCH="main"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

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

setup_directories() {
    log_info "创建目录结构..."

    mkdir -p "$APP_DIR/src" "$LOG_DIR" "$BACKUP_DIR"

    log_info "目录创建完成"
}

install_dependencies() {
    log_info "安装 npm 依赖..."

    cd "$APP_DIR"
    npm install --production

    log_info "依赖安装完成"
}

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
    "serverUrl": "https://api.day.app",
    "soundNormal": "minuet",
    "soundCritical": "alarm",
    "volume": 5,
    "monitorEnabled": true,
    "volatilityEnabled": true
  },
  "telegram": {
    "enabled": true
  },
  "symbols": [],
  "settings": {
    "checkIntervalMinutes": 1,
    "alertSilenceMinutes": 5,
    "maxPriceRecordsPerSymbol": 720,
    "maxSymbols": 20
  }
}
EOF

        log_info "默认配置已创建，请编辑 $CONFIG_FILE"
    fi
}

ensure_env_file() {
    if [ ! -f "$ENV_FILE" ] && [ -f "$APP_DIR/.env.example" ]; then
        cp "$APP_DIR/.env.example" "$ENV_FILE"
        log_info ".env 文件已创建"
    fi
}

backup_runtime_files() {
    local ts backup_path
    ts=$(date +%Y%m%d_%H%M%S)
    backup_path="$BACKUP_DIR/update_$ts"
    mkdir -p "$backup_path"

    for file in "$CONFIG_FILE" "$ENV_FILE" "$APP_DIR/alert_state.json" "$APP_DIR/alert_history.json"; do
        if [ -f "$file" ]; then
            cp "$file" "$backup_path/"
        fi
    done

    log_info "运行配置已备份到 $backup_path"
}

resolve_git_branch() {
    local branch
    branch=$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")
    if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
        branch="$DEFAULT_BRANCH"
    fi
    echo "$branch"
}

write_version_files() {
    local git_branch channel version display

    if [ -f "$VERSION_FILE" ]; then
        version=$(tr -d '\r\n' < "$VERSION_FILE")
    else
        version="v0.0.0"
    fi

    git_branch=$(resolve_git_branch)
    if [ "$git_branch" = "$DEFAULT_BRANCH" ]; then
        channel="main"
    else
        channel="branch"
    fi

    display="$channel $version"

    cat > "$VERSION_META_FILE" <<EOF
CHANNEL=$channel
VERSION=$version
DISPLAY=$display
EOF

    cat > "$INSTALL_VERSION_FILE" <<EOF
$display
EOF

    log_info "当前版本：$display"
}

git_update_code() {
    if [ ! -d "$APP_DIR/.git" ]; then
        log_warn "非 Git 仓库，跳过代码更新"
        return
    fi

    local current_branch
    current_branch=$(resolve_git_branch)

    log_info "拉取最新代码，当前分支：$current_branch"
    git -C "$APP_DIR" fetch --tags origin
    git -C "$APP_DIR" pull --ff-only origin "$current_branch"
}

cmd_install() {
    log_info "开始安装 $DISPLAY_NAME..."

    check_dependencies
    setup_directories
    ensure_env_file
    install_dependencies
    create_default_config
    write_version_files

    log_info ""
    log_info "=========================================="
    log_info "安装完成！"
    log_info "=========================================="
    log_info "1. 编辑配置文件：nano $CONFIG_FILE"
    log_info "2. 编辑环境变量：nano $ENV_FILE"
    log_info "3. 配置 Bark / Telegram / 币种"
    log_info "4. 运行：./deploy.sh start"
}

cmd_update() {
    log_info "开始更新 $DISPLAY_NAME..."

    check_dependencies
    backup_runtime_files
    git_update_code
    ensure_env_file
    install_dependencies
    write_version_files

    log_info ""
    log_info "更新完成，配置与数据已保留"
    log_info "重启应用：./deploy.sh restart"
}

cmd_start() {
    log_info "启动 $DISPLAY_NAME..."

    cd "$APP_DIR"

    if [ ! -f "$CONFIG_FILE" ]; then
        log_error "配置文件不存在，请先运行：./deploy.sh install"
        exit 1
    fi

    write_version_files
    pm2 start ecosystem.config.js --only "$APP_NAME" 2>/dev/null || pm2 start ecosystem.config.js

    sleep 2
    pm2 status

    log_info "启动完成"
}

cmd_stop() {
    log_info "停止 $DISPLAY_NAME..."
    pm2 stop "$APP_NAME"
    log_info "停止完成"
}

cmd_restart() {
    log_info "重启 $DISPLAY_NAME..."

    cd "$APP_DIR"
    write_version_files
    pm2 restart "$APP_NAME"

    sleep 2
    pm2 status

    log_info "重启完成"
}

cmd_status() {
    write_version_files
    pm2 status "$APP_NAME"
    echo ""
    log_info "版本文件：$INSTALL_VERSION_FILE"
    if [ -f "$INSTALL_VERSION_FILE" ]; then
        cat "$INSTALL_VERSION_FILE"
    fi
}

cmd_logs() {
    pm2 logs "$APP_NAME" --lines 50
}

main() {
    case "${1:-}" in
        install)
            cmd_install
            ;;
        update|upgrade)
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
            echo "用法：$0 {install|update|upgrade|start|stop|restart|status|logs}"
            exit 1
            ;;
    esac
}

main "$@"
