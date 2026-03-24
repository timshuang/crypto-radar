/**
 * volatility-engine.js - 波动侦测引擎模块（独立版本）
 * 
 * 职责：
 * - 独立于 CheckerEngine 运行
 * - 每分钟检查监控范围内的币种波动
 * - 使用滑动窗口计算波动率
 * - 静默期管理（5 分钟内不重复通知）
 * - 调用 AlertService 发送通知
 * 
 * 关键特性：
 * - 每次检查都从 config 读取最新参数
 * - 全局模式 = 现货 USDT + Alpha 全量
 * - 取消阶梯阈值，只用静默期
 */

class VolatilityEngine {
  constructor(configManager, storage, alertService, volatilityMonitor, wsConnector) {
    this.configManager = configManager;
    this.storage = storage;
    this.alertService = alertService;
    this.volatilityMonitor = volatilityMonitor;
    this.wsConnector = wsConnector;  // 注入 wsConnector，用于获取 Alpha 币种列表
    
    this.checkInterval = null;
    this.isRunning = false;
    this.lastCheckTime = null;
    this.checkCount = 0;
    this.binanceSymbolsCache = null;
    this.binanceCacheTime = 0;
  }
  
  /**
   * 获取币安全量币种列表（带缓存）
   */
  async _getBinanceSymbols() {
    const now = Date.now();
    const CACHE_DURATION = 5 * 60 * 1000; // 5 分钟缓存
    
    // 检查缓存
    if (this.binanceSymbolsCache && (now - this.binanceCacheTime) < CACHE_DURATION) {
      return this.binanceSymbolsCache;
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
      this.binanceSymbolsCache = symbols;
      this.binanceCacheTime = now;
      
      console.log(`[Volatility] Binance 全量币种：${symbols.length} 个 USDT 交易对`);
      return symbols;
    } catch (err) {
      console.error(`[Volatility] 获取币种列表失败：${err.message}`);
      // 返回缓存（如果有）
      if (this.binanceSymbolsCache) {
        return this.binanceSymbolsCache;
      }
      return [];
    }
  }

  /**
   * 获取 Alpha 全量币种列表
   * 优先从 wsConnector.symbolCache 获取（WebSocket 全量推送时动态建立）
   */
  async _getAlphaSymbols() {
    // 尝试从 wsConnector 的 symbolCache 获取（全量推送时已建立映射）
    if (this.wsConnector && this.wsConnector.symbolCache && this.wsConnector.symbolCache.size > 0) {
      const symbols = Array.from(this.wsConnector.symbolCache.values());
      console.log(`[Volatility] Alpha 全量币种：${symbols.length} 个 (from symbolCache)`);
      return symbols;
    }
    
    // symbolCache 为空时，返回空数组（等待下次检查）
    console.log(`[Volatility] Alpha symbolCache 为空，等待数据流入...`);
    return [];
  }

  /**
   * 启动波动侦测引擎
   */
  start() {
    const intervalMinutes = this.configManager.getSettings().checkIntervalMinutes || 1;
    const intervalMs = intervalMinutes * 60 * 1000;
    
    console.log(`[Volatility] 启动，检查间隔：${intervalMinutes} 分钟`);
    
    // 等待 WebSocket 数据流入后再开始第一次检查（方案 2）
    if (this.wsConnector && this.wsConnector.symbolCache) {
      const initialSize = this.wsConnector.symbolCache.size;
      console.log(`[Volatility] 当前 symbolCache: ${initialSize} 个 Alpha 币种`);
      
      if (initialSize === 0) {
        // symbolCache 为空，发送等待通知
        console.log(`[Volatility] 等待 Alpha 数据流入...`);
        
        if (this.alertService) {
          this.alertService.sendTextToTelegram('🌊 波动侦测启动中\n\n正在等待 Alpha 数据流入...\n请稍候，预计 10-30 秒').catch(err => {
            console.error('[Volatility] 发送等待通知失败:', err.message);
          });
        }
        
        // 轮询检查 symbolCache，有数据后再开始
        const checkInterval = setInterval(() => {
          if (this.wsConnector.symbolCache.size > 0) {
            clearInterval(checkInterval);
            const count = this.wsConnector.symbolCache.size;
            console.log(`[Volatility] Alpha 数据已就绪 (${count} 个币种)，开始第一次检查...`);
            
            // 发送就绪通知
            if (this.alertService) {
              this.alertService.sendTextToTelegram(`✅ Alpha 数据已就绪\n\n已收录 ${count} 个 Alpha 币种\n开始波动检查...`).catch(err => {
                console.error('[Volatility] 发送就绪通知失败:', err.message);
              });
            }
            
            this._runCheck();
          }
        }, 2000);
        
        // 超时保护：30 秒后无论有没有数据都开始检查
        setTimeout(() => {
          clearInterval(checkInterval);
          if (this.wsConnector.symbolCache.size === 0) {
            console.warn(`[Volatility] 等待 Alpha 数据超时，直接开始检查（symbolCache 为空）`);
            if (this.alertService) {
              this.alertService.sendTextToTelegram('⚠️ 等待 Alpha 数据超时\n\n直接开始检查（仅现货）\nAlpha 数据可能延迟').catch(err => {
                console.error('[Volatility] 发送超时通知失败:', err.message);
              });
            }
          }
          this._runCheck();
        }, 30000);
      } else {
        // symbolCache 已有数据，直接开始
        console.log(`[Volatility] Alpha 数据已就绪 (${initialSize} 个币种)，开始第一次检查...`);
        this._runCheck();
      }
    } else {
      // 没有 wsConnector，直接开始
      console.log('[Volatility] 无 wsConnector，直接开始检查');
      this._runCheck();
    }
    
    // 定时执行
    this.checkInterval = setInterval(() => {
      this._runCheck();
    }, intervalMs);
  }

  /**
   * 停止波动侦测引擎
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;  // 立即停止当前检查
    console.log('[Volatility] 已停止');
  }

  /**
   * 执行一次检查
   */
  async _runCheck() {
    if (this.isRunning) {
      console.warn('[Volatility] 上次检查仍在运行，跳过本次');
      return;
    }
    
    // 检查系统总开关
    if (!this.configManager.isSystemEnabled()) {
      console.log('[Volatility] 系统总开关已关闭，跳过检查');
      return;
    }
    
    // 检查波动模块开关
    const config = this.configManager.config;
    const volatilityModule = config.volatilityModule || {};
    
    if (!volatilityModule.enabled) {
      console.log('[Volatility] 波动模块已关闭，跳过检查');
      return;
    }
    
    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      console.log('[Volatility] 开始检查...');
      
      // 每次检查都从 config 读取最新参数
      const windowMinutes = volatilityModule.windowMinutes || 5;
      const thresholdPercent = volatilityModule.thresholdPercent || 20;
      const scope = volatilityModule.scope || 'global';
      
      console.log(`[Volatility] 参数：window=${windowMinutes}min, threshold=${thresholdPercent}%, scope=${scope}`);
      
      let volatilitySymbols = [];
      
      if (scope === 'global') {
        // 全局模式：现货 USDT + Alpha 全量
        const [binanceSymbols, alphaSymbols] = await Promise.all([
          this._getBinanceSymbols(),
          this._getAlphaSymbols()
        ]);
        
        // 现货 USDT
        volatilitySymbols = binanceSymbols.map(symbol => ({
          symbol,
          source: 'spot'
        }));
        
        // Alpha 全量
        const alphaSymbolsMapped = alphaSymbols.map(symbol => ({
          symbol,
          source: 'alpha'
        }));
        
        volatilitySymbols = [...volatilitySymbols, ...alphaSymbolsMapped];
        console.log(`[Volatility] 全局监控：${binanceSymbols.length} 现货 + ${alphaSymbols.length} Alpha = ${volatilitySymbols.length} 总币种`);
      } else {
        // added 模式：监控列表所有币种
        const allSymbols = config.symbols || [];
        volatilitySymbols = allSymbols.map(s => ({
          symbol: s.symbol,
          source: s.source || 'spot'
        }));
        console.log(`[Volatility] 已添加币种模式：${allSymbols.length} 个币种`);
      }
      
      let volatilityTriggers = 0;
      const silenceMinutes = this.configManager.getSettings().alertSilenceMinutes || 5;
      const silenceMs = silenceMinutes * 60 * 1000;
      console.log(`[Volatility] 静默期配置：${silenceMinutes}分钟 (${silenceMs}ms)`);
      const now = Date.now();
      
      // 获取告警状态
      const alertState = await this.storage.getAlertState();
      const volatilityState = alertState.volatility || {};
      
      for (const symbolConfig of volatilitySymbols) {
        const symbol = symbolConfig.symbol;
        const source = symbolConfig.source;
        const ca = symbolConfig.ca;
        
        // 获取最新价格（Alpha 使用 ca 作为 key）
        const priceKey = (source === 'alpha' && ca) ? ca : symbol;
        const latestPrice = this.storage.getLatestPrice(priceKey);
        
        if (!latestPrice) {
          // 全局模式下，很多币种没有价格数据是正常的
          if (scope !== 'global') {
            console.warn(`[Volatility] ${symbol} 无价格数据，跳过`);
          }
          continue;
        }
        
        // 检查静默期（使用 symbol 作为 key，便于用户理解）
        const volatilityKey = `${symbol}_volatility`;
        if (!this.storage.canAlert(volatilityKey)) {
          const silenceUntil = this.storage.getSilenceUntil(volatilityKey);
          const remainingMs = silenceUntil - now;
          const remainingMin = Math.ceil(remainingMs / 60000);
          if (volatilitySymbols.length <= 10 || volatilitySymbols.indexOf(symbolConfig) < 5) {
            console.log(`[Volatility] ${symbol} 静默期中，剩余 ${remainingMin} 分钟`);
          }
          continue;
        }
        
        // 构建波动配置（每次从 config 读取）
        const volatility = {
          windowMinutes,
          thresholdPercent,
          enabled: true
        };
        
        // 调试日志：打印实际使用的配置（只打印前 5 个，避免日志过多）
        if (volatilitySymbols.length <= 10 || volatilitySymbols.indexOf(symbolConfig) < 5) {
          console.log(`[Volatility] ${symbol} 波动检查：window=${volatility.windowMinutes}min, threshold=${volatility.thresholdPercent}%`);
        }
        
        const volatilityResult = this.volatilityMonitor.check(priceKey, volatility);
        
        if (volatilityResult) {
          if (volatilitySymbols.length <= 10 || volatilitySymbols.indexOf(symbolConfig) < 5) {
            const volValue = (volatilityResult.volatility || 0).toFixed(2);
            console.log(`[Volatility] ${symbol} 波动结果：${volValue}%, 阈值=${volatilityResult.threshold}%, 触发=${volatilityResult.isTriggered}`);
          }
        }
        
        if (volatilityResult && volatilityResult.isTriggered) {
          console.log(`[Volatility] ${symbol} 触发，调用 handleTrigger...`);
          
          // 调用 handleTrigger 处理静默期和通知
          const success = await this.volatilityMonitor.handleTrigger(volatilityResult);
          
          console.log(`[Volatility] ${symbol} handleTrigger 返回：${success}`);
          
          if (success) {
            volatilityTriggers++;
          }
        }
      }
      
      // 处理失败队列
      await this.alertService.processFailedQueue();
      
      // 更新统计
      this.lastCheckTime = startTime;
      this.checkCount++;
      
      const duration = Date.now() - startTime;
      console.log(`[Volatility] 检查完成，耗时 ${duration}ms, 触发：${volatilityTriggers}`);
      
    } catch (err) {
      console.error(`[Volatility] 检查失败：${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 获取检查统计
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      checkCount: this.checkCount,
      lastCheckTime: this.lastCheckTime,
      intervalMinutes: this.configManager.getSettings().checkIntervalMinutes || 1
    };
  }

  /**
   * 手动触发检查
   */
  async runManual() {
    console.log('[Volatility] 手动触发检查');
    await this._runCheck();
  }
}

module.exports = VolatilityEngine;
