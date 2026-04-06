#!/bin/bash
# =============================================================================
# ChainPulse 一键部署脚本
# 目标环境：Oracle Cloud 2C1G Ubuntu 20.04
# =============================================================================

set -e

echo "======================================"
echo "🦐 ChainPulse 一键部署脚本"
echo "======================================"
echo ""

# === 1. 系统检测 ===
echo "[1/8] 系统检测..."

# 检查内存
MEM_TOTAL=$(free -m | awk '/^Mem:/{print $2}')
echo "  内存总量：${MEM_TOTAL}MB"
if [ $MEM_TOTAL -lt 800 ]; then
  echo "  ⚠️  警告：内存小于 800MB，可能运行不稳定"
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
  echo "  Node.js 未安装，开始安装..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "  ✅ Node.js 已安装：$(node -v)"
else
  echo "  ✅ Node.js 已安装：$(node -v)"
fi

# 检查 Git
if ! command -v git &> /dev/null; then
  echo "  Git 未安装，开始安装..."
  sudo apt-get install -y git
fi
echo "  ✅ Git 已安装"

# === 2. 配置 Swap（1GB） ===
echo ""
echo "[2/8] 配置 Swap（1GB）..."
if [ ! -f /swapfile ]; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo "  ✅ Swap 已创建"
else
  echo "  ✅ Swap 已存在"
fi

# === 3. 安装 PM2 ===
echo ""
echo "[3/8] 安装 PM2..."
if ! command -v pm2 &> /dev/null; then
  sudo npm install -g pm2
  echo "  ✅ PM2 已安装"
else
  echo "  ✅ PM2 已安装"
fi

# === 4. 代码部署 ===
echo ""
echo "[4/8] 代码部署..."
DEPLOY_DIR="$HOME/crypto-radar"

if [ -d "$DEPLOY_DIR" ]; then
  echo "  检测到现有部署，执行 git pull..."
  cd "$DEPLOY_DIR"
  git pull
else
  echo "  首次部署，克隆代码..."
  git clone https://github.com/timshuang/crypto-radar.git "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
fi

echo "  ✅ 代码已就绪"

# === 5. 安装依赖 ===
echo ""
echo "[5/8] 安装依赖..."
cd "$DEPLOY_DIR"
npm install --production
echo "  ✅ 依赖已安装"

# === 6. 生成 .env 文件 ===
echo ""
echo "[6/8] 生成 .env 文件..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ✅ .env 文件已生成（空值，启动后在配置页面填写）"
else
  echo "  ✅ .env 文件已存在"
fi

# === 7. PM2 配置 ===
echo ""
echo "[7/8] 配置 PM2..."

# 创建 PM2 配置文件
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'chainpulse',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
EOF

# 创建日志目录
mkdir -p logs

# 启动应用
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup | tail -1 | bash 2>/dev/null || true

echo "  ✅ PM2 已配置并启动"

# === 8. 输出访问说明 ===
echo ""
echo "======================================"
echo "✅ ChainPulse 部署完成！"
echo "======================================"
echo ""
echo "📋 访问方式："
echo ""
echo "1. SSH 隧道连接（推荐）："
echo "   在本地电脑执行："
echo "   ssh -L 3000:localhost:3000 -i ~/.ssh/id_rsa ubuntu@YOUR_VPS_IP"
echo ""
echo "2. 浏览器打开："
echo "   http://localhost:3000"
echo ""
echo "3. 在配置页面填写："
echo "   - Bark Key"
echo "   - Telegram Bot Token"
echo "   - Telegram Chat ID"
echo ""
echo "🔧 常用命令："
echo "   pm2 status          # 查看状态"
echo "   pm2 logs            # 查看日志"
echo "   pm2 restart all     # 重启服务"
echo "   pm2 stop all        # 停止服务"
echo ""
echo "📁 重要文件位置："
echo "   配置文件：$DEPLOY_DIR/config.json"
echo "   环境变量：$DEPLOY_DIR/.env"
echo "   日志文件：$DEPLOY_DIR/logs/"
echo ""
echo "======================================"
