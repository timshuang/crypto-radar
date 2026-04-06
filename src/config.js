/**
 * config.js - 配置管理模块
 * 
 * 功能：
 * - 用户配置 CRUD（币种、阈值、开关）
 * - 系统总开关
 * - 全局/特定币种监控模式切换
 * - 配置验证和默认值
 * 
 * 敏感数据说明：
 * - Bark Key、Telegram Token/ChatId 已从 config.json 移除
 * - 敏感数据只存储在 .env 文件中
 * - config.json 只存储非敏感业务配置
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
    
    // 敏感数据（Bark Key、Telegram Token）已从 config.json 移除，只在 .env 中存储
    // 不再验证 deviceKey/botToken/chatId
    
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
    // Bark 默认配置（非敏感字段）
    if (this.config.bark) {
      if (!this.config.bark.serverUrl) {
        this.config.bark.serverUrl = 'https://api.day.app';
      }
      if (!this.config.bark.soundNormal) {
        this.config.bark.soundNormal = 'minuet';
      }
      if (!this.config.bark.soundCritical) {
        this.config.bark.soundCritical = 'alarm';
      }
      if (this.config.bark.volume === undefined) {
        this.config.bark.volume = 5;
      }
      if (this.config.bark.monitorEnabled === undefined) {
        this.config.bark.monitorEnabled = true;
      }
      if (this.config.bark.volatilityEnabled === undefined) {
        this.config.bark.volatilityEnabled = true;
      }
    }
    
    // Telegram 默认配置
    if (this.config.telegram && this.config.telegram.enabled === undefined) {
      this.config.telegram.enabled = true;
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
      this.config.settings.maxPriceRecordsPerSymbol = 300;  // 小机优化：300 条≈5 分钟
    }
    
    // 币种默认值
    if (Array.isArray(this.config.symbols)) {
      this.config.symbols.forEach(symbol => {
        if (symbol.enabled === undefined) {
          symbol.enabled = true;
        }
        if (!Array.isArray(symbol.targets)) {
          symbol.targets = [];
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
        serverUrl: 'https://api.day.app',
        soundNormal: 'minuet',
        soundCritical: 'alarm',
        volume: 5,
        monitorEnabled: true,
        volatilityEnabled: true
        // 敏感数据 deviceKey 已移除，只在 .env 中存储
      },
      telegram: {
        enabled: true
        // 敏感数据 botToken/chatId 已移除，只在 .env 中存储
      },
      symbols: [],
      settings: {
        checkIntervalMinutes: 1,
        alertSilenceMinutes: 5,
        maxPriceRecordsPerSymbol: 300  // 小机优化：300 条≈5 分钟
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
    return this.config.symbols.filter(s => s.enabled);
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
    
    if (enabled !== null) {
      target.enabled = enabled;
      symbolConfig.enabled = enabled;
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
