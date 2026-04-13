/**
 * monitors.js - 监控模块（价格目标线 + 波动侦测线）
 * 
 * 包含：
 * - TargetMonitor: 价格目标线监控
 * - VolatilityMonitor: 波动侦测线监控
 * - fetchBinanceSymbols: 获取币安全量交易对
 * - fetchAlphaPrice: 获取 Alpha 代币价格
 */

// 缓存币安全量币种列表
let binanceSymbolsCache = null;
let binanceCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 分钟缓存

/**
 * 获取币安全量 USDT 交易对
 * @returns {Promise<string[]>} - 币种列表（如 ['BTCUSDT', 'ETHUSDT', ...]）
 */
async function fetchBinanceSymbols() {
  // 检查缓存
  const now = Date.now();
  if (binanceSymbolsCache && (now - binanceCacheTime) < CACHE_DURATION) {
    return binanceSymbolsCache;
  }
  
  try {
    const url = 'https://api.binance.com/api/v3/exchangeInfo';
    const response = await fetch(url);
    const data = await response.json();
    
    // 筛选 USDT 交易对且状态正常的
    const symbols = (data.symbols || [])
      .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map(s => s.symbol);
    
    // 更新缓存
    binanceSymbolsCache = symbols;
    binanceCacheTime = now;
    
    console.log(`[Binance] 获取全量币种：${symbols.length} 个 USDT 交易对`);
    return symbols;
  } catch (err) {
    console.error(`[Binance] 获取币种列表失败：${err.message}`);
    // 返回缓存（如果有）
    if (binanceSymbolsCache) {
      return binanceSymbolsCache;
    }
    return [];
  }
}

/**
 * 获取 Alpha 代币价格
 * @param {string} alphaId - Alpha ID（如 ALPHA_804）
 * @returns {Promise<string>} - 价格
 */
async function fetchAlphaPrice(alphaId) {
  try {
    const url = `https://www.binance.com/bapi/defi/v1/public/alpha-trade/ticker?symbol=${alphaId}USDT`;
    const response = await fetch(url);
    const data = await response.json();
    
    // 注意：数据在 data.data 里
    if (data.data && data.data.lastPrice) {
      return data.data.lastPrice;
    }
    
    throw new Error('Alpha API 返回数据格式异常');
  } catch (err) {
    console.error(`[Alpha] 获取 ${alphaId} 价格失败:`, err.message);
    return null;
  }
}

/**
 * 获取 Alpha 交易所信息
 * @returns {Promise<object>} - 交易所信息
 */
async function fetchAlphaExchangeInfo() {
  try {
    const url = 'https://www.binance.com/bapi/defi/v1/public/alpha-trade/get-exchange-info';
    const response = await fetch(url);
    const data = await response.json();
    
    return data.data || {};
  } catch (err) {
    console.error('[Alpha] 获取交易所信息失败:', err.message);
    return {};
  }
}

/**
 * 获取 Alpha K 线数据
 * @param {string} alphaId - Alpha ID（如 ALPHA_804）
 * @param {string} interval - K 线间隔（1m, 5m, 15m, 1h, 4h, 1d）
 * @param {number} limit - 返回数量（默认 100）
 * @returns {Promise<Array>} - K 线数据
 */
async function fetchAlphaKlines(alphaId, interval = '1m', limit = 100) {
  try {
    const url = `https://www.binance.com/bapi/defi/v1/public/alpha-trade/klines?symbol=${alphaId}USDT&interval=${interval}&limit=${limit}`;
    const response = await fetch(url);
    const data = await response.json();
    
    return data.data || [];
  } catch (err) {
    console.error(`[Alpha] 获取 ${alphaId} K 线失败:`, err.message);
    return [];
  }
}

/**
 * 价格目标线监控器
 * 
 * 职责：
 * - 监控币种价格是否达到用户设定的目标价位
 * - 触发条件：价格 >= 目标价 (做多) 或 价格 <= 目标价 (做空)
 * - 状态流转：WAITING → TRIGGERED → COMPLETED
 * - 一次性逻辑：触发后自动标记为"已完成"，不再重复告警
 */
class TargetMonitor {
  constructor(storage, alertService, configManager) {
    this.storage = storage;
    this.alertService = alertService;
    this.configManager = configManager;
  }

  /**
   * 检查所有价格目标
   */
  check(symbol, currentPrice, targets) {
    const triggered = [];
    
    if (!Array.isArray(targets)) {
      return triggered;
    }
    
    for (const target of targets) {
      // 跳过禁用的目标
      if (!target.enabled) {
        continue;
      }
      
      // 跳过已完成的目标
      if (target.status === 'completed') {
        continue;
      }
      
      // 检查是否触发
      const isTriggered = this._checkTarget(target, currentPrice);
      
      if (isTriggered) {
        triggered.push({
          ...target,
          currentPrice
        });
      }
    }
    
    return triggered;
  }

  /**
   * 检查单个目标
   */
  _checkTarget(target, currentPrice) {
    if (target.type === 'above') {
      return currentPrice >= target.price;
    } else if (target.type === 'below') {
      return currentPrice <= target.price;
    }
    return false;
  }

  /**
   * 处理触发的目标
   */
  async handleTrigger(symbol, target, currentPrice) {
    const targetKey = `${symbol}_target_${target.id}`;
    
    // 检查静默期
    if (!this.storage.canAlert(targetKey)) {
      console.log(`[Target] ${symbol} 目标 ${target.id} 在静默期，跳过`);
      return false;
    }
    
    // 更新状态（storage）
    this.storage.updateTargetState(
      target.id,
      symbol,
      target.type,
      target.price,
      'triggered'
    );
    
    // 更新状态（configManager - 用于前端显示）
    // 触发后自动关闭开关（一次性报警）
    if (this.configManager) {
      this.configManager.updateTargetStatus(symbol, target.id, 'triggered', currentPrice, false);
      await this.configManager.save();
    }
    
    // 发送告警
    const sent = await this.alertService.sendTargetAlert(
      symbol,
      target.type,
      target.price,
      currentPrice
    );
    
    if (sent) {
      // 设置静默期
      this.storage.setAlertSilence(targetKey);
      
      console.log(`[Target] ${symbol} 触发报警，已自动关闭监控`);
      return true;
    }
    
    return false;
  }
}

/**
 * 波动侦测线监控器
 * 
 * 职责：
 * - 监控币种在指定时间窗口内的价格波动幅度
 * - 触发条件：(最高价 - 最低价) / 最低价 >= 阈值%
 * - 检测窗口：滑动窗口，每 1 分钟检查过去 N 分钟的数据
 * - 持续性监控：不会自动完成，持续检测
 * - 静默期管理：触发后 5 分钟内不重复通知
 */
class VolatilityMonitor {
  constructor(storage, alertService) {
    this.storage = storage;
    this.alertService = alertService;
  }

  _isDebugEnabled() {
    try {
      const configManager = require('./config');
      return configManager?.config?.debug === true;
    } catch (_) {
      return false;
    }
  }

  /**
   * 检查波动
   */
  check(symbol, config) {
    if (!config || !config.enabled) {
      return null;
    }
    
    const { windowMinutes, thresholdPercent } = config;
    
    // 获取滑动窗口统计
    const stats = this.storage.getWindowStats(symbol, windowMinutes, 'volatility');
    
    if (!stats || !stats.startPrice || !stats.endPrice) {
      return null; // 数据不足
    }
    
    // 计算波动率：净变化率 (end - start) / start * 100%
    const volatility = ((stats.endPrice - stats.startPrice) / stats.startPrice) * 100;
    
    // 使用全局阈值
    const currentThreshold = thresholdPercent;
    
    // 检查是否触发（上涨或下跌超过阈值）
    const isTriggered = Math.abs(volatility) >= currentThreshold;
    
    return {
      symbol,
      volatility,
      min: stats.min,
      max: stats.max,
      startPrice: stats.startPrice,
      endPrice: stats.endPrice,
      direction: stats.endPrice >= stats.startPrice ? 'up' : 'down',
      threshold: currentThreshold,
      baseThreshold: thresholdPercent,
      isTriggered,
      windowMinutes
    };
  }

  /**
   * 处理触发的波动
   */
  async handleTrigger(result) {
    const { symbol, volatility, min, max, threshold, direction, windowMinutes, sourceType, startPrice, endPrice } = result;
    const volatilityKey = `${symbol}_volatility`;
    const isTrackedSpot = ['BTC', 'ETH', 'TIA', 'BTCUSDT', 'ETHUSDT', 'TIAUSDT'].includes(String(symbol || '').toUpperCase());
    
    // 检查静默期
    if (!this.storage.canAlert(volatilityKey)) {
      if (isTrackedSpot && this._isDebugEnabled()) {
        console.log(`[Volatility][TrackedSpot] stage=handleTrigger.silenced, symbol=${symbol}, key=${volatilityKey}`);
      }
      console.log(`[Volatility] ${symbol} 在静默期，跳过`);
      return false;
    }
    
    // ⚠️ 关键修复：立即设置静默期（同步），防止竞态条件
    this.storage.setAlertSilence(volatilityKey);
    if (isTrackedSpot && this._isDebugEnabled()) {
      console.log(`[Volatility][TrackedSpot] stage=handleTrigger.send, symbol=${symbol}, key=${volatilityKey}, volatility=${(volatility || 0).toFixed(2)}, threshold=${threshold}, sourceType=${sourceType || 'N/A'}, windowMinutes=${windowMinutes}`);
    }
    
    // 发送告警（异步操作）
    const sent = await this.alertService.sendVolatilityAlert(
      symbol,
      volatility,
      min,
      max,
      threshold,
      direction,
      windowMinutes,
      sourceType,
      startPrice,
      endPrice
    );
    
    if (sent) {
      if (isTrackedSpot && this._isDebugEnabled()) {
        console.log(`[Volatility][TrackedSpot] stage=handleTrigger.sent, symbol=${symbol}, key=${volatilityKey}`);
      }
      console.log(`[Volatility] ${symbol} 波动 ${(volatility || 0).toFixed(2)}% 已触发`);
      return true;
    }
    
    if (isTrackedSpot && this._isDebugEnabled()) {
      console.log(`[Volatility][TrackedSpot] stage=handleTrigger.sendFailed, symbol=${symbol}, key=${volatilityKey}`);
    }
    console.log(`[Volatility] ${symbol} 波动 ${(volatility || 0).toFixed(2)}% 已触发（通知发送失败）`);
    return true;  // 返回 true 表示已处理，避免重复触发
  }

  /**
   * 初始化波动监控状态
   */
  init(symbol, config) {
    if (!config || !config.enabled) {
      return;
    }
    
    const { thresholdPercent } = config;
    
    this.storage.updateVolatilityState(
      symbol,
      true,
      thresholdPercent
    );
    
    console.log(`[Volatility] ${symbol} 监控已初始化，阈值 ${thresholdPercent}%`);
  }
}

module.exports = {
  TargetMonitor,
  VolatilityMonitor,
  fetchAlphaPrice,
  fetchAlphaExchangeInfo,
  fetchAlphaKlines
};
