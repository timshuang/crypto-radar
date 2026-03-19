/**
 * test-cys-ws.js - 长时间测试 CYS WebSocket
 */

const WebSocket = require('ws');

async function testCYSWebSocket() {
  const streamName = 'alpha_495usdt@aggTrade';
  const wsUrl = 'wss://nbstream.binance.com/w3w/wsa/stream';
  
  console.log('='.repeat(60));
  console.log('🦞 CYS (ALPHA_495) WebSocket 长时间测试');
  console.log('='.repeat(60));
  console.log(`streamName: ${streamName}`);
  console.log(`wsUrl: ${wsUrl}`);
  console.log('等待 30 秒观察数据...\n');
  
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let messageCount = 0;
    let tradeCount = 0;
    
    const timeout = setTimeout(() => {
      console.log('\n' + '='.repeat(60));
      console.log(`测试结果:`);
      console.log(`  总消息数：${messageCount}`);
      console.log(`  交易消息数：${tradeCount}`);
      if (tradeCount === 0) {
        console.log(`\n❌ CYS 没有交易数据返回`);
        console.log(`可能原因:`);
        console.log(`  1. CYS 在 Alpha 平台没有活跃交易`);
        console.log(`  2. 流名称格式不正确`);
        console.log(`  3. 需要使用 HTTP API 轮询作为备选方案`);
      } else {
        console.log(`\n✅ CYS 有交易数据！`);
      }
      console.log('='.repeat(60));
      ws.close();
      resolve(tradeCount > 0);
    }, 30000);
    
    ws.on('open', () => {
      console.log('✅ WebSocket 连接成功');
      
      const subscribeMsg = {
        method: 'SUBSCRIBE',
        params: [streamName],
        id: Date.now()
      };
      ws.send(JSON.stringify(subscribeMsg));
      console.log(`   已发送订阅：${JSON.stringify(subscribeMsg)}\n`);
    });
    
    ws.on('message', (data) => {
      messageCount++;
      const msg = JSON.parse(data.toString());
      
      // 订阅响应
      if (msg.id && !msg.data) {
        console.log(`📨 订阅确认：id=${msg.id}`);
        return;
      }
      
      // 交易数据
      if (msg.data && msg.data.e === 'aggTrade') {
        tradeCount++;
        const trade = msg.data;
        console.log(`📊 交易 #${tradeCount}: price=${trade.p}, qty=${trade.q}, time=${new Date(trade.T).toISOString()}`);
      } else {
        console.log(`📨 其他消息：${JSON.stringify(msg).substring(0, 150)}`);
      }
    });
    
    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`\n❌ WebSocket 错误：${err.message}`);
      resolve(false);
    });
    
    ws.on('close', () => {
      console.log('WebSocket 连接已关闭');
    });
  });
}

testCYSWebSocket().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
