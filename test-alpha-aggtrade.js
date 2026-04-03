/**
 * 测试 Alpha 代币 @aggTrade 聚合流
 * 
 * 当前使用：alpha_${id}usdt@trade
 * 待验证：${symbol}@aggTrade 或 alpha_${id}usdt@aggTrade
 */

const WebSocket = require('ws');

// 测试用的 Alpha 代币（从 config.json 读取）
const TEST_TOKENS = [
  { symbol: 'PIEVERSE', alphaId: 'ALPHA_469' },
  { symbol: 'BTW', alphaId: 'ALPHA_778' },
  { symbol: 'CYS', alphaId: 'ALPHA_495' }
];

// 测试不同的流格式
const STREAM_FORMATS = [
  // 格式 1: alpha_${id}usdt@aggTrade（文档确认的格式）
  (token) => `alpha_${token.alphaId.replace('ALPHA_', '')}usdt@aggTrade`,
  
  // 格式 2: alpha_${id}USDT@aggTrade（大写测试）
  (token) => `alpha_${token.alphaId.replace('ALPHA_', '')}USDT@aggTrade`,
  
  // 格式 3: alpha_${id}usdt@trade（当前使用的，小写）
  (token) => `alpha_${token.alphaId.replace('ALPHA_', '')}usdt@trade`,
  
  // 格式 4: alpha_${id}USDT@trade（当前使用的，大写）
  (token) => `alpha_${token.alphaId.replace('ALPHA_', '')}USDT@trade`
];

const STREAM_NAMES = [
  'alpha_${id}usdt@aggTrade（文档格式）',
  'alpha_${id}USDT@aggTrade（大写）',
  'alpha_${id}usdt@trade（当前小写）',
  'alpha_${id}USDT@trade（当前大写）'
];

async function testStreamFormat(formatIndex, streamNames) {
  return new Promise((resolve) => {
    console.log(`\n=== 测试格式 ${formatIndex + 1}: ${STREAM_NAMES[formatIndex]} ===`);
    console.log(`订阅流：${streamNames.join(', ')}`);
    
    const ws = new WebSocket('wss://nbstream.binance.com/w3w/wsa/stream');
    let messageCount = 0;
    let timeoutHandle;
    
    ws.on('open', () => {
      console.log('✅ WebSocket 已连接');
      
      // 订阅
      ws.send(JSON.stringify({
        method: 'SUBSCRIBE',
        params: streamNames,
        id: Date.now()
      }));
      
      // 10 秒超时
      timeoutHandle = setTimeout(() => {
        console.log(`❌ 超时：10 秒内未收到任何消息`);
        ws.close();
        resolve({ success: false, messages: [] });
      }, 10000);
    });
    
    ws.on('message', (data) => {
      messageCount++;
      const msg = JSON.parse(data.toString());
      
      if (messageCount === 1) {
        // 第一条可能是订阅确认
        if (msg.id !== undefined) {
          console.log('📋 订阅确认:', JSON.stringify(msg));
          return;
        }
      }
      
      // 收到数据
      clearTimeout(timeoutHandle);
      console.log('✅ 收到数据:');
      console.log(JSON.stringify(msg, null, 2));
      
      ws.close();
      resolve({ success: true, message: msg });
    });
    
    ws.on('error', (err) => {
      console.log(`❌ 错误：${err.message}`);
      clearTimeout(timeoutHandle);
      ws.close();
      resolve({ success: false, error: err.message });
    });
    
    ws.on('close', () => {
      console.log('🔌 连接已关闭');
    });
  });
}

async function runTests() {
  console.log('🧪 Alpha @aggTrade 流格式测试\n');
  console.log('测试代币:', TEST_TOKENS.map(t => t.symbol).join(', '));
  
  for (let i = 0; i < STREAM_FORMATS.length; i++) {
    const streamNames = TEST_TOKENS.map(token => STREAM_FORMATS[i](token));
    
    try {
      const result = await testStreamFormat(i, streamNames);
      
      if (result.success) {
        console.log(`\n✅ 格式 ${i + 1} 有效！`);
        console.log('========================================\n');
        return { formatIndex: i, formatName: STREAM_NAMES[i], result };
      } else {
        console.log(`\n❌ 格式 ${i + 1} 无效\n`);
      }
    } catch (err) {
      console.log(`\n❌ 格式 ${i + 1} 测试异常：${err.message}\n`);
    }
    
    // 等待 2 秒再测试下一个
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n❌ 所有格式测试失败');
  return null;
}

// 运行测试
runTests()
  .then(result => {
    if (result) {
      console.log('\n========== 测试结论 ==========');
      console.log(`✅ 可用格式：${result.formatName}`);
      console.log(`索引：${result.formatIndex}`);
      process.exit(0);
    } else {
      console.log('\n========== 测试结论 ==========');
      console.log('❌ 没有发现可用的 @aggTrade 格式');
      console.log('建议：继续使用当前的 @trade 流');
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('测试异常:', err);
    process.exit(1);
  });
