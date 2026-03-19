/**
 * ws-connector.js - WebSocket 连接模块
 * 
 * 功能：
 * - 连接币安现货 + Alpha WebSocket
 * - 自动重连（断线后 5 秒重连，指数退避）
 * - 心跳检测（30 秒 ping/pong）
 * - 连接池管理（最多 20 个币种）
 */

const WebSocket = require('ws');
const https = require('https');

class WSConnector {
  constructor(dataManager) {
    this.dataManager = dataManager;
    
    // 连接配置
    this.connections = new Map(); // symbol => { ws, reconnectDelay, pingInterval }
    this.maxSymbols = 20;
    
    // 币安 WebSocket 地址
    this.spotWsUrl = 'wss://stream.binance.com:9443/ws';
    this.alphaWsUrl = 'wss://nbstream.binance.com/w3w/wsa/stream';
    
    // 心跳配置
    this.pingInterval = 30000; // 30 秒
    this.pongTimeout = 5000;   // 5 秒超时
    
    // 重连配置
    this.initialReconnectDelay = 5000;
    this.maxReconnectDelay = 80000;
  }

  /**
   * 连接单个币种
   */
  connect(symbol, source = 'spot', alphaId = null) {
    const symbolUpper = symbol.toUpperCase();
    
    // 检查是否已连接
    if (this.connections.has(symbolUpper)) {
      console.log(`[WS] ${symbolUpper} 已连接，跳过`);
      return;
    }
    
    // 检查连接数限制
    if (this.connections.size >= this.maxSymbols) {
      console.warn(`[WS] 达到最大连接数 ${this.maxSymbols}，无法连接 ${symbolUpper}`);
      return;
    }
    
    // 选择 WebSocket 地址和流名称
    let wsUrl, streamName, streamUrl;
    
    if (source === 'alpha' && alphaId) {
      // Alpha WebSocket：流格式 alpha_{token_id}usdt@aggTrade
      // 例如：alpha_173usdt@aggTrade
      wsUrl = this.alphaWsUrl;
      const tokenNum = alphaId.replace('ALPHA_', '');
      streamName = `alpha_${tokenNum}usdt@aggTrade`;
      streamUrl = `${wsUrl}`;
      console.log(`[WS] 连接 Alpha ${symbolUpper} (${alphaId}) -> ${streamName}`);
    } else {
      // 现货/新币 WebSocket：格式 PORTALUSDT -> portalusdt@trade（小写）
      wsUrl = this.spotWsUrl;
      streamName = `${symbolUpper.toLowerCase()}@trade`;
      streamUrl = `${wsUrl}/${streamName}`;
      console.log(`[WS] 连接 ${symbolUpper} -> ${streamUrl}`);
    }
    
    const ws = new WebSocket(streamUrl);
    
    const connection = {
      symbol: symbolUpper,
      source,
      alphaId,
      ws,
      streamName,
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
    
    this.connections.set(symbolUpper, connection);
  }

  /**
   * 连接多个币种
   */
  connectMultiple(symbols) {
    symbols.forEach(({ symbol, source, alphaId }) => {
      this.connect(symbol, source, alphaId);
    });
  }

  /**
   * 断开连接
   */
  disconnect(symbol) {
    const symbolUpper = symbol.toUpperCase();
    const connection = this.connections.get(symbolUpper);
    
    if (connection) {
      this._cleanupConnection(connection);
      this.connections.delete(symbolUpper);
      console.log(`[WS] ${symbolUpper} 已断开`);
    }
  }

  /**
   * 断开所有连接
   */
  disconnectAll() {
    for (const [symbol, connection] of this.connections.entries()) {
      this._cleanupConnection(connection);
    }
    this.connections.clear();
    console.log('[WS] 所有连接已断开');
  }

  /**
   * 通过 HTTP API 获取初始价格（用于 WebSocket 连接建立时立即获取价格）
   */
  _fetchInitialPrice(connection) {
    return new Promise((resolve) => {
      try {
        let url;
        if (connection.source === 'alpha' && connection.alphaId) {
          // Alpha 代币使用 Alpha API
          const tokenNum = connection.alphaId.replace('ALPHA_', '');
          url = `https://www.binance.com/bapi/defi/v1/public/alpha-trade/ticker?symbol=${connection.alphaId}USDT`;
        } else {
          // 现货/新币使用标准 API
          url = `https://api.binance.com/api/v3/ticker/price?symbol=${connection.symbol}`;
        }
        
        https.get(url, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              let price = null;
              
              if (connection.source === 'alpha' && parsed.data && parsed.data.lastPrice) {
                price = parseFloat(parsed.data.lastPrice);
              } else if (parsed.price) {
                price = parseFloat(parsed.price);
              }
              
              if (price !== null && !isNaN(price)) {
                const now = Date.now();
                this.dataManager.addPriceRecord(connection.symbol, now, price, 0);
                console.log(`[WS] ${connection.symbol} 初始价格：$${price} (HTTP API)`);
                resolve(price);
              } else {
                console.warn(`[WS] ${connection.symbol} HTTP API 返回价格无效`);
                resolve(null);
              }
            } catch (err) {
              console.warn(`[WS] ${connection.symbol} HTTP API 解析错误：${err.message}`);
              resolve(null);
            }
          });
        }).on('error', (err) => {
          console.warn(`[WS] ${connection.symbol} HTTP API 请求失败：${err.message}`);
          resolve(null);
        });
      } catch (err) {
        console.warn(`[WS] ${connection.symbol} 获取初始价格失败：${err.message}`);
        resolve(null);
      }
    });
  }

  /**
   * 连接成功处理
   */
  async _onOpen(connection) {
    console.log(`[WS] ${connection.symbol} 连接成功`);
    connection.reconnectDelay = this.initialReconnectDelay;
    connection.lastMessageTime = Date.now();
    
    // Alpha WebSocket 需要订阅流
    if (connection.source === 'alpha' && connection.streamName) {
      const subscribeMsg = {
        method: 'SUBSCRIBE',
        params: [connection.streamName],
        id: Date.now()
      };
      connection.ws.send(JSON.stringify(subscribeMsg));
      console.log(`[WS] ${connection.symbol} 已订阅 ${connection.streamName}`);
    }
    
    // 立即通过 HTTP API 获取初始价格（解决新币种添加后价格显示 0 的问题）
    await this._fetchInitialPrice(connection);
    
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
      
      // 解析价格数据
      if (connection.source === 'alpha') {
        // Alpha WebSocket 格式：外层有 data 包装
        // {"data":{"e":"aggTrade","E":1234567890,"s":"ALPHA_804USDT","a":12345,"p":"0.07","q":"100","f":100,"l":100,"T":1234567890,"m":true},"stream":"alpha_804usdt@aggTrade"}
        // 或者订阅响应：{"id":123456}
        const tradeData = msg.data || msg;
        if (tradeData.e === 'aggTrade') {
          const price = parseFloat(tradeData.p);
          const volume = parseFloat(tradeData.q);
          const time = tradeData.T || tradeData.E || Date.now();
          
          // 写入数据管理器
          this.dataManager.addPriceRecord(connection.symbol, time, price, volume);
        }
      } else {
        // 现货/新币 WebSocket 格式：trade
        if (msg.e === 'trade') {
          const price = parseFloat(msg.p);
          const volume = parseFloat(msg.q);
          const time = msg.E || msg.T || Date.now();
          
          // 写入数据管理器
          this.dataManager.addPriceRecord(connection.symbol, time, price, volume);
        }
      }
    } catch (err) {
      console.error(`[WS] ${connection.symbol} 消息解析错误：${err.message}`);
    }
  }

  /**
   * 错误处理
   */
  _onError(connection, err) {
    console.error(`[WS] ${connection.symbol} 错误：${err.message}`);
  }

  /**
   * 关闭处理
   */
  _onClose(connection, code, reason) {
    console.warn(`[WS] ${connection.symbol} 关闭：code=${code}, reason=${reason?.toString() || 'unknown'}`);
    
    // 清理连接
    this._cleanupConnection(connection);
    
    // 触发重连
    this._scheduleReconnect(connection);
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
          console.warn(`[WS] ${connection.symbol} Pong 超时，关闭连接`);
          connection.ws.terminate();
        }, this.pongTimeout);
      }
    }, this.pingInterval);
  }

  /**
   * 调度重连
   */
  _scheduleReconnect(connection) {
    const { symbol, reconnectDelay } = connection;
    
    console.log(`[WS] ${symbol} ${reconnectDelay}ms 后重连`);
    
    // 清除旧的重连定时器（如果有）
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
    }
    
    connection.reconnectTimer = setTimeout(() => {
      // 检查是否已被移除
      if (!this.connections.has(symbol)) {
        console.log(`[WS] ${symbol} 已移除，取消重连`);
        return;
      }
      
      // 重新连接
      this.connect(symbol, connection.source);
    }, reconnectDelay);
    
    // 指数退避
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
   * 检查连接健康状态
   */
  checkHealth() {
    const now = Date.now();
    const unhealthy = [];
    
    for (const [symbol, connection] of this.connections.entries()) {
      // 检查是否超过 5 分钟无消息
      if (now - connection.lastMessageTime > 5 * 60 * 1000) {
        unhealthy.push({
          symbol,
          lastMessageTime: connection.lastMessageTime,
          messageCount: connection.messageCount
        });
        console.warn(`[WS] ${symbol} 数据异常：${Math.floor((now - connection.lastMessageTime) / 1000)}s 无新价格`);
      }
    }
    
    return {
      total: this.connections.size,
      unhealthy: unhealthy.length,
      details: unhealthy
    };
  }

  /**
   * 获取连接统计
   */
  getStats() {
    const stats = {};
    
    for (const [symbol, connection] of this.connections.entries()) {
      stats[symbol] = {
        source: connection.source,
        connected: connection.ws.readyState === WebSocket.OPEN,
        lastMessageTime: connection.lastMessageTime,
        messageCount: connection.messageCount
      };
    }
    
    return stats;
  }
}

module.exports = WSConnector;
