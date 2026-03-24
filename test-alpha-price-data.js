/**
 * test-alpha-price-data.js - 检查 Alpha 币种价格数据
 */

const storage = require('./src/storage');
const path = require('path');

async function test() {
  console.log('=== 检查 Alpha 币种价格数据 ===\n');
  
  // 初始化存储
  storage.dataDir = path.join(__dirname);
  await storage.init();
  
  console.log(`总币种数：${storage.priceBuffers.size} 个\n`);
  
  // 检查 Alpha 币种（key 以 0x 开头）
  let alphaCount = 0;
  let spotCount = 0;
  
  for (const [key, buffer] of storage.priceBuffers.entries()) {
    const latest = buffer.getLatest();
    if (!latest) continue;
    
    if (key.startsWith('0x')) {
      // Alpha 币种
      const symbol = storage.getSymbolForCa(key);
      if (alphaCount < 10) {
        console.log(`Alpha: ${symbol || 'unknown'} - key: ${key} - price: ${latest.price}`);
      }
      alphaCount++;
    } else if (!key.includes('USDT')) {
      // 可能是现货币种
      spotCount++;
    }
  }
  
  console.log(`\nAlpha 币种：${alphaCount} 个`);
  console.log(`现货币种：${spotCount} 个`);
  
  // 检查 symbolMapping
  console.log(`\nsymbolMapping: ${storage.symbolMapping.size} 个`);
  console.log(`reverseSymbolMapping: ${storage.reverseSymbolMapping.size} 个`);
  
  if (storage.symbolMapping.size > 0) {
    console.log('\n前 10 个 symbol -> ca 映射:');
    let count = 0;
    for (const [symbol, ca] of storage.symbolMapping.entries()) {
      if (count >= 10) break;
      console.log(`  ${symbol} -> ${ca}`);
      count++;
    }
  }
}

test().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
