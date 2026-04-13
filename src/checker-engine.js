/**
 * checker-engine.js - 价格监控引擎模块
 * 
 * 职责：
 * - 每分钟执行一次全量检查
 * - 遍历所有启用的币种配置
 * - 执行 TargetMonitor 检查
 * - 收集触发的告警
 * - 调用 AlertService 发送通知
 * - 更新告警状态（冷却时间、完成状态）
 * - 持久化状态到存储
 * 
 * 注意：波动侦测逻辑已移至 VolatilityEngine（独立模块）
 */

class CheckerEngine {
  constructor(configManager, storage, alertService, targetMonitor) {
    this.configManager = configManager;
    this.storage = storage;
    this.alertService = alertService;
    this.targetMonitor = targetMonitor;
    
    this.checkInterval = null;
    this.isRunning = false;
    this.lastCheckTime = null;
    this.checkCount = 0;
  }
  
  /**
   * 启动检查引擎
   */
  start() {
    console.log('[Checker] 启动（事件驱动模式）');
    // 事件驱动：由 storage 价格更新钩子触发 _runCheckForSymbol
    // 保留 runManual 供手动触发与排障使用
  }

  /**
   * 停止检查引擎
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[Checker] 已停止');
    }
  }

  /**
   * 执行一次检查
   */
  async _runCheck() {
    // 兼容保留：手动触发时执行全量检查
    if (this.isRunning) {
      console.warn('[Checker] 上次检查仍在运行，跳过本次');
      return;
    }

    // 检查系统总开关
    if (!this.configManager.isSystemEnabled()) {
      console.log('[Checker] 系统总开关已关闭，跳过检查');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const enabledSymbols = this.configManager.getEnabledSymbols();
      if (enabledSymbols.length === 0) return;

      let targetTriggers = 0;
      for (const symbolConfig of enabledSymbols) {
        targetTriggers += await this._runCheckForSymbol(symbolConfig);
      }

      await this.alertService.processFailedQueue();
      this.lastCheckTime = startTime;
      this.checkCount++;

      const duration = Date.now() - startTime;
      console.log(`[Checker] 手动全量检查完成，耗时 ${duration}ms, 目标触发：${targetTriggers}`);
    } catch (err) {
      console.error(`[Checker] 检查失败：${err.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 事件驱动：收到某币种价格更新时只检查该币种
   */
  async handlePriceUpdate(update) {
    if (!update?.symbol || !this.configManager.isSystemEnabled()) return;

    const enabledSymbols = this.configManager.getEnabledSymbols();
    const symbolConfig = enabledSymbols.find(s => s.symbol === update.symbol);
    if (!symbolConfig) return;

    await this._runCheckForSymbol(symbolConfig, update.price);
  }

  async _runCheckForSymbol(symbolConfig, hintedPrice = null) {
    const { symbol, source, targets, alphaId } = symbolConfig;
    const priceKey = (source === 'alpha' && alphaId) ? alphaId : symbol;

    const latestPrice = hintedPrice !== null
      ? { price: hintedPrice }
      : this.storage.getLatestPrice(priceKey, 'monitor');

    if (!latestPrice) return 0;

    const triggeredTargets = this.targetMonitor.check(symbol, latestPrice.price, targets);
    let targetTriggers = 0;

    for (const target of triggeredTargets) {
      const success = await this.targetMonitor.handleTrigger(symbol, target, latestPrice.price);
      if (success) targetTriggers++;
    }

    if (targetTriggers > 0) {
      this.lastCheckTime = Date.now();
      this.checkCount++;
    }

    return targetTriggers;
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
    console.log('[Checker] 手动触发检查');
    await this._runCheck();
  }
}

module.exports = CheckerEngine;
