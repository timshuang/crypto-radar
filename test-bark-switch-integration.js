/**
 * Integration test for Bark notification switch state checking
 * 
 * Tests the complete flow:
 * 1. Switch OFF → No notification sent
 * 2. Switch ON → Notification sent
 */

const EventEmitter = require('events');

// Mock ConfigManager
class MockConfigManager extends EventEmitter {
  constructor() {
    super();
    this.config = {
      bark: {
        enabled: true,
        deviceKey: 'test_key',
        sound: 'minuet',
        volume: 5,
        serverUrl: 'https://api.day.app',
        monitorEnabled: true,
        monitorMode: 'normal',
        volatilityEnabled: false,
        volatilityMode: 'normal'
      },
      symbols: [
        { symbol: 'BTCUSDT', source: 'spot', barkEnabled: true, barkMode: 'normal' }
      ],
      telegram: {
        enabled: false
      }
    };
  }

  async save() {
    // Mock save
  }
}

// Mock BarkSender
class MockBarkSender {
  constructor() {
    this.sendCount = 0;
  }

  buildUrl(config, message, mode) {
    return `https://api.day.app/${config.key}/${encodeURIComponent(message.title)}/${encodeURIComponent(message.content)}?sound=${config.sound}`;
  }

  async send(config, message, mode) {
    this.sendCount++;
    console.log(`[MockBarkSender] 发送 #${this.sendCount}: ${message.content}`);
    return { success: true, mode };
  }
}

// Mock TelegramSender
class MockTelegramSender {
  buildUrl(config, message) {
    return 'https://api.telegram.org/...';
  }

  async send(config, message) {
    return { success: true };
  }
}

// Mock Templater
class MockTemplater {
  buildMessage(alert) {
    const action = alert.type === 'above' ? '上穿' : '下破';
    const sourceType = alert.sourceType || '现货';
    return {
      title: '价格预警',
      content: `[${sourceType}] ${alert.symbol} ${action} ${alert.targetPrice}`
    };
  }
}

// Simplified NotificationService for testing
class TestNotificationService {
  constructor(configManager) {
    this.configManager = configManager;
    this.barkSender = new MockBarkSender();
    this.telegramSender = new MockTelegramSender();
    this.templater = new MockTemplater();
    this.testMode = false;
  }

  async send(alert, options = {}) {
    const config = this.configManager.config;
    const results = { bark: null, telegram: null, testMode: this.testMode };
    const message = this.templater.buildMessage(alert);

    if (options.useBark && config.bark?.enabled) {
      const isMonitorAlert = alert.source === 'target';
      const isVolatilityAlert = alert.source === 'volatility';
      
      if (isMonitorAlert && config.bark.monitorEnabled === false) {
        console.log('[Bark] 监控列表开关关闭，跳过推送');
        results.bark = { success: false, skipped: true, reason: 'monitorEnabled=false' };
      } else if (isVolatilityAlert && config.bark.volatilityEnabled !== true) {
        console.log('[Bark] 波动侦测开关关闭，跳过推送');
        results.bark = { success: false, skipped: true, reason: 'volatilityEnabled=false' };
      } else {
        try {
          const barkConfig = {
            key: config.bark.deviceKey,
            sound: config.bark.sound,
            volume: config.bark.volume,
            serverUrl: config.bark.serverUrl
          };

          results.bark = await this.barkSender.send(barkConfig, message, options.mode);
        } catch (err) {
          console.error(`[Notification] Bark 发送失败：${err.message}`);
          results.bark = { success: false, error: err.message };
        }
      }
    }

    return results;
  }
}

// ==================== Run Tests ====================
console.log('🦐 Bark 通知开关状态检查 - 集成测试\n');

async function runTests() {
  let passed = 0;
  let failed = 0;

  // Test 1: Monitor alert with switch ON
  console.log('=== 测试 1: 监控列表开关开启 → 发送通知 ===');
  const configManager1 = new MockConfigManager();
  configManager1.config.bark.monitorEnabled = true;
  const service1 = new TestNotificationService(configManager1);
  
  const alert1 = {
    source: 'target',
    symbol: 'BTCUSDT',
    type: 'above',
    targetPrice: 69900,
    sourceType: '现货'
  };
  
  const result1 = await service1.send(alert1, { useBark: true, mode: 'normal' });
  if (result1.bark.success && service1.barkSender.sendCount === 1) {
    console.log('  ✅ PASS: 通知已发送\n');
    passed++;
  } else {
    console.log('  ❌ FAIL: 通知未发送\n');
    failed++;
  }

  // Test 2: Monitor alert with switch OFF
  console.log('=== 测试 2: 监控列表开关关闭 → 跳过推送 ===');
  const configManager2 = new MockConfigManager();
  configManager2.config.bark.monitorEnabled = false;
  const service2 = new TestNotificationService(configManager2);
  
  const alert2 = {
    source: 'target',
    symbol: 'ETHUSDT',
    type: 'below',
    targetPrice: 3500,
    sourceType: '现货'
  };
  
  const result2 = await service2.send(alert2, { useBark: true, mode: 'normal' });
  if (result2.bark.skipped && result2.bark.reason === 'monitorEnabled=false' && service2.barkSender.sendCount === 0) {
    console.log('  ✅ PASS: 推送已跳过（0 资源浪费）\n');
    passed++;
  } else {
    console.log('  ❌ FAIL: 推送未正确跳过\n');
    failed++;
  }

  // Test 3: Volatility alert with switch OFF (default)
  console.log('=== 测试 3: 波动侦测开关关闭（默认） → 跳过推送 ===');
  const configManager3 = new MockConfigManager();
  configManager3.config.bark.volatilityEnabled = false;  // 默认就是 false
  const service3 = new TestNotificationService(configManager3);
  
  const alert3 = {
    source: 'volatility',
    symbol: 'SOLUSDT',
    windowMinutes: 5,
    changePercent: 25.5,
    direction: 'up',
    sourceType: '现货'
  };
  
  const result3 = await service3.send(alert3, { useBark: true, mode: 'normal' });
  if (result3.bark.skipped && result3.bark.reason === 'volatilityEnabled=false' && service3.barkSender.sendCount === 0) {
    console.log('  ✅ PASS: 推送已跳过（0 资源浪费）\n');
    passed++;
  } else {
    console.log('  ❌ FAIL: 推送未正确跳过\n');
    failed++;
  }

  // Test 4: Volatility alert with switch ON
  console.log('=== 测试 4: 波动侦测开关开启 → 发送通知 ===');
  const configManager4 = new MockConfigManager();
  configManager4.config.bark.volatilityEnabled = true;
  const service4 = new TestNotificationService(configManager4);
  
  const alert4 = {
    source: 'volatility',
    symbol: 'SOLUSDT',
    windowMinutes: 5,
    changePercent: 25.5,
    direction: 'up',
    sourceType: '现货'
  };
  
  const result4 = await service4.send(alert4, { useBark: true, mode: 'normal' });
  if (result4.bark.success && service4.barkSender.sendCount === 1) {
    console.log('  ✅ PASS: 通知已发送\n');
    passed++;
  } else {
    console.log('  ❌ FAIL: 通知未发送\n');
    failed++;
  }

  // Summary
  console.log('=== 测试总结 ===\n');
  console.log(`通过：${passed}/${passed + failed}`);
  console.log(`失败：${failed}/${passed + failed}`);
  console.log();
  
  if (failed === 0) {
    console.log('✅ 所有集成测试通过！');
    return true;
  } else {
    console.log('❌ 部分集成测试失败');
    return false;
  }
}

runTests().then(success => {
  process.exit(success ? 0 : 1);
});
