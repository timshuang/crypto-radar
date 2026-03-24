/**
 * test-volatility-alpha.js - 测试波动侦测 Alpha 币种数据流
 * 
 * 验证点：
 * 1. wsConnector.symbolCache 是否正确填充
 * 2. volatilityEngine 是否能获取 Alpha 币种列表
 * 3. 全量模式下 Alpha 币种是否有价格数据
 */

const path = require('path');
const storage = require('./src/storage');
const WSConnector = require('./src/ws-connector');
const { VolatilityMonitor } = require('./src/monitors');

// 模拟 configManager
const mockConfigManager = {
  config: {
    volatilityModule: {
      enabled: true,
      scope: 'global',
      windowMinutes: 5,
      thresholdPercent: 20
    }
  },
  getSettings: () => ({
    checkIntervalMinutes: 1,
    alertSilenceMinutes: 5
  }),
  isSystemEnabled: () => true
};

async function test() {
  console.log('=== 波动侦测 Alpha 币种测试 ===\n');
  
  // 1. 初始化存储
  console.log('1. 初始化存储...');
  storage.dataDir = path.join(__dirname);
  await storage.init();
  
  // 2. 初始化 WebSocket 连接器
  console.log('2. 初始化 WebSocket 连接器...');
  const wsConnector = new WSConnector(storage);
  
  // 3. 初始化波动侦测监控器
  console.log('3. 初始化波动侦测监控器...');
  const volatilityMonitor = new VolatilityMonitor(storage);
  
  // 4. 连接 Alpha 全量推送
  console.log('4. 连接 Alpha 全量推送...');
  wsConnector.setVolatilityMode('global');
  wsConnector.connectVolatilityAlpha([]);
  
  // 等待连接建立
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 检查连接状态
  const stats = wsConnector.getStats();
  console.log('   连接统计:', JSON.stringify(stats, null, 2));
  
  // 5. 等待数据流入（等待 20 秒，让 symbolCache 填充）
  console.log('5. 等待数据流入（20 秒）...');
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`   ${i + 1}/10: symbolCache = ${wsConnector.symbolCache.size} 个`);
    if (wsConnector.symbolCache.size > 100) break;  // 超过 100 个就提前结束
  }
  
  // 6. 检查 symbolCache
  console.log('\n6. 检查 symbolCache:');
  console.log(`   symbolCache 大小：${wsConnector.symbolCache.size} 个`);
  
  if (wsConnector.symbolCache.size > 0) {
    console.log('   前 10 个 Alpha 币种:');
    let count = 0;
    for (const [ca, symbol] of wsConnector.symbolCache.entries()) {
      if (count >= 10) break;
      console.log(`     - ${symbol} (ca: ${ca})`);
      count++;
    }
  }
  
  // 7. 检查价格缓冲区
  console.log('\n7. 检查价格缓冲区:');
  let alphaPriceCount = 0;
  for (const [key, buffer] of storage.priceBuffers.entries()) {
    // 检查是否是 Alpha 币种（key 是 ca 格式）
    if (key.startsWith('0x')) {
      const symbol = storage.getSymbolForCa(key);
      const latest = buffer.getLatest();
      if (latest && alphaPriceCount < 5) {
        console.log(`   - ${symbol}: ${latest.price} (key: ${key})`);
        alphaPriceCount++;
      }
    }
  }
  console.log(`   总计：${storage.priceBuffers.size} 个币种有价格数据`);
  
  // 8. 测试 _getAlphaSymbols
  console.log('\n8. 测试 VolatilityEngine._getAlphaSymbols():');
  const VolatilityEngine = require('./src/volatility-engine');
  
  // 模拟 alertService
  const mockAlertService = {
    sendTextToTelegram: async () => {},
    processFailedQueue: async () => {}
  };
  
  const volatilityEngine = new VolatilityEngine(
    mockConfigManager,
    storage,
    mockAlertService,
    volatilityMonitor,
    wsConnector  // 注入 wsConnector
  );
  
  const alphaSymbols = await volatilityEngine._getAlphaSymbols();
  console.log(`   Alpha 币种数量：${alphaSymbols.length} 个`);
  if (alphaSymbols.length > 0) {
    console.log('   前 10 个 Alpha 币种:');
    alphaSymbols.slice(0, 10).forEach(symbol => {
      console.log(`     - ${symbol}`);
    });
  }
  
  // 9. 验证结果
  console.log('\n=== 测试结果 ===');
  if (wsConnector.symbolCache.size > 0 && alphaSymbols.length > 0) {
    console.log('✅ PASS: Alpha 数据流正常');
    console.log(`   - symbolCache: ${wsConnector.symbolCache.size} 个`);
    console.log(`   - _getAlphaSymbols: ${alphaSymbols.length} 个`);
  } else {
    console.log('❌ FAIL: Alpha 数据流异常');
    console.log(`   - symbolCache: ${wsConnector.symbolCache.size} 个`);
    console.log(`   - _getAlphaSymbols: ${alphaSymbols.length} 个`);
  }
  
  // 清理
  wsConnector.disconnectAll();
  process.exit(wsConnector.symbolCache.size > 0 && alphaSymbols.length > 0 ? 0 : 1);
}

test().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
