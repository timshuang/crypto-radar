/**
 * storage.js - 数据存储模块
 * 
 * 功能：
 * - JSON 文件持久化
 * - 价格历史记录（滑动窗口，1440 条/币种）
 * - 告警状态管理
 * - 内存优化：使用 TypedArray 减少占用
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * 价格缓冲区 - 使用 TypedArray 优化内存
 */
class PriceBuffer {
  constructor(maxSize = 1440) {
    this.maxSize = maxSize;
    // 使用并行 TypedArray 减少内存占用
    this.times = new Uint32Array(maxSize);      // 秒级时间戳
    this.prices = new Float64Array(maxSize);    // 价格
    this.volumes = new Float32Array(maxSize);   // 成交量
    this.head = 0;                               // 写入位置（循环缓冲区）
    this.count = 0;                              // 实际记录数
  }

  /**
   * 添加价格记录
   */
  push(time, price, volume = 0) {
    const idx = this.head % this.maxSize;
    this.times[idx] = Math.floor(time / 1000);  // 转为秒级时间戳
    this.prices[idx] = price;
    this.volumes[idx] = volume;
    this.head++;
    if (this.count < this.maxSize) {
      this.count++;
    }
  }

  /**
   * 获取滑动窗口内的最高价和最低价
   */
  getWindowStats(windowMinutes) {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - (windowMinutes * 60);
    
    let min = Infinity;
    let max = -Infinity;
    let found = false;
    let startPrice = null;
    let endPrice = null;

    // 从后向前遍历（最新的数据）
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - 1 - i + this.maxSize) % this.maxSize;
      const time = this.times[idx];
      
      if (time < windowStart) break;
      
      const price = this.prices[idx];
      if (endPrice === null) {
        endPrice = price;
      }
      startPrice = price;
      if (price < min) min = price;
      if (price > max) max = price;
      found = true;
    }

    return found ? { min, max, startPrice, endPrice } : null;
  }

  /**
   * 获取最新价格
   */
  getLatest() {
    if (this.count === 0) return null;
    const idx = (this.head - 1 + this.maxSize) % this.maxSize;
    return {
      time: this.times[idx] * 1000,
      price: this.prices[idx],
      volume: this.volumes[idx]
    };
  }

  /**
   * 获取记录数量
   */
  getCount() {
    return this.count;
  }

  /**
   * 导出为数组（用于持久化）
   */
  toArray() {
    const records = [];
    // 循环缓冲区：从实际起始位置开始遍历
    const startIdx = (this.head - this.count + this.maxSize) % this.maxSize;
    for (let i = 0; i < this.count; i++) {
      const idx = (startIdx + i) % this.maxSize;
      records.push({
        t: this.times[idx],
        p: this.prices[idx],
        v: this.volumes[idx]
      });
    }
    return records;
  }

  /**
   * 从数组恢复
   */
  fromArray(records) {
    this.head = 0;
    this.count = 0;
    
    for (const record of records) {
      this.push(record.t * 1000, record.p, record.v);
    }
  }
}

/**
 * 告警节流器 - 5 分钟静默期
 */
class AlertThrottle {
  constructor(silenceMinutes = 5) {
    this.silenceMs = silenceMinutes * 60 * 1000;
    this.silenceUntil = new Map(); // key => timestamp
  }

  /**
   * 检查是否可以发送告警
   */
  canAlert(key) {
    const now = Date.now();
    const until = this.silenceUntil.get(key);
    return !until || now >= until;
  }

  /**
   * 设置静默期
   */
  setSilence(key) {
    this.silenceUntil.set(key, Date.now() + this.silenceMs);
  }

  /**
   * 清除静默状态
   */
  clearSilence(key) {
    this.silenceUntil.delete(key);
  }

  /**
   * 持久化为 JSON
   */
  toJSON() {
    return Object.fromEntries(this.silenceUntil);
  }

  /**
   * 从 JSON 恢复
   */
  fromJSON(data) {
    if (data && typeof data === 'object') {
      this.silenceUntil = new Map(Object.entries(data));
    }
  }
}



/**
 * JSON 存储管理器 - 原子写入和备份
 */
class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {};
    this.writeQueue = Promise.resolve();
    this.pendingWrites = 0;
    this.saveTimer = null;
  }

  /**
   * 加载数据
   */
  async load() {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(content);
      console.log(`[Storage] 加载成功：${this.filePath}`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.data = {};
        console.log(`[Storage] 文件不存在，使用空数据：${this.filePath}`);
      } else {
        // 尝试从备份恢复
        try {
          const backupPath = this.filePath + '.bak';
          const content = await fs.readFile(backupPath, 'utf8');
          this.data = JSON.parse(content);
          console.log(`[Storage] 从备份恢复：${backupPath}`);
        } catch (backupErr) {
          console.warn(`[Storage] 备份也不存在，使用空数据`);
          this.data = {};
        }
      }
    }
  }

  /**
   * 保存数据（原子写入）
   */
  async save() {
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const tmpPath = this.filePath + '.tmp';
        const content = JSON.stringify(this.data, null, 2);
        await fs.writeFile(tmpPath, content, 'utf8');
        await fs.rename(tmpPath, this.filePath);
        console.log(`[Storage] 保存成功：${this.filePath}`);
      } catch (err) {
        console.error(`[Storage] 保存失败：${err.message}`);
      }
    });
    return this.writeQueue;
  }

  /**
   * 批量更新（带防抖）
   */
  batchUpdate(updates, delayMs = 1000) {
    Object.assign(this.data, updates);
    this.pendingWrites++;
    
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save().then(() => {
        this.pendingWrites = 0;
      });
    }, delayMs);
  }

  /**
   * 获取数据
   */
  get(key, defaultValue = null) {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  /**
   * 设置数据
   */
  set(key, value) {
    this.data[key] = value;
  }

  /**
   * 获取完整数据
   */
  getAll() {
    return { ...this.data };
  }
}

/**
 * 主存储管理器
 */
class StorageManager {
  constructor(dataDir = null) {
    this.dataDir = dataDir || path.join(__dirname, '..');
    
    // 初始化存储文件
    this.alertStateStore = new JsonStore(path.join(this.dataDir, 'alert_state.json'));
    this.priceHistoryStore = new JsonStore(path.join(this.dataDir, 'price_history.json'));
    this.alertHistoryStore = new JsonStore(path.join(this.dataDir, 'alert_history.json'));
    
    // 内存中的价格缓冲区（按币种）
    this.priceBuffers = new Map();
    
    // Alpha 符号映射（symbol -> ca，用于显示）
    this.symbolMapping = new Map(); // symbol -> ca
    this.reverseSymbolMapping = new Map(); // ca -> symbol
    
    // 告警节流器
    this.throttle = new AlertThrottle(5);
    
    // 报警历史（内存缓存）
    this.alertHistory = [];
  }

  /**
   * 初始化存储
   */
  async init(maxRecordsPerSymbol = 1440) {
    this.maxRecords = maxRecordsPerSymbol;
    
    // 加载持久化数据
    await this.alertStateStore.load();
    await this.priceHistoryStore.load();
    await this.alertHistoryStore.load();
    
    // 恢复告警节流状态
    const silenceData = this.alertStateStore.get('silenceUntil', {});
    this.throttle.fromJSON(silenceData);
    
    // 恢复价格历史到内存缓冲区
    const priceData = this.priceHistoryStore.getAll();
    for (const [displaySymbol, data] of Object.entries(priceData)) {
      if (data && Array.isArray(data.records)) {
        // 如果有 _key 字段，使用它作为内部 key（Alpha 的 ca）
        const internalKey = data._key || displaySymbol;
        
        const buffer = new PriceBuffer(this.maxRecords);
        buffer.fromArray(data.records);
        this.priceBuffers.set(internalKey, buffer);
        
        // 恢复符号映射（如果是 Alpha）
        if (data._key && data._key !== displaySymbol) {
          this.setSymbolMapping(displaySymbol, data._key);
        }
      }
    }
    
    // 恢复报警历史
    this.alertHistory = this.alertHistoryStore.get('history', []);
    
    console.log(`[Storage] 初始化完成，恢复 ${this.priceBuffers.size} 个币种的历史数据，${this.alertHistory.length} 条报警记录`);
  }

  /**
   * 获取或创建价格缓冲区
   */
  getPriceBuffer(symbol) {
    if (!this.priceBuffers.has(symbol)) {
      this.priceBuffers.set(symbol, new PriceBuffer(this.maxRecords));
    }
    return this.priceBuffers.get(symbol);
  }

  /**
   * 设置符号映射（Alpha：symbol -> ca）
   */
  setSymbolMapping(symbol, ca) {
    if (symbol && ca) {
      this.symbolMapping.set(symbol, ca);
      this.reverseSymbolMapping.set(ca, symbol);
    }
  }

  /**
   * 获取符号映射
   */
  getSymbolForCa(ca) {
    return this.reverseSymbolMapping.get(ca?.toLowerCase());
  }

  /**
   * 获取 Ca 对于符号
   */
  getCaForSymbol(symbol) {
    return this.symbolMapping.get(symbol);
  }

  /**
   * 添加价格记录
   * @param {string} key - 内部使用的 key（现货：symbol，Alpha：ca）
   * @param {number} time - 时间戳
   * @param {number} price - 价格
   * @param {number} volume - 成交量
   * @param {string} displaySymbol - 显示用的符号名（可选，用于 Alpha）
   */
  addPriceRecord(key, time, price, volume = 0, displaySymbol = null) {
    // 如果是 Alpha 且提供了 displaySymbol，记录映射关系
    if (displaySymbol && key !== displaySymbol) {
      this.setSymbolMapping(displaySymbol, key);
    }
    
    const buffer = this.getPriceBuffer(key);
    buffer.push(time, price, volume);
  }

  /**
   * 获取最新价格
   * @param {string} key - 内部使用的 key（现货：symbol，Alpha：ca）
   */
  getLatestPrice(key) {
    const buffer = this.priceBuffers.get(key);
    return buffer ? buffer.getLatest() : null;
  }

  /**
   * 获取最新价格（带显示符号）
   * @param {string} key - 内部使用的 key
   * @returns {object} - { time, price, volume, symbol }
   */
  getLatestPriceWithSymbol(key) {
    const latest = this.getLatestPrice(key);
    if (!latest) return null;
    
    // 如果是 Alpha（key 是 ca），获取显示用的 symbol
    const displaySymbol = this.getSymbolForCa(key);
    
    return {
      ...latest,
      symbol: displaySymbol || key
    };
  }

  /**
   * 获取滑动窗口统计
   * @param {string} key - 内部使用的 key（现货：symbol，Alpha：ca）
   * @param {number} windowMinutes - 时间窗口（分钟）
   */
  getWindowStats(key, windowMinutes) {
    const buffer = this.priceBuffers.get(key);
    return buffer ? buffer.getWindowStats(windowMinutes) : null;
  }

  /**
   * 持久化价格历史（批量）
   */
  async persistPriceHistory() {
    const priceData = {};
    
    for (const [key, buffer] of this.priceBuffers.entries()) {
      // 获取显示用的符号（Alpha 使用 symbol，现货使用 symbol）
      const displaySymbol = this.getSymbolForCa(key) || key;
      
      priceData[displaySymbol] = {
        lastUpdate: Date.now(),
        latestPrice: buffer.getLatest()?.price || 0,
        records: buffer.toArray(),
        _key: key !== displaySymbol ? key : undefined // 如果 key 和 symbol 不同，保存 key（用于 Alpha）
      };
    }
    
    this.priceHistoryStore.data = priceData;
    await this.priceHistoryStore.save();
  }

  /**
   * 获取目标状态
   */
  getTargetState(targetId) {
    const targets = this.alertStateStore.get('targets', {});
    return targets[targetId] || null;
  }

  /**
   * 更新目标状态
   */
  updateTargetState(targetId, symbol, type, price, status) {
    const targets = this.alertStateStore.get('targets', {});
    
    const now = Date.now();
    const existing = targets[targetId] || {};
    
    targets[targetId] = {
      ...existing,
      symbol,
      type,
      price,
      status,
      triggeredAt: status === 'triggered' ? (existing.triggeredAt || now) : existing.triggeredAt,
      completedAt: status === 'completed' ? now : existing.completedAt,
      lastAlertAt: now,
      alertCount: (existing.alertCount || 0) + 1
    };
    
    this.alertStateStore.set('targets', targets);
    this.alertStateStore.batchUpdate({ targets, lastUpdate: new Date().toISOString() });
  }

  /**
   * 获取波动状态
   */
  getVolatilityState(symbol) {
    const volatility = this.alertStateStore.get('volatility', {});
    return volatility[symbol] || null;
  }

  /**
   * 获取告警状态（用于波动侦测）
   */
  getAlertState() {
    // 返回完整的告警状态对象
    return {
      volatility: this.alertStateStore.get('volatility', {})
    };
  }

  /**
   * 更新波动告警状态（设置静默期）
   */
  setVolatilitySilence(symbol, silenceUntil) {
    const volatility = this.alertStateStore.get('volatility', {});
    
    if (!volatility[symbol]) {
      volatility[symbol] = {};
    }
    
    volatility[symbol].silenceUntil = silenceUntil;
    volatility[symbol].lastAlertAt = Date.now();
    
    this.alertStateStore.set('volatility', volatility);
    this.alertStateStore.batchUpdate({ volatility, lastUpdate: new Date().toISOString() });
  }

  /**
   * 保存告警状态（用于波动侦测）
   */
  async saveAlertState(alertState) {
    if (alertState.volatility) {
      this.alertStateStore.set('volatility', alertState.volatility);
      this.alertStateStore.batchUpdate({ volatility: alertState.volatility, lastUpdate: new Date().toISOString() });
    }
  }

  /**
   * 更新波动状态
   */
  updateVolatilityState(symbol, enabled, threshold) {
    const volatility = this.alertStateStore.get('volatility', {});
    
    let state = volatility[symbol];
    if (!state) {
      state = {
        enabled,
        lastTriggeredAt: null,
        lastAlertAt: null
      };
    }
    
    state.enabled = enabled;
    
    volatility[symbol] = state;
    this.alertStateStore.set('volatility', volatility);
    this.alertStateStore.batchUpdate({ volatility, lastUpdate: new Date().toISOString() });
  }

  /**
   * 触发波动告警
   */
  triggerVolatility(symbol) {
    const volatility = this.alertStateStore.get('volatility', {});
    const state = volatility[symbol];
    
    if (state) {
      const now = Date.now();
      state.lastTriggeredAt = now;
      state.lastAlertAt = now;
      
      volatility[symbol] = state;
      this.alertStateStore.set('volatility', volatility);
      this.alertStateStore.batchUpdate({ volatility, lastUpdate: new Date().toISOString() });
    }
  }

  /**
   * 检查是否可以发送告警
   */
  canAlert(key) {
    const can = this.throttle.canAlert(key);
    if (!can) {
      const silenceUntil = this.throttle.silenceUntil.get(key);
      const remainingMin = Math.ceil((silenceUntil - Date.now()) / 60000);
      console.log(`[Storage] canAlert: ${key} 在静默期，剩余 ${remainingMin}分钟`);
    }
    return can;
  }

  /**
   * 获取静默期结束时间
   */
  getSilenceUntil(key) {
    return this.throttle.silenceUntil.get(key) || 0;
  }

  /**
   * 设置告警静默
   */
  setAlertSilence(key) {
    this.throttle.setSilence(key);
    const silenceUntil = this.throttle.silenceUntil.get(key);
    const remainingMin = Math.ceil((silenceUntil - Date.now()) / 60000);
    console.log(`[Storage] setAlertSilence: ${key}, 静默期结束：${new Date(silenceUntil).toLocaleTimeString()}, 剩余：${remainingMin}分钟`);
    
    // 立即持久化（不使用 batchUpdate 的延迟）
    const silenceData = this.throttle.toJSON();
    this.alertStateStore.set('silenceUntil', silenceData);
    this.alertStateStore.save();  // 立即保存
  }

  /**
   * 定期清理过期数据
   */
  startCleanup(intervalMinutes = 5) {
    const maxAge = 24 * 60 * 60 * 1000; // 24 小时
    
    setInterval(() => {
      const now = Date.now();
      
      for (const [symbol, buffer] of this.priceBuffers.entries()) {
        // PriceBuffer 内部已通过循环缓冲区自动限制大小
        // 这里只需确保持久化时不会超出限制
        if (buffer.count > this.maxRecords) {
          console.log(`[Storage] 清理 ${symbol} 过期数据：${buffer.count} -> ${this.maxRecords}`);
        }
      }
      
      // 持久化价格历史
      this.persistPriceHistory();
      
      console.log(`[Storage] 定期清理完成`);
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * 获取报警历史
   */
  getAlertHistory() {
    return this.alertHistory;
  }

  /**
   * 保存报警历史
   */
  async saveAlertHistory(history) {
    this.alertHistory = history;
    this.alertHistoryStore.set('history', history);
    this.alertHistoryStore.set('lastUpdate', new Date().toISOString());
    await this.alertHistoryStore.save();
  }

  /**
   * 标记报警为已读
   */
  markAlertRead(alertId) {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (alert) {
      alert.read = true;
      this.alertHistoryStore.set('history', this.alertHistory);
      this.alertHistoryStore.save();
    }
  }

  /**
   * 清除报警历史
   */
  async clearAlertHistory() {
    this.alertHistory = [];
    await this.saveAlertHistory([]);
  }
}

// 导出单例
module.exports = new StorageManager();
