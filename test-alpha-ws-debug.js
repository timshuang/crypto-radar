/**
 * test-alpha-ws-debug.js - 调试 Alpha WebSocket 连接
 */

const WebSocket = require('ws');

async function testAlphaWebSocket(alphaId) {
  const tokenNum = alphaId.replace('ALPHA_', '');
  const streamName = `alpha_${tokenNum}usdt@aggTrade`;
  const wsUrl = 'wss://nbstream.binance.com/w3w/wsa/stream';
  
  console.log(`\n测试 Alpha WebSocket:`);
  console.log(`  alphaId: ${alphaId}`);
  console.log(`  streamName: ${streamName}`);
  console.log(`  wsUrl: ${wsUrl}`);
  
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let messageCount = 0;
    
    const timeout = setTimeout(() => {
      console.log(`\n❌ 超时：10 秒内未收到足够数据`);
      console.log(`   收到消息数：${messageCount}`);
      ws.close();
      resolve(false);
    }, 10000);
    
    ws.on('open', () => {
      console.log(`\n✅ WebSocket 连接成功`);
      
      // 发送订阅消息
      const subscribeMsg = {
        method: 'SUBSCRIBE',
        params: [streamName],
        id: Date.now()
      };
      ws.send(JSON.stringify(subscribeMsg));
      console.log(`   已发送订阅：${JSON.stringify(subscribeMsg)}`);
    });
    
    ws.on('message', (data) => {
      messageCount++;
      const msg = JSON.parse(data.toString());
      
      if (messageCount <= 3) {
        console.log(`\n📨 收到消息 #${messageCount}:`);
        console.log(`   类型：${msg.e || msg.type || 'unknown'}`);
        console.log(`   数据：${JSON.stringify(msg).substring(0, 200)}`);
      }
      
      // 检查是否是 aggTrade 消息
      if (msg.e === 'aggTrade') {
        console.log(`\n✅ 收到 aggTrade 数据:`);
        console.log(`   符号：${msg.s}`);
        console.log(`   价格：${msg.p}`);
        console.log(`   数量：${msg.q}`);
        console.log(`   时间：${msg.T || msg.E}`);
        
        if (messageCount >= 5) {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        }
      }
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`\n❌ WebSocket 错误：${err.message}`);
      resolve(false);
    });
    
    ws.on('close', () => {
      console.log(`\nWebSocket 连接已关闭`);
    });
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('🦞 Alpha WebSocket 调试测试');
  console.log('='.repeat(60));
  
  const alphaIds = ['ALPHA_495', 'ALPHA_804', 'ALPHA_173'];
  
  for (const alphaId of alphaIds) {
    const success = await testAlphaWebSocket(alphaId);
    if (success) {
      console.log(`\n✅ ${alphaId} 测试成功！`);
      break;
    } else {
      console.log(`\n❌ ${alphaId} 测试失败`);
    }
    
    // 等待 2 秒再测试下一个
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('测试完成');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
