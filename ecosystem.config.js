/**
 * ecosystem.config.js - PM2 配置文件
 * 
 * 针对 1C/512MB RAM 环境优化
 */

module.exports = {
  apps: [{
    name: 'crypto_radar',
    script: './src/index.js',
    cwd: __dirname,
    
    // 实例配置
    instances: 1,              // 单实例（内存受限）
    exec_mode: 'fork',         // fork 模式（非 cluster）
    
    // 内存管理 - 关键配置
    max_memory_restart: '450M', // 超过 450MB 自动重启（含 Web UI）
    node_args: [
      '--max-old-space-size=450',  // 限制堆内存为 450MB
      '--expose-gc'                 // 允许手动 GC
    ],
    
    // 环境变量
    env: {
      NODE_ENV: 'production',
      CONFIG_PATH: './config.json'
    },
    
    // 日志配置
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    log_file: './logs/app.log',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    
    // 重启策略
    autorestart: true,
    watch: false,              // 生产环境禁用 watch
    max_restarts: 10,
    min_uptime: '60s',         // 60 秒内崩溃算失败
    
    // 优雅关闭
    kill_timeout: 5000,        // 5 秒超时
    wait_ready: true,          // 等待 ready 信号
    listen_timeout: 5000,      // 启动超时
    
    // 重启间隔
    restart_delay: 3000        // 重启间隔 3 秒
  }]
};
