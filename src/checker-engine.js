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
      
      // 价格目标检查：只检查启用的币种
      const enabledSymbols = this.configManager.getEnabledSymbols();
      
      if (enabledSymbols.length === 0) {
        console.log('[Checker] 没有启用的币种，跳过');
        return;
      }
      
      let targetTriggers = 0;
      
      // 检查价格目标
      for (const symbolConfig of enabledSymbols) {
        const { symbol, source, targets, ca } = symbolConfig;
        
        // 获取最新价格（Alpha 使用 ca 作为 key）
        const priceKey = (source === 'alpha' && ca) ? ca : symbol;
        const latestPrice = this.storage.getLatestPrice(priceKey);
        
        if (!latestPrice) {
          console.warn(`[Checker] ${symbol} 无价格数据，跳过`);
          continue;
        }
        
        // 检查价格目标（使用 symbol 用于显示）
        const triggeredTargets = this.targetMonitor.check(symbol, latestPrice.price, targets);
        
        for (const target of triggeredTargets) {
          const success = await this.targetMonitor.handleTrigger(symbol, target, latestPrice.price);
          if (success) {
            targetTriggers++;
          }
        }
      }
      
      // 处理失败队列
      await this.alertService.processFailedQueue();
      
      // 更新统计
      this.lastCheckTime = startTime;
      this.checkCount++;
      
      const duration = Date.now() - startTime;
      console.log(`[Checker] 检查完成，耗时 ${duration}ms, 目标触发：${targetTriggers}`);
      
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
