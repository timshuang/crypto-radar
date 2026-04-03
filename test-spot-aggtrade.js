/**
 * 快速测试：现货 @aggTrade 格式验证
 */

const WebSocket = require('ws');

const ws = new WebSocket('wss://stream.binance.com:9443/stream');

ws.on('open', () => {
  console.log('✅ 现货 WebSocket 已连接');
  
  // 订阅 BTCUSDT 和 ETHUSDT 的 @aggTrade
  ws.send(JSON.stringify({
    method: 'SUBSCRIBE',
    params: ['btcusdt@aggTrade', 'ethusdt@aggTrade'],
    id: Date.now()
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  
  if (msg.id !== undefined) {
    console.log('📋 订阅确认:', JSON.stringify(msg));
    return;
  }
  
  console.log('✅ 收到数据:');
  console.log(JSON.stringify(msg, null, 2));
  
  // 收到第一条数据就退出
  ws.close();
  process.exit(0);
});

ws.on('error', (err) => {
  console.log('❌ 错误:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('🔌 连接关闭');
});

// 10 秒超时
setTimeout(() => {
  console.log('❌ 超时');
  ws.close();
  process.exit(1);
}, 10000);
