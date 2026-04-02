/**
 * alert-service.js - 告警服务模块
 * 
 * 功能：
 * - Bark API 推送（分级：default / critical）
 * - 网页 WebSocket 推送（实时弹窗）
 * - 报警历史记录
 * - 失败重试机制（3 次，指数退避）
 * - 消息格式化
 */

const EventEmitter = require('events');

class AlertService extends EventEmitter {
  constructor(barkConfig, configManager, notificationService) {
    super();
    this.config = barkConfig;
    this.enabled = barkConfig?.enabled !== false;
    this.deviceKey = barkConfig?.deviceKey;
    this.serverUrl = barkConfig?.serverUrl || 'https://api.day.app';
    this.sound = barkConfig?.sound || 'alarm.mp3';
    this.group = barkConfig?.group || 'crypto_radar';
    
    // 新增：配置管理器和通知服务
    this.configManager = configManager;
    this.notificationService = notificationService;
    
    // WebSocket 服务器引用（由外部绑定）
    this.wsServer = null;
    
    // 失败队列
    this.failedQueue = [];
    this.maxQueueSize = 100;
    
    // 重试配置
    this.maxRetries = 3;
    this.baseDelay = 1000;
  }

  /**
   * 绑定 WebSocket 服务器
   */
  bindWebSocket(wsServer) {
    this.wsServer = wsServer;
    console.log('[Alert] WebSocket 服务器已绑定');
  }

  /**
   * 更新配置
   */
  updateConfig(config) {
    this.config = config;
    this.enabled = config?.enabled !== false;
    this.deviceKey = config?.deviceKey;
    this.serverUrl = config?.serverUrl || 'https://api.day.app';
    this.sound = config?.sound || 'alarm.mp3';
    this.group = config?.group || 'crypto_radar';
    console.log('[Alert] 配置已更新');
  }

  /**
   * 发送告警
   * @param {Object} options - 告警选项
   * @param {string} options.title - 标题
   * @param {string} options.body - 内容
   * @param {string} options.level - 级别：'default' | 'critical'
   * @param {string} options.symbol - 币种（可选）
   * @param {string} options.type - 类型：'target' | 'volatility'
   */
  async send(options) {
    if (!this.enabled) {
      console.log('[Alert] 告警服务已禁用，跳过发送');
      return false;
    }

    if (!this.deviceKey || this.deviceKey === 'YOUR_DEVICE_KEY_HERE') {
      console.warn('[Alert] DeviceKey 未配置，跳过发送');
      return false;
    }

    const {
      title,
      body,
      level = 'default',
      symbol = '',
      type = 'target'
    } = options;

    // 构建 Bark 请求体
    const payload = {
      title: title || '🦐 价格告警',
      body: body,
      badge: '1',
      sound: this.sound,
      isArchive: '1',
      group: this.group,
      level: level === 'critical' ? 'timeSensitive' : 'active',
      url: symbol ? `https://www.binance.com/zh-CN/price/${symbol.replace('USDT', '')}` : undefined
    };

    try {
      await this._sendWithRetry(payload);
      console.log(`[Alert] 告警发送成功：${body}`);
      this.emit('alert', { ...options, timestamp: Date.now() });
      return true;
    } catch (err) {
      console.error(`[Alert] 告警发送失败：${err.message}`);
      this._addToFailedQueue(payload);
      this.emit('alert_failed', { ...options, error: err.message, timestamp: Date.now() });
      return false;
    }
  }

  /**
   * 带重试的发送
   */
  async _sendWithRetry(payload) {
    let lastError;
    
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        await this._doSend(payload);
        return; // 成功则返回
      } catch (err) {
        lastError = err;
        const delay = this.baseDelay * Math.pow(2, i);
        console.warn(`[Alert] 重试 ${i + 1}/${this.maxRetries}, ${delay}ms 后`);
        await this._sleep(delay);
      }
    }
    
    throw lastError;
  }

  /**
   * 实际发送请求
   */
  async _doSend(payload) {
    const url = `${this.serverUrl}/push`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 秒超时

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      
      if (result.code !== 200) {
        throw new Error(result.message || 'Unknown error');
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('请求超时 (5s)');
      }
      throw err;
    }
  }

  /**
   * 添加到失败队列
   */
  _addToFailedQueue(payload) {
    if (this.failedQueue.length >= this.maxQueueSize) {
      this.failedQueue.shift(); // 移除最旧的
    }
    
    this.failedQueue.push({
      ...payload,
      retryCount: 0,
      createdAt: Date.now()
    });
  }

  /**
   * 处理失败队列
   */
  async processFailedQueue() {
    if (this.failedQueue.length === 0) {
      return;
    }

    console.log(`[Alert] 处理失败队列，当前数量：${this.failedQueue.length}`);
    
    const stillFailed = [];

    for (const item of this.failedQueue) {
      if (item.retryCount >= this.maxRetries) {
        console.warn(`[Alert] 告警丢弃 (重试超限): ${item.body}`);
        
        // 🔴 修复：丢弃前设置静默期，防止同一币种重复触发
        if (item.type === 'volatility' && item.symbol && this.storage?.setAlertSilence) {
          const key = `${item.symbol}_volatility`;
          this.storage.setAlertSilence(key);
          console.log(`[Alert] 已设置静默期：${key}`);
        }
        
        continue;
      }

      try {
        await this._doSend(item);
        console.log(`[Alert] 失败队列告警发送成功：${item.body}`);
      } catch (err) {
        item.retryCount++;
        stillFailed.push(item);
      }
    }

    this.failedQueue = stillFailed;
  }

  /**
   * 发送价格目标告警
   */
  async sendTargetAlert(symbol, type, price, currentPrice) {
    const direction = type === 'above' ? '📈 突破' : '📉 跌破';
    const emoji = type === 'above' ? '⬆️' : '⬇️';
    
    const title = `${emoji} 价格目标`;
    const body = `${symbol} ${direction} $${price.toLocaleString()}\n当前价：$${currentPrice.toLocaleString()}`;
    
    // 发送 Bark 通知（旧逻辑，保持兼容）
    const barkSent = await this.send({
      title,
      body,
      level: 'critical',
      symbol,
      type: 'target'
    });
    
    // 发送网页弹窗通知
    await this.sendWebAlert({
      symbol,
      source: 'target',
      type,
      targetPrice: price,
      currentPrice,
      triggeredAt: Date.now()
    });
    
    // 发送外部通知（新通知服务）
    const alert = {
      symbol,
      source: 'target',
      type,
      targetPrice: price,
      currentPrice,
      sourceType: this._getSourceType(symbol)
    };
    await this.sendExternalNotification(alert);
    
    return barkSent;
  }

  /**
   * 发送波动告警
   */
  async sendVolatilityAlert(symbol, volatility, min, max, threshold, directionOverride = null, windowMinutes = null, sourceType = null) {
    const title = '🌊 波动侦测';
    const body = `${symbol} 波动 ${(volatility || 0).toFixed(2)}% (阈值 ${(threshold || 0).toFixed(1)}%)\n区间：$${min?.toLocaleString() || 'N/A'} - $${max?.toLocaleString() || 'N/A'}`;
    
    const barkSent = await this.send({
      title,
      body,
      level: 'default',
      symbol,
      type: 'volatility'
    });
    
    // 使用传入的 windowMinutes，如果没有则从配置读取
    const actualWindowMinutes = windowMinutes || this.configManager?.config?.volatilityModule?.windowMinutes || 5;
    
    // 使用传入的 sourceType，如果没有则通过 _getSourceType 获取
    const actualSourceType = sourceType || this._getSourceType(symbol);

    // 优先使用波动计算阶段已经得出的方向；兜底时再从窗口起始价和当前价计算
    let direction = directionOverride;
    if (!direction) {
      const latestPrice = this.storage?.getLatestPrice(symbol);
      const currentPrice = latestPrice?.price ?? max;
      const windowStats = this.storage?.getWindowStats(symbol, actualWindowMinutes);
      const startPrice = windowStats?.startPrice ?? min;
      direction = currentPrice < startPrice ? 'down' : 'up';
    }
    
    // 发送外部通知（新通知服务）
    const alert = {
      symbol,
      source: 'volatility',
      windowMinutes: actualWindowMinutes,
      changePercent: volatility,
      direction,
      sourceType: actualSourceType
    };
    await this.sendExternalNotification(alert);
    
    return barkSent;
  }

  /**
   * 发送网页弹窗告警
   */
  async sendWebAlert(alert) {
    try {
      // 1. 保存到报警历史记录
      await this.saveAlertToHistory(alert);
      
      // 2. 通过 WebSocket 推送给前端（实时弹窗）
      if (this.wsServer) {
        this.wsServer.broadcast(JSON.stringify({
          type: 'ALERT',
          data: alert
        }));
        console.log(`[Alert] 网页告警已推送：${alert.symbol}`);
      } else {
        console.warn('[Alert] WebSocket 服务器未绑定，跳过网页推送');
      }
    } catch (err) {
      console.error(`[Alert] 网页告警发送失败：${err.message}`);
    }
  }

  /**
   * 保存到报警历史
   */
  async saveAlertToHistory(alert) {
    try {
      const storage = require('./storage');
      const history = storage.getAlertHistory();
      
      history.unshift({
        id: `alert_${Date.now()}`,
        symbol: alert.symbol,
        source: alert.source || 'target',
        type: alert.type,
        targetPrice: alert.targetPrice,
        currentPrice: alert.currentPrice,
        triggeredAt: alert.triggeredAt,
        read: false
      });
      
      // 保留最近 100 条
      if (history.length > 100) {
        history.splice(100);
      }
      
      await storage.saveAlertHistory(history);
      console.log(`[Alert] 告警已保存到历史：${alert.symbol}`);
    } catch (err) {
      console.error(`[Alert] 保存告警历史失败：${err.message}`);
    }
  }

  /**
   * 睡眠工具
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 获取币种来源类型
   * 优先从 config.symbols 查找，找不到时从 storage.symbolMapping 判断（全量模式）
   */
  _getSourceType(symbol) {
    if (!this.configManager) return '现货';
    
    // 1. 优先从 config.symbols 查找
    const symbolConfig = this.configManager.config.symbols.find(s => s.symbol === symbol);
    if (symbolConfig?.source === 'alpha') return 'Alpha';
    if (symbolConfig?.source === 'spot') return '现货';
    
    // 2. 从 storage.symbolMapping 判断（全量模式下的 Alpha 币种）
    if (this.storage && this.storage.getCaForSymbol) {
      const ca = this.storage.getCaForSymbol(symbol);
      if (ca) return 'Alpha';
    }
    
    // 3. 默认返回现货
    return '现货';
  }

  /**
   * 发送外部通知 (Bark / Telegram)
   * @param {Object} alert - 告警对象
   * @param {Object} options - 通知选项
   */
  async sendExternalNotification(alert, options = {}) {
    if (!this.notificationService) {
      console.warn('[Alert] 通知服务未初始化，跳过外部通知');
      return;
    }

    try {
      const config = this.configManager.config;
      const symbolConfig = config.symbols.find(s => s.symbol === alert.symbol);

      // 获取币种级别的通知设置
      const useBark = options.useBark ?? (symbolConfig?.barkEnabled !== false);
      const useTelegram = options.useTelegram ?? config.telegram?.enabled;
      
      // 获取 Bark 模式：全局配置优先（monitorMode/volatilityMode），币种级别配置仅作为额外覆盖
      const isVolatilityAlert = alert.source === 'volatility';
      const globalMode = isVolatilityAlert 
        ? (config.bark?.volatilityMode || 'normal')
        : (config.bark?.monitorMode || 'normal');
      
      // 优先级：options.mode > globalMode > symbolConfig.barkMode
      // 说明：全局配置优先于币种级别，避免历史默认值覆盖用户意图
      const mode = options.mode ?? globalMode ?? symbolConfig?.barkMode ?? 'normal';

      // 发送通知
      const results = await this.notificationService.send(alert, {
        useBark,
        useTelegram,
        mode,
        testMode: options.testMode
      });

      // 记录日志
      if (results.bark?.success) {
        console.log(`[Alert] Bark 通知已发送：${alert.symbol}`);
      } else if (results.bark?.error) {
        console.error(`[Alert] Bark 通知失败：${results.bark.error}`);
      }

      if (results.telegram?.success) {
        console.log(`[Alert] Telegram 通知已发送：${alert.symbol}`);
      } else if (results.telegram?.error) {
        console.error(`[Alert] Telegram 通知失败：${results.telegram.error}`);
      }

      return results;
    } catch (err) {
      console.error(`[Alert] 外部通知发送失败：${err.message}`);
    }
  }

  /**
   * 获取失败队列统计
   */
  getQueueStats() {
    return {
      size: this.failedQueue.length,
      maxSize: this.maxQueueSize
    };
  }

  /**
   * 发送文本消息到 Telegram（用于系统通知）
   */
  async sendTextToTelegram(text) {
    try {
      const tgConfig = this.configManager?.config?.telegram || {};

      // 占位符过滤：避免 ENV_*/YOUR_* 等模板值误用于发送
      const isPlaceholder = (v) => {
        if (!v || typeof v !== 'string') return false;
        return v.startsWith('ENV_') || v.startsWith('YOUR_') || v.endsWith('_HERE');
      };
      const pickRealValue = (...values) => {
        for (const v of values) {
          if (v === undefined || v === null || v === '') continue;
          if (typeof v === 'string' && isPlaceholder(v)) continue;
          return v;
        }
        return '';
      };

      // 统一与通知模块一致：优先 .env，fallback config
      const botToken = pickRealValue(process.env.TG_BOT_TOKEN, tgConfig.botToken);
      const chatId = pickRealValue(process.env.TG_CHAT_ID, tgConfig.chatId);
      const enabled = tgConfig.enabled === true;

      if (!enabled || !botToken || !chatId) {
        console.log('[Alert] Telegram 未配置，跳过文本通知');
        return { success: false, error: 'Telegram 未配置' };
      }

      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const body = {
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      
      if (result.ok) {
        console.log('[Alert] Telegram 文本通知已发送');
        return { success: true };
      } else {
        console.error(`[Alert] Telegram 文本通知失败：${result.description}`);
        return { success: false, error: result.description };
      }
    } catch (err) {
      console.error(`[Alert] Telegram 文本通知异常：${err.message}`);
      return { success: false, error: err.message };
    }
  }
}

module.exports = AlertService;
