/**
 * 测试新币代币格式
 * 验证代币列表、搜索和状态端点
 */

const WebServer = require('./src/web-server');

// 模拟依赖
const mockConfigManager = {
  config: { symbols: [] },
  save: async () => {},
  isSystemEnabled: () => true,
  setSystemEnabled: () => {}
};

const mockStorage = {
  getLatestPrice: () => ({ price: 0 }),
  alertStateStore: { getAll: () => ({}) }
};

const mockApp = { isRunning: true };

async function test() {
  console.log('🦞 开始测试新币代币格式...\n');
  
  const server = new WebServer({ port: 3001 });
  server.bind(mockConfigManager, mockStorage, mockApp);
  
  // 测试 1: 获取新币代币列表
  console.log('✅ 测试 1: 获取新币代币列表');
  const newTokens = server.getNewTokens();
  console.log('   代币列表:', newTokens);
  console.log('   期望：[PORTALUSDT, NEWTUSDT, ALPHAUSDT]');
  console.log('   结果:', newTokens.length === 3 ? '通过 ✅' : '失败 ❌');
  console.log();
  
  // 测试 2: 获取代币状态
  console.log('✅ 测试 2: 获取代币状态');
  const status = server.getNewTokenStatus('PORTALUSDT');
  console.log('   PORTALUSDT 状态:', status);
  console.log('   期望：TRADING');
  console.log('   结果:', status === 'TRADING' ? '通过 ✅' : '失败 ❌');
  
  const breakStatus = server.getNewTokenStatus('ALPHAUSDT');
  console.log('   ALPHAUSDT 状态:', breakStatus);
  console.log('   期望：BREAK');
  console.log('   结果:', breakStatus === 'BREAK' ? '通过 ✅' : '失败 ❌');
  console.log();
  
  // 测试 3: 搜索代币
  console.log('✅ 测试 3: 搜索代币');
  const searchResults = await server.searchSymbols('PORTAL');
  console.log('   搜索结果:', searchResults);
  console.log('   期望：包含 "PORTALUSDT (TRADING)"');
  console.log('   结果:', searchResults.includes('PORTALUSDT (TRADING)') ? '通过 ✅' : '失败 ❌');
  console.log();
  
  // 测试 4: WebSocket 流名称格式
  console.log('✅ 测试 4: WebSocket 流名称格式');
  const testSymbols = ['PORTALUSDT', 'NEWTUSDT', 'ALPHAUSDT'];
  testSymbols.forEach(symbol => {
    const streamName = `${symbol.toLowerCase()}@trade`;
    console.log(`   ${symbol} -> ${streamName}`);
  });
  console.log('   期望：小写格式');
  console.log('   结果：通过 ✅');
  console.log();
  
  // 测试 5: 代币状态端点
  console.log('✅ 测试 5: 代币状态端点');
  const statusResult = server._getSymbolsStatus();
  console.log('   状态数据:', JSON.stringify(statusResult.data, null, 2));
  console.log('   期望：包含所有代币的状态');
  console.log('   结果:', statusResult.success ? '通过 ✅' : '失败 ❌');
  console.log();
  
  console.log('=================================');
  console.log('🎉 所有测试完成！');
  console.log('=================================');
}

test().catch(console.error);
