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
   * 获取 Alpha 全量币种列表（包含 symbol、ca、displayName）
   * 优先从 wsConnector.symbolCache 获取（WebSocket 全量推送时动态建立）
   * @returns {Array<{symbol: string, ca: string, source: string, displayName: string}>}
   */
  async _getAlphaSymbols() {
    // 尝试从 wsConnector 的 symbolCache 获取（全量推送时已建立映射）
    if (this.wsConnector && this.wsConnector.symbolCache && this.wsConnector.symbolCache.size > 0) {
      const result = [];
      
      for (const [ca, symbol] of this.wsConnector.symbolCache.entries()) {
        const displayName = this.storage.getSymbolForCa(ca) || symbol;
        if (!displayName || /^\d+$/.test(String(displayName))) {
          continue;
        }
        
        result.push({
          symbol: displayName,
          ca,              // 合约地址
          source: 'alpha',
          displayName      // 币种名称（如 "CYS"）或数字 ID
        });
      }
      console.log(`[Volatility] Alpha 全量币种：${result.length} 个 (from symbolCache)`);
      return result;
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
    // 修复：不依赖 symbolCache，而是检查是否有实际价格数据
    const hasPriceData = this.storage && this.storage.priceBuffers && this.storage.priceBuffers.size > 0;
    
    if (!hasPriceData) {
      // 无价格数据，发送等待通知
      console.log(`[Volatility] 等待价格数据流入...`);
      
      if (this.alertService) {
        this.alertService.sendTextToTelegram('🌊 波动侦测启动中\n\n正在等待价格数据流入...\n请稍候，预计 10-30 秒').catch(err => {
          console.error('[Volatility] 发送等待通知失败:', err.message);
        });
      }
      
      // 轮询检查 priceBuffers，有数据后再开始
      const checkInterval = setInterval(() => {
        if (this.storage.priceBuffers.size > 0) {
          clearInterval(checkInterval);
          const count = this.storage.priceBuffers.size;
          console.log(`[Volatility] 价格数据已就绪 (${count} 个币种)，开始第一次检查...`);
          
          // 发送就绪通知
          if (this.alertService) {
            this.alertService.sendTextToTelegram(`✅ 价格数据已就绪\n\n已收录 ${count} 个币种\n开始波动检查...`).catch(err => {
              console.error('[Volatility] 发送就绪通知失败:', err.message);
            });
          }
          
          this._runCheck();
        }
      }, 2000);
      
      // 超时保护：30 秒后无论有没有数据都开始检查
      setTimeout(() => {
        clearInterval(checkInterval);
        if (this.storage.priceBuffers.size === 0) {
          console.warn(`[Volatility] 等待价格数据超时，直接开始检查`);
          if (this.alertService) {
            this.alertService.sendTextToTelegram('⚠️ 等待价格数据超时\n\n直接开始检查\n价格数据可能延迟').catch(err => {
              console.error('[Volatility] 发送超时通知失败:', err.message);
            });
          }
        }
        this._runCheck();
      }, 30000);
    } else {
      // 已有价格数据，直接开始
      const count = this.storage.priceBuffers.size;
      console.log(`[Volatility] 价格数据已就绪 (${count} 个币种)，开始第一次检查...`);
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
      
      // 强制刷入 pending 数据，确保价格数据最新
      if (this.storage) {
        this.storage.flushPending();
      }
      
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
        
        console.log(`[Volatility] _getAlphaSymbols 返回：${alphaSymbols.length} 个 Alpha 币种`);
        if (alphaSymbols.length > 0 && alphaSymbols.length <= 10) {
          console.log(`[Volatility] Alpha 币种列表：${alphaSymbols.slice(0, 10).map(a => a.symbol).join(', ')}`);
        }
        
        // 现货 USDT
        volatilitySymbols = binanceSymbols.map(symbol => ({
          symbol,
          source: 'spot'
        }));
        
        // Alpha 全量（_getAlphaSymbols 已返回完整对象）
        volatilitySymbols = [...volatilitySymbols, ...alphaSymbols];
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
      
      // 调试：统计 Alpha 币种价格数据
      let alphaWithPrice = 0;
      let alphaWithoutPrice = 0;
      let spotWithPrice = 0;
      let spotWithoutPrice = 0;
      
      for (const symbolConfig of volatilitySymbols) {
        const symbol = symbolConfig.symbol;
        const source = symbolConfig.source;
        const ca = symbolConfig.ca;
        let displayName = (source === 'alpha' && ca)
          ? (this.storage.getSymbolForCa(ca) || symbolConfig.displayName || symbol)
          : (symbolConfig.displayName || symbol);
        
        // 规范化 symbol：去掉 USDT 后缀，确保静默期 key 一致
        displayName = displayName.replace(/USDT$/i, '').toUpperCase();
        
        // 获取最新价格（Alpha 使用 ca 作为 key）
        const priceKey = (source === 'alpha' && ca) ? ca : symbol;
        const latestPrice = this.storage.getLatestPrice(priceKey);
        
        // 统计
        if (source === 'alpha') {
          if (latestPrice) alphaWithPrice++; else alphaWithoutPrice++;
        } else {
          if (latestPrice) spotWithPrice++; else spotWithoutPrice++;
        }
        
        if (!latestPrice) {
          // 全局模式下，很多币种没有价格数据是正常的
          if (scope !== 'global') {
            console.warn(`[Volatility] ${displayName} 无价格数据，跳过`);
          }
          continue;
        }
        
        // 检查静默期（使用 displayName 作为 key，便于用户理解）
        const volatilityKey = `${displayName}_volatility`;
        if (!this.storage.canAlert(volatilityKey)) {
          const silenceUntil = this.storage.getSilenceUntil(volatilityKey);
          const remainingMs = silenceUntil - now;
          const remainingMin = Math.ceil(remainingMs / 60000);
          if (volatilitySymbols.length <= 10 || volatilitySymbols.indexOf(symbolConfig) < 5) {
            console.log(`[Volatility] ${displayName} 静默期中，剩余 ${remainingMin} 分钟`);
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
        
        let volatilityResult = this.volatilityMonitor.check(priceKey, volatility);
        
        if (volatilityResult) {
          // 修复：将 symbol 替换为显示名称（而不是数字 ID 或 ca）
          volatilityResult.symbol = displayName;
          volatilityResult.sourceType = source;  // 传递来源类型（alpha/spot）
          
          if (volatilitySymbols.length <= 10 || volatilitySymbols.indexOf(symbolConfig) < 5) {
            const volValue = (volatilityResult.volatility || 0).toFixed(2);
            console.log(`[Volatility] ${displayName} 波动结果：${volValue}%, 阈值=${volatilityResult.threshold}%, 触发=${volatilityResult.isTriggered}`);
          }
        }
        
        if (volatilityResult && volatilityResult.isTriggered) {
          console.log(`[Volatility] ${displayName} 触发，调用 handleTrigger...`);
          
          // 调用 handleTrigger 处理静默期和通知
          const success = await this.volatilityMonitor.handleTrigger(volatilityResult);
          
          console.log(`[Volatility] ${displayName} handleTrigger 返回：${success}`);
          
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
      console.log(`[Volatility] 价格数据统计：现货 ${spotWithPrice}/${spotWithPrice + spotWithoutPrice}, Alpha ${alphaWithPrice}/${alphaWithPrice + alphaWithoutPrice}`);
      
    } catch (err) {
      console.error(`[Volatility] 检查失败：${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 处理单个价格更新（实时波动检查）
   * 由 Storage 的价格更新钩子触发
   * @param {Object} update - {key, symbol, time, price, volume, source}
   */
  async handlePriceUpdate(update) {
    // 检查波动模块开关
    const config = this.configManager.config;
    const volatilityModule = config.volatilityModule || {};
    
    if (!volatilityModule.enabled) {
      return; // 波动模块关闭，不处理
    }
    
    const scope = volatilityModule.scope || 'global';
    
    // 判断是否需要检查该币种
    if (scope === 'added') {
      // 监控列表模式：只检查 config.symbols 中的币种
      const monitoredSymbols = (config.symbols || []).map(s => s.symbol);
      if (!monitoredSymbols.includes(update.symbol)) {
        return; // 不在监控列表中，跳过
      }
    }
    // global 模式：所有价格流入都检查
    
    // 获取配置参数
    const windowMinutes = volatilityModule.windowMinutes || 5;
    const thresholdPercent = volatilityModule.thresholdPercent || 20;
    
    // 构建波动配置
    const volatility = {
      windowMinutes,
      thresholdPercent,
      enabled: true
    };
    
    // 检查波动
    const priceKey = update.key;
    const volatilityResult = this.volatilityMonitor.check(priceKey, volatility);
    
    if (volatilityResult && volatilityResult.isTriggered) {
      // 修复：使用正确的显示名称和来源
      // 规范化 symbol：去掉 USDT 后缀，确保静默期 key 一致
      const normalizedSymbol = update.symbol.replace(/USDT$/i, '').toUpperCase();
      volatilityResult.symbol = normalizedSymbol;
      volatilityResult.sourceType = update.source;
      
      console.log(`[Volatility] ${update.symbol} 实时触发：${volatilityResult.volatility?.toFixed(2)}%`);
      
      // 调用 handleTrigger 处理静默期和通知
      await this.volatilityMonitor.handleTrigger(volatilityResult);
    }
  }
  
  /**
   * 刷新监控币种列表（配置变更时调用）
   */
  refreshMonitoredSymbols() {
    console.log('[Volatility] 监控列表已刷新');
    // 下一次价格更新时会自动使用新的配置
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
