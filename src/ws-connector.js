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
 * - 唯一 ID 管理（现货：symbol，Alpha：alphaId）
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
      alpha: new Map()    // Alpha 订阅列表（alphaId -> subscription）
    };
    
    // 波动侦测模式
    this.volatilityMode = 'added'; // 'added' | 'global'
    
    // 符号映射缓存（全量推送时动态建立）
    this.symbolCache = new Map(); // alphaId -> symbol
    this.alphaTokenNameCache = new Map(); // alpha numeric id -> symbol
    this.alphaTokenNameCacheTime = 0;
    this.alphaTokenNameCacheTtl = 60 * 60 * 1000; // 1 小时缓存
    this.alphaTokenFetchPromise = null;
  }

  _isAlphaNumericId(value) {
    return value !== null && value !== undefined && /^\d+$/.test(String(value));
  }

  _normalizeAlphaKey(value) {
    if (value === null || value === undefined) {
      return value;
    }

    const raw = String(value);
    return raw.startsWith('0x') ? raw.toLowerCase() : raw;
  }

  _normalizeAlphaId(value) {
    if (value === null || value === undefined) {
      return null;
    }

    const raw = String(value).toUpperCase();
    const match = raw.match(/ALPHA_(\d+)/);
    return match ? `ALPHA_${match[1]}` : null;
  }

  _extractAlphaIdFromStream(streamName) {
    if (!streamName) {
      return null;
    }

    const match = String(streamName).match(/alpha_(\d+)usdt@/i);
    return match ? `ALPHA_${match[1]}` : null;
  }

  _findAlphaSubscriptionById(alphaId, connection) {
    if (!alphaId) {
      return null;
    }

    const normalizedAlphaId = this._normalizeAlphaId(alphaId);
    const candidates = [connection?.options?.subscriptions, this.priceMonitorSubscriptions.alpha];

    for (const subscriptions of candidates) {
      if (!(subscriptions instanceof Map)) continue;

      for (const subscription of subscriptions.values()) {
        if (this._normalizeAlphaId(subscription?.alphaId) === normalizedAlphaId) {
          return subscription;
        }
      }
    }

    return null;
  }

  _resolveAlphaKeyById(alphaId, connection) {
    if (!alphaId) {
      return null;
    }

    const normalizedAlphaId = this._normalizeAlphaId(alphaId);
    if (!normalizedAlphaId) {
      return null;
    }

    const subscription = this._findAlphaSubscriptionById(normalizedAlphaId, connection);
    if (subscription?.alphaId) {
      return this._normalizeAlphaId(subscription.alphaId);
    }

    const alphaTokens = connection?.options?.alphaTokens;
    if (Array.isArray(alphaTokens)) {
      const token = alphaTokens.find(item => this._normalizeAlphaId(item?.alphaId) === normalizedAlphaId);
      if (token?.alphaId) {
        return this._normalizeAlphaId(token.alphaId);
      }
    }

    return null;
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
   * 加载 Alpha 代币名称映射
   * came@allTokens@ticker24 的 s 字段在全量模式下是数字 ID，需要额外映射到真实 symbol
   */
  async loadAlphaTokenNameCache(force = false) {
    const now = Date.now();
    if (!force && this.alphaTokenNameCache.size > 0 && (now - this.alphaTokenNameCacheTime) < this.alphaTokenNameCacheTtl) {
      return this.alphaTokenNameCache;
    }

    if (this.alphaTokenFetchPromise) {
      return this.alphaTokenFetchPromise;
    }

    this.alphaTokenFetchPromise = (async () => {
      try {
        const response = await fetch('https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list');
        const data = await response.json();
        const tokens = Array.isArray(data?.data) ? data.data : [];
        const nameCache = new Map();

        for (const token of tokens) {
          if (!token?.alphaId || !token?.symbol) continue;
          if (token.offline) continue;  // 跳过 offline 代币
          const numericId = token.alphaId.replace(/^ALPHA_/, '');
          if (numericId) {
            nameCache.set(numericId, token.symbol);
          }
        }

        if (nameCache.size > 0) {
          this.alphaTokenNameCache = nameCache;
          this.alphaTokenNameCacheTime = Date.now();
          this._reconcileAlphaSymbolCache();
          console.log(`[WS] Alpha 名称映射已加载：${nameCache.size} 个 online 代币`);
        }
      } catch (err) {
        console.warn(`[WS] 加载 Alpha 名称映射失败：${err.message}`);
      } finally {
        this.alphaTokenFetchPromise = null;
      }

      return this.alphaTokenNameCache;
    })();

    return this.alphaTokenFetchPromise;
  }

  /**
   * 解析 Alpha 全量推送里的真实显示名称
   */
  _resolveAlphaSymbol(rawSymbol) {
    if (rawSymbol === null || rawSymbol === undefined) {
      return rawSymbol;
    }

    const raw = String(rawSymbol);
    if (!this._isAlphaNumericId(raw)) {
      return raw;
    }

    return this.alphaTokenNameCache.get(raw) || raw;
  }

  _logAlphaResolveMiss(rawSymbol, ca, type) {
    const raw = rawSymbol === null || rawSymbol === undefined ? String(rawSymbol) : String(rawSymbol).trim();
    const cacheHas = this.alphaTokenNameCache.has(raw);
    const cacheSize = this.alphaTokenNameCache.size;

    console.warn(`[WS][AlphaResolveMiss] type=${type}, rawSymbol=${raw}, key=${ca || 'N/A'}, cacheHas=${cacheHas}, cacheSize=${cacheSize}`);
  }

  _isTrackedAlphaSymbol(symbol) {
    return ['PRL', 'EDGE', 'UP', 'BASED'].includes(String(symbol || '').toUpperCase());
  }

  _isTrackedAlphaRaw(rawSymbol, streamSymbol) {
    const raw = String(rawSymbol || '');
    const stream = String(streamSymbol || '').toUpperCase();
    return ['823', '838', '804', '837'].includes(raw)
      || ['ALPHA_823USDT', 'ALPHA_838USDT', 'ALPHA_804USDT', 'ALPHA_837USDT', 'ALPHA_804USDC'].includes(stream);
  }

  _logTrackedAlphaFlow(stage, payload = {}) {
    const entries = Object.entries(payload)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    console.log(`[WS][TrackedAlpha] stage=${stage}${entries ? `, ${entries}` : ''}`);
  }

  /**
   * 在名称映射加载后回填已有的 symbolCache
   */
  _reconcileAlphaSymbolCache() {
    for (const [alphaId, cachedSymbol] of this.symbolCache.entries()) {
      const rawAlphaId = String(alphaId).replace(/^ALPHA_/, '');
      const resolvedSymbol = this._resolveAlphaSymbol(rawAlphaId);
      if (!resolvedSymbol || resolvedSymbol === rawAlphaId) {
        continue;
      }

      this.symbolCache.set(alphaId, resolvedSymbol || cachedSymbol);
      this.dataManager.setSymbolMapping(resolvedSymbol, alphaId);
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
      const alphaKey = this._normalizeAlphaId(token.alphaId);

      if (!alphaKey) {
        console.warn(`[WS] Alpha 代币 ${token.symbol} 缺少 ca 和 alphaId，跳过`);
        continue;
      }

      subscriptions.set(alphaKey, {
        symbol: token.symbol,
        ca: token.ca || null,
        alphaId: alphaKey,
        streamName: `alpha_${alphaKey.replace('ALPHA_', '')}usdt@trade`
      });
    }
    
    return subscriptions;
  }

  /**
   * 存储价格并执行智能检查（仅价格变化才继续触发后续钩子）
   */
  _storePriceRecord(key, time, price, volume = 0, displaySymbol = null, sourceName = 'unknown', sourceType = 'unknown') {
    const channel = String(sourceName || '').startsWith('volatility') ? 'volatility' : 'monitor';
    const result = this.dataManager.addPriceRecord(key, time, price, volume, displaySymbol, channel);

    if (!this._sourceFlowStats || this._sourceFlowStats.second !== Math.floor(Date.now() / 1000)) {
      this._sourceFlowStats = {
        second: Math.floor(Date.now() / 1000),
        counts: {}
      };
    }

    const bucket = `${sourceName}:${sourceType}`;
    this._sourceFlowStats.counts[bucket] = (this._sourceFlowStats.counts[bucket] || 0) + 1;

    if (this._sourceFlowStats.counts[bucket] <= 3) {
      console.log(`[WS][StoreSource] second=${this._sourceFlowStats.second}, source=${bucket}, channel=${channel}, key=${key}, symbol=${displaySymbol || key}`);
    }

    return Boolean(result?.changed);
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
  async connectVolatilityAlpha(alphaTokens, useAllSymbols = false) {
    if (this.volatilityMode === 'global') {
      // 全量推送模式
      console.log(`[WS] 波动侦测 Alpha 全量推送：!miniTicker@arr`);
      await this.loadAlphaTokenNameCache();
      this._connect('volatilityAlpha', this.alphaWsUrl, { 
        type: 'alpha-full',
        streamNames: ['!miniTicker@arr']
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
      
      // 调试日志：每 100 条消息打印一次
      if (connection.messageCount % 100 === 1) {
        console.log(`[WS] ${connection.name} 收到消息 #${connection.messageCount}: ${JSON.stringify(msg).substring(0, 200)}`);
      }
      
      const { type } = connection.options;
      
      // 现货全量推送（数组，只保留 USDT 对）
      if (type === 'spot-full') {
        const spotFullTokens = Array.isArray(msg)
          ? msg
          : (Array.isArray(msg?.data) ? msg.data : (msg?.data ? [msg.data] : [msg]));

        let parsedSpotCount = 0;
        for (const item of spotFullTokens) {
          if (item && (item.e === '24hrMiniTicker' || item.e === 'miniTicker') && item.s) {
            const symbol = item.s;
            
            // 过滤：只处理 USDT 对
            if (!symbol.endsWith('USDT')) {
              continue; // 非 USDT 对直接跳过，不存入内存
            }
            
            const price = parseFloat(item.c ?? item.p ?? item.lp);
            const volume = parseFloat(item.q ?? item.v) || 0;
            const time = item.E || item.T || Date.now();
            
            if (!isNaN(price)) {
              this._storePriceRecord(symbol, time, price, volume, null, connection.name, type);
              parsedSpotCount++;
            }
          }
        }

        if (parsedSpotCount > 0 && (connection.messageCount <= 5 || connection.messageCount % 100 === 1)) {
          console.log(`[WS][Flow] ${connection.name} parsedSpotTokens=${parsedSpotCount}, messageCount=${connection.messageCount}`);
        }
      }
      // 现货组合流（外层包装：{"stream":"...", "data": {...}}）
      else if (type === 'spot-combined') {
        const data = msg.data || msg;
        if (data.s && (data.c || data.p || data.lp)) {
          const symbol = data.s;
          const price = parseFloat(data.c ?? data.p ?? data.lp);
          const volume = parseFloat(data.q ?? data.v) || 0;
          const time = data.E || data.T || Date.now();
          
          if (!isNaN(price)) {
            this._storePriceRecord(symbol, time, price, volume, null, connection.name, type);
          }
        }
      }
      // Alpha 全量推送或组合流
      else if (type.includes('alpha')) {
        // Alpha 全量推送支持两种格式：
        // 1) came@allTokens@ticker24 => { data: { d: [...] } }
        // 2) !miniTicker@arr / !ticker@arr => [ {...}, {...} ]
        const alphaFullTokens = (type === 'alpha-full' && Array.isArray(msg))
          ? msg
          : (msg.data && msg.data.d && Array.isArray(msg.data.d)
              ? msg.data.d
              : (type === 'alpha-full' && msg.data && msg.data.s ? [msg.data] : null));

        if (alphaFullTokens) {
          const tokens = alphaFullTokens;

          if (connection.messageCount <= 10 && tokens[0]) {
            console.log(`[WS] ${connection.name} Alpha token[${connection.messageCount}]:`, JSON.stringify(tokens[0]));
          }

          let parsedAlphaCount = 0;
          for (const token of tokens) {
            const streamSymbol = token.s;
            const alphaPairMatch = typeof streamSymbol === 'string' ? streamSymbol.match(/^ALPHA_(\d+)(USDT|USDC)$/i) : null;
            const rawSymbol = alphaPairMatch ? alphaPairMatch[1] : token.s;
            const alphaInternalKey = alphaPairMatch ? `ALPHA_${alphaPairMatch[1]}` : null;
            const resolvedSymbol = this._resolveAlphaSymbol(rawSymbol);
            const hasResolvedSymbol = resolvedSymbol && !this._isAlphaNumericId(resolvedSymbol);

            if (this._isTrackedAlphaRaw(rawSymbol, streamSymbol) || this._isTrackedAlphaSymbol(resolvedSymbol)) {
              this._logTrackedAlphaFlow('resolved', {
                type,
                rawSymbol,
                streamSymbol: streamSymbol || 'N/A',
                resolvedSymbol,
                hasResolvedSymbol,
                key: alphaInternalKey || 'N/A'
              });
            }

            if (!hasResolvedSymbol) {
              if (connection.messageCount <= 20 || connection.messageCount % 100 === 1) {
                this._logAlphaResolveMiss(rawSymbol, alphaInternalKey, type);
              }
              continue;
            }

            const priceValue = token.p ?? token.c ?? token.lp;
            const volumeValue = token.q ?? token.v ?? token.vol24 ?? 0;
            const eventTime = token.E || token.t || Date.now();
            const price = parseFloat(priceValue);
            const volume = parseFloat(volumeValue) || 0;
            const time = eventTime || Date.now();

            if (!isNaN(price)) {
              const stableAlphaKey = alphaInternalKey || null;

              if (stableAlphaKey && type === 'alpha-full') {
                const oldSize = this.symbolCache.size;
                this.symbolCache.set(stableAlphaKey, resolvedSymbol);
                this.dataManager.setSymbolMapping(resolvedSymbol, stableAlphaKey);

                if (this._isTrackedAlphaRaw(rawSymbol, streamSymbol) || this._isTrackedAlphaSymbol(resolvedSymbol)) {
                  this._logTrackedAlphaFlow('symbolCache', {
                    rawSymbol,
                    streamSymbol: streamSymbol || 'N/A',
                    symbol: resolvedSymbol,
                    key: stableAlphaKey,
                    price,
                    volume
                  });
                }

                if ((oldSize === 0) || (this.symbolCache.size % 50 === 1)) {
                  console.log(`[WS] ✅ symbolCache 更新：${this.symbolCache.size} 个 Alpha 币种`);
                }
              }

              const key = stableAlphaKey || resolvedSymbol;
              const displaySymbol = resolvedSymbol;
              if (this._isTrackedAlphaRaw(rawSymbol, streamSymbol) || this._isTrackedAlphaSymbol(displaySymbol)) {
                this._logTrackedAlphaFlow('storePriceRecord', {
                  rawSymbol,
                  streamSymbol: streamSymbol || 'N/A',
                  symbol: displaySymbol,
                  key,
                  price,
                  volume,
                  time
                });
              }
              this._storePriceRecord(key, time, price, volume, displaySymbol, connection.name, type);
              parsedAlphaCount++;
            }
          }

          if (parsedAlphaCount > 0 && (connection.messageCount <= 5 || connection.messageCount % 100 === 1)) {
            console.log(`[WS][Flow] ${connection.name} parsedAlphaTokens=${parsedAlphaCount}, messageCount=${connection.messageCount}, symbolCache=${this.symbolCache.size}`);
          }
        }
        // Alpha 组合流（外层包装：{"stream":"...", "data": {...}}）
        // 重要：当前生产以 @trade 为准。虽然历史上保留过 @aggTrade 测试脚本，
        // 但实测 Alpha @aggTrade 不稳定，不能据此回切主流程。
        // @trade：{"data":{"e":"trade","s":"ALPHA_495USDT","p":"0.49","q":"100","E":...},"stream":"alpha_495usdt@trade"}
        // @ticker：{"data":{"s":"ALPHA_495USDT","lp":"0.49","q":"100","E":...},"stream":"alpha_495usdt@ticker"}
        if (type === 'alpha-combined') {
          const combinedData = msg.data || msg;
          if (combinedData.s && (combinedData.p || combinedData.lp)) {
            const alphaId = this._normalizeAlphaId(combinedData.s) || this._extractAlphaIdFromStream(msg.stream);
            const alphaKey = this._resolveAlphaKeyById(alphaId, connection) || alphaId;
            const price = parseFloat(combinedData.p || combinedData.lp);
            const volume = parseFloat(combinedData.q) || 0;
            const time = combinedData.E || combinedData.T || Date.now();

            if (!isNaN(price) && alphaKey) {
              const subscription = this._findAlphaSubscriptionById(alphaId, connection);
              const displaySymbol = subscription?.symbol || alphaId;
              this.dataManager.setSymbolMapping(displaySymbol, alphaKey);
              this._storePriceRecord(alphaKey, time, price, volume, displaySymbol, connection.name, type);
            } else if (!alphaKey && connection.messageCount % 200 === 1) {
              console.warn(`[WS] ${connection.name} Alpha 组合流未找到 alphaId 映射，跳过存储: symbol=${combinedData.s}, stream=${msg.stream || 'N/A'}`);
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
          this.connectVolatilityAlpha([]).catch(err => {
            console.error(`[WS] ${name} 重连失败：${err.message}`);
          });
        } else {
          this.connectVolatilityAlpha(options.alphaTokens).catch(err => {
            console.error(`[WS] ${name} 重连失败：${err.message}`);
          });
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
