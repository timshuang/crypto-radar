/**
 * web-server.js - 轻量级 Web 管理界面
 * 
 * 功能：
 * - RESTful API 端点
 * - 静态文件服务
 * - API Token 验证
 * - 内存优化（<50MB）
 */

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const WebSocket = require('ws');
const { fetchAlphaPrice } = require('./monitors');

// 简单的 URL 解析
function parseUrl(url) {
  const [pathname, queryString] = url.split('?');
  const query = {};
  if (queryString) {
    queryString.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      query[decodeURIComponent(key)] = decodeURIComponent(value || '');
    });
  }
  return { pathname, query };
}

// 简单的 JSON 解析
function parseBody(body) {
  try {
    return JSON.parse(body);
  } catch (err) {
    return null;
  }
}

class WebServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 3000;
    this.apiToken = options.apiToken || 'crypto_radar_token_2024';
    this.publicDir = options.publicDir || path.join(__dirname, '..', 'public');
    this.configManager = null;
    this.storage = null;
    this.app = null;
    this.server = null;
    this.startTime = null;
    this.notificationService = null;
    // 代币列表缓存（5 分钟）
    this.symbolCache = null;
    this.cacheLoadTime = null;
    this.CACHE_TTL = 5 * 60 * 1000; // 5 分钟
    // 手动添加的 Alpha 代币（API 可能不完整）
    // 格式：{ alphaId: 'ALPHA_xxx', symbol: 'SYM', name: 'Name', status: 'TRADING' }
    this.manualAlphaTokens = [
      { alphaId: 'ALPHA_495', symbol: 'CYS', name: 'Cysic', status: 'TRADING' }
    ];
    // 新币代币列表（格式：和现货一样，如 PORTALUSDT、NEWTUSDT）
    // 币安没有独立的 Alpha API，所有代币都在标准 api.binance.com 中
    // 状态：TRADING（可交易）或 BREAK（暂停交易）
    this.newTokens = [
      'PORTALUSDT',  // TRADING
      'NEWTUSDT',    // TRADING
      'ALPHAUSDT',   // BREAK - 注意：当前状态为暂停交易
      // 可以添加更多新币
    ];
    
    // 新币代币状态映射（symbol -> status）
    this.newTokenStatus = {
      'PORTALUSDT': 'TRADING',
      'NEWTUSDT': 'TRADING',
      'ALPHAUSDT': 'BREAK',
      // TODO: 定期更新状态
    };
    
    // WebSocket 服务器
    this.wsServer = null;
    this.clients = new Set();
  }

  /**
   * 绑定依赖
   */
  bind(configManager, storage, app, notificationService) {
    this.configManager = configManager;
    this.storage = storage;
    this.app = app;
    this.notificationService = notificationService;
  }

  /**
   * 加载代币列表缓存（现货 + Alpha）
   */
  async loadSymbolCache() {
    console.log('[Cache] Loading symbol cache...');
    const start = Date.now();
    
    try {
      // 并行加载现货和 Alpha
      const [spotData, alphaData] = await Promise.all([
        fetch('https://api.binance.com/api/v3/exchangeInfo').then(r => r.json()),
        fetch('https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list').then(r => r.json())
      ]);
      
      // 处理现货数据（只保留 TRADING 状态的 USDT 交易对）
      const spotSymbols = (spotData.symbols || [])
        .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map(s => ({
          symbol: s.symbol,
          source: 'spot',
          status: 'TRADING'
        }));
      
      // 处理 Alpha 数据
      const alphaSymbols = (alphaData.data || [])
        .filter(t => t.alphaId && t.symbol)
        .map(t => ({
          symbol: `${t.symbol} (${t.alphaId})`,
          alphaId: t.alphaId,
          source: 'alpha',
          status: 'TRADING',
          name: t.name
        }));
      
      // 合并缓存
      this.symbolCache = [...spotSymbols, ...alphaSymbols];
      this.cacheLoadTime = Date.now();
      
      const duration = Date.now() - start;
      console.log(`[Cache] Loaded ${this.symbolCache.length} symbols in ${duration}ms`);
      
      return this.symbolCache;
    } catch (error) {
      console.error('[Cache] Failed to load cache:', error);
      throw error;
    }
  }

  /**
   * 初始化缓存（启动时加载 + 定时刷新）
   */
  async initSymbolCache() {
    await this.loadSymbolCache();
    
    // 每 5 分钟刷新一次
    setInterval(() => {
      this.loadSymbolCache().catch(err => {
        console.error('[Cache] Refresh failed:', err);
      });
    }, this.CACHE_TTL);
  }

  /**
   * 获取新币代币列表
   */
  getNewTokens() {
    return this.newTokens;
  }

  /**
   * 获取新币代币状态
   */
  getNewTokenStatus(symbol) {
    return this.newTokenStatus[symbol.toUpperCase()] || 'TRADING';
  }

  /**
   * 搜索币种（使用缓存）
   */
  async searchSymbols(query, source = 'spot') {
    if (!this.symbolCache) {
      await this.loadSymbolCache();
    }
    
    const q = query.toUpperCase();
    let results = this.symbolCache
      .filter(s => s.symbol.toUpperCase().includes(q));
    
    // 根据数据源过滤
    if (source === 'spot') {
      results = results.filter(s => s.source === 'spot');
    } else if (source === 'alpha') {
      results = results.filter(s => s.source === 'alpha');
    }
    // source === 'all' 不过滤
    
    // 获取已添加币种的价格缓存
    const cachedPrices = this._getPrices().data || {};
    
    // 返回时附带价格
    return Promise.all(results.slice(0, 10).map(async s => {
      let price = 'N/A';
      
      // 现货价格：直接从缓存获取（已添加币种）或从币安 API 获取（新币种）
      if (s.source === 'spot') {
        // 先查缓存
        price = cachedPrices[s.symbol] || cachedPrices[s.symbol.replace('USDT', '')];
        // 缓存没有，从币安 API 获取
        if (!price) {
          try {
            const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${s.symbol}`);
            const data = await res.json();
            price = data.price ? parseFloat(data.price) : 'N/A';
          } catch (e) {
            price = 'N/A';
          }
        }
      }
      // Alpha 价格：从缓存或 HTTP API 获取
      else if (s.source === 'alpha') {
        const alphaMatch = s.symbol.match(/\((ALPHA_\d+)\)/);
        if (alphaMatch) {
          const alphaPrice = await fetchAlphaPrice(alphaMatch[1]);
          price = alphaPrice ? parseFloat(alphaPrice) : 'N/A';
        }
      }
      
      return {
        symbol: s.symbol,
        source: s.source,
        price: price,
        status: s.status
      };
    }));
  }

  /**
   * 启动服务器
   */
  async start() {
    // 初始化代币缓存
    await this.initSymbolCache();
    
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      
      // 初始化 WebSocket 服务器
      this.wsServer = new WebSocket.Server({ server: this.server });
      
      this.wsServer.on('connection', (ws) => {
        this._handleWebSocketConnection(ws);
      });
      
      this.server.on('error', (err) => {
        console.error(`[WebServer] 服务器错误：${err.message}`);
        reject(err);
      });

      this.server.listen(this.port, () => {
        this.startTime = Date.now();
        console.log(`[WebServer] 启动成功：http://localhost:${this.port}`);
        console.log(`[WebServer] API Token: ${this.apiToken}`);
        console.log(`[WebServer] WebSocket 已启用`);
        resolve();
      });
    });
  }

  /**
   * 停止服务器
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        // 关闭所有 WebSocket 连接
        this.clients.forEach(client => {
          client.close();
        });
        this.clients.clear();
        
        this.server.close(() => {
          console.log('[WebServer] 服务器已停止');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * 处理 WebSocket 连接
   */
  _handleWebSocketConnection(ws) {
    this.clients.add(ws);
    console.log(`[WebSocket] 新连接，当前连接数：${this.clients.size}`);
    
    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[WebSocket] 连接关闭，当前连接数：${this.clients.size}`);
    });
    
    ws.on('error', (err) => {
      console.error(`[WebSocket] 连接错误：${err.message}`);
      this.clients.delete(ws);
    });
  }

  /**
   * 广播消息给所有连接的客户端
   */
  broadcast(message) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    let sentCount = 0;
    
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
        sentCount++;
      }
    });
    
    console.log(`[WebSocket] 广播消息，发送给 ${sentCount} 个客户端`);
  }

  /**
   * 处理请求
   */
  async _handleRequest(req, res) {
    const { pathname, query } = parseUrl(req.url);
    const method = req.method;

    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Token');

    // OPTIONS 预检
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // API 路由
      if (pathname.startsWith('/api/')) {
        // API Token 验证（除了 status 和 cache/status 端点）
        if (pathname !== '/api/status' && pathname !== '/api/cache/status') {
          const token = req.headers['x-api-token'];
          if (!token || token !== this.apiToken) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
        }

        await this._handleApi(req, res, pathname, query);
      } else {
        // 静态文件
        await this._handleStatic(req, res, pathname);
      }
    } catch (err) {
      console.error(`[WebServer] 请求处理错误：${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }

  /**
   * 处理 API 请求
   */
  async _handleApi(req, res, pathname, query) {
    const method = req.method;

    // 读取请求体
    let body = '';
    if (method === 'POST' || method === 'PUT') {
      body = await new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
      body = parseBody(body);
    }

    // 路由处理
    let result;

    // GET /api/status - 系统状态
    if (pathname === '/api/status' && method === 'GET') {
      result = this._getStatus();
    }
    // GET /api/cache/status - 缓存状态
    else if (pathname === '/api/cache/status' && method === 'GET') {
      result = this._getCacheStatus();
    }
    // GET /api/prices - 获取所有当前价格（用于搜索显示）
    else if (pathname === '/api/prices' && method === 'GET') {
      result = this._getPrices();
    }
    // GET /api/symbols/search - 搜索币种
    else if (pathname === '/api/symbols/search' && method === 'GET') {
      result = await this._searchSymbols(query.q, query.source);
    }
    // GET /api/symbols/status - 代币状态检查
    else if (pathname === '/api/symbols/status' && method === 'GET') {
      result = this._getSymbolsStatus();
    }
    // GET /api/symbols - 币种列表
    else if (pathname === '/api/symbols' && method === 'GET') {
      result = this._getSymbols(query.symbol);
    }
    // POST /api/symbols - 添加币种
    else if (pathname === '/api/symbols' && method === 'POST') {
      result = await this._addSymbol(body);
    }
    // PUT /api/symbols/:id - 更新币种
    else if (pathname.match(/^\/api\/symbols\/[^/]+$/) && method === 'PUT') {
      const symbol = pathname.split('/')[3];
      result = await this._updateSymbol(symbol, body);
    }
    // DELETE /api/symbols/:id - 删除币种
    else if (pathname.match(/^\/api\/symbols\/[^/]+$/) && method === 'DELETE') {
      const symbol = pathname.split('/')[3];
      result = await this._deleteSymbol(symbol);
    }
    // GET /api/targets - 价格目标列表
    else if (pathname === '/api/targets' && method === 'GET') {
      result = this._getTargets(query.symbol);
    }
    // POST /api/targets - 添加目标
    else if (pathname === '/api/targets' && method === 'POST') {
      result = await this._addTarget(body);
    }
    // PUT /api/targets - 更新目标（根据 symbol 更新）
    else if (pathname === '/api/targets' && method === 'PUT') {
      result = await this._updateTargetBySymbol(body);
    }
    // PUT /api/targets/:id - 更新目标
    else if (pathname.match(/^\/api\/targets\/[^/]+$/) && method === 'PUT') {
      const targetId = pathname.split('/')[3];
      result = await this._updateTarget(targetId, body);
    }
    // DELETE /api/targets/:id - 删除目标
    else if (pathname.match(/^\/api\/targets\/[^/]+$/) && method === 'DELETE') {
      const targetId = pathname.split('/')[3];
      result = await this._deleteTarget(targetId);
    }
    // GET /api/alerts - 告警历史
    else if (pathname === '/api/alerts' && method === 'GET') {
      result = this._getAlerts(query);
    }
    // GET /api/alerts/history - 获取报警历史记录
    else if (pathname === '/api/alerts/history' && method === 'GET') {
      result = this._getAlertsHistory();
    }
    // POST /api/system/toggle - 系统总开关
    else if (pathname === '/api/system/toggle' && method === 'POST') {
      result = this._toggleSystem(body);
    }
    // GET /api/volatility/config - 获取波动模块配置（新版）
    else if (pathname === '/api/volatility/config' && method === 'GET') {
      result = this._getVolatilityConfig();
    }
    // PUT /api/volatility/start - 开启波动侦测（新版）
    else if (pathname === '/api/volatility/start' && method === 'PUT') {
      result = await this._startVolatility(body);
    }
    // PUT /api/volatility/toggle - 切换波动侦测开关（新版）
    else if (pathname === '/api/volatility/toggle' && method === 'PUT') {
      result = await this._toggleVolatilityNew(body);
    }
    // GET /api/volatility - 波动配置（旧版，保留兼容）
    else if (pathname === '/api/volatility' && method === 'GET') {
      result = this._getVolatility(query.symbol);
    }
    // GET /api/volatility/settings - 获取波动设置（旧版，保留兼容）
    else if (pathname === '/api/volatility/settings' && method === 'GET') {
      result = this._getVolatilitySettings();
    }
    // PUT /api/volatility/settings - 更新波动设置（旧版，保留兼容）
    else if (pathname === '/api/volatility/settings' && method === 'PUT') {
      result = await this._updateVolatilitySettings(body);
    }
    // PUT /api/volatility/scope - 更新波动监控范围（旧版，保留兼容）
    else if (pathname === '/api/volatility/scope' && method === 'PUT') {
      result = await this._updateVolatilityScope(body);
    }
    // PUT /api/volatility/:symbol - 更新波动配置（旧版，保留兼容）
    else if (pathname.match(/^\/api\/volatility\/[^/]+$/) && method === 'PUT') {
      const symbol = pathname.split('/')[3];
      result = await this._updateVolatility(symbol, body);
    }
    // POST /api/volatility/toggle - 切换波动侦测（旧版，保留兼容）
    else if (pathname === '/api/volatility/toggle' && method === 'POST') {
      result = this._toggleVolatility(body);
    }
    // GET /api/settings - 系统设置
    else if (pathname === '/api/settings' && method === 'GET') {
      result = this._getSettings();
    }
    // PUT /api/settings - 更新设置
    else if (pathname === '/api/settings' && method === 'PUT') {
      result = await this._updateSettings(body);
    }
    // GET /api/notification/config - 获取通知配置
    else if (pathname === '/api/notification/config' && method === 'GET') {
      result = this._getNotificationConfig();
    }
    // PUT /api/notification/config - 保存通知配置
    else if (pathname === '/api/notification/config' && method === 'PUT') {
      result = await this._saveNotificationConfig(body);
    }
    // POST /api/notification/test - 测试通知
    else if (pathname === '/api/notification/test' && method === 'POST') {
      result = await this._testNotification(body);
    }
    // PUT /api/symbols/:symbol/notification - 更新币种通知设置
    else if (pathname.match(/^\/api\/symbols\/[^/]+\/notification$/) && method === 'PUT') {
      const symbol = pathname.split('/')[4];
      result = await this._updateSymbolNotification(symbol, body);
    }
    // PUT /api/notification/config/bark/monitor - 切换监控列表 Bark 通知
    else if (pathname === '/api/notification/config/bark/monitor' && method === 'PUT') {
      result = await this._toggleBarkMonitor();
    }
    // PUT /api/notification/config/bark/monitor/mode - 保存监控列表 Bark 模式
    else if (pathname === '/api/notification/config/bark/monitor/mode' && method === 'PUT') {
      result = await this._saveBarkMonitorMode(body);
    }
    // PUT /api/notification/config/bark/volatility - 切换波动侦测 Bark 通知
    else if (pathname === '/api/notification/config/bark/volatility' && method === 'PUT') {
      result = await this._toggleBarkVolatility();
    }
    // PUT /api/notification/config/bark/volatility/mode - 保存波动侦测 Bark 模式
    else if (pathname === '/api/notification/config/bark/volatility/mode' && method === 'PUT') {
      result = await this._saveBarkVolatilityMode(body);
    }
    else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  }

  /**
   * 处理静态文件
   */
  async _handleStatic(req, res, pathname) {
    // 默认首页
    if (pathname === '/') {
      pathname = '/index.html';
    }

    const filePath = path.join(this.publicDir, pathname);
    
    // 安全检查：防止目录遍历
    if (!filePath.startsWith(this.publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const content = await fs.readFile(filePath);
      const ext = path.extname(pathname).toLowerCase();
      
      const contentTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon'
      };

      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
      res.end(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    }
  }

  // ==================== API  handlers ====================

  /**
   * GET /api/status - 系统状态
   */
  _getStatus() {
    const config = this.configManager?.config;
    const uptime = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
    const memory = process.memoryUsage();
    
    const symbols = config?.symbols || [];
    const enabledSymbols = symbols.filter(s => s.enabled);
    
    // 获取实时价格
    const symbolPrices = enabledSymbols.map(s => {
      // Alpha 币种使用 ca 作为 key 查询，现货使用 symbol
      const priceKey = s.source === 'alpha' ? s.ca : s.symbol;
      const latest = this.storage?.getLatestPrice(priceKey);
      return {
        symbol: s.symbol,
        enabled: s.enabled,
        source: s.source,
        price: latest?.price || 0,
        change24h: 0 // TODO: 计算 24h 变化
      };
    });

    return {
      success: true,
      data: {
        running: this.app?.isRunning || false,
        uptime,
        memory: {
          heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
          rss: Math.round(memory.rss / 1024 / 1024)
        },
        symbolsCount: symbols.length,
        enabledCount: enabledSymbols.length,
        symbolPrices,
        systemEnabled: this.configManager?.isSystemEnabled() || false
      }
    };
  }

  /**
   * GET /api/cache/status - 缓存状态
   */
  _getCacheStatus() {
    return {
      success: true,
      data: {
        cached: !!this.symbolCache,
        count: this.symbolCache?.length || 0,
        loadedAt: this.cacheLoadTime,
        age: this.cacheLoadTime ? Date.now() - this.cacheLoadTime : null,
        ttl: this.CACHE_TTL
      }
    };
  }

  /**
   * GET /api/prices - 获取所有当前价格
   * 返回格式：{ SYMBOL: price, ... }
   */
  _getPrices() {
    const config = this.configManager?.config;
    const symbols = config?.symbols || [];
    
    const prices = {};
    symbols.forEach(s => {
      // Alpha 币种使用 ca 作为 key 查询，现货使用 symbol
      const priceKey = s.source === 'alpha' ? s.ca : s.symbol;
      const latest = this.storage?.getLatestPrice(priceKey);
      if (latest?.price) {
        prices[s.symbol] = latest.price;
        // 也存储不带 USDT 的版本方便查找
        const baseSymbol = s.symbol.replace('USDT', '');
        prices[baseSymbol] = latest.price;
      }
    });
    
    return {
      success: true,
      data: prices
    };
  }

  /**
   * GET /api/symbols/search - 搜索币种
   */
  async _searchSymbols(query, source = 'spot') {
    try {
      const results = await this.searchSymbols(query, source);
      return {
        success: true,
        data: results
      };
    } catch (err) {
      console.error('[WebServer] 搜索币种失败:', err.message);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * GET /api/symbols/status - 代币状态检查
   */
  _getSymbolsStatus() {
    try {
      const statusMap = {};
      this.newTokens.forEach(symbol => {
        statusMap[symbol] = this.getNewTokenStatus(symbol);
      });
      
      return {
        success: true,
        data: statusMap
      };
    } catch (err) {
      console.error('[WebServer] 获取代币状态失败:', err.message);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * GET /api/symbols - 币种列表
   */
  _getSymbols(symbolFilter) {
    const config = this.configManager?.config;
    let symbols = config?.symbols || [];
    
    // 如果提供了 symbol 参数，过滤出单个币种
    if (symbolFilter) {
      symbols = symbols.filter(s => s.symbol === symbolFilter.toUpperCase());
    }
    
    // 添加实时价格
    const symbolsWithPrice = symbols.map(s => {
      // Alpha 币种使用 ca 作为 key 查询，现货使用 symbol
      const priceKey = s.source === 'alpha' ? s.ca : s.symbol;
      const latest = this.storage?.getLatestPrice(priceKey);
      return {
        ...s,
        currentPrice: latest?.price || 0
      };
    });

    return {
      success: true,
      data: symbolsWithPrice
    };
  }

  /**
   * POST /api/symbols - 添加币种
   */
  async _addSymbol(data) {
    if (!data || !data.symbol) {
      return { success: false, error: '缺少 symbol 字段' };
    }

    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    // 解析符号和来源（格式：SYMBOL 或 SYMBOL (source) 或 SYMBOL (ALPHA_xxx)）
    let symbol = data.symbol.toUpperCase();
    let source = data.source || 'spot';
    let alphaId = null;
    
    // 检查是否是 Alpha 代币格式：SYMBOL (ALPHA_xxx)
    const alphaMatch = data.symbol.match(/^(.+)\s+\((ALPHA_\d+)\)$/i);
    if (alphaMatch) {
      symbol = alphaMatch[1].toUpperCase();
      alphaId = alphaMatch[2].toUpperCase();
      source = 'alpha';
    } else {
      const match = data.symbol.match(/^(.+)\s+\((spot|new)\)$/i);
      if (match) {
        symbol = match[1].toUpperCase();
        source = match[2].toLowerCase();
      }
    }

    // 新币代币格式验证（和现货一样）
    if (source === 'new') {
      if (!symbol.match(/^[A-Z]+USDT$/)) {
        return { 
          success: false, 
          error: '新币代币格式错误，必须是 SYMBOLUSDT 格式（如 PORTALUSDT）' 
        };
      }
    } else if (source === 'alpha') {
      // Alpha 代币格式验证
      if (!alphaId || !alphaId.match(/^ALPHA_\d+$/)) {
        return { 
          success: false, 
          error: 'Alpha 代币格式错误，必须是 SYMBOL (ALPHA_xxx) 格式（如 UP (ALPHA_804)）' 
        };
      }
    } else {
      // 现货代币格式验证
      if (!symbol.match(/^[A-Z]+USDT$/)) {
        return { 
          success: false, 
          error: '现货代币格式错误，必须是 SYMBOLUSDT 格式（如 BTCUSDT）' 
        };
      }
    }

    // 检查是否已存在
    const exists = config.symbols.find(s => s.symbol === symbol);
    if (exists) {
      return { success: false, error: '币种已存在' };
    }

    // 创建新币种配置
    const newSymbol = {
      symbol: symbol,
      enabled: data.enabled !== false,
      source: source,
      alphaId: alphaId, // Alpha 代币专用字段
      targets: [],
      volatility: {
        enabled: true,
        windowMinutes: 5,
        thresholdPercent: 20
      }
    };

    config.symbols.push(newSymbol);
    await this.configManager.save();

    return { success: true, data: newSymbol };
  }

  /**
   * PUT /api/symbols/:symbol - 更新币种
   */
  async _updateSymbol(symbol, data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    const symbolConfig = config.symbols.find(s => s.symbol === symbol.toUpperCase());
    if (!symbolConfig) {
      return { success: false, error: '币种不存在' };
    }

    // 更新字段
    if (data.enabled !== undefined) {
      symbolConfig.enabled = data.enabled;
      
      // 打开开关时：重置状态为 waiting，继续监控
      if (data.enabled === true && symbolConfig.targets?.[0]) {
        symbolConfig.targets[0].status = 'waiting';
        symbolConfig.targets[0].triggeredAt = null;
        symbolConfig.targets[0].triggeredPrice = null;
        symbolConfig.targets[0].enabled = true; // 同时打开目标开关
        console.log(`[WebServer] 币种 ${symbol} 开关已打开，状态重置为 waiting`);
      }
      // 关闭开关时：保持当前状态，但标记为暂停
      else if (data.enabled === false) {
        console.log(`[WebServer] 币种 ${symbol} 开关已关闭，状态保持为 ${symbolConfig.targets[0]?.status || 'N/A'}`);
      }
    }
    if (data.source) symbolConfig.source = data.source;
    if (data.volatility) {
      symbolConfig.volatility = { ...symbolConfig.volatility, ...data.volatility };
    }

    await this.configManager.save();

    return { success: true, data: symbolConfig };
  }

  /**
   * DELETE /api/symbols/:symbol - 删除币种
   */
  async _deleteSymbol(symbol) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    const index = config.symbols.findIndex(s => s.symbol === symbol.toUpperCase());
    if (index === -1) {
      return { success: false, error: '币种不存在' };
    }

    config.symbols.splice(index, 1);
    await this.configManager.save();

    return { success: true };
  }

  /**
   * GET /api/targets - 价格目标列表
   */
  _getTargets(symbolFilter) {
    const config = this.configManager?.config;
    const symbols = config?.symbols || [];
    
    let targets = [];
    symbols.forEach(s => {
      if (symbolFilter && s.symbol !== symbolFilter.toUpperCase()) {
        return;
      }
      (s.targets || []).forEach(t => {
        targets.push({
          ...t,
          symbol: s.symbol
        });
      });
    });

    return { success: true, data: targets };
  }

  /**
   * POST /api/targets - 添加目标
   */
  async _addTarget(data) {
    console.log('[WebServer] _addTarget 收到数据:', data);
    
    if (!data || !data.symbol || !data.type || !data.price) {
      console.log('[WebServer] _addTarget 验证失败：缺少必要字段');
      return { success: false, error: '缺少必要字段' };
    }

    const config = this.configManager?.config;
    if (!config) {
      console.log('[WebServer] _addTarget 错误：配置未加载');
      return { success: false, error: '配置未加载' };
    }

    const symbolConfig = config.symbols.find(s => s.symbol === data.symbol.toUpperCase());
    if (!symbolConfig) {
      console.log('[WebServer] _addTarget 错误：币种不存在', data.symbol);
      return { success: false, error: '币种不存在' };
    }

    const target = {
      id: `target_${Date.now()}`,
      type: data.type, // 'above' or 'below'
      price: parseFloat(data.price),
      enabled: data.enabled !== false,
      status: 'waiting'
    };

    console.log('[WebServer] _addTarget 创建目标对象:', target);
    console.log('[WebServer] _addTarget 添加前 targets 数组:', symbolConfig.targets);
    
    symbolConfig.targets.push(target);
    
    console.log('[WebServer] _addTarget 添加后 targets 数组:', symbolConfig.targets);
    console.log('[WebServer] _addTarget 准备保存配置...');
    
    await this.configManager.save();
    
    console.log('[WebServer] _addTarget 保存成功');

    return { success: true, data: target };
  }

  /**
   * PUT /api/targets - 更新目标（根据 symbol 更新第一个目标）
   */
  async _updateTargetBySymbol(data) {
    console.log('[WebServer] _updateTargetBySymbol 收到数据:', data);
    
    if (!data || !data.symbol || !data.type || !data.price) {
      console.log('[WebServer] _updateTargetBySymbol 验证失败：缺少必要字段');
      return { success: false, error: '缺少必要字段' };
    }

    const config = this.configManager?.config;
    if (!config) {
      console.log('[WebServer] _updateTargetBySymbol 错误：配置未加载');
      return { success: false, error: '配置未加载' };
    }

    const symbolConfig = config.symbols.find(s => s.symbol === data.symbol.toUpperCase());
    if (!symbolConfig) {
      console.log('[WebServer] _updateTargetBySymbol 错误：币种不存在', data.symbol);
      return { success: false, error: '币种不存在' };
    }

    // 更新或添加目标
    if (symbolConfig.targets?.length > 0) {
      // 更新第一个目标
      symbolConfig.targets[0] = {
        ...symbolConfig.targets[0],
        type: data.type,
        price: parseFloat(data.price)
      };
      console.log('[WebServer] _updateTargetBySymbol 更新现有目标:', symbolConfig.targets[0]);
    } else {
      // 创建新目标
      symbolConfig.targets = [{
        id: `target_${Date.now()}`,
        type: data.type,
        price: parseFloat(data.price),
        enabled: true,
        status: 'waiting'
      }];
      console.log('[WebServer] _updateTargetBySymbol 创建新目标:', symbolConfig.targets[0]);
    }
    
    await this.configManager.save();
    console.log('[WebServer] _updateTargetBySymbol 保存成功');

    return { success: true, data: symbolConfig.targets[0] };
  }

  /**
   * PUT /api/targets/:id - 更新目标
   */
  async _updateTarget(targetId, data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    let target = null;
    let symbolConfig = null;

    for (const s of config.symbols) {
      const t = s.targets.find(t => t.id === targetId);
      if (t) {
        target = t;
        symbolConfig = s;
        break;
      }
    }

    if (!target) {
      return { success: false, error: '目标不存在' };
    }

    if (data.type) target.type = data.type;
    if (data.price !== undefined) target.price = parseFloat(data.price);
    if (data.enabled !== undefined) target.enabled = data.enabled;
    if (data.status) target.status = data.status;

    await this.configManager.save();

    return { success: true, data: target };
  }

  /**
   * DELETE /api/targets/:id - 删除目标
   */
  async _deleteTarget(targetId) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    for (const s of config.symbols) {
      const index = s.targets.findIndex(t => t.id === targetId);
      if (index !== -1) {
        s.targets.splice(index, 1);
        await this.configManager.save();
        return { success: true };
      }
    }

    return { success: false, error: '目标不存在' };
  }

  /**
   * GET /api/alerts - 告警历史
   */
  _getAlerts(query) {
    const alertState = this.storage?.alertStateStore?.getAll() || {};
    const targets = alertState.targets || {};
    const volatility = alertState.volatility || {};

    let alerts = [];

    // 价格目标告警
    for (const [targetId, data] of Object.entries(targets)) {
      alerts.push({
        type: 'target',
        targetId,
        ...data
      });
    }

    // 波动告警
    for (const [symbol, data] of Object.entries(volatility)) {
      alerts.push({
        type: 'volatility',
        symbol,
        ...data
      });
    }

    // 筛选
    if (query.symbol) {
      alerts = alerts.filter(a => a.symbol === query.symbol.toUpperCase());
    }

    // 按时间排序
    alerts.sort((a, b) => (b.triggeredAt || b.lastAlertAt || 0) - (a.triggeredAt || a.lastAlertAt || 0));

    return { success: true, data: alerts };
  }

  /**
   * GET /api/alerts/history - 获取报警历史记录
   */
  _getAlertsHistory() {
    const history = this.storage?.getAlertHistory() || [];
    
    return { success: true, data: history };
  }

  /**
   * POST /api/system/toggle - 系统总开关
   */
  _toggleSystem(data) {
    const enabled = data?.enabled !== undefined ? data.enabled : !this.configManager?.isSystemEnabled();
    this.configManager?.setSystemEnabled(enabled);
    
    return {
      success: true,
      data: { enabled }
    };
  }

  /**
   * GET /api/volatility - 波动配置
   */
  _getVolatility(symbolFilter) {
    const config = this.configManager?.config;
    const symbols = config?.symbols || [];
    
    let volatility = [];
    symbols.forEach(s => {
      if (symbolFilter && s.symbol !== symbolFilter.toUpperCase()) {
        return;
      }
      volatility.push({
        symbol: s.symbol,
        enabled: s.enabled,
        volatility: s.volatility
      });
    });

    return { success: true, data: volatility };
  }

  /**
   * PUT /api/volatility/:symbol - 更新波动配置
   */
  async _updateVolatility(symbol, data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    const symbolConfig = config.symbols.find(s => s.symbol === symbol.toUpperCase());
    if (!symbolConfig) {
      return { success: false, error: '币种不存在' };
    }

    if (data.volatility) {
      symbolConfig.volatility = { ...symbolConfig.volatility, ...data.volatility };
    }

    await this.configManager.save();

    return { success: true, data: symbolConfig.volatility };
  }

  /**
   * GET /api/volatility/settings - 获取波动设置
   */
  _getVolatilitySettings() {
    const config = this.configManager?.config;
    return {
      success: true,
      data: {
        scope: config?.volatilityScope || 'global',
        windowMinutes: config?.volatilityWindowMinutes || 5,
        thresholdPercent: config?.volatilityThresholdPercent || 20,
        enabled: false
      }
    };
  }

  /**
   * PUT /api/volatility/settings - 更新波动设置（应用到所有币种 + 全局配置）
   */
  async _updateVolatilitySettings(data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    // 更新全局配置（用于 global 模式）
    if (data.windowMinutes !== undefined) {
      config.volatilityWindowMinutes = parseInt(data.windowMinutes);
    }
    if (data.thresholdPercent !== undefined) {
      config.volatilityThresholdPercent = parseFloat(data.thresholdPercent);
    }

    // 更新所有币种的波动配置（用于 added 模式）
    if (config.symbols && Array.isArray(config.symbols)) {
      for (const symbol of config.symbols) {
        if (!symbol.volatility) {
          symbol.volatility = {};
        }
        
        if (data.windowMinutes !== undefined) {
          symbol.volatility.windowMinutes = parseInt(data.windowMinutes);
        }
        if (data.thresholdPercent !== undefined) {
          symbol.volatility.thresholdPercent = parseFloat(data.thresholdPercent);
        }
      }
    }

    await this.configManager.save();
    console.log(`[WebServer] 波动设置已更新：window=${config.volatilityWindowMinutes}min, threshold=${config.volatilityThresholdPercent}%`);

    return { success: true, message: '波动设置已更新' };
  }

  /**
   * PUT /api/volatility/scope - 更新波动监控范围
   */
  async _updateVolatilityScope(data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    if (data.scope) {
      config.volatilityScope = data.scope;
    }

    await this.configManager.save();

    return { success: true, data: { scope: config.volatilityScope } };
  }

  /**
   * POST /api/volatility/toggle - 切换波动侦测（旧版，保留兼容）
   */
  _toggleVolatility(data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    const enabled = data?.enabled !== undefined ? data.enabled : !config.volatilityEnabled;
    config.volatilityEnabled = enabled;
    this.configManager.save();

    return { success: true, data: { enabled } };
  }

  /**
   * GET /api/volatility/config - 获取波动模块配置（新版）
   */
  _getVolatilityConfig() {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    const volatilityModule = config.volatilityModule || {
      enabled: false,
      scope: 'global',
      windowMinutes: 5,
      thresholdPercent: 20,
      barkEnabled: false,
      barkMode: 'normal'
    };

    return {
      success: true,
      data: volatilityModule
    };
  }

  /**
   * PUT /api/volatility/start - 开启波动侦测（新版）
   * 提交当前页面参数到 config
   */
  async _startVolatility(data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    // 初始化 volatilityModule（如果不存在）
    if (!config.volatilityModule) {
      config.volatilityModule = {};
    }

    // 更新参数
    config.volatilityModule.enabled = true;
    config.volatilityModule.scope = data?.scope || 'global';
    config.volatilityModule.windowMinutes = parseInt(data?.windowMinutes) || 5;
    
    // 调试日志：打印收到的数据
    console.log('[WebServer] _startVolatility - 收到的 data:', JSON.stringify(data));
    console.log('[WebServer] _startVolatility - data.thresholdPercent:', data?.thresholdPercent, 'typeof:', typeof data?.thresholdPercent);
    console.log('[WebServer] _startVolatility - parseFloat 结果:', parseFloat(data?.thresholdPercent));
    
    config.volatilityModule.thresholdPercent = parseFloat(data?.thresholdPercent) || 20;  // 支持小数
    config.volatilityModule.barkEnabled = config.bark?.volatilityEnabled || false;
    config.volatilityModule.barkMode = config.bark?.volatilityMode || 'normal';

    await this.configManager.save();

    console.log('[WebServer] 保存后的 config.volatilityModule:', config.volatilityModule);

    console.log(`[WebServer] 波动侦测已开启：scope=${config.volatilityModule.scope}, window=${config.volatilityModule.windowMinutes}min, threshold=${config.volatilityModule.thresholdPercent}%`);

    // 构建并发送 TG 通知
    const scope = config.volatilityModule.scope || 'global';
    const windowMinutes = config.volatilityModule.windowMinutes || 5;
    const thresholdPercent = config.volatilityModule.thresholdPercent || 20;
    const silenceMinutes = 5;
    
    let rangeText;
    if (scope === 'global') {
      rangeText = '全量';
    } else {
      // 监控列表模式，列出所有添加到监控列表的币种（不管 enabled 状态）
      const allSymbols = (config.symbols || [])
        .map(s => s.symbol);
      const count = allSymbols.length;
      const symbolList = allSymbols.join(', ');
      rangeText = `监控列表（${count}个：${symbolList}）`;
    }
    
    const message = `🌊 波动侦测开启

范围：${rangeText}
窗口：${windowMinutes}min | 阈值：${thresholdPercent}% | 静默期：${silenceMinutes}分钟`;
    
    // 发送 TG 通知（不等待，不阻塞）
    if (this.app?.alertService) {
      this.app.alertService.sendTextToTelegram(message).catch(err => {
        console.error('[WebServer] 发送波动侦测开启通知失败:', err.message);
      });
    } else {
      console.warn('[WebServer] alertService 未初始化，跳过通知发送');
    }

    // 直接启动波动引擎（如果已初始化）
    console.log('[WebServer] this.app:', this.app ? '存在' : 'undefined');
    console.log('[WebServer] this.app.volatilityEngine:', this.app?.volatilityEngine ? '存在' : 'undefined');
    
    if (this.app?.volatilityEngine) {
      console.log('[WebServer] 启动波动侦测引擎...');
      this.app.volatilityEngine.start();
    } else {
      console.warn('[WebServer] 波动侦测引擎未初始化，跳过启动');
    }

    return {
      success: true,
      message: '波动侦测已开启',
      data: config.volatilityModule
    };
  }

  /**
   * PUT /api/volatility/toggle - 切换波动侦测开关（新版）
   * 关闭时删除 config 参数，前端保持当前值
   */
  async _toggleVolatilityNew(data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    const enabled = data?.enabled !== undefined ? data.enabled : false;

    if (!config.volatilityModule) {
      config.volatilityModule = {};
    }

    config.volatilityModule.enabled = enabled;

    // 关闭时：删除参数（但保留 enabled 字段）
    if (!enabled) {
      delete config.volatilityModule.scope;
      delete config.volatilityModule.windowMinutes;
      delete config.volatilityModule.thresholdPercent;
      console.log('[WebServer] 波动侦测已关闭，参数已删除');
    }

    await this.configManager.save();

    // 通知应用停止/重启波动引擎
    if (this.app && this.app.volatilityEngine) {
      if (enabled) {
        console.log('[WebServer] 重启波动侦测引擎...');
        this.app.volatilityEngine.stop();
        this.app.volatilityEngine.start();
      } else {
        console.log('[WebServer] 停止波动侦测引擎...');
        this.app.volatilityEngine.stop();
      }
    }

    return {
      success: true,
      message: enabled ? '波动侦测已开启' : '波动侦测已关闭',
      data: { enabled }
    };
  }

  /**
   * GET /api/settings - 系统设置
   */
  _getSettings() {
    const config = this.configManager?.config;
    return {
      success: true,
      data: {
        bark: config?.bark || {},
        settings: config?.settings || {}
      }
    };
  }

  /**
   * PUT /api/settings - 更新设置
   */
  async _updateSettings(data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    if (data.bark) {
      config.bark = { ...config.bark, ...data.bark };
    }

    if (data.settings) {
      config.settings = { ...config.settings, ...data.settings };
    }

    await this.configManager.save();

    return { success: true, data: { bark: config.bark, settings: config.settings } };
  }

  /**
   * 获取通知配置
   */
  _getNotificationConfig() {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }
    
    // 从环境变量读取敏感配置（优先于 config.json）
    const barkKey = process.env.BARK_KEY || config.bark?.deviceKey || '';
    const barkSoundNormal = process.env.BARK_SOUND_NORMAL || config.bark?.soundNormal || 'minuet';
    const barkSoundCritical = process.env.BARK_SOUND_CRITICAL || config.bark?.soundCritical || 'alarm';
    const barkVolume = parseInt(process.env.BARK_VOLUME) || config.bark?.volume || 5;
    const tgBotToken = process.env.TG_BOT_TOKEN || config.telegram?.botToken || '';
    const tgChatId = process.env.TG_CHAT_ID || config.telegram?.chatId || '';
    
    return {
      success: true,
      data: {
        bark: {
          enabled: config.bark?.enabled || false,
          deviceKey: barkKey,  // 直接显示真实值，不脱敏
          serverUrl: config.bark?.serverUrl || 'https://api.day.app',
          soundNormal: barkSoundNormal,
          soundCritical: barkSoundCritical,
          volume: barkVolume,
          group: config.bark?.group || 'crypto_radar',
          monitorEnabled: config.bark?.monitorEnabled !== false, // 默认 true
          monitorMode: config.bark?.monitorMode || 'normal',
          volatilityEnabled: config.bark?.volatilityEnabled === true, // 默认 false
          volatilityMode: config.bark?.volatilityMode || 'normal'
        },
        telegram: {
          enabled: config.telegram?.enabled || false,
          botToken: tgBotToken,  // 直接显示真实值，不脱敏
          chatId: tgChatId
        },
        settings: {
          notificationTestMode: config.settings?.notificationTestMode || false
        }
      }
    };
  }

  /**
   * 脱敏显示密钥
   */
  _maskSecret(secret) {
    if (!secret || secret.length < 8) return '***';
    return secret.substring(0, 4) + '...' + secret.substring(secret.length - 4);
  }

  /**
   * 保存 .env 文件
   */
  async _saveEnvFile(updates) {
    const fs = require('fs');
    const path = require('path');
    
    const envPath = path.join(process.cwd(), '.env');
    const envExamplePath = path.join(process.cwd(), '.env.example');
    
    // 读取现有 .env 文件（如果存在）
    let envContent = '';
    try {
      envContent = fs.readFileSync(envPath, 'utf8');
    } catch (err) {
      // 文件不存在，从 .env.example 复制
      try {
        envContent = fs.readFileSync(envExamplePath, 'utf8');
      } catch (err2) {
        envContent = '# Crypto Radar Environment Variables\n';
      }
    }
    
    // 更新环境变量
    const lines = envContent.split('\n');
    const updated = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) {
        const key = match[1];
        if (updates[key] !== undefined) {
          lines[i] = `${key}=${updates[key]}`;
          updated[key] = true;
        }
      }
    }
    
    // 添加新的环境变量（如果不存在）
    for (const [key, value] of Object.entries(updates)) {
      if (!updated[key]) {
        lines.push(`${key}=${value}`);
      }
    }
    
    // 写入 .env 文件
    fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
    console.log('[WebServer] .env 文件已更新:', Object.keys(updates).join(', '));
  }

  /**
   * 保存通知配置
   */
  async _saveNotificationConfig(data) {
    try {
      console.log('[WebServer] _saveNotificationConfig received data:', JSON.stringify(data, null, 2));
      console.log('[WebServer] data.bark !== undefined:', data.bark !== undefined);
      console.log('[WebServer] data.telegram !== undefined:', data.telegram !== undefined);
      
      if (data.bark?.enabled && !data.bark.deviceKey) {
        throw new Error('Bark 启用时必须填写 deviceKey');
      }
      if (data.telegram?.enabled && (!data.telegram.botToken || !data.telegram.chatId)) {
        throw new Error('Telegram 启用时必须填写 botToken 和 chatId');
      }

      const config = this.configManager.config;
      console.log('[WebServer] config.telegram before update:', JSON.stringify(config.telegram, null, 2));

      // 准备 .env 文件更新
      const envUpdates = {};
      
      // 只有当 data.bark 存在时才更新 bark
      if (data.bark !== undefined) {
        console.log('[WebServer] Updating bark config...');
        
        // 敏感字段更新到 .env
        if (data.bark.deviceKey !== undefined) {
          envUpdates.BARK_KEY = data.bark.deviceKey;
        }
        if (data.bark.sound !== undefined) {
          envUpdates.BARK_SOUND = data.bark.sound;
        }
        if (data.bark.volume !== undefined) {
          envUpdates.BARK_VOLUME = data.bark.volume.toString();
        }
        if (data.bark.soundNormal !== undefined) {
          envUpdates.BARK_SOUND_NORMAL = data.bark.soundNormal;
        }
        if (data.bark.soundCritical !== undefined) {
          envUpdates.BARK_SOUND_CRITICAL = data.bark.soundCritical;
        }
        
        // 非敏感字段保留在 config.json（铃声使用占位符）
        config.bark = {
          ...config.bark,
          enabled: data.bark?.enabled ?? false,
          deviceKey: 'ENV_BARK_KEY',  // 占位符
          soundNormal: 'ENV_BARK_SOUND_NORMAL',  // 占位符
          soundCritical: 'ENV_BARK_SOUND_CRITICAL',  // 占位符
          volume: parseInt(data.bark?.volume) || 5,
          serverUrl: data.bark?.serverUrl ?? 'https://api.day.app',
          group: data.bark?.group ?? 'crypto_radar'
        };
      }

      // 只有当 data.telegram 存在时才更新 telegram
      if (data.telegram !== undefined) {
        console.log('[WebServer] Updating telegram config...');
        
        // 敏感字段更新到 .env
        if (data.telegram.botToken !== undefined) {
          envUpdates.TG_BOT_TOKEN = data.telegram.botToken;
        }
        if (data.telegram.chatId !== undefined) {
          envUpdates.TG_CHAT_ID = data.telegram.chatId;
        }
        
        // 非敏感字段保留在 config.json
        config.telegram = {
          ...config.telegram,
          enabled: data.telegram?.enabled ?? false,
          botToken: 'ENV_TG_BOT_TOKEN',  // 占位符
          chatId: 'ENV_TG_CHAT_ID'       // 占位符
        };
      } else {
        console.log('[WebServer] NOT updating telegram config (data.telegram is undefined)');
      }

      // 只有当 data.settings 存在时才更新 settings
      if (data.settings !== undefined) {
        console.log('[WebServer] Updating settings config...');
        config.settings = {
          ...config.settings,
          notificationTestMode: data.settings?.notificationTestMode ?? false
        };
      }

      // 保存 config.json
      console.log('[WebServer] config.telegram after update:', JSON.stringify(config.telegram, null, 2));
      await this.configManager.save();
      
      // 保存 .env 文件（如果有更新）
      if (Object.keys(envUpdates).length > 0) {
        await this._saveEnvFile(envUpdates);
        
        // 重新加载 .env 文件，更新 process.env
        require('dotenv').config({ override: true });
        console.log('[WebServer] 环境变量已重新加载');
      }

      return {
        success: true,
        message: '配置已保存',
        data: { updatedAt: new Date().toISOString() }
      };
    } catch (err) {
      return {
        success: false,
        error: 'SAVE_FAILED',
        message: err.message
      };
    }
  }

  /**
   * 更新币种通知设置
   */
  async _updateSymbolNotification(symbol, data) {
    try {
      const config = this.configManager.config;
      const symbolConfig = config.symbols.find(s => s.symbol === symbol.toUpperCase());

      if (!symbolConfig) {
        throw new Error(`币种 ${symbol} 不存在`);
      }

      if (data.barkEnabled !== undefined) {
        symbolConfig.barkEnabled = data.barkEnabled;
      }
      if (data.barkMode !== undefined) {
        if (!['normal', 'critical'].includes(data.barkMode)) {
          throw new Error('barkMode 必须是 normal 或 critical');
        }
        symbolConfig.barkMode = data.barkMode;
      }

      if (data.volatility) {
        if (!symbolConfig.volatility) {
          symbolConfig.volatility = {};
        }
        if (data.volatility.barkEnabled !== undefined) {
          symbolConfig.volatility.barkEnabled = data.volatility.barkEnabled;
        }
        if (data.volatility.barkMode !== undefined) {
          symbolConfig.volatility.barkMode = data.volatility.barkMode;
        }
      }

      await this.configManager.save();

      return {
        success: true,
        message: '币种通知设置已更新',
        data: symbolConfig
      };
    } catch (err) {
      return {
        success: false,
        error: 'UPDATE_FAILED',
        message: err.message
      };
    }
  }

  /**
   * 切换监控列表 Bark 通知
   */
  async _toggleBarkMonitor() {
    try {
      const config = this.configManager.config;
      
      // 切换状态
      const currentEnabled = config.bark?.monitorEnabled !== false;
      const newEnabled = !currentEnabled;
      
      config.bark = config.bark || {};
      config.bark.monitorEnabled = newEnabled;
      config.bark.monitorMode = config.bark.monitorMode || 'normal';
      
      await this.configManager.save();
      
      return {
        success: true,
        message: `监控列表 Bark 通知已${newEnabled ? '启用' : '禁用'}`,
        data: {
          enabled: newEnabled,
          mode: config.bark.monitorMode
        }
      };
    } catch (err) {
      return {
        success: false,
        error: 'TOGGLE_FAILED',
        message: err.message
      };
    }
  }

  /**
   * 保存监控列表 Bark 模式
   */
  async _saveBarkMonitorMode(data) {
    try {
      if (!data.mode || !['normal', 'critical'].includes(data.mode)) {
        throw new Error('模式必须是 normal 或 critical');
      }
      
      const config = this.configManager.config;
      config.bark = config.bark || {};
      config.bark.monitorMode = data.mode;
      
      await this.configManager.save();
      
      return {
        success: true,
        message: '监控列表 Bark 模式已保存',
        data: {
          mode: data.mode
        }
      };
    } catch (err) {
      return {
        success: false,
        error: 'SAVE_FAILED',
        message: err.message
      };
    }
  }

  /**
   * 切换波动侦测 Bark 通知
   */
  async _toggleBarkVolatility() {
    try {
      const config = this.configManager.config;
      
      // 切换状态
      const currentEnabled = config.bark?.volatilityEnabled === true;
      const newEnabled = !currentEnabled;
      
      config.bark = config.bark || {};
      config.bark.volatilityEnabled = newEnabled;
      config.bark.volatilityMode = config.bark.volatilityMode || 'normal';
      
      await this.configManager.save();
      
      return {
        success: true,
        message: `波动侦测 Bark 通知已${newEnabled ? '启用' : '禁用'}`,
        data: {
          enabled: newEnabled,
          mode: config.bark.volatilityMode
        }
      };
    } catch (err) {
      return {
        success: false,
        error: 'TOGGLE_FAILED',
        message: err.message
      };
    }
  }

  /**
   * 保存波动侦测 Bark 模式
   */
  async _saveBarkVolatilityMode(data) {
    try {
      if (!data.mode || !['normal', 'critical'].includes(data.mode)) {
        throw new Error('模式必须是 normal 或 critical');
      }
      
      const config = this.configManager.config;
      config.bark = config.bark || {};
      config.bark.volatilityMode = data.mode;
      
      await this.configManager.save();
      
      return {
        success: true,
        message: '波动侦测 Bark 模式已保存',
        data: {
          mode: data.mode
        }
      };
    } catch (err) {
      return {
        success: false,
        error: 'SAVE_FAILED',
        message: err.message
      };
    }
  }

  /**
   * 测试通知
   */
  async _testNotification(data) {
    try {
      if (!this.notificationService) {
        throw new Error('通知服务未初始化');
      }

      const config = this.configManager.config;
      const alert = {
        symbol: data.symbol,
        source: data.type,
        currentPrice: data.currentPrice,
        sourceType: config.symbols.find(s => s.symbol === data.symbol)?.source === 'alpha' ? 'Alpha' : '现货'
      };

      if (data.type === 'target') {
        alert.type = data.targetType;
        alert.targetPrice = data.targetPrice;
      } else if (data.type === 'volatility') {
        alert.windowMinutes = data.windowMinutes;
        alert.changePercent = data.changePercent;
        alert.direction = data.direction;
      }

      const barkUrl = this.notificationService.buildBarkUrl(alert, config.bark, data.mode);
      const tgUrl = this.notificationService.buildTelegramUrl(alert, config.telegram);
      const message = this.notificationService.buildMessage(alert);

      return {
        success: true,
        message: '测试通知已生成',
        data: {
          bark: {
            url: barkUrl,
            title: message.title,
            content: message.content,
            mode: data.mode || 'normal'
          },
          telegram: {
            url: tgUrl,
            text: `${message.title}\n${message.content}`
          },
          testMode: true
        }
      };
    } catch (err) {
      return {
        success: false,
        error: 'TEST_FAILED',
        message: err.message
      };
    }
  }
}

module.exports = WebServer;
