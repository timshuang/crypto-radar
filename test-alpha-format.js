/**
 * test-alpha-format.js - 测试 Alpha 代币格式
 * 
 * 用途：
 * - 验证 Alpha 代币格式是否正确
 * - 测试 WebSocket 连接
 * - 测试 API 调用
 */

const WebSocket = require('ws');

// 测试 Alpha 代币格式
function testAlphaFormat() {
  console.log('='.repeat(60));
  console.log('测试 Alpha 代币格式');
  console.log('='.repeat(60));
  
  const testCases = [
    { symbol: 'ALPHA_173USDT', expected: true, desc: '正确的 Alpha 格式' },
    { symbol: 'ALPHA_174USDT', expected: true, desc: '正确的 Alpha 格式' },
    { symbol: 'BERAUSDT', expected: false, desc: '现货格式（错误）' },
    { symbol: 'PENGUUSDT', expected: false, desc: '现货格式（错误）' },
    { symbol: 'ALPHA_173BTC', expected: true, desc: 'Alpha + BTC 计价' },
  ];
  
  const alphaRegex = /^ALPHA_\d+USDT$/i;
  
  testCases.forEach(({ symbol, expected, desc }) => {
    const isValid = alphaRegex.test(symbol);
    const status = isValid === expected ? '✅' : '❌';
    console.log(`${status} ${symbol}: ${desc} - ${isValid ? '有效' : '无效'}`);
  });
  
  console.log('');
}

// 测试现货 WebSocket 连接（基准测试）
async function testSpotWebSocket() {
  console.log('='.repeat(60));
  console.log('测试现货 WebSocket 连接（基准）');
  console.log('='.repeat(60));
  
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
    
    const timeout = setTimeout(() => {
      ws.close();
      console.log('❌ 现货 WebSocket 连接超时');
      resolve(false);
    }, 10000);
    
    ws.on('open', () => {
      console.log('✅ 现货 WebSocket 连接成功');
    });
    
    ws.on('message', (data) => {
      clearTimeout(timeout);
      const msg = JSON.parse(data.toString());
      console.log(`✅ 收到现货价格数据：${msg.s} = ${msg.p}`);
      ws.close();
      resolve(true);
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`❌ 现货 WebSocket 错误：${err.message}`);
      resolve(false);
    });
  });
}

// 测试 Alpha WebSocket 连接
async function testAlphaWebSocket() {
  console.log('='.repeat(60));
  console.log('测试 Alpha WebSocket 连接');
  console.log('='.repeat(60));
  
  // 注意：Alpha WebSocket 可能需要有效的 token ID
  const testSymbols = [
    'alpha_173usdt@trade',
    'alpha_174usdt@trade',
  ];
  
  for (const stream of testSymbols) {
    console.log(`\n测试流：${stream}`);
    
    const success = await new Promise((resolve) => {
      const ws = new WebSocket('wss://ws.alpha.binance.com/ws/' + stream);
      
      const timeout = setTimeout(() => {
        ws.close();
        console.log(`❌ Alpha WebSocket 连接超时：${stream}`);
        resolve(false);
      }, 10000);
      
      ws.on('open', () => {
        console.log(`✅ Alpha WebSocket 连接成功：${stream}`);
      });
      
      ws.on('message', (data) => {
        clearTimeout(timeout);
        const msg = JSON.parse(data.toString());
        console.log(`✅ 收到 Alpha 价格数据：${JSON.stringify(msg).substring(0, 100)}...`);
        ws.close();
        resolve(true);
      });
      
      ws.on('error', (err) => {
        clearTimeout(timeout);
        console.log(`❌ Alpha WebSocket 错误：${err.message}`);
        resolve(false);
      });
    });
    
    if (success) break; // 成功后停止测试
  }
}

// 测试 Alpha API
async function testAlphaAPI() {
  console.log('='.repeat(60));
  console.log('测试 Alpha API');
  console.log('='.repeat(60));
  
  const endpoints = [
    'https://alpha.binance.com/api/v3/alpha-tokens',
    'https://alpha.binance.com/api/v3/ticker/24hr?symbol=ALPHA_173USDT',
    'https://alpha.binance.com/api/v3/exchangeInfo',
  ];
  
  for (const url of endpoints) {
    console.log(`\n测试端点：${url}`);
    
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'crypto_radar/1.0' }
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ API 响应成功：${JSON.stringify(data).substring(0, 100)}...`);
      } else {
        console.log(`❌ API 响应失败：HTTP ${response.status}`);
      }
    } catch (err) {
      console.log(`❌ API 请求错误：${err.message}`);
    }
  }
}

// 主函数
async function main() {
  console.log('\n🦐 crypto_radar - Alpha 代币格式测试\n');
  
  // 1. 测试格式
  testAlphaFormat();
  
  // 2. 测试现货 WebSocket（基准）
  await testSpotWebSocket();
  
  // 3. 测试 Alpha WebSocket
  await testAlphaWebSocket();
  
  // 4. 测试 Alpha API
  await testAlphaAPI();
  
  console.log('\n' + '='.repeat(60));
  console.log('测试完成');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
