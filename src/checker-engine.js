/**
 * checker-engine.js - 检查引擎模块
 * 
 * 职责：
 * - 每分钟执行一次全量检查
 * - 遍历所有 active 配置
 * - 执行 TargetMonitor 检查
 * - 执行 VolatilityMonitor 检查
 * - 收集触发的告警
 * - 调用 AlertService 发送通知
 * - 更新告警状态（冷却时间、完成状态）
 * - 持久化状态到存储
 */

class CheckerEngine {
  constructor(configManager, storage, alertService, targetMonitor, volatilityMonitor) {
    this.configManager = configManager;
    this.storage = storage;
    this.alertService = alertService;
    this.targetMonitor = targetMonitor;
    this.volatilityMonitor = volatilityMonitor;
    
    this.checkInterval = null;
    this.isRunning = false;
    this.lastCheckTime = null;
    this.checkCount = 0;
  }

  /**
   * 启动检查引擎
   */
  start() {
    const intervalMinutes = this.configManager.getSettings().checkIntervalMinutes || 1;
    const intervalMs = intervalMinutes * 60 * 1000;
    
    console.log(`[Checker] 启动，检查间隔：${intervalMinutes} 分钟`);
    
    // 立即执行一次
    this._runCheck();
    
    // 定时执行
    this.checkInterval = setInterval(() => {
      this._runCheck();
    }, intervalMs);
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
      console.log('[Checker] 开始检查...');
      
      // 获取所有启用的币种
      const symbols = this.configManager.getEnabledSymbols();
      
      if (symbols.length === 0) {
        console.log('[Checker] 没有启用的币种，跳过');
        return;
      }
      
      let targetTriggers = 0;
      let volatilityTriggers = 0;
      
      // 遍历所有币种
      for (const symbolConfig of symbols) {
        const { symbol, source, targets, volatility } = symbolConfig;
        
        // 获取最新价格
        const latestPrice = this.storage.getLatestPrice(symbol);
        
        if (!latestPrice) {
          console.warn(`[Checker] ${symbol} 无价格数据，跳过`);
          continue;
        }
        
        // 检查价格目标
        const triggeredTargets = this.targetMonitor.check(symbol, latestPrice.price, targets);
        
        for (const target of triggeredTargets) {
          const success = await this.targetMonitor.handleTrigger(symbol, target, latestPrice.price);
          if (success) {
            targetTriggers++;
          }
        }
        
        // 检查波动
        const volatilityResult = this.volatilityMonitor.check(symbol, volatility);
        
        if (volatilityResult && volatilityResult.isTriggered) {
          const success = await this.volatilityMonitor.handleTrigger(volatilityResult);
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
      console.log(`[Checker] 检查完成，耗时 ${duration}ms, ` +
        `目标触发：${targetTriggers}, 波动触发：${volatilityTriggers}`);
      
    } catch (err) {
      console.error(`[Checker] 检查失败：${err.message}`);
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
    console.log('[Checker] 手动触发检查');
    await this._runCheck();
  }
}

module.exports = CheckerEngine;
