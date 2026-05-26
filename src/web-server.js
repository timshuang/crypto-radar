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
const syncFs = require('fs');
const path = require('path');
const packageJson = require('../package.json');
const EventEmitter = require('events');
const WebSocket = require('ws');
const { fetchAlphaPrice } = require('./monitors');

function readVersionInfo(baseDir) {
  const metaPath = path.join(baseDir, 'VERSION_META');

  let version = packageJson.version || '0.0.0';
  let channel = 'branch';

  try {
    if (syncFs.existsSync(metaPath)) {
      const rawMeta = syncFs.readFileSync(metaPath, 'utf8');
      const meta = Object.fromEntries(
        rawMeta
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .map(line => {
            const idx = line.indexOf('=');
            return idx > 0 ? [line.slice(0, idx), line.slice(idx + 1)] : null;
          })
          .filter(Boolean)
      );

      if (meta.CHANNEL === 'main' || meta.CHANNEL === 'branch') {
        channel = meta.CHANNEL;
      }
    }
  } catch (error) {
    console.error('[Version] 读取版本信息失败:', error.message);
  }

  const display = `${channel} ${version}`;

  return {
    version,
    channel,
    display
  };
}

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
    this.host = options.host || '127.0.0.1';
    this.apiToken = options.apiToken || 'crypto_radar_token_2024';
    this.publicDir = options.publicDir || path.join(__dirname, '..', 'public');
    this.configManager = null;
    this.storage = null;
    this.app = null;
    this.server = null;
    this.startTime = null;
    this.notificationService = null;
    this.loginAttempts = new Map();
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

      this.server.listen(this.port, this.host, () => {
        this.startTime = Date.now();
        console.log(`[WebServer] 启动成功：http://${this.host}:${this.port}`);
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
        // 登录端点不需要 token
        if (pathname === '/api/auth/login' && method === 'POST') {
          const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
          await this._handleLogin(req, res, clientIp);
          return;
        }

        // 其他所有 API 端点需要 token 验证
        const token = req.headers['x-api-token'] || query.token;
        if (!token || token !== this.apiToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
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
   * 处理登录请求
   */
  async _handleLogin(req, res, clientIp) {
    const now = Date.now();
    const attempt = this.loginAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };

    if (attempt.lockedUntil > now) {
      const remainingSec = Math.ceil((attempt.lockedUntil - now) / 1000);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `登录尝试过多，请 ${remainingSec} 秒后再试` }));
      return;
    }

    let body = '';
    body = await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data));
    });
    const parsed = parseBody(body);

    if (!parsed || !parsed.password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '请输入密码' }));
      return;
    }

    if (parsed.password === this.apiToken) {
      this.loginAttempts.delete(clientIp);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, token: this.apiToken }));
    } else {
      attempt.count++;
      let errorMsg;
      if (attempt.count >= 5) {
        attempt.lockedUntil = now + 5 * 60 * 1000;
        attempt.count = 0;
        errorMsg = '密码错误次数达到5次，已锁定5分钟';
      } else {
        errorMsg = `密码错误，您还有 ${5 - attempt.count} 次尝试机会`;
      }
      this.loginAttempts.set(clientIp, attempt);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: errorMsg }));
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

    // GET /api/auth/verify - 验证当前 token
    if (pathname === '/api/auth/verify' && method === 'GET') {
      result = { success: true };
    }
    // POST /api/auth/change-password - 修改密码
    else if (pathname === '/api/auth/change-password' && method === 'POST') {
      result = await this._changePassword(body);
    }
    // GET /api/status - 系统状态
    else if (pathname === '/api/status' && method === 'GET') {
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
    // GET /api/probe - 手动触发 API 格式探针
    else if (pathname === '/api/probe' && method === 'GET') {
      result = await this._runProbe();
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
    // DELETE /api/alerts/history - 清空报警历史记录
    else if (pathname === '/api/alerts/history' && method === 'DELETE') {
      result = await this._clearAlertsHistory();
    }
    // POST /api/system/toggle - 系统总开关
    else if (pathname === '/api/system/toggle' && method === 'POST') {
      result = this._toggleSystem(body);
    }
    // POST /api/system/restart - 重启系统（重新加载配置）
    else if (pathname === '/api/system/restart' && method === 'POST') {
      result = this._restartSystem(body);
    }
    // GET /api/volatility/config - 获取波动模块配置
    else if (pathname === '/api/volatility/config' && method === 'GET') {
      result = this._getVolatilityConfig();
    }
    // PUT /api/volatility/start - 开启波动侦测
    else if (pathname === '/api/volatility/start' && method === 'PUT') {
      result = await this._startVolatility(body);
    }
    // PUT /api/volatility/toggle - 切换波动侦测开关
    else if (pathname === '/api/volatility/toggle' && method === 'PUT') {
      result = await this._toggleVolatility(body);
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
    // PUT /api/notification/config/bark/volatility/high-volume - 切换大额强提醒开关
    else if (pathname === '/api/notification/config/bark/volatility/high-volume' && method === 'PUT') {
      result = await this._toggleBarkHighVolume();
    }
    // GET /api/config/export - 导出完整配置
    else if (pathname === '/api/config/export' && method === 'GET') {
      result = await this._exportConfig();
    }
    // POST /api/config/import - 导入完整配置
    else if (pathname === '/api/config/import' && method === 'POST') {
      result = await this._importConfig(body);
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
   * 统一解析取价 key（Alpha: alphaId -> 运行时映射 -> symbol）
   */
  _resolvePriceKey(symbolConfig) {
    if (!symbolConfig) return null;
    if (symbolConfig.source !== 'alpha') return symbolConfig.symbol;

    // 1) 配置中的 alphaId
    if (symbolConfig.alphaId) return symbolConfig.alphaId;

    // 2) 运行时映射（全量流建立的 symbol -> alphaId）
    const mappedKey = this.storage?.getCaForSymbol?.(symbolConfig.symbol);
    if (mappedKey) return mappedKey;

    // 3) 最终兜底（少数场景下 Alpha 可能以 symbol 入库）
    return symbolConfig.symbol;
  }

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
      const priceKey = this._resolvePriceKey(s);
      const latest = this.storage?.getLatestPrice(priceKey);
      return {
        symbol: s.symbol,
        enabled: s.enabled,
        source: s.source,
        price: latest?.price || 0,
        change24h: 0 // TODO: 计算 24h 变化
      };
    });

    const versionInfo = readVersionInfo(path.join(__dirname, '..'));

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
        systemEnabled: this.configManager?.isSystemEnabled() || false,
        version: versionInfo.version,
        versionChannel: versionInfo.channel,
        versionDisplay: versionInfo.display
      }
    };
  }

  /**
   * GET /api/cache/status - 缓存状态
   */
  _getCacheStatus() {
    const cache = this.symbolCache || [];
    const spotCount = cache.filter(s => s.source === 'spot').length;
    const alphaCount = cache.filter(s => s.source === 'alpha').length;

    return {
      success: true,
      data: {
        cached: !!this.symbolCache,
        count: cache.length,
        spotCount,
        alphaCount,
        loadedAt: this.cacheLoadTime,
        age: this.cacheLoadTime ? Date.now() - this.cacheLoadTime : null,
        ttl: this.CACHE_TTL
      }
    };
  }

  /**
   * GET /api/probe - 手动触发 API 格式探针
   */
  async _runProbe() {
    if (!this.app?.systemMonitor) {
      return { success: false, error: 'SystemMonitor 未初始化' };
    }
    return await this.app.systemMonitor.runApiProbes();
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
      const priceKey = this._resolvePriceKey(s);
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
      const priceKey = this._resolvePriceKey(s);
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
      targets: []
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
   * DELETE /api/alerts/history - 清空报警历史记录
   */
  async _clearAlertsHistory() {
    await this.storage?.clearAlertHistory?.();
    return { success: true, message: '报警历史已清空' };
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
   * POST /api/system/restart - 重启系统（由 PM2 自动拉起）
   */
  _restartSystem(data = {}) {
    try {
      const reason = data.reason || 'manual';
      console.log(`[WebServer] 收到系统重启请求，reason=${reason}`);

      // 先返回成功响应，再延迟退出进程（由 PM2 自动重启）
      setTimeout(() => {
        console.log('[WebServer] 正在重启进程...');
        process.exit(0);
      }, 800);

      return {
        success: true,
        message: '系统重启已开始',
        data: {
          restarting: true,
          timestamp: new Date().toISOString()
        }
      };
    } catch (err) {
      return {
        success: false,
        error: 'RESTART_FAILED',
        message: err.message
      };
    }
  }

  /**
   * GET /api/volatility/config - 获取波动模块配置
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
      minAvgQuoteVolume3m: 100,
      highVolumeEnabled: false,
      highVolumeThresholdAlpha: 500,
      highVolumeThresholdSpot: 5000
    };

    return {
      success: true,
      data: volatilityModule
    };
  }

  /**
   * PUT /api/volatility/start - 开启波动侦测
   * 保存全部参数 + 启动引擎 + 发送 TG 通知
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
    config.volatilityModule.thresholdPercent = parseFloat(data?.thresholdPercent) || 20;
    config.volatilityModule.minAvgQuoteVolume3m = parseFloat(data?.minAvgQuoteVolume3m) || 100;
    config.volatilityModule.highVolumeEnabled = data?.highVolumeEnabled === true;
    config.volatilityModule.highVolumeThresholdAlpha = parseFloat(data?.highVolumeThresholdAlpha) || 500;
    config.volatilityModule.highVolumeThresholdSpot = parseFloat(data?.highVolumeThresholdSpot) || 5000;

    // 后端校验：大额阈值必须 ≥ minAvg
    const minAvg = config.volatilityModule.minAvgQuoteVolume3m || 100;
    let validationError = null;
    const alphaInvalid = config.volatilityModule.highVolumeThresholdAlpha > 0 && config.volatilityModule.highVolumeThresholdAlpha < minAvg;
    const spotInvalid = config.volatilityModule.highVolumeThresholdSpot > 0 && config.volatilityModule.highVolumeThresholdSpot < minAvg;
    if (alphaInvalid || spotInvalid) {
      validationError = '大额阈值不能小于 avg. 3m 过滤值，波动侦测已关闭';
      config.volatilityModule.enabled = false;
      config.volatilityModule.highVolumeEnabled = false;
    }

    await this.configManager.save();

    if (validationError) {
      return { success: false, error: validationError };
    }

    console.log(`[WebServer] 波动侦测已开启：scope=${config.volatilityModule.scope}, window=${config.volatilityModule.windowMinutes}min, threshold=${config.volatilityModule.thresholdPercent}%`);

    // 构建并发送 TG 通知
    const scope = config.volatilityModule.scope || 'global';
    const windowMinutes = config.volatilityModule.windowMinutes || 5;
    const thresholdPercent = config.volatilityModule.thresholdPercent || 20;
    const silenceMinutes = config.settings?.alertSilenceMinutes || 5;
    const minAvgQuoteVolume3m = config.volatilityModule.minAvgQuoteVolume3m || 100;
    const highVolumeEnabled = config.volatilityModule.highVolumeEnabled === true;
    const highVolumeThresholdAlpha = config.volatilityModule.highVolumeThresholdAlpha || 500;
    const highVolumeThresholdSpot = config.volatilityModule.highVolumeThresholdSpot || 5000;
    
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
窗口：${windowMinutes}min | 阈值：${thresholdPercent}% | 静默期：${silenceMinutes}分钟 | avg. 3m：${minAvgQuoteVolume3m}U
是否开启大额交易提醒：${highVolumeEnabled ? `是` : '否'}
大额阈值（Alpha）：≥ ${highVolumeThresholdAlpha}U | 大额阈值（现货）：≥ ${highVolumeThresholdSpot}U`;
    
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
   * PUT /api/volatility/toggle - 切换波动侦测开关
   * 关闭时保留 config 参数，便于下次直接恢复
   */
  async _toggleVolatility(data) {
    const config = this.configManager?.config;
    if (!config) {
      return { success: false, error: '配置未加载' };
    }

    const enabled = data?.enabled !== undefined ? data.enabled : false;

    if (!config.volatilityModule) {
      config.volatilityModule = {};
    }

    config.volatilityModule.enabled = enabled;

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
   * POST /api/auth/change-password - 修改密码
   */
  async _changePassword(data) {
    if (!data || !data.newPassword || data.newPassword.length < 6) {
      return { success: false, error: '密码长度不能少于 6 位' };
    }

    try {
      this.apiToken = data.newPassword;

      this.configManager.config.apiToken = data.newPassword;
      await this.configManager.save();

      console.log('[WebServer] 登录密码已更新');
      return { success: true, message: '密码已更新，下次登录时生效' };
    } catch (err) {
      console.error('[WebServer] 更新密码失败:', err.message);
      return { success: false, error: '密码更新失败: ' + err.message };
    }
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

    // 敏感数据只从 .env 读取
    // 非敏感数据从 config.json 读取
    const barkKey = process.env.BARK_KEY || '';
    const barkSoundNormal = process.env.BARK_SOUND_NORMAL || config.bark?.soundNormal || 'minuet';
    const barkSoundCritical = process.env.BARK_SOUND_CRITICAL || config.bark?.soundCritical || 'alarm';
    const barkVolume = parseInt(process.env.BARK_VOLUME) || config.bark?.volume || 5;
    const tgBotToken = process.env.TG_BOT_TOKEN || '';
    const tgChatId = process.env.TG_CHAT_ID || '';
    
    return {
      success: true,
      data: {
        bark: {
          enabled: config.bark?.enabled || false,
          deviceKey: barkKey,  // 从 .env 读取
          serverUrl: config.bark?.serverUrl || 'https://api.day.app',
          soundNormal: barkSoundNormal,
          soundCritical: barkSoundCritical,
          volume: barkVolume,
          group: config.bark?.group || 'crypto_radar',
          monitorEnabled: config.bark?.monitorEnabled !== false,
          monitorMode: ['normal', 'critical'].includes(config.bark?.monitorMode) ? config.bark.monitorMode : 'normal',
          volatilityEnabled: config.bark?.volatilityEnabled === true,
          volatilityMode: ['normal', 'critical'].includes(config.bark?.volatilityMode) ? config.bark.volatilityMode : 'normal'
        },
        telegram: {
          enabled: config.telegram?.enabled || false,
          botToken: tgBotToken,  // 从 .env 读取
          chatId: tgChatId  // 从 .env 读取
        },
        settings: {
          checkIntervalMinutes: config.settings?.checkIntervalMinutes || 1,
          alertSilenceMinutes: config.settings?.alertSilenceMinutes || 5,
          maxPriceRecordsPerSymbol: config.settings?.maxPriceRecordsPerSymbol || 300,
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
      
      const config = this.configManager.config;

      // 准备 .env 文件更新（敏感数据）
      const envUpdates = {};
      
      // 只有当 data.bark 存在时才更新 bark
      if (data.bark !== undefined) {
        console.log('[WebServer] Updating bark config...');
        
        // 敏感字段更新到 .env
        if (data.bark.deviceKey !== undefined) {
          envUpdates.BARK_KEY = data.bark.deviceKey;
        }
        // 铃声和音量也支持从 .env 读取（可选）
        if (data.bark.soundNormal !== undefined) {
          envUpdates.BARK_SOUND_NORMAL = data.bark.soundNormal;
        }
        if (data.bark.soundCritical !== undefined) {
          envUpdates.BARK_SOUND_CRITICAL = data.bark.soundCritical;
        }
        if (data.bark.volume !== undefined) {
          envUpdates.BARK_VOLUME = data.bark.volume.toString();
        }
        
        // 非敏感字段保留在 config.json（不存储敏感数据）
        config.bark = {
          ...config.bark,
          enabled: data.bark?.enabled ?? false,
          serverUrl: data.bark?.serverUrl ?? 'https://api.day.app',
          soundNormal: data.bark?.soundNormal || 'minuet',
          soundCritical: data.bark?.soundCritical || 'alarm',
          volume: parseInt(data.bark?.volume) || 5,
          group: data.bark?.group ?? 'crypto_radar',
          monitorEnabled: data.bark?.monitorEnabled !== false,
          monitorMode: ['normal', 'critical'].includes(data.bark?.monitorMode) ? data.bark.monitorMode : (config.bark?.monitorMode || 'normal'),
          volatilityEnabled: data.bark?.volatilityEnabled === true,
          volatilityMode: ['normal', 'critical'].includes(data.bark?.volatilityMode) ? data.bark.volatilityMode : (config.bark?.volatilityMode || 'normal')
          // 不存储 deviceKey（敏感数据只在 .env）
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
        
        // 非敏感字段保留在 config.json（不存储敏感数据）
        config.telegram = {
          ...config.telegram,
          enabled: data.telegram?.enabled ?? false
          // 不存储 botToken/chatId（敏感数据只在 .env）
        };
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
   * 切换大额强提醒开关
   */
  async _toggleBarkHighVolume() {
    try {
      const config = this.configManager.config;
      
      // 切换状态
      const currentEnabled = config.volatilityModule?.highVolumeEnabled === true;
      const newEnabled = !currentEnabled;
      
      config.volatilityModule = config.volatilityModule || {};
      config.volatilityModule.highVolumeEnabled = newEnabled;
      
      await this.configManager.save();
      
      return {
        success: true,
        message: `大额强提醒已${newEnabled ? '启用' : '禁用'}`,
        data: { highVolumeEnabled: newEnabled }
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

  /**
   * GET /api/config/export - 导出完整配置
   */
  async _exportConfig() {
    try {
      const config = this.configManager?.config;
      if (!config) {
        return { success: false, error: '配置未加载' };
      }

      const exportData = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        config: {
          settingsPage: {
            bark: {
              deviceKey: process.env.BARK_KEY || '',
              soundNormal: process.env.BARK_SOUND_NORMAL || config.bark?.soundNormal || 'minuet',
              soundCritical: process.env.BARK_SOUND_CRITICAL || config.bark?.soundCritical || 'alarm',
              volume: parseInt(process.env.BARK_VOLUME) || config.bark?.volume || 5
            },
            telegram: {
              enabled: config.telegram?.enabled || false,
              botToken: process.env.TG_BOT_TOKEN || '',
              chatId: process.env.TG_CHAT_ID || ''
            },
            cache: {
              alertSilenceMinutes: config.settings?.alertSilenceMinutes || 5,
              maxPriceRecordsPerSymbol: config.settings?.maxPriceRecordsPerSymbol || 720
            }
          },
          marketPage: {
            priceMonitor: {
              bark: {
                enabled: config.bark?.monitorEnabled !== false,
                mode: config.bark?.monitorMode || 'normal'
              },
              symbols: config.symbols || []
            },
            volatility: {
              bark: {
                enabled: config.bark?.volatilityEnabled === true,
                mode: config.bark?.volatilityMode || 'normal'
              },
              params: {
                enabled: config.volatilityModule?.enabled || false,
                scope: config.volatilityModule?.scope || 'global',
                windowMinutes: config.volatilityModule?.windowMinutes || 5,
                thresholdPercent: config.volatilityModule?.thresholdPercent || 20,
                minAvgQuoteVolume3m: config.volatilityModule?.minAvgQuoteVolume3m || 100
              }
            }
          }
        }
      };

      return exportData;
    } catch (err) {
      return { success: false, error: '导出失败: ' + err.message };
    }
  }

  /**
   * POST /api/config/import - 导入完整配置（完全覆盖）
   */
  async _importConfig(data) {
    try {
      if (!data || !data.config) {
        return { success: false, error: '无效的配置文件格式' };
      }

      if (!data.version) {
        return { success: false, error: '缺少版本号' };
      }

      const config = this.configManager?.config;
      if (!config) {
        return { success: false, error: '配置管理器未加载' };
      }

      const imported = data.config;
      const sp = imported.settingsPage || {};
      const mp = imported.marketPage || {};
      const pm = mp.priceMonitor || {};
      const vol = mp.volatility || {};

      // === settingsPage: 更新 config.json ===
      if (sp.telegram) {
        config.telegram = { enabled: sp.telegram.enabled || false };
      }
      if (sp.cache) {
        config.settings = {
          ...config.settings,
          alertSilenceMinutes: sp.cache.alertSilenceMinutes || 5,
          maxPriceRecordsPerSymbol: sp.cache.maxPriceRecordsPerSymbol || 720
        };
      }

      // === marketPage.priceMonitor: 更新 config.json ===
      if (pm.bark || pm.symbols) {
        config.bark = { ...config.bark };
      }
      if (pm.bark) {
        config.bark.monitorEnabled = pm.bark.enabled !== false;
        config.bark.monitorMode = pm.bark.mode || 'normal';
      }
      if (pm.symbols) {
        config.symbols = pm.symbols;
      }

      // === marketPage.volatility: 更新 config.json ===
      if (vol.bark || vol.params) {
        config.bark = { ...config.bark };
      }
      if (vol.bark) {
        config.bark.volatilityEnabled = vol.bark.enabled === true;
        config.bark.volatilityMode = vol.bark.mode || 'normal';
      }
      if (vol.params) {
        config.volatilityModule = {
          enabled: vol.params.enabled || false,
          scope: vol.params.scope || 'global',
          windowMinutes: vol.params.windowMinutes || 5,
          thresholdPercent: vol.params.thresholdPercent || 20,
          minAvgQuoteVolume3m: vol.params.minAvgQuoteVolume3m || 100
        };
      }

      // 保存 config.json
      await this.configManager.save();

      // === 更新 .env 敏感字段（settingsPage.bark + settingsPage.telegram）===
      const envUpdates = {};
      if (sp.bark?.deviceKey !== undefined) {
        envUpdates.BARK_KEY = sp.bark.deviceKey;
      }
      if (sp.bark?.soundNormal !== undefined) {
        envUpdates.BARK_SOUND_NORMAL = sp.bark.soundNormal;
      }
      if (sp.bark?.soundCritical !== undefined) {
        envUpdates.BARK_SOUND_CRITICAL = sp.bark.soundCritical;
      }
      if (sp.bark?.volume !== undefined) {
        envUpdates.BARK_VOLUME = sp.bark.volume.toString();
      }
      if (sp.telegram?.botToken !== undefined) {
        envUpdates.TG_BOT_TOKEN = sp.telegram.botToken;
      }
      if (sp.telegram?.chatId !== undefined) {
        envUpdates.TG_CHAT_ID = sp.telegram.chatId;
      }

      if (Object.keys(envUpdates).length > 0) {
        await this._saveEnvFile(envUpdates);
        require('dotenv').config({ override: true });
      }

      console.log('[WebServer] 配置已导入并覆盖');

      return {
        success: true,
        message: '配置已导入，系统将重启以生效'
      };
    } catch (err) {
      return { success: false, error: '导入失败: ' + err.message };
    }
  }
}

module.exports = WebServer;
