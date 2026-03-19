/**
 * Test script for Bark notification validation and optimization
 * 
 * Tests:
 * 1. Frontend validation (simulated)
 * 2. Message format (extreme minimal)
 * 3. URL building (normal and critical modes)
 * 4. Switch state check
 */

const Templater = require('./src/notification/templater');
const BarkSender = require('./src/notification/bark-sender');
const NotificationService = require('./src/notification/notification-service');

console.log('🦐 Bark 通知校验和优化 - 测试脚本\n');

// ==================== Test 1: Message Format ====================
console.log('=== 测试 1: 推送内容格式（极致极简）===\n');

const templater = new Templater();

// Test case 1: Spot price alert (above)
const alert1 = {
  source: 'target',
  symbol: 'BTCUSDT',
  type: 'above',
  targetPrice: 69900,
  sourceType: '现货'
};
const msg1 = templater.buildMessage(alert1);
console.log('测试用例 1: 现货上穿');
console.log('  标题:', msg1.title);
console.log('  内容:', msg1.content);
console.log('  预期：[现货] BTCUSDT 上穿 69900');
console.log('  结果:', msg1.content === '[现货] BTCUSDT 上穿 69900' ? '✅ PASS' : '❌ FAIL');
console.log();

// Test case 2: Alpha price alert (below)
const alert2 = {
  source: 'target',
  symbol: 'ETHUSDT',
  type: 'below',
  targetPrice: 3500,
  sourceType: 'Alpha'
};
const msg2 = templater.buildMessage(alert2);
console.log('测试用例 2: Alpha 下破');
console.log('  标题:', msg2.title);
console.log('  内容:', msg2.content);
console.log('  预期：[Alpha] ETHUSDT 下破 3500');
console.log('  结果:', msg2.content === '[Alpha] ETHUSDT 下破 3500' ? '✅ PASS' : '❌ FAIL');
console.log();

// Test case 3: Volatility alert
const alert3 = {
  source: 'volatility',
  symbol: 'SOLUSDT',
  windowMinutes: 5,
  changePercent: 25.5,
  direction: 'up',
  sourceType: '现货'
};
const msg3 = templater.buildMessage(alert3);
console.log('测试用例 3: 波动侦测');
console.log('  标题:', msg3.title);
console.log('  内容:', msg3.content);
console.log();

// ==================== Test 2: URL Building ====================
console.log('=== 测试 2: URL 链接拼装 ===\n');

const barkSender = new BarkSender();

const barkConfig = {
  key: 'test_device_key_123',
  sound: 'minuet',
  volume: 5,
  serverUrl: 'https://api.day.app'
};

// Normal mode
const urlNormal = barkSender.buildUrl(barkConfig, msg1, 'normal');
console.log('普通模式 URL:');
console.log('  ', urlNormal);
console.log('  检查：包含 sound=minuet:', urlNormal.includes('sound=minuet') ? '✅' : '❌');
console.log('  检查：不包含 level=critical:', !urlNormal.includes('level=critical') ? '✅' : '❌');
console.log();

// Critical mode
const urlCritical = barkSender.buildUrl(barkConfig, msg1, 'critical');
console.log('紧急模式 URL:');
console.log('  ', urlCritical);
console.log('  检查：包含 sound=minuet:', urlCritical.includes('sound=minuet') ? '✅' : '❌');
console.log('  检查：包含 level=critical:', urlCritical.includes('level=critical') ? '✅' : '❌');
console.log('  检查：包含 volume=5:', urlCritical.includes('volume=5') ? '✅' : '❌');
console.log();

// ==================== Test 3: Content Validation ====================
console.log('=== 测试 3: 内容禁令检查 ===\n');

const forbiddenWords = ['价格预警', '动作', '币种类型', '目标价', '|'];
let allPassed = true;

forbiddenWords.forEach(word => {
  const contains = msg1.content.includes(word);
  if (contains) {
    console.log(`  ❌ 内容包含禁词："${word}"`);
    allPassed = false;
  }
});

if (allPassed) {
  console.log('  ✅ 内容不包含任何禁词');
}
console.log();

// ==================== Summary ====================
console.log('=== 测试总结 ===\n');
console.log('推送内容格式：', msg1.content === '[现货] BTCUSDT 上穿 69900' ? '✅ PASS' : '❌ FAIL');
console.log('URL 拼装（普通模式）:', urlNormal.includes('sound=minuet') && !urlNormal.includes('level=critical') ? '✅ PASS' : '❌ FAIL');
console.log('URL 拼装（紧急模式）:', urlCritical.includes('level=critical') && urlCritical.includes('volume=5') ? '✅ PASS' : '❌ FAIL');
console.log('内容禁令检查：', allPassed ? '✅ PASS' : '❌ FAIL');
console.log();

const allTestsPassed = 
  msg1.content === '[现货] BTCUSDT 上穿 69900' &&
  msg2.content === '[Alpha] ETHUSDT 下破 3500' &&
  urlNormal.includes('sound=minuet') &&
  !urlNormal.includes('level=critical') &&
  urlCritical.includes('level=critical') &&
  urlCritical.includes('volume=5') &&
  allPassed;

console.log('总体结果:', allTestsPassed ? '✅ 所有测试通过！' : '❌ 部分测试失败');
process.exit(allTestsPassed ? 0 : 1);
