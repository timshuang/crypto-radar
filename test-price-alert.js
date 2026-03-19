/**
 * 测试网页弹窗报警功能
 * 
 * 用法：node test-price-alert.js
 */

const fs = require('fs').promises;
const path = require('path');

async function testPriceAlert() {
  console.log('🧪 测试网页弹窗报警功能\n');
  
  // 1. 读取当前配置
  const configPath = path.join(__dirname, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  
  console.log('📋 当前配置的币种:');
  config.symbols.forEach(s => {
    console.log(`  - ${s.symbol} (来源：${s.source})`);
    if (s.targets && s.targets.length > 0) {
      s.targets.forEach(t => {
        console.log(`    目标：${t.type === 'above' ? '上破' : '下破'} $${t.price} (${t.enabled ? '启用' : '禁用'})`);
      });
    }
  });
  
  // 2. 为 BTCUSDT 添加一个测试目标（当前价格约 73800，设置上破 74000）
  const btcSymbol = config.symbols.find(s => s.symbol === 'BTCUSDT');
  if (btcSymbol) {
    // 添加测试目标
    btcSymbol.targets = btcSymbol.targets || [];
    btcSymbol.targets.push({
      id: `target_${Date.now()}`,
      type: 'above',
      price: 74000,
      enabled: true,
      status: 'waiting'
    });
    
    console.log('\n✅ 已添加测试目标：BTCUSDT 上破 $74000');
  }
  
  // 3. 保存配置
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('💾 配置已保存');
  
  // 4. 等待配置热加载（约 2 秒）
  console.log('\n⏳ 等待配置热加载...');
  await sleep(2000);
  
  // 5. 提示用户检查
  console.log('\n' + '='.repeat(60));
  console.log('📋 测试步骤:');
  console.log('1. 打开浏览器访问：http://localhost:3001');
  console.log('2. 允许浏览器通知权限（如果弹出提示）');
  console.log('3. 等待价格更新或手动修改目标价格为当前价格以下');
  console.log('4. 检查是否弹出报警窗口');
  console.log('5. 检查报警历史页面是否有记录');
  console.log('='.repeat(60));
  
  console.log('\n💡 提示：如果要立即触发测试，可以将目标价格设置为低于当前价格');
  console.log('   当前 BTC 价格约 $73800，可以设置目标为 $73000 上破');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

testPriceAlert().catch(console.error);
