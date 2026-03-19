/**
 * config.js - 配置管理模块
 * 
 * 功能：
 * - 用户配置 CRUD（币种、阈值、开关）
 * - 系统总开关
 * - 全局/特定币种监控模式切换
 * - 配置验证和默认值
 */

const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class ConfigManager extends EventEmitter {
  constructor(configPath = null) {
    super();
    // 支持从环境变量或参数获取配置路径
    this.configPath = configPath || process.env.CONFIG_PATH || path.join(__dirname, '..', 'config.json');
    this.config = null;
    this.systemEnabled = true; // 系统总开关
  }

  /**
   * 加载配置文件
   */
  async load() {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(content);
      
      // 验证配置结构
      this.validate();
      
      // 应用默认值
      this.applyDefaults();
      
      console.log(`[Config] 配置加载成功：${this.configPath}`);
      return this.config;
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn(`[Config] 配置文件不存在，使用默认配置`);
        this.config = this.getDefaultConfig();
        await this.save();
        return this.config;
      }
      throw new Error(`配置加载失败：${err.message}`);
    }
  }

  /**
   * 保存配置文件
   */
  async save() {
    try {
      // 原子写入：先写临时文件，再命名
      const tmpPath = this.configPath + '.tmp';
      this.config.updatedAt = new Date().toISOString();
      
      const content = JSON.stringify(this.config, null, 2);
      await fs.writeFile(tmpPath, content, 'utf8');
      await fs.rename(tmpPath, this.configPath);
      
      console.log(`[Config] 配置已保存`);
      
      // 触发配置变更事件
      this.emit('configChanged', this.config);
      
      return true;
    } catch (err) {
      throw new Error(`配置保存失败：${err.message}`);
    }
  }

  /**
   * 验证配置结构
   */
  validate() {
    const errors = [];
    
    if (!this.config.version) {
      errors.push('缺少 version 字段');
    }
    
    if (!this.config.bark || !this.config.bark.deviceKey) {
      console.warn('⚠️ 警告：Bark deviceKey 未配置，通知功能将不可用');
      // 不添加错误，允许系统继续初始化
    }
    
    if (!Array.isArray(this.config.symbols)) {
      errors.push('symbols 必须是数组');
    }
    
    if (!this.config.settings) {
      errors.push('缺少 settings 配置');
    }
    
    // 验证每个币种配置
    if (Array.isArray(this.config.symbols)) {
      this.config.symbols.forEach((symbol, index) => {
        if (!symbol.symbol) {
          errors.push(`symbols[${index}] 缺少 symbol 字段`);
        }
        if (!['spot', 'alpha'].includes(symbol.source)) {
          errors.push(`symbols[${index}] source 必须是 'spot' 或 'alpha'`);
        }
        if (!Array.isArray(symbol.targets)) {
          errors.push(`symbols[${index}] targets 必须是数组`);
        }
        if (!symbol.volatility || typeof symbol.volatility !== 'object') {
          errors.push(`symbols[${index}] 缺少 volatility 配置`);
        }
      });
    }
    
    if (errors.length > 0) {
      throw new Error(`配置验证失败：\n${errors.join('\n')}`);
    }
  }

  /**
   * 应用默认值
   */
  applyDefaults() {
    // Bark 默认配置
    if (!this.config.bark.serverUrl) {
      this.config.bark.serverUrl = 'https://api.day.app';
    }
    if (!this.config.bark.sound) {
      this.config.bark.sound = 'alarm.mp3';
    }
    if (!this.config.bark.group) {
      this.config.bark.group = 'crypto_radar';
    }
    
    // 全局设置默认值
    if (!this.config.settings) {
      this.config.settings = {};
    }
    if (!this.config.settings.checkIntervalMinutes) {
      this.config.settings.checkIntervalMinutes = 1;
    }
    if (!this.config.settings.alertSilenceMinutes) {
      this.config.settings.alertSilenceMinutes = 5;
    }
    if (!this.config.settings.maxPriceRecordsPerSymbol) {
      this.config.settings.maxPriceRecordsPerSymbol = 1440;
    }
    if (!this.config.settings.maxSymbols) {
      this.config.settings.maxSymbols = 20;
    }
    
    // 币种默认值
    if (Array.isArray(this.config.symbols)) {
      this.config.symbols.forEach(symbol => {
        if (symbol.enabled === undefined) {
          symbol.enabled = true;
        }
        if (symbol.volatility) {
          if (symbol.volatility.enabled === undefined) {
            symbol.volatility.enabled = true;
          }
          if (!symbol.volatility.windowMinutes) {
            symbol.volatility.windowMinutes = 60;
          }
          if (!symbol.volatility.thresholdPercent) {
            symbol.volatility.thresholdPercent = 2.0;
          }
          if (!symbol.volatility.stepThreshold) {
            symbol.volatility.stepThreshold = 0.5;
          }
        }
      });
    }
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bark: {
        enabled: true,
        deviceKey: 'YOUR_DEVICE_KEY_HERE',
        serverUrl: 'https://api.day.app',
        sound: 'alarm.mp3',
        group: 'crypto_radar'
      },
      symbols: [
        {
          symbol: 'BTCUSDT',
          enabled: true,
          source: 'spot',
          targets: [
            {
              id: 'target_1',
              type: 'above',
              price: 50000,
              enabled: true,
              status: 'waiting'
            }
          ],
          volatility: {
            enabled: true,
            windowMinutes: 60,
            thresholdPercent: 2.0,
            stepThreshold: 0.5
          }
        }
      ],
      settings: {
        checkIntervalMinutes: 1,
        alertSilenceMinutes: 5,
        maxPriceRecordsPerSymbol: 1440,
        maxSymbols: 20
      }
    };
  }

  /**
   * 系统总开关控制
   */
  setSystemEnabled(enabled) {
    this.systemEnabled = enabled;
    console.log(`[Config] 系统总开关：${enabled ? '开启' : '关闭'}`);
  }

  isSystemEnabled() {
    return this.systemEnabled;
  }

  /**
   * 获取所有启用的币种
   */
  getEnabledSymbols() {
    if (!this.config || !Array.isArray(this.config.symbols)) {
      return [];
    }
    return this.config.symbols
      .filter(s => s.enabled)
      .slice(0, this.config.settings.maxSymbols);
  }

  /**
   * 获取特定币种配置
   */
  getSymbolConfig(symbol) {
    if (!this.config || !Array.isArray(this.config.symbols)) {
      return null;
    }
    return this.config.symbols.find(s => s.symbol === symbol.toUpperCase());
  }

  /**
   * 启用/禁用特定币种
   */
  setSymbolEnabled(symbol, enabled) {
    const symbolConfig = this.getSymbolConfig(symbol);
    if (symbolConfig) {
      symbolConfig.enabled = enabled;
      console.log(`[Config] 币种 ${symbol}: ${enabled ? '启用' : '禁用'}`);
      return true;
    }
    return false;
  }

  /**
   * 添加价格目标
   */
  addTarget(symbol, type, price) {
    const symbolConfig = this.getSymbolConfig(symbol);
    if (!symbolConfig) {
      return false;
    }
    
    const target = {
      id: `target_${Date.now()}`,
      type: type, // 'above' or 'below'
      price: price,
      enabled: true,
      status: 'waiting'
    };
    
    symbolConfig.targets.push(target);
    return target;
  }

  /**
   * 移除价格目标
   */
  removeTarget(symbol, targetId) {
    const symbolConfig = this.getSymbolConfig(symbol);
    if (!symbolConfig) {
      return false;
    }
    
    const index = symbolConfig.targets.findIndex(t => t.id === targetId);
    if (index !== -1) {
      symbolConfig.targets.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 更新目标状态
   */
  updateTargetStatus(symbol, targetId, status, triggeredPrice = null, enabled = null) {
    const symbolConfig = this.getSymbolConfig(symbol);
    if (!symbolConfig || !symbolConfig.targets) {
      return false;
    }
    
    const target = symbolConfig.targets.find(t => t.id === targetId);
    if (!target) {
      return false;
    }
    
    target.status = status;
    if (status === 'triggered') {
      target.triggeredAt = Date.now();
      if (triggeredPrice) {
        target.triggeredPrice = triggeredPrice;
      }
    }
    
    // 支持手动设置 enabled 状态（触发时自动关闭开关）
    // 注意：触发时关闭的是币种级别的开关 (symbol.enabled)，而不是目标级别的开关
    if (enabled !== null) {
      target.enabled = enabled;
      symbolConfig.enabled = enabled; // 同步更新币种级别的开关
      console.log(`[Config] 币种 ${symbol} 开关已${enabled ? '打开' : '关闭'}（触发自动关闭）`);
    }
    
    console.log(`[Config] 目标 ${targetId} 状态更新：${status}, target.enabled: ${target.enabled}, symbol.enabled: ${symbolConfig.enabled}`);
    return true;
  }

  /**
   * 获取全局设置
   */
  getSettings() {
    return this.config?.settings || {};
  }

  /**
   * 获取 Bark 配置
   */
  getBarkConfig() {
    return this.config?.bark || {};
  }
}

// 导出单例
module.exports = new ConfigManager();
