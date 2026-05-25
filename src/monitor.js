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
  constructor(wsConnector, storage, alertService) {
    this.wsConnector = wsConnector;
    this.storage = storage;
    this.alertService = alertService || null;
    
    this.memoryCheckInterval = null;
    this.healthCheckInterval = null;
    
    // 内存阈值（MB）
    this.warnThreshold = 350;
    this.errorThreshold = 380;
    
    // 统计
    this.gcCount = 0;
    this.lastGcTime = null;
    
    // API 探针
    this.lastProbeTime = 0;
    this.probeIntervalMs = 24 * 60 * 60 * 1000; // 24 小时
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
    
    // 每 24h 执行 API 探针
    if (Date.now() - this.lastProbeTime >= this.probeIntervalMs) {
      this.runApiProbes().catch(err => {
        console.error('[Monitor] API 探针异常:', err.message);
      });
    }
    
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
   * API 格式探针 - 每 24h 检测关键外部接口
   * 失败时发 TG + Bark 紧急通知
   */
  async runApiProbes() {
    this.lastProbeTime = Date.now();
    console.log('[Monitor] 开始 API 格式探针...');

    const results = [];

    // 探针 1: 现货 API
    results.push(await this._probe('现货 API', async () => {
      const res = await fetch('https://api.binance.com/api/v3/exchangeInfo', { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.symbols)) throw new Error('缺少 symbols 数组');
      return `${data.symbols.length} 个交易对`;
    }));

    // 探针 2: Alpha API
    results.push(await this._probe('Alpha API', async () => {
      const res = await fetch('https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list', { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.data)) throw new Error('缺少 data 数组');
      return `${data.data.length} 个代币`;
    }));

    // 探针 3: Alpha WebSocket 格式
    results.push(await this._probe('Alpha WS 格式', async () => {
      const { WebSocket } = require('ws');
      return new Promise((resolve, reject) => {
        const ws = new WebSocket('wss://nbstream.binance.com/w3w/wsa/stream');
        const timer = setTimeout(() => { ws.close(); reject(new Error('超时 10s')); }, 10000);
        ws.on('open', () => {
          ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: ['!miniTicker@arr'], id: Date.now() }));
        });
        ws.on('message', (data) => {
          clearTimeout(timer);
          const msg = JSON.parse(data.toString());
          if (msg.data && Array.isArray(msg.data) && msg.data[0]?.s) {
            ws.close();
            resolve(`格式正常，示例: ${msg.data[0].s}`);
          } else if (msg.id) {
            // 订阅确认，继续等数据
            return;
          } else {
            ws.close();
            reject(new Error(`格式异常: ${JSON.stringify(msg).substring(0, 200)}`));
          }
        });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
    }));

    // 探针 4: 现货 WebSocket 格式
    results.push(await this._probe('现货 WS 格式', async () => {
      const { WebSocket } = require('ws');
      return new Promise((resolve, reject) => {
        const ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');
        const timer = setTimeout(() => { ws.close(); reject(new Error('超时 10s')); }, 10000);
        ws.on('message', (data) => {
          clearTimeout(timer);
          const msg = JSON.parse(data.toString());
          if (Array.isArray(msg) && msg[0]?.s) {
            ws.close();
            resolve(`格式正常，${msg.length} 个币种，示例: ${msg[0].s}`);
          } else {
            ws.close();
            reject(new Error(`格式异常: ${JSON.stringify(msg).substring(0, 200)}`));
          }
        });
        ws.on('error', (err) => { clearTimeout(timer); reject(err); });
      });
    }));

    // 探针 5: Telegram API
    results.push(await this._probe('Telegram API', async () => {
      const tgBotToken = process.env.TG_BOT_TOKEN;
      if (!tgBotToken) return '跳过（TG_BOT_TOKEN 未配置）';
      const res = await fetch(`https://api.telegram.org/bot${tgBotToken}/getMe`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(`Telegram 错误: ${data.description}`);
      return `Bot: ${data.result?.username || 'unknown'}`;
    }));

    // 汇总
    const failures = results.filter(r => !r.ok);
    const summary = results.map(r => `${r.ok ? '✅' : '❌'} ${r.name}: ${r.ok ? r.detail : r.error}`).join('\n');
    console.log(`[Monitor] API 探针完成: ${results.length - failures.length}/${results.length} 通过`);

    if (failures.length > 0) {
      const failNames = failures.map(r => r.name).join('、');
      const failDetails = failures.map(r => `${r.name}: ${r.error}`).join('\n');
      const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

      const tgMessage = `⚠️ API 格式探针异常\n\n${failDetails}\n\n时间: ${time}\n通过: ${results.length - failures.length}/${results.length}`;

      // 发 TG
      if (this.alertService) {
        this.alertService.sendTextToTelegram(tgMessage).catch(err => {
          console.error('[Monitor] 探针 TG 通知发送失败:', err.message);
        });

        // 发 Bark 紧急通知
        const barkKey = process.env.BARK_KEY;
        if (barkKey) {
          const barkConfig = {
            key: barkKey,
            serverUrl: 'https://api.day.app'
          };
          const barkMsg = { title: `⚠️ API 探针异常: ${failNames}`, content: failDetails };
          this.alertService.notificationService?.barkSender?.send(barkConfig, barkMsg, 'critical').catch(err => {
            console.error('[Monitor] 探针 Bark 通知发送失败:', err.message);
          });
        }
      }
    }
  }

  /**
   * 执行单个探针，捕获异常
   */
  async _probe(name, fn) {
    try {
      const detail = await fn();
      return { name, ok: true, detail };
    } catch (err) {
      return { name, ok: false, error: err.message };
    }
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
