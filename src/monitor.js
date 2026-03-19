/**
 * monitor.js - 系统监控模块
 * 
 * 功能：
 * - 内存使用监控
 * - 连接健康检查
 * - 定期垃圾回收提示
 * - 资源告警
 */

class SystemMonitor {
  constructor(wsConnector, storage) {
    this.wsConnector = wsConnector;
    this.storage = storage;
    
    this.memoryCheckInterval = null;
    this.healthCheckInterval = null;
    
    // 内存阈值（MB）
    this.warnThreshold = 350;
    this.errorThreshold = 380;
    
    // 统计
    this.gcCount = 0;
    this.lastGcTime = null;
  }

  /**
   * 启动监控
   */
  start() {
    console.log('[Monitor] 启动系统监控');
    
    // 内存检查：每 1 分钟
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemory();
    }, 60000);
    
    // 健康检查：每 5 分钟
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth();
    }, 5 * 60 * 1000);
    
    // 手动 GC：每 5 分钟（如果支持）
    setInterval(() => {
      this.triggerGC();
    }, 5 * 60 * 1000);
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    console.log('[Monitor] 系统监控已停止');
  }

  /**
   * 检查内存使用
   */
  checkMemory() {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const rssMB = usage.rss / 1024 / 1024;
    
    console.log(`[Monitor] 内存：${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (RSS: ${rssMB.toFixed(2)}MB)`);
    
    if (heapUsedMB > this.errorThreshold) {
      console.error(`[Monitor] ⚠️ 内存使用超过 ${this.errorThreshold}MB，可能即将 OOM`);
      this.triggerGC();
    } else if (heapUsedMB > this.warnThreshold) {
      console.warn(`[Monitor] ⚠️ 内存使用超过 ${this.warnThreshold}MB，触发 GC`);
      this.triggerGC();
    }
    
    return {
      heapUsed: heapUsedMB,
      heapTotal: heapTotalMB,
      rss: rssMB,
      external: usage.external / 1024 / 1024
    };
  }

  /**
   * 检查连接健康
   */
  checkHealth() {
    // WebSocket 连接健康
    const wsHealth = this.wsConnector.checkHealth();
    
    if (wsHealth.unhealthy > 0) {
      console.warn(`[Monitor] ⚠️ ${wsHealth.unhealthy}/${wsHealth.total} 个 WS 连接数据异常`);
    } else {
      console.log(`[Monitor] WS 连接健康：${wsHealth.total} 个正常`);
    }
    
    // 价格数据检查
    const priceStats = this._checkPriceData();
    
    return {
      ws: wsHealth,
      price: priceStats
    };
  }

  /**
   * 检查价格数据
   */
  _checkPriceData() {
    const now = Date.now();
    const issues = [];
    
    // 这里可以检查存储中的价格数据新鲜度
    // 由于数据在内存中，主要通过 WS 连接健康来间接判断
    
    return {
      checked: true,
      issues: issues
    };
  }

  /**
   * 触发垃圾回收
   */
  triggerGC() {
    if (global.gc) {
      global.gc();
      this.gcCount++;
      this.lastGcTime = Date.now();
      console.log('[Monitor] 手动 GC 已触发');
    } else {
      // Node.js 未启用 --expose-gc
      console.debug('[Monitor] GC 不可用（未启用 --expose-gc）');
    }
  }

  /**
   * 获取监控统计
   */
  getStats() {
    const usage = process.memoryUsage();
    
    return {
      memory: {
        heapUsed: usage.heapUsed / 1024 / 1024,
        heapTotal: usage.heapTotal / 1024 / 1024,
        rss: usage.rss / 1024 / 1024,
        external: usage.external / 1024 / 1024
      },
      gc: {
        count: this.gcCount,
        lastGcTime: this.lastGcTime
      },
      uptime: process.uptime()
    };
  }
}

module.exports = SystemMonitor;
