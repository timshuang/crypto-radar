/**
 * ws-connector.js - WebSocket 连接模块（v2 重构版）
 * 
 * 连接架构（最多 6 个连接）：
 * 
 * | 模块         | 模式       | 现货连接 | Alpha 连接 | 说明                      |
 * |--------------|------------|---------|-----------|---------------------------|
 * | 价格监控     | 组合流     | 1 个    | 1 个      | enabled: true 的币种      |
 * | 波动侦测     | 监控列表   | 1 个    | 1 个      | scope: 'added' 所有监控列表币种 |
 * | 波动侦测     | 全量推送   | 1 个    | 1 个      | scope: 'global' 全市场扫描 |
 * | **总计**     | -          | **3 个**| **3 个**  | **最多 6 个连接**         |
 * 
 * 功能：
 * - 组合流连接（单个连接订阅多个指定币种）
 * - 全量推送连接（!miniTicker@arr + came@allTokens@ticker24）
 * - 现货和 Alpha 独立连接
 * - 断线重连（指数退避：5s → 10s → 20s → 40s → 60s 上限）
 * - 唯一 ID 管理（现货：symbol，Alpha：合约地址 ca）
 */

const WebSocket = require('ws');

class WSConnector {
  constructor(dataManager) {
    this.dataManager = dataManager;
    
    // 连接池（最多 6 个连接）
    this.connections = {
      // 价格监控组合流
      priceMonitorSpot: null,
      priceMonitorAlpha: null,
      
      // 波动侦测（动态：组合流或全量推送）
      volatilitySpot: null,
      volatilityAlpha: null
    };
    
    // 币安 WebSocket 地址
    this.spotCombinedWsUrl = 'wss://stream.binance.com:9443/stream';
    this.spotFullWsUrl = 'wss://stream.binance.com:9443/ws/!miniTicker@arr';
    this.alphaWsUrl = 'wss://nbstream.binance.com/w3w/wsa/stream';
    
    // 心跳配置
    this.pingInterval = 30000; // 30 秒
    this.pongTimeout = 5000;   // 5 秒超时
    
    // 重连配置（指数退避）
    this.initialReconnectDelay = 5000;
    this.maxReconnectDelay = 60000; // 60 秒上限
    
    // 订阅管理
    this.priceMonitorSubscriptions = {
      spot: new Set(),    // 现货订阅列表（symbol）
      alpha: new Map()    // Alpha 订阅列表（ca -> symbol）
    };
    
    // 波动侦测模式
    this.volatilityMode = 'added'; // 'added' | 'global'
    
    // 符号映射缓存（全量推送时动态建立）
    this.symbolCache = new Map(); // ca -> symbol
  }

  /**
   * 设置波动侦测模式
   */
  setVolatilityMode(mode) {
    if (mode !== 'added' && mode !== 'global') {
      console.warn(`[WS] 无效的波动模式：${mode}，使用默认 'added'`);
      mode = 'added';
    }
    
    const oldMode = this.volatilityMode;
    this.volatilityMode = mode;
    
    console.log(`[WS] 波动侦测模式：${oldMode} -> ${mode}`);
    
    // 如果模式改变，需要重新连接波动侦测
    if (oldMode !== mode && (this.connections.volatilitySpot || this.connections.volatilityAlpha)) {
      console.log('[WS] 波动模式变更，需要重新连接波动侦测');
    }
  }

  /**
   * 构建现货组合流订阅列表
   */
  buildSpotCombinedStreams(symbols) {
    return symbols.map(symbol => `${symbol.toLowerCase()}@miniTicker`);
  }

  /**
   * 构建 Alpha 组合流订阅列表
   */
  buildAlphaSubscriptions(alphaTokens) {
    const subscriptions = new Map();
    
    for (const token of alphaTokens) {
      let caKey;
      
      if (token.ca) {
        // 优先使用 ca
        caKey = token.ca.toLowerCase();
      } else if (token.alphaId) {
        // 向后兼容：使用 alphaId
        caKey = token.alphaId.toLowerCase();
      } else {
        console.warn(`[WS] Alpha 代币 ${token.symbol} 缺少 ca 和 alphaId，跳过`);
        continue;
      }
      
      subscriptions.set(caKey, {
        symbol: token.symbol,
        ca: token.ca || token.alphaId,
        alphaId: token.alphaId,
        streamName: `alpha_${token.alphaId.replace('ALPHA_', '')}usdt@miniTicker`
      });
    }
    
    return subscriptions;
  }

  // ==================== 价格监控组合流 ====================

  /**
   * 连接价格监控现货组合流
   */
  connectPriceMonitorSpot(symbols) {
    if (!symbols || symbols.length === 0) {
      console.log('[WS] 价格监控现货：无订阅币种，跳过连接');
      return;
    }
    
    const streams = this.buildSpotCombinedStreams(symbols);
    const streamUrl = `${this.spotCombinedWsUrl}?streams=${streams.join('/')}`;
    
    console.log(`[WS] 价格监控现货组合流：${symbols.length} 个币种`);
    console.log(`[WS] 订阅流：${streams.join(', ')}`);
    
    this.priceMonitorSubscriptions.spot = new Set(symbols);
    this._connect('priceMonitorSpot', streamUrl, { type: 'spot-combined', symbols });
  }

  /**
   * 连接价格监控 Alpha 组合流
   */
  connectPriceMonitorAlpha(alphaTokens) {
    if (!alphaTokens || alphaTokens.length === 0) {
      console.log('[WS] 价格监控 Alpha：无订阅币种，跳过连接');
      return;
    }
    
    this.priceMonitorSubscriptions.alpha = this.buildAlphaSubscriptions(alphaTokens);
    const streamNames = Array.from(this.priceMonitorSubscriptions.alpha.values()).map(s => s.streamName);
    
    console.log(`[WS] 价格监控 Alpha 组合流：${alphaTokens.length} 个币种`);
    console.log(`[WS] 订阅流：${streamNames.join(', ')}`);
    
    this._connect('priceMonitorAlpha', this.alphaWsUrl, { 
      type: 'alpha-combined', 
      streamNames,
      alphaTokens 
    });
  }

  // ==================== 波动侦测（动态模式） ====================

  /**
   * 连接波动侦测现货（根据模式选择组合流或全量推送）
   * 注意：波动侦测独立于价格监控，使用所有监控列表币种（不管 enabled 状态）
   */
  connectVolatilitySpot(symbols, useAllSymbols = false) {
    if (this.volatilityMode === 'global') {
      // 全量推送模式
      console.log(`[WS] 波动侦测现货全量推送：!miniTicker@arr`);
      this._connect('volatilitySpot', this.spotFullWsUrl, { type: 'spot-full' });
    } else {
      // 监控列表模式（组合流）
      // 波动侦测使用所有监控列表币种（不管 enabled 状态）
      if (!symbols || symbols.length === 0) {
        console.log('[WS] 波动侦测现货：无订阅币种，跳过连接');
        return;
      }
      
      const streams = this.buildSpotCombinedStreams(symbols);
      const streamUrl = `${this.spotCombinedWsUrl}?streams=${streams.join('/')}`;
      
      console.log(`[WS] 波动侦测现货组合流：${symbols.length} 个币种（独立连接）`);
      console.log(`[WS] 订阅流：${streams.join(', ')}`);
      
      this._connect('volatilitySpot', streamUrl, { type: 'spot-combined', symbols });
    }
  }

  /**
   * 连接波动侦测 Alpha（根据模式选择组合流或全量推送）
   * 注意：波动侦测独立于价格监控，使用所有监控列表币种（不管 enabled 状态）
   */
  connectVolatilityAlpha(alphaTokens, useAllSymbols = false) {
    if (this.volatilityMode === 'global') {
      // 全量推送模式
      console.log(`[WS] 波动侦测 Alpha 全量推送：came@allTokens@ticker24`);
      this._connect('volatilityAlpha', this.alphaWsUrl, { 
        type: 'alpha-full',
        streamNames: ['came@allTokens@ticker24']
      });
    } else {
      // 监控列表模式（组合流）
      // 波动侦测使用所有监控列表币种（不管 enabled 状态）
      if (!alphaTokens || alphaTokens.length === 0) {
        console.log('[WS] 波动侦测 Alpha：无订阅币种，跳过连接');
        return;
      }
      
      const subscriptions = this.buildAlphaSubscriptions(alphaTokens);
      const streamNames = Array.from(subscriptions.values()).map(s => s.streamName);
      
      console.log(`[WS] 波动侦测 Alpha 组合流：${alphaTokens.length} 个币种（独立连接）`);
      console.log(`[WS] 订阅流：${streamNames.join(', ')}`);
      
      this._connect('volatilityAlpha', this.alphaWsUrl, { 
        type: 'alpha-combined', 
        streamNames,
        alphaTokens,
        subscriptions
      });
    }
  }

  // ==================== 内部连接实现 ====================

  /**
   * 通用连接方法
   */
  _connect(name, streamUrl, options) {
    // 清理旧连接
    if (this.connections[name]) {
      this._cleanupConnection(this.connections[name]);
    }
    
    const ws = new WebSocket(streamUrl);
    
    const connection = {
      name,
      ws,
      options,
      reconnectDelay: this.initialReconnectDelay,
      reconnectTimer: null,
      pingInterval: null,
      pongTimeout: null,
      lastMessageTime: 0,
      messageCount: 0
    };
    
    // 绑定事件处理
    ws.on('open', () => this._onOpen(connection));
    ws.on('message', (data) => this._onMessage(connection, data));
    ws.on('error', (err) => this._onError(connection, err));
    ws.on('close', (code, reason) => this._onClose(connection, code, reason));
    ws.on('pong', () => this._onPong(connection));
    
    this.connections[name] = connection;
  }

  /**
   * 连接成功处理
   */
  _onOpen(connection) {
    console.log(`[WS] ${connection.name} 连接成功`);
    connection.reconnectDelay = this.initialReconnectDelay;
    connection.lastMessageTime = Date.now();
    
    // Alpha 连接需要发送订阅消息
    if (connection.options.type.includes('alpha') && connection.options.streamNames) {
      const subscribeMsg = {
        method: 'SUBSCRIBE',
        params: connection.options.streamNames,
        id: Date.now()
      };
      connection.ws.send(JSON.stringify(subscribeMsg));
      console.log(`[WS] ${connection.name} 已订阅 ${connection.options.streamNames.length} 个流`);
    }
    
    // 启动心跳检测
    this._startHeartbeat(connection);
  }

  /**
   * 收到消息处理
   */
  _onMessage(connection, data) {
    try {
      const msg = JSON.parse(data.toString());
      connection.lastMessageTime = Date.now();
      connection.messageCount++;
      
      const { type } = connection.options;
      
      // 现货全量推送（数组）
      if (type === 'spot-full') {
        const messages = Array.isArray(msg) ? msg : [msg];
        
        for (const item of messages) {
          if (item.e === 'miniTicker') {
            const symbol = item.s;
            const price = parseFloat(item.c);
            const volume = parseFloat(item.q) || 0;
            const time = item.E || Date.now();
            
            if (!isNaN(price)) {
              this.dataManager.addPriceRecord(symbol, time, price, volume);
            }
          }
        }
      }
      // 现货组合流（单个对象）
      else if (type === 'spot-combined') {
        if (msg.e === 'miniTicker') {
          const symbol = msg.s;
          const price = parseFloat(msg.c);
          const volume = parseFloat(msg.q) || 0;
          const time = msg.E || Date.now();
          
          if (!isNaN(price)) {
            this.dataManager.addPriceRecord(symbol, time, price, volume);
          }
        }
      }
      // Alpha 全量推送或组合流
      else if (type.includes('alpha')) {
        // Alpha 推送格式：{"data":{"d":[{"s":"PIEVERSE","ca":"0x...","lp":"0.566"},...]}}
        if (msg.data && msg.data.d && Array.isArray(msg.data.d)) {
          const tokens = msg.data.d;
          
          for (const token of tokens) {
            const symbol = token.s;
            const ca = token.ca ? token.ca.toLowerCase() : null;
            const price = parseFloat(token.lp);
            const time = Date.now();
            
            if (!isNaN(price)) {
              // 全量推送时动态建立 ca -> symbol 映射
              if (ca && type === 'alpha-full') {
                this.symbolCache.set(ca, symbol);
                this.dataManager.setSymbolMapping(symbol, ca);
              }
              
              // 使用 ca 作为内部 key（如果有）
              const key = ca || symbol;
              this.dataManager.addPriceRecord(key, time, price, 0, symbol);
            }
          }
        }
        
        // 订阅响应处理
        if (msg.id && msg.result !== undefined) {
          console.log(`[WS] ${connection.name} 订阅响应：id=${msg.id}, result=${msg.result}`);
        }
      }
    } catch (err) {
      console.error(`[WS] ${connection.name} 消息解析错误：${err.message}`);
    }
  }

  /**
   * 错误处理
   */
  _onError(connection, err) {
    console.error(`[WS] ${connection.name} 错误：${err.message}`);
  }

  /**
   * 关闭处理
   */
  _onClose(connection, code, reason) {
    console.warn(`[WS] ${connection.name} 关闭：code=${code}, reason=${reason?.toString() || 'unknown'}`);
    
    // 清理连接
    this._cleanupConnection(connection);
    
    // 触发重连
    this._scheduleReconnect(connection);
  }

  /**
   * 收到 Pong 处理
   */
  _onPong(connection) {
    if (connection.pongTimeout) {
      clearTimeout(connection.pongTimeout);
      connection.pongTimeout = null;
    }
  }

  /**
   * 启动心跳检测
   */
  _startHeartbeat(connection) {
    if (connection.pingInterval) {
      clearInterval(connection.pingInterval);
    }
    
    connection.pingInterval = setInterval(() => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.ping();
        
        connection.pongTimeout = setTimeout(() => {
          console.warn(`[WS] ${connection.name} Pong 超时，关闭连接`);
          connection.ws.terminate();
        }, this.pongTimeout);
      }
    }, this.pingInterval);
  }

  /**
   * 调度重连（指数退避）
   */
  _scheduleReconnect(connection) {
    const { name, reconnectDelay, options } = connection;
    
    console.log(`[WS] ${name} ${reconnectDelay}ms 后重连`);
    
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
    }
    
    connection.reconnectTimer = setTimeout(() => {
      // 根据连接类型和模式重新连接
      if (name === 'priceMonitorSpot') {
        this.connectPriceMonitorSpot(Array.from(options.symbols));
      } else if (name === 'priceMonitorAlpha') {
        this.connectPriceMonitorAlpha(options.alphaTokens);
      } else if (name === 'volatilitySpot') {
        if (this.volatilityMode === 'global') {
          this.connectVolatilitySpot([]);
        } else {
          this.connectVolatilitySpot(Array.from(options.symbols));
        }
      } else if (name === 'volatilityAlpha') {
        if (this.volatilityMode === 'global') {
          this.connectVolatilityAlpha([]);
        } else {
          this.connectVolatilityAlpha(options.alphaTokens);
        }
      }
    }, reconnectDelay);
    
    // 指数退避（5s → 10s → 20s → 40s → 60s 上限）
    connection.reconnectDelay = Math.min(
      reconnectDelay * 2,
      this.maxReconnectDelay
    );
  }

  /**
   * 清理连接资源
   */
  _cleanupConnection(connection) {
    if (connection.pingInterval) {
      clearInterval(connection.pingInterval);
      connection.pingInterval = null;
    }
    
    if (connection.pongTimeout) {
      clearTimeout(connection.pongTimeout);
      connection.pongTimeout = null;
    }
    
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = null;
    }
    
    if (connection.ws) {
      connection.ws.removeAllListeners();
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close();
      }
    }
  }

  /**
   * 断开所有连接
   */
  disconnectAll() {
    for (const [name, connection] of Object.entries(this.connections)) {
      if (connection) {
        this._cleanupConnection(connection);
        this.connections[name] = null;
      }
    }
    
    this.priceMonitorSubscriptions.spot.clear();
    this.priceMonitorSubscriptions.alpha.clear();
    this.symbolCache.clear();
    
    console.log('[WS] 所有连接已断开');
  }

  /**
   * 断开指定连接
   */
  disconnect(name) {
    if (this.connections[name]) {
      this._cleanupConnection(this.connections[name]);
      this.connections[name] = null;
      console.log(`[WS] ${name} 已断开`);
    }
  }

  /**
   * 检查连接健康状态
   */
  checkHealth() {
    const now = Date.now();
    const unhealthy = [];
    
    for (const [name, connection] of Object.entries(this.connections)) {
      if (connection && now - connection.lastMessageTime > 5 * 60 * 1000) {
        unhealthy.push({
          name,
          lastMessageTime: connection.lastMessageTime,
          messageCount: connection.messageCount
        });
        console.warn(`[WS] ${name} 数据异常：${Math.floor((now - connection.lastMessageTime) / 1000)}s 无新价格`);
      }
    }
    
    return {
      connections: Object.entries(this.connections)
        .filter(([_, conn]) => conn !== null)
        .map(([name, conn]) => ({
          name,
          connected: conn.ws.readyState === WebSocket.OPEN,
          lastMessageTime: conn.lastMessageTime,
          messageCount: conn.messageCount
        })),
      unhealthy: unhealthy.length,
      details: unhealthy
    };
  }

  /**
   * 获取连接统计
   */
  getStats() {
    const stats = {
      volatilityMode: this.volatilityMode,
      totalConnections: 0,
      connections: {}
    };
    
    for (const [name, connection] of Object.entries(this.connections)) {
      if (connection) {
        stats.totalConnections++;
        stats.connections[name] = {
          connected: connection.ws.readyState === WebSocket.OPEN,
          lastMessageTime: connection.lastMessageTime,
          messageCount: connection.messageCount,
          type: connection.options.type
        };
      }
    }
    
    // 统计订阅数量
    stats.priceMonitorSpotSymbols = this.priceMonitorSubscriptions.spot.size;
    stats.priceMonitorAlphaTokens = this.priceMonitorSubscriptions.alpha.size;
    stats.symbolCacheSize = this.symbolCache.size;
    
    return stats;
  }
}

module.exports = WSConnector;
