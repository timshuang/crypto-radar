/**
 * ws-connector.js - WebSocket 连接模块（重构版）
 * 
 * 功能：
 * - 组合流连接（单个连接订阅多个指定币种）
 * - 全量推送连接（!miniTicker@arr + came@allTokens@ticker24）
 * - 现货和 Alpha 独立连接
 * - 断线重连（指数退避：5s → 10s → 20s → 40s → 60s 上限）
 * - 唯一 ID 管理（现货：symbol，Alpha：合约地址 ca）
 * 
 * 连接模式：
 * - monitorList: 组合流模式（监控列表）
 * - fullScan: 全量推送模式（全市场扫描）
 */

const WebSocket = require('ws');
const https = require('https');

class WSConnector {
  constructor(dataManager) {
    this.dataManager = dataManager;
    
    // 连接配置
    this.spotConnection = null;  // 现货连接（单个）
    this.alphaConnection = null; // Alpha 连接（单个）
    
    // 币安 WebSocket 地址
    this.spotWsUrl = 'wss://stream.binance.com:9443/ws';
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
    this.spotSubscriptions = new Set(); // 现货订阅列表（symbol）
    this.alphaSubscriptions = new Map(); // Alpha 订阅列表（ca -> symbol）
    
    // 连接模式
    this.mode = 'monitorList'; // 'monitorList' | 'fullScan'
  }

  /**
   * 设置连接模式
   */
  setMode(mode) {
    this.mode = mode;
    console.log(`[WS] 连接模式设置为：${mode}`);
  }

  /**
   * 构建组合流订阅列表（现货）
   */
  buildSpotCombinedStreams(symbols) {
    // 格式：symbolusdt@trade 或 symbolusdt@miniTicker
    return symbols.map(symbol => `${symbol.toLowerCase()}@miniTicker`);
  }

  /**
   * 构建 Alpha 订阅列表
   */
  buildAlphaSubscriptions(alphaTokens) {
    // alphaTokens: [{ symbol: 'PIEVERSE', ca: '0x...123456', alphaId: 'ALPHA_469' }]
    const subscriptions = new Map();
    
    for (const token of alphaTokens) {
      if (token.ca) {
        // 使用合约地址后 6 位作为 key（兼容旧格式）
        const caShort = token.ca.toLowerCase();
        subscriptions.set(caShort, {
          symbol: token.symbol,
          ca: token.ca,
          alphaId: token.alphaId,
          streamName: `alpha_${token.alphaId.replace('ALPHA_', '')}usdt@miniTicker`
        });
      } else if (token.alphaId) {
        // 向后兼容：没有 ca 字段时使用 alphaId
        const caShort = token.alphaId.toLowerCase();
        subscriptions.set(caShort, {
          symbol: token.symbol,
          ca: token.alphaId,
          alphaId: token.alphaId,
          streamName: `alpha_${token.alphaId.replace('ALPHA_', '')}usdt@miniTicker`
        });
      }
    }
    
    return subscriptions;
  }

  /**
   * 连接现货组合流（监控列表模式）
   */
  connectSpotCombined(symbols) {
    if (symbols.length === 0) {
      console.log('[WS] 现货组合流：无订阅币种，跳过连接');
      return;
    }
    
    const streams = this.buildSpotCombinedStreams(symbols);
    const streamUrl = `${this.spotCombinedWsUrl}?streams=${streams.join('/')}`;
    
    console.log(`[WS] 现货组合流连接：${symbols.length} 个币种`);
    console.log(`[WS] 订阅流：${streams.join(', ')}`);
    
    this._connectSpot(streamUrl, symbols);
  }

  /**
   * 连接现货全量推送（全量扫描模式）
   */
  connectSpotFull() {
    console.log(`[WS] 现货全量推送连接：!miniTicker@arr`);
    
    this._connectSpot(this.spotFullWsUrl, []);
  }

  /**
   * 现货连接内部实现
   */
  _connectSpot(streamUrl, symbols) {
    // 清理旧连接
    if (this.spotConnection) {
      this._cleanupConnection(this.spotConnection);
    }
    
    const ws = new WebSocket(streamUrl);
    
    this.spotConnection = {
      ws,
      reconnectDelay: this.initialReconnectDelay,
      reconnectTimer: null,
      pingInterval: null,
      pongTimeout: null,
      lastMessageTime: 0,
      messageCount: 0,
      symbols: new Set(symbols)
    };
    
    // 绑定事件处理
    ws.on('open', () => this._onSpotOpen(this.spotConnection));
    ws.on('message', (data) => this._onSpotMessage(this.spotConnection, data));
    ws.on('error', (err) => this._onSpotError(this.spotConnection, err));
    ws.on('close', (code, reason) => this._onSpotClose(this.spotConnection, code, reason));
    ws.on('pong', () => this._onPong(this.spotConnection));
  }

  /**
   * 连接 Alpha 组合流（监控列表模式）
   */
  connectAlphaCombined(alphaTokens) {
    if (!alphaTokens || alphaTokens.length === 0) {
      console.log('[WS] Alpha 组合流：无订阅币种，跳过连接');
      return;
    }
    
    this.alphaSubscriptions = this.buildAlphaSubscriptions(alphaTokens);
    const streamNames = Array.from(this.alphaSubscriptions.values()).map(s => s.streamName);
    
    console.log(`[WS] Alpha 组合流连接：${alphaTokens.length} 个币种`);
    console.log(`[WS] 订阅流：${streamNames.join(', ')}`);
    
    this._connectAlpha(streamNames);
  }

  /**
   * 连接 Alpha 全量推送（全量扫描模式）
   */
  connectAlphaFull() {
    console.log(`[WS] Alpha 全量推送连接：came@allTokens@ticker24`);
    
    // 全量推送不需要预定义订阅列表
    this.alphaSubscriptions = new Map();
    this._connectAlpha(['came@allTokens@ticker24']);
  }

  /**
   * Alpha 连接内部实现
   */
  _connectAlpha(streamNames) {
    // 清理旧连接
    if (this.alphaConnection) {
      this._cleanupConnection(this.alphaConnection);
    }
    
    const ws = new WebSocket(this.alphaWsUrl);
    
    this.alphaConnection = {
      ws,
      reconnectDelay: this.initialReconnectDelay,
      reconnectTimer: null,
      pingInterval: null,
      pongTimeout: null,
      lastMessageTime: 0,
      messageCount: 0,
      streamNames
    };
    
    // 绑定事件处理
    ws.on('open', () => this._onAlphaOpen(this.alphaConnection));
    ws.on('message', (data) => this._onAlphaMessage(this.alphaConnection, data));
    ws.on('error', (err) => this._onAlphaError(this.alphaConnection, err));
    ws.on('close', (code, reason) => this._onAlphaClose(this.alphaConnection, code, reason));
    ws.on('pong', () => this._onPong(this.alphaConnection));
  }

  /**
   * 现货连接成功处理
   */
  _onSpotOpen(connection) {
    console.log(`[WS] 现货连接成功`);
    connection.reconnectDelay = this.initialReconnectDelay;
    connection.lastMessageTime = Date.now();
    
    // 启动心跳检测
    this._startHeartbeat(connection);
    
    // 如果是组合流模式，记录订阅的币种
    if (connection.symbols.size > 0) {
      console.log(`[WS] 现货已订阅 ${connection.symbols.size} 个币种`);
    }
  }

  /**
   * 现货消息处理
   */
  _onSpotMessage(connection, data) {
    try {
      const msg = JSON.parse(data.toString());
      connection.lastMessageTime = Date.now();
      connection.messageCount++;
      
      // 全量推送是数组，组合流是单个对象
      const messages = Array.isArray(msg) ? msg : [msg];
      
      for (const item of messages) {
        if (item.e === 'miniTicker') {
          const symbol = item.s; // 如 BTCUSDT
          const price = parseFloat(item.c); // close price
          const volume = parseFloat(item.q) || 0; // quote volume
          const time = item.E || Date.now();
          
          if (!isNaN(price)) {
            this.dataManager.addPriceRecord(symbol, time, price, volume);
          }
        }
      }
    } catch (err) {
      console.error(`[WS] 现货消息解析错误：${err.message}`);
    }
  }

  /**
   * 现货错误处理
   */
  _onSpotError(connection, err) {
    console.error(`[WS] 现货错误：${err.message}`);
  }

  /**
   * 现货关闭处理
   */
  _onSpotClose(connection, code, reason) {
    console.warn(`[WS] 现货关闭：code=${code}, reason=${reason?.toString() || 'unknown'}`);
    
    // 清理连接
    this._cleanupConnection(connection);
    
    // 触发重连
    this._scheduleReconnect('spot', connection);
  }

  /**
   * Alpha 连接成功处理
   */
  _onAlphaOpen(connection) {
    console.log(`[WS] Alpha 连接成功`);
    connection.reconnectDelay = this.initialReconnectDelay;
    connection.lastMessageTime = Date.now();
    
    // 发送订阅消息
    if (connection.streamNames && connection.streamNames.length > 0) {
      const subscribeMsg = {
        method: 'SUBSCRIBE',
        params: connection.streamNames,
        id: Date.now()
      };
      connection.ws.send(JSON.stringify(subscribeMsg));
      console.log(`[WS] Alpha 已订阅 ${connection.streamNames.length} 个流`);
    }
    
    // 启动心跳检测
    this._startHeartbeat(connection);
  }

  /**
   * Alpha 消息处理
   */
  _onAlphaMessage(connection, data) {
    try {
      const msg = JSON.parse(data.toString());
      connection.lastMessageTime = Date.now();
      connection.messageCount++;
      
      // Alpha 推送格式：
      // {"data":{"d":[{"s":"PIEVERSE","ca":"0x...123456","lp":"0.566"},...]}}
      
      if (msg.data && msg.data.d && Array.isArray(msg.data.d)) {
        const tokens = msg.data.d;
        
        for (const token of tokens) {
          const symbol = token.s;
          const ca = token.ca ? token.ca.toLowerCase() : null;
          const price = parseFloat(token.lp); // last price
          const time = Date.now();
          
          if (!isNaN(price)) {
            // 使用合约地址作为 key（如果有）
            let key = symbol;
            if (ca) {
              // 后台使用合约地址作为唯一标识
              key = ca;
              
              // 同时记录 symbol -> ca 映射（用于显示）
              if (!this.dataManager.getSymbolMapping) {
                this.dataManager.setSymbolMapping(symbol, ca);
              }
            }
            
            this.dataManager.addPriceRecord(key, time, price, 0, symbol);
          }
        }
      }
      
      // 订阅响应处理
      if (msg.id && msg.result !== undefined) {
        console.log(`[WS] Alpha 订阅响应：id=${msg.id}, result=${msg.result}`);
      }
    } catch (err) {
      console.error(`[WS] Alpha 消息解析错误：${err.message}`);
    }
  }

  /**
   * Alpha 错误处理
   */
  _onAlphaError(connection, err) {
    console.error(`[WS] Alpha 错误：${err.message}`);
  }

  /**
   * Alpha 关闭处理
   */
  _onAlphaClose(connection, code, reason) {
    console.warn(`[WS] Alpha 关闭：code=${code}, reason=${reason?.toString() || 'unknown'}`);
    
    // 清理连接
    this._cleanupConnection(connection);
    
    // 触发重连
    this._scheduleReconnect('alpha', connection);
  }

  /**
   * 收到 Pong 处理
   */
  _onPong(connection) {
    // 清除 pong 超时定时器
    if (connection.pongTimeout) {
      clearTimeout(connection.pongTimeout);
      connection.pongTimeout = null;
    }
  }

  /**
   * 启动心跳检测
   */
  _startHeartbeat(connection) {
    // 清除旧的心跳
    if (connection.pingInterval) {
      clearInterval(connection.pingInterval);
    }
    
    connection.pingInterval = setInterval(() => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.ping();
        
        // 设置 pong 超时
        connection.pongTimeout = setTimeout(() => {
          console.warn(`[WS] Pong 超时，关闭连接`);
          connection.ws.terminate();
        }, this.pongTimeout);
      }
    }, this.pingInterval);
  }

  /**
   * 调度重连（指数退避）
   */
  _scheduleReconnect(type, connection) {
    const { reconnectDelay } = connection;
    
    console.log(`[WS] ${type} ${reconnectDelay}ms 后重连`);
    
    // 清除旧的重连定时器
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
    }
    
    connection.reconnectTimer = setTimeout(() => {
      // 重新连接
      if (type === 'spot') {
        if (this.mode === 'fullScan') {
          this.connectSpotFull();
        } else {
          const symbols = Array.from(connection.symbols);
          this.connectSpotCombined(symbols);
        }
      } else if (type === 'alpha') {
        if (this.mode === 'fullScan') {
          this.connectAlphaFull();
        } else {
          const alphaTokens = Array.from(this.alphaSubscriptions.values());
          this.connectAlphaCombined(alphaTokens);
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
    if (this.spotConnection) {
      this._cleanupConnection(this.spotConnection);
      this.spotConnection = null;
    }
    
    if (this.alphaConnection) {
      this._cleanupConnection(this.alphaConnection);
      this.alphaConnection = null;
    }
    
    this.spotSubscriptions.clear();
    this.alphaSubscriptions.clear();
    
    console.log('[WS] 所有连接已断开');
  }

  /**
   * 检查连接健康状态
   */
  checkHealth() {
    const now = Date.now();
    const unhealthy = [];
    
    // 检查现货连接
    if (this.spotConnection) {
      if (now - this.spotConnection.lastMessageTime > 5 * 60 * 1000) {
        unhealthy.push({
          type: 'spot',
          lastMessageTime: this.spotConnection.lastMessageTime,
          messageCount: this.spotConnection.messageCount
        });
        console.warn(`[WS] 现货数据异常：${Math.floor((now - this.spotConnection.lastMessageTime) / 1000)}s 无新价格`);
      }
    }
    
    // 检查 Alpha 连接
    if (this.alphaConnection) {
      if (now - this.alphaConnection.lastMessageTime > 5 * 60 * 1000) {
        unhealthy.push({
          type: 'alpha',
          lastMessageTime: this.alphaConnection.lastMessageTime,
          messageCount: this.alphaConnection.messageCount
        });
        console.warn(`[WS] Alpha 数据异常：${Math.floor((now - this.alphaConnection.lastMessageTime) / 1000)}s 无新价格`);
      }
    }
    
    return {
      spot: this.spotConnection ? { connected: true, ...this.spotConnection } : null,
      alpha: this.alphaConnection ? { connected: true, ...this.alphaConnection } : null,
      unhealthy: unhealthy.length,
      details: unhealthy
    };
  }

  /**
   * 获取连接统计
   */
  getStats() {
    const stats = {
      mode: this.mode,
      spot: null,
      alpha: null
    };
    
    if (this.spotConnection) {
      stats.spot = {
        connected: this.spotConnection.ws.readyState === WebSocket.OPEN,
        lastMessageTime: this.spotConnection.lastMessageTime,
        messageCount: this.spotConnection.messageCount,
        symbolsCount: this.spotConnection.symbols.size
      };
    }
    
    if (this.alphaConnection) {
      stats.alpha = {
        connected: this.alphaConnection.ws.readyState === WebSocket.OPEN,
        lastMessageTime: this.alphaConnection.lastMessageTime,
        messageCount: this.alphaConnection.messageCount,
        subscriptionsCount: this.alphaSubscriptions.size
      };
    }
    
    return stats;
  }
}

module.exports = WSConnector;
