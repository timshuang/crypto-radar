/**
 * crypto_radar - Web3 双轨行情雷达系统
 * 
 * 主程序入口
 * 
 * 功能：
 * - WebSocket 接入币安现货 + Alpha
 * - 双轨逻辑：价格目标线 + 波动侦测线
 * - 滑动窗口计算（1 分钟全量检查）
 * - 告警抑制（5 分钟静默期）
 * - Bark API 推送（分级：default / critical）
 * 
 * 目标环境：1C/512MB RAM
 */

// 加载环境变量（必须在最前面）
require('dotenv').config();

const path = require('path');
const configManager = require('./config');
const storage = require('./storage');
const AlertService = require('./alert-service');
const NotificationService = require('./notification/notification-service');
const WSConnector = require('./ws-connector');
const { TargetMonitor, VolatilityMonitor } = require('./monitors');
const CheckerEngine = require('./checker-engine');
const VolatilityEngine = require('./volatility-engine');
const SystemMonitor = require('./monitor');
const WebServer = require('./web-server');

// 全局状态
class AppState {
  constructor() {
    this.configManager = null;
    this.storage = null;
    this.alertService = null;
    this.wsConnector = null;
    this.targetMonitor = null;
    this.volatilityMonitor = null;
    this.checkerEngine = null;
    this.volatilityEngine = null;
    this.systemMonitor = null;
    this.webServer = null;
    
    this.isRunning = false;
  }
}

const app = new AppState();

/**
 * 初始化应用
 */
async function init() {
  console.log('='.repeat(60));
  console.log('🦐 crypto_radar - Web3 双轨行情雷达系统');
  console.log('='.repeat(60));
  console.log(`启动时间：${new Date().toISOString()}`);
  console.log(`Node.js 版本：${process.version}`);
  console.log(`内存限制：${process.env.NODE_OPTIONS || '默认'}`);
  console.log('='.repeat(60));
  
  try {
    // 1. 加载配置
    console.log('\n[Init] 加载配置...');
    app.configManager = configManager;
    await app.configManager.load();
    
    const barkConfig = app.configManager.getBarkConfig();
    const settings = app.configManager.getSettings();
    
    // 2. 初始化存储
    console.log('[Init] 初始化存储...');
    app.storage = storage;
    await app.storage.init(settings.maxPriceRecordsPerSymbol);
    
    // 3. 初始化通知服务
    console.log('[Init] 初始化通知服务...');
    app.notificationService = new NotificationService(app.configManager);
    
    // 4. 初始化告警服务
    console.log('[Init] 初始化告警服务...');
    app.alertService = new AlertService(barkConfig, app.configManager, app.notificationService);
    
    // 绑定 WebSocket 服务器（稍后初始化）
    // 在 Web 服务器启动后绑定
    
    // 4. 初始化 WebSocket 连接器
    console.log('[Init] 初始化 WebSocket 连接...');
    app.wsConnector = new WSConnector(app.storage);
    
    // 5. 初始化监控器
    console.log('[Init] 初始化监控器...');
    app.targetMonitor = new TargetMonitor(app.storage, app.alertService, app.configManager);
    app.volatilityMonitor = new VolatilityMonitor(app.storage, app.alertService);
    
    // 6. 初始化检查引擎（只负责价格目标监控）
    console.log('[Init] 初始化检查引擎...');
    app.checkerEngine = new CheckerEngine(
      app.configManager,
      app.storage,
      app.alertService,
      app.targetMonitor,
      app.volatilityMonitor
    );
    
    // 6b. 初始化波动侦测引擎（独立运行）
    console.log('[Init] 初始化波动侦测引擎...');
    app.volatilityEngine = new VolatilityEngine(
      app.configManager,
      app.storage,
      app.alertService,
      app.volatilityMonitor
    );
    
    // 7. 初始化系统监控
    console.log('[Init] 初始化系统监控...');
    app.systemMonitor = new SystemMonitor(app.wsConnector, app.storage);
    
    // 8. 初始化 Web 服务器
    console.log('[Init] 初始化 Web 服务器...');
    app.webServer = new WebServer({
      port: process.env.WEB_PORT || 3000,
      apiToken: process.env.API_TOKEN || 'crypto_radar_token_2024'
    });
    app.webServer.bind(app.configManager, app.storage, app, app.notificationService);
    
    // 9. 监听配置变更事件（用于动态添加币种）
    console.log('[Init] 监听配置变更...');
    app.configManager.on('configChanged', (newConfig) => {
      handleConfigChange(newConfig);
    });
    
    console.log('\n[Init] 初始化完成 ✓');
    return true;
    
  } catch (err) {
    console.error(`\n[Init] 初始化失败：${err.message}`);
    console.error(err.stack);
    return false;
  }
}

/**
 * 启动应用
 */
async function start() {
  if (app.isRunning) {
    console.warn('[Start] 应用已在运行中');
    return;
  }
  
  console.log('\n[Start] 启动应用...');
  
  try {
    const settings = app.configManager.getSettings();
    const symbols = app.configManager.getEnabledSymbols();
    
    if (symbols.length === 0) {
      console.warn('[Start] ⚠️ 没有启用的币种，请配置 config.json');
    }
    
    console.log(`[Start] 启用币种：${symbols.map(s => s.symbol).join(', ')}`);
    
    // 1. 连接 WebSocket（根据 scope 选择模式）
    console.log('[Start] 连接 WebSocket...');
    const allSymbols = app.configManager.config.symbols || [];
    const volatilityConfig = app.configManager.config.volatilityModule || {};
    
    // 分离现货和 Alpha 币种
    const enabledSymbols = allSymbols.filter(s => s.enabled);
    const spotSymbols = allSymbols
      .filter(s => s.source === 'spot')
      .map(s => s.symbol);
    
    const alphaTokens = allSymbols
      .filter(s => s.source === 'alpha')
      .map(s => ({
        symbol: s.symbol,
        ca: s.ca,
        alphaId: s.alphaId
      }));
    
    // 1a. 价格监控组合流（enabled: true 的币种）
    const enabledSpotSymbols = enabledSymbols
      .filter(s => s.source === 'spot')
      .map(s => s.symbol);
    
    const enabledAlphaTokens = enabledSymbols
      .filter(s => s.source === 'alpha')
      .map(s => ({
        symbol: s.symbol,
        ca: s.ca,
        alphaId: s.alphaId
      }));
    
    if (enabledSpotSymbols.length > 0) {
      app.wsConnector.connectPriceMonitorSpot(enabledSpotSymbols);
    }
    if (enabledAlphaTokens.length > 0) {
      app.wsConnector.connectPriceMonitorAlpha(enabledAlphaTokens);
    }
    
    // 1b. 波动侦测（根据 scope 选择模式）
    if (volatilityConfig.enabled) {
      const scope = volatilityConfig.scope || 'added';
      app.wsConnector.setVolatilityMode(scope);
      
      if (scope === 'global') {
        // 全量推送模式
        console.log('[Start] 波动侦测：全量推送模式');
        app.wsConnector.connectVolatilitySpot([]);
        app.wsConnector.connectVolatilityAlpha([]);
      } else {
        // 监控列表模式（组合流）
        console.log('[Start] 波动侦测：监控列表组合流模式');
        if (spotSymbols.length > 0) {
          app.wsConnector.connectVolatilitySpot(spotSymbols);
        }
        if (alphaTokens.length > 0) {
          app.wsConnector.connectVolatilityAlpha(alphaTokens);
        }
      }
    } else {
      console.log('[Start] 波动侦测：未启用');
    }
    
    // 等待 WS 连接建立
    console.log('[Start] 等待 WebSocket 连接建立...');
    await sleep(3000);
    
    // 2. 初始化波动监控状态（波动侦测独立于价格监控，初始化所有币种）
    console.log('[Start] 初始化波动监控...');
    const configSymbols = app.configManager.config.symbols || [];
    configSymbols.forEach(s => {
      app.volatilityMonitor.init(s.symbol, s.volatility);
    });
    
    // 2b. 启动波动侦测引擎（如果启用）
    if (volatilityConfig.enabled) {
      console.log('[Start] 启动波动侦测引擎...');
      app.volatilityEngine.start();
    } else {
      console.log('[Start] 波动侦测未启用，跳过');
    }
    
    // 3. 启动系统监控
    console.log('[Start] 启动系统监控...');
    app.systemMonitor.start();
    
    // 4. 启动 Web 服务器（优先启动以绑定 WebSocket）
    console.log('[Start] 启动 Web 服务器...');
    await app.webServer.start();
    
    // 5. 绑定 WebSocket 服务器到告警服务
    if (app.webServer.wsServer) {
      app.alertService.bindWebSocket(app.webServer);
    }
    
    // 6. 启动检查引擎
    console.log('[Start] 启动检查引擎...');
    app.checkerEngine.start();
    
    // 7. 启动存储定期清理
    console.log('[Start] 启动数据清理...');
    app.storage.startCleanup(5);
    
    // 8. 持久化价格历史（定期）
    setInterval(() => {
      app.storage.persistPriceHistory();
    }, 60000); // 每 1 分钟
    
    app.isRunning = true;
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ 应用启动成功！');
    const wsStats = app.wsConnector?.getStats() || {};
    console.log(`波动模式：${wsStats.volatilityMode || 'N/A'}`);
    console.log(`WebSocket 连接：${wsStats.totalConnections || 0} 个 (最多 6 个)`);
    for (const [name, conn] of Object.entries(wsStats.connections || {})) {
      console.log(`  - ${name}: ${conn.connected ? '✅' : '❌'} (${conn.type})`);
    }
    console.log(`价格监控现货：${wsStats.priceMonitorSpotSymbols || 0} 个币种`);
    console.log(`价格监控 Alpha: ${wsStats.priceMonitorAlphaTokens || 0} 个代币`);
    console.log(`符号缓存：${wsStats.symbolCacheSize || 0} 个 (全量推送时动态建立)`);
    console.log(`价格监控币种：${enabledSymbols.length} 个 (enabled: true)`);
    console.log(`检查间隔：${settings.checkIntervalMinutes} 分钟`);
    console.log(`静默期：${settings.alertSilenceMinutes} 分钟`);
    console.log(`最大价格记录：${settings.maxPriceRecordsPerSymbol} 条/币种`);
    console.log('='.repeat(60));
    
    // 打印初始状态
    printStatus();
    
  } catch (err) {
    console.error(`\n[Start] 启动失败：${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

/**
 * 停止应用
 */
async function stop() {
  if (!app.isRunning) {
    console.warn('[Stop] 应用未运行');
    return;
  }
  
  console.log('\n[Stop] 停止应用...');
  
  // 1. 停止检查引擎
  app.checkerEngine?.stop();
  
  // 1b. 停止波动侦测引擎
  if (app.volatilityEngine) {
    app.volatilityEngine.stop();
  }
  
  // 2. 停止系统监控
  app.systemMonitor?.stop();
  
  // 3. 断开 WebSocket 连接
  app.wsConnector?.disconnectAll();
  
  // 4. 停止 Web 服务器
  await app.webServer?.stop();
  
  // 5. 持久化数据
  console.log('[Stop] 持久化数据...');
  await app.storage.persistPriceHistory();
  await app.storage.alertStateStore.save();
  
  app.isRunning = false;
  
  console.log('[Stop] 应用已停止 ✓');
}

/**
 * 处理配置变更（动态添加币种）
 */
async function handleConfigChange(newConfig) {
  if (!app.isRunning) {
    console.log('[ConfigChange] 应用未运行，跳过');
    return;
  }
  
  const newSymbols = newConfig.symbols || [];
  const volatilityConfig = newConfig.volatilityModule || {};
  
  console.log('[ConfigChange] 检测到配置变更，重新连接 WebSocket...');
  
  // 分离现货和 Alpha 币种
  const enabledSymbols = newSymbols.filter(s => s.enabled);
  const spotSymbols = newSymbols
    .filter(s => s.source === 'spot')
    .map(s => s.symbol);
  
  const alphaTokens = newSymbols
    .filter(s => s.source === 'alpha')
    .map(s => ({
      symbol: s.symbol,
      ca: s.ca,
      alphaId: s.alphaId
    }));
  
  // 1. 价格监控组合流（enabled: true 的币种）
  const enabledSpotSymbols = enabledSymbols
    .filter(s => s.source === 'spot')
    .map(s => s.symbol);
  
  const enabledAlphaTokens = enabledSymbols
    .filter(s => s.source === 'alpha')
    .map(s => ({
      symbol: s.symbol,
      ca: s.ca,
      alphaId: s.alphaId
    }));
  
  // 重新连接价格监控
  app.wsConnector.disconnect('priceMonitorSpot');
  app.wsConnector.disconnect('priceMonitorAlpha');
  
  if (enabledSpotSymbols.length > 0) {
    app.wsConnector.connectPriceMonitorSpot(enabledSpotSymbols);
  }
  if (enabledAlphaTokens.length > 0) {
    app.wsConnector.connectPriceMonitorAlpha(enabledAlphaTokens);
  }
  
  // 2. 波动侦测（根据 scope 选择模式）
  if (volatilityConfig.enabled) {
    const scope = volatilityConfig.scope || 'added';
    const oldMode = app.wsConnector.volatilityMode;
    
    if (scope !== oldMode) {
      console.log(`[ConfigChange] 波动模式变更：${oldMode} -> ${scope}`);
      app.wsConnector.setVolatilityMode(scope);
      
      // 重新连接波动侦测
      app.wsConnector.disconnect('volatilitySpot');
      app.wsConnector.disconnect('volatilityAlpha');
      
      if (scope === 'global') {
        console.log('[ConfigChange] 波动侦测：全量推送模式');
        app.wsConnector.connectVolatilitySpot([]);
        app.wsConnector.connectVolatilityAlpha([]);
      } else {
        console.log('[ConfigChange] 波动侦测：监控列表组合流模式');
        if (spotSymbols.length > 0) {
          app.wsConnector.connectVolatilitySpot(spotSymbols);
        }
        if (alphaTokens.length > 0) {
          app.wsConnector.connectVolatilityAlpha(alphaTokens);
        }
      }
    } else {
      // 模式未变，只更新订阅列表
      console.log('[ConfigChange] 波动模式未变，更新订阅列表');
      if (scope === 'global') {
        // 全量推送不需要重新连接
      } else {
        app.wsConnector.disconnect('volatilitySpot');
        app.wsConnector.disconnect('volatilityAlpha');
        
        if (spotSymbols.length > 0) {
          app.wsConnector.connectVolatilitySpot(spotSymbols);
        }
        if (alphaTokens.length > 0) {
          app.wsConnector.connectVolatilityAlpha(alphaTokens);
        }
      }
    }
  }
  
  // 为所有币种初始化波动监控
  newSymbols.forEach(s => {
    app.volatilityMonitor?.init(s.symbol, s.volatility);
  });
  
  // 等待连接建立
  console.log('[ConfigChange] 等待 WebSocket 连接建立...');
  await sleep(3000);
  
  console.log('[ConfigChange] 配置变更处理完成 ✓');
}

/**
 * 打印状态
 */
function printStatus() {
  const wsStats = app.wsConnector?.getStats() || {};
  const checkerStats = app.checkerEngine?.getStats() || {};
  const monitorStats = app.systemMonitor?.getStats() || {};
  
  console.log('\n--- 系统状态 ---');
  console.log(`运行状态：${app.isRunning ? '运行中' : '已停止'}`);
  console.log(`波动模式：${wsStats.volatilityMode || 'N/A'}`);
  console.log(`WebSocket 连接：${wsStats.totalConnections || 0} 个`);
  for (const [name, conn] of Object.entries(wsStats.connections || {})) {
    console.log(`  - ${name}: ${conn.connected ? '✅' : '❌'} (${conn.type})`);
  }
  console.log(`检查次数：${checkerStats.checkCount}`);
  console.log(`内存使用：${monitorStats.memory?.heapUsed?.toFixed(2) || 'N/A'}MB`);
  console.log(`运行时长：${formatUptime(monitorStats.uptime || 0)}`);
  console.log('----------------\n');
}

/**
 * 格式化运行时长
 */
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hours}h ${minutes}m ${secs}s`;
}

/**
 * 睡眠工具
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 等待 WebSocket 连接建立
 * @param {WSConnector} wsConnector - WS 连接器
 * @param {number} expectedCount - 期望的连接数
 * @param {number} timeoutMs - 超时时间（毫秒）
 */
async function waitForConnections(wsConnector, expectedCount, timeoutMs = 10000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const stats = wsConnector.getStats();
    const connectedCount = Object.values(stats).filter(s => s.connected).length;
    
    if (connectedCount >= expectedCount) {
      console.log(`[Start] WebSocket 连接已建立：${connectedCount}/${expectedCount}`);
      return true;
    }
    
    console.log(`[Start] 等待中... ${connectedCount}/${expectedCount} 连接已建立`);
    await sleep(500);
  }
  
  console.warn(`[Start] ⚠️ 等待 WebSocket 连接超时，继续启动`);
  return false;
}

/**
 * 优雅关闭处理
 */
function setupGracefulShutdown() {
  const shutdown = async (signal) => {
    console.log(`\n[Shutdown] 收到信号 ${signal}，准备关闭...`);
    await stop();
    process.exit(0);
  };
  
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // 未捕获异常处理
  process.on('uncaughtException', (err) => {
    console.error('\n[Error] 未捕获异常:', err.message);
    console.error(err.stack);
  });
  
  // 未处理的 Promise 拒绝
  process.on('unhandledRejection', (reason, promise) => {
    console.error('\n[Error] 未处理的 Promise 拒绝:', reason);
  });
}

/**
 * 主函数
 */
async function main() {
  // 设置优雅关闭
  setupGracefulShutdown();
  
  // 初始化
  const initSuccess = await init();
  if (!initSuccess) {
    console.error('[Main] 初始化失败，退出');
    process.exit(1);
  }
  
  // 启动
  await start();
  
  // 定期打印状态（每 10 分钟）
  setInterval(() => {
    printStatus();
  }, 10 * 60 * 1000);
}

// 启动应用
main().catch(err => {
  console.error('[Main] 启动失败:', err);
  process.exit(1);
});

// 导出用于测试
module.exports = { init, start, stop, app };
