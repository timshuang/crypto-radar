#!/bin/bash
# =============================================================================
# ChainPulse 一键部署脚本（安装 / 更新 / 卸载）
# 目标环境：Oracle Cloud Ubuntu 20.04+
# =============================================================================

set -e

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
NC='\033[0m'

APP_NAME="crypto_radar"
DISPLAY_NAME="ChainPulse"
DEPLOY_DIR="$HOME/crypto-radar"
VERSION_META_FILE_NAME="VERSION_META"
NGINX_SITE_NAME="chainpulse"
NGINX_AVAILABLE="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"

print_header() {
  echo "======================================"
  echo "🦐 ${DISPLAY_NAME} 一键部署脚本"
  echo "======================================"
  echo ""
}

choose_action() {
  echo "请选择操作："
  echo "  1) 安装"
  echo "  2) 更新"
  echo "  3) 卸载（仅删除 ChainPulse 相关资源）"
  read -r -p "请输入选项 [1/2/3，默认1]: " ACTION_CHOICE
  case "$ACTION_CHOICE" in
    2) ACTION="update" ;;
    3) ACTION="uninstall" ;;
    *) ACTION="install" ;;
  esac
}

choose_mode() {
  echo "请选择部署模式："
  echo "  1) 公网模式（默认，监听 0.0.0.0:3000）"
  echo "  2) 安全模式（监听 127.0.0.1:3000，可选 Nginx 反代）"
  read -r -p "请输入选项 [1/2，默认1]: " MODE_CHOICE

  if [ "$MODE_CHOICE" = "2" ]; then
    DEPLOY_MODE="secure"
    WEB_HOST="127.0.0.1"
    echo -e "${GREEN}已选择：安全模式${NC}"
    echo -e "${YELLOW}提示：请确保防火墙仅开放 22/80/443，关闭公网 3000。${NC}"
  else
    DEPLOY_MODE="public"
    WEB_HOST="0.0.0.0"
    echo -e "${GREEN}已选择：公网模式${NC}"
    echo -e "${YELLOW}提示：请确保防火墙/安全组已开放公网 3000。${NC}"
  fi

  echo ""
}

load_existing_mode() {
  if [ -f "$DEPLOY_DIR/ecosystem.config.js" ] && grep -q "WEB_HOST: '127.0.0.1'" "$DEPLOY_DIR/ecosystem.config.js"; then
    DEPLOY_MODE="secure"
    WEB_HOST="127.0.0.1"
    echo "  ✅ 检测到现有部署模式：安全模式（127.0.0.1:3000）"
  else
    DEPLOY_MODE="public"
    WEB_HOST="0.0.0.0"
    echo "  ✅ 检测到现有部署模式：公网模式（0.0.0.0:3000）"
  fi
}

extract_domain_from_nginx() {
  if [ -f "$NGINX_AVAILABLE" ]; then
    DETECTED_DOMAIN=$(grep -E "^\s*server_name\s+" "$NGINX_AVAILABLE" | head -n1 | sed -E 's/^\s*server_name\s+([^;]+);/\1/' | awk '{print $1}')
  else
    DETECTED_DOMAIN=""
  fi
}

confirm_delete() {
  echo ""
  echo -e "${RED}即将卸载 ${DISPLAY_NAME}（仅项目相关资源）：${NC}"
  echo "  - PM2 进程: ${APP_NAME}"
  echo "  - 项目目录: ${DEPLOY_DIR}"
  echo "  - Nginx 站点: ${NGINX_AVAILABLE} / ${NGINX_ENABLED}"
  echo ""
  echo "不会删除："
  echo "  - 其他 PM2 项目"
  echo "  - PM2/Node/Nginx 软件本体"
  echo "  - 其他 Nginx 站点"
  echo "  - Swap、防火墙、系统配置"
  echo ""
  read -r -p "输入 y 确认卸载（输入 n 取消）: " CONFIRM_TEXT
  if [[ "$CONFIRM_TEXT" =~ ^[Nn]$ ]]; then
    echo "已取消卸载。"
    exit 0
  fi
  if [[ ! "$CONFIRM_TEXT" =~ ^[Yy]$ ]]; then
    echo "未输入 y，已取消卸载。"
    exit 0
  fi
}

uninstall_chainpulse() {
  extract_domain_from_nginx
  confirm_delete

  echo ""
  echo "[卸载] 停止并删除 PM2 进程..."
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  pm2 save >/dev/null 2>&1 || true
  echo "  ✅ PM2 进程已处理"

  echo "[卸载] 删除项目目录..."
  if [ -d "$DEPLOY_DIR" ]; then
    rm -rf "$DEPLOY_DIR"
    echo "  ✅ 已删除 ${DEPLOY_DIR}"
  else
    echo "  ↪ 项目目录不存在，跳过"
  fi

  echo "[卸载] 删除 Nginx 站点配置..."
  if [ -L "$NGINX_ENABLED" ] || [ -f "$NGINX_ENABLED" ]; then
    sudo rm -f "$NGINX_ENABLED"
  fi
  if [ -f "$NGINX_AVAILABLE" ]; then
    sudo rm -f "$NGINX_AVAILABLE"
  fi

  if command -v nginx >/dev/null 2>&1; then
    if sudo nginx -t >/dev/null 2>&1; then
      sudo systemctl reload nginx || true
    fi
  fi
  echo "  ✅ Nginx 站点已处理"

  if [ -n "$DETECTED_DOMAIN" ]; then
    echo ""
    read -r -p "是否删除 ${DETECTED_DOMAIN} 的证书？[y/N]: " REMOVE_CERT
    if [[ "$REMOVE_CERT" =~ ^[Yy]$ ]]; then
      if command -v certbot >/dev/null 2>&1; then
        sudo certbot delete --cert-name "$DETECTED_DOMAIN" -n || true
        echo "  ✅ 证书删除命令已执行"
      else
        echo "  ↪ 未安装 certbot，跳过证书删除"
      fi
    else
      echo "  ↪ 已跳过证书删除"
    fi
  fi

  echo ""
  echo "======================================"
  echo "✅ ${DISPLAY_NAME} 卸载完成"
  echo "======================================"
}

install_nginx_and_optional_reverse_proxy() {
  echo ""
  echo "[8/9] 安装 Nginx..."
  sudo apt-get update -y
  sudo apt-get install -y nginx
  sudo systemctl enable nginx
  sudo systemctl start nginx
  echo "  ✅ Nginx 已安装"

  read -r -p "请输入你的域名（例如 example.com）。直接回车=跳过反代配置，仅安装 Nginx：" DOMAIN
  if [ -z "$DOMAIN" ]; then
    echo "  ↪ 已跳过反代配置（仅安装 Nginx）"
    return 0
  fi

  echo ""
  echo "  开始配置 Nginx 反代域名：$DOMAIN"

  sudo tee "$NGINX_AVAILABLE" >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

  sudo ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  sudo rm -f /etc/nginx/sites-enabled/default

  if ! sudo nginx -t; then
    echo -e "${RED}  ❌ Nginx 配置校验失败，已跳过反代部署。${NC}"
    return 0
  fi

  sudo systemctl reload nginx
  echo "  ✅ Nginx 反代（HTTP）已生效"

  echo ""
  read -r -p "请输入证书邮箱（用于 Let's Encrypt 到期提醒，直接回车跳过证书申请）：" CERT_EMAIL
  if [ -z "$CERT_EMAIL" ]; then
    echo "  ↪ 已跳过证书自动申请，当前为 HTTP 可访问。"
    return 0
  fi

  echo ""
  echo "  正在尝试自动申请 HTTPS 证书（Let's Encrypt）..."
  sudo apt-get install -y certbot python3-certbot-nginx

  set +e
  sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERT_EMAIL" --redirect
  CERTBOT_EXIT=$?
  set -e

  if [ $CERTBOT_EXIT -eq 0 ]; then
    echo -e "${GREEN}  ✅ HTTPS 证书申请成功，已启用 443 + HTTP 自动跳转。${NC}"
  else
    echo -e "${RED}  ❌ 证书申请失败，已降级为 HTTP（服务仍可用）。${NC}"
    echo "  失败日志：/var/log/letsencrypt/letsencrypt.log"
  fi
}

write_version_metadata() {
  local branch version channel

  if [ -f "$DEPLOY_DIR/package.json" ]; then
    version=$(node -e "console.log(require('$DEPLOY_DIR/package.json').version || '0.0.0')" 2>/dev/null || echo "0.0.0")
  else
    version="0.0.0"
  fi

  branch=$(git -C "$DEPLOY_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  if [ "$branch" = "main" ]; then
    channel="main"
  else
    channel="branch"
  fi

  cat > "$DEPLOY_DIR/$VERSION_META_FILE_NAME" <<EOF
CHANNEL=$channel
EOF

  echo "  Current version: ${channel} ${version}"
}

backup_runtime_files() {
  local backup_dir
  backup_dir="$DEPLOY_DIR/backup/update_latest"
  rm -rf "$backup_dir"
  mkdir -p "$backup_dir"

  for file in config.json .env alert_history.json; do
    if [ -f "$DEPLOY_DIR/$file" ]; then
      cp "$DEPLOY_DIR/$file" "$backup_dir/"
    fi
  done

  echo "  ✅ 已备份关键配置到 $backup_dir"
}

print_summary() {
  echo ""
  echo "======================================"
  echo "✅ ${DISPLAY_NAME} 部署完成！"
  echo "======================================"
  echo ""

  if [ "$DEPLOY_MODE" = "public" ]; then
    echo "📋 当前模式：公网模式"
    echo "访问地址："
    echo "  http://YOUR_SERVER_IP:3000"
  else
    echo "📋 当前模式：安全模式（仅本机监听 3000）"
    echo "本机监听："
    echo "  http://127.0.0.1:3000"
  fi

  echo ""
  echo "📁 重要文件位置："
  echo "   配置文件：$DEPLOY_DIR/config.json"
  echo "   环境变量：$DEPLOY_DIR/.env"
  echo "   Version source: $DEPLOY_DIR/package.json"
  echo "   Note: version label comes from package.json on the deployed branch."
  echo "   日志文件：$DEPLOY_DIR/logs/"
  echo ""
  echo "======================================"
}

run_prechecks() {
  echo "[1/9] 系统检测..."

  MEM_TOTAL=$(free -m | awk '/^Mem:/{print $2}')
  echo "  内存总量：${MEM_TOTAL}MB"
  if [ "$MEM_TOTAL" -lt 800 ]; then
    echo "  ⚠️  警告：内存小于 800MB，可能运行不稳定"
  fi

  if ! command -v node &> /dev/null; then
    echo "  Node.js 未安装，开始安装..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "  ✅ Node.js 已安装：$(node -v)"
  else
    echo "  ✅ Node.js 已安装：$(node -v)"
  fi

  if ! command -v git &> /dev/null; then
    echo "  Git 未安装，开始安装..."
    sudo apt-get install -y git
  fi
  echo "  ✅ Git 已安装"

  echo ""
  echo "[2/9] 配置 Swap（1GB）..."
  TARGET_SWAP_BYTES=$((1024 * 1024 * 1024))
  CURRENT_SWAP_BYTES=$(swapon --show=SIZE --bytes --noheadings 2>/dev/null | awk '{sum += $1} END {print sum + 0}')

  if [ "$CURRENT_SWAP_BYTES" -ge "$TARGET_SWAP_BYTES" ]; then
    CURRENT_SWAP_MB=$((CURRENT_SWAP_BYTES / 1024 / 1024))
    echo "  ✅ 已检测到 Swap ${CURRENT_SWAP_MB}MB（>= 1024MB），跳过创建"
  else
    CURRENT_SWAP_MB=$((CURRENT_SWAP_BYTES / 1024 / 1024))
    echo "  ⚠️ 当前 Swap 为 ${CURRENT_SWAP_MB}MB，小于 1024MB，调整 /swapfile 为 1GB"

    if swapon --show=NAME --noheadings 2>/dev/null | grep -qx '/swapfile'; then
      sudo swapoff /swapfile || true
    fi

    sudo rm -f /swapfile
    sudo fallocate -l 1G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile

    if ! grep -q '^/swapfile none swap sw 0 0$' /etc/fstab; then
      echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    fi

    echo "  ✅ /swapfile 已配置为 1GB"
  fi

  echo ""
  echo "[3/9] 安装 PM2..."
  if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo "  ✅ PM2 已安装"
  else
    echo "  ✅ PM2 已安装"
  fi
}

install_chainpulse() {
  choose_mode
  run_prechecks

  echo ""
  echo "[4/9] 代码部署..."
  echo -e "${YELLOW}  NOTICE: formal deployment installs the stable main branch and does not follow the branch that served this deploy.sh.${NC}"
  if [ -d "$DEPLOY_DIR/.git" ]; then
    echo -e "${YELLOW}  ⚠️ 检测到已有安装：$DEPLOY_DIR${NC}"
    read -r -p "是否继续安装？ [Y/n] " CONTINUE_INSTALL
    if [[ "$CONTINUE_INSTALL" =~ ^[Nn]$ ]]; then
      echo "已取消安装"
      exit 0
    fi
  fi

  git clone https://github.com/timshuang/crypto-radar.git "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
  echo -e "${YELLOW}  NOTICE: code source locked to stable branch main for formal deployment.${NC}"
  echo "  ✅ 代码已就绪"

  echo ""
  echo "[5/9] 安装依赖..."
  npm install --production
  echo "  ✅ 依赖已安装"

  write_version_metadata

  echo ""
  echo "[6/9] 跳过运行期配置文件初始化（由程序自行处理）"

  echo ""
  echo "[7/9] 配置 PM2..."
  cat > ecosystem.config.js <<EOF
module.exports = {
  apps: [{
    name: '${APP_NAME}',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      WEB_HOST: '${WEB_HOST}',
      WEB_PORT: 3000
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
EOF

  mkdir -p logs
  pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
  pm2 start ecosystem.config.js --env production
  pm2 save
  pm2 startup | tail -1 | bash 2>/dev/null || true
  echo "  ✅ PM2 已配置并启动"

  if [ "$DEPLOY_MODE" = "secure" ]; then
    install_nginx_and_optional_reverse_proxy
  else
    echo ""
    echo "[8/9] 跳过 Nginx（公网模式默认不安装）"
  fi

  echo ""
  echo "[9/9] 部署结果"
  print_summary
}

update_chainpulse() {
  run_prechecks

  echo ""
  echo "[4/9] 代码部署..."
  if [ ! -d "$DEPLOY_DIR/.git" ]; then
    echo -e "${RED}  ❌ 未检测到现有 Git 部署：$DEPLOY_DIR${NC}"
    echo "  请改用“安装”操作。"
    exit 1
  fi

  echo "  检测到现有部署，执行更新..."
  load_existing_mode
  backup_runtime_files
  cd "$DEPLOY_DIR"
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
  git fetch --tags origin
  git pull --ff-only origin "$CURRENT_BRANCH"
  echo "  ✅ 代码已就绪"

  echo ""
  echo "[5/9] 安装依赖..."
  npm install --production
  echo "  ✅ 依赖已安装"

  write_version_metadata

  echo ""
  echo "[6/9] 跳过运行期配置文件处理（沿用程序自身逻辑）"

  echo ""
  echo "[7/9] 重启 PM2..."
  mkdir -p logs
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 restart "$APP_NAME"
    echo "  ✅ PM2 进程已重启"
  else
    if [ -f ecosystem.config.js ]; then
      pm2 start ecosystem.config.js --env production
      echo "  ✅ PM2 进程不存在，已按现有配置启动"
    else
      echo -e "${RED}  ❌ 缺少 ecosystem.config.js，无法按现有运行方式启动${NC}"
      exit 1
    fi
  fi
  pm2 save
  echo "  ✅ 已保留现有部署模式与 PM2 配置"

  echo ""
  echo "[8/9] 跳过 Nginx / 证书配置（更新沿用现有设置）"

  echo ""
  echo "[9/9] 部署结果"
  print_summary
}

retry_cert() {
  local domain="$1"
  local email="$2"

  if [ -z "$domain" ] || [ -z "$email" ]; then
    echo "用法: ./deploy.sh --retry-cert <domain> <email>"
    echo "示例: ./deploy.sh --retry-cert trade.5202157.xyz you@example.com"
    exit 1
  fi

  sudo apt-get update -y
  sudo apt-get install -y certbot python3-certbot-nginx nginx
  sudo systemctl reload nginx
  sudo certbot --nginx -d "$domain" --non-interactive --agree-tos -m "$email" --redirect
  echo -e "${GREEN}✅ 证书重试成功：$domain${NC}"
}

if [ "$1" = "--retry-cert" ]; then
  retry_cert "$2" "$3"
  exit 0
fi

print_header
choose_action

if [ "$ACTION" = "uninstall" ]; then
  uninstall_chainpulse
elif [ "$ACTION" = "update" ]; then
  update_chainpulse
else
  install_chainpulse
fi
