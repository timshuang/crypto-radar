/**
 * Crypto Radar - 前端 JavaScript
 * 轻量级，无框架依赖
 */

// API Token（从配置文件读取或默认）
const API_TOKEN = 'crypto_radar_token_2024';

// 自动补全相关变量
let autocompleteTimeout = null;
let autocompleteIndex = -1;
let autocompleteResults = [];

// 待删除的币种
let symbolToDelete = null;

// API 请求封装
async function api(endpoint, options = {}) {
  const url = `/api${endpoint}`;
  
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Token': API_TOKEN,
      ...options.headers
    }
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || '请求失败');
    }
    
    return data;
  } catch (err) {
    console.error(`API 错误 [${endpoint}]:`, err.message);
    throw err;
  }
}

// 格式化数字（保持完整精度，不截断小数）
function formatNumber(num, decimals = null) {
  if (num === null || num === undefined) return '-';
  
  // 如果未指定小数位数，保持原始精度
  if (decimals === null) {
    return Number(num).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 8  // 最多显示 8 位小数，适应加密货币精度
    });
  }
  
  return Number(num).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// 格式化时间
function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

// 格式化运行时间
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

// 格式化内存
function formatMemory(mb) {
  return `${mb} MB`;
}

// 页面切换
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });
  document.querySelectorAll('.nav-links a').forEach(link => {
    link.classList.remove('active');
  });
  
  document.getElementById(pageId).classList.add('active');
  
  // 更新导航激活状态
  const navMap = {
    'dashboard': 0,
    'monitor': 1,
    'alerts': 2,
    'settings': 3
  };
  
  const index = navMap[pageId];
  if (index !== undefined) {
    document.querySelectorAll('.nav-links a')[index]?.classList.add('active');
  }
  
  // 加载设置页面时，加载系统开关状态和通知配置
  if (pageId === 'settings') {
    loadSystemStatusFromSettings();
    loadNotificationConfig();
  }
}

// 加载仪表盘
async function loadDashboard() {
  try {
    const result = await api('/status');
    const data = result.data;
    
    // 更新状态
    document.getElementById('uptime').textContent = formatUptime(data.uptime);
    document.getElementById('memory').textContent = formatMemory(data.memory.heapUsed);
    document.getElementById('symbols-count').textContent = data.symbolsCount;
    document.getElementById('enabled-count').textContent = data.enabledCount;
    
    // 更新币种卡片
    const symbolCards = document.getElementById('symbol-cards');
    if (data.symbolPrices && data.symbolPrices.length > 0) {
      symbolCards.innerHTML = data.symbolPrices.map(s => `
        <div class="symbol-card">
          <div class="symbol-card-header">
            <span class="symbol-name">${s.symbol}</span>
            <span class="symbol-source">${s.source === 'alpha' ? 'Alpha' : '现货'}</span>
          </div>
          <div class="symbol-price">$${formatNumber(s.price)}</div>
          <div class="symbol-change ${s.change24h >= 0 ? 'positive' : 'negative'}">
            24h: ${s.change24h >= 0 ? '+' : ''}${formatNumber(s.change24h)}%
          </div>
        </div>
      `).join('');
    } else {
      symbolCards.innerHTML = '<div class="empty-state">暂无币种数据</div>';
    }
  } catch (err) {
    console.error('加载仪表盘失败:', err);
  }
}

// 加载币种监控列表（整合页面）
async function loadMonitor() {
  try {
    const symbolsResult = await api('/symbols');
    const targetsResult = await api('/targets');
    
    const symbols = symbolsResult.data || [];
    const targets = targetsResult.data || [];
    
    // 构建币种到目标的映射
    const symbolTargets = {};
    targets.forEach(t => {
      if (!symbolTargets[t.symbol]) {
        symbolTargets[t.symbol] = [];
      }
      symbolTargets[t.symbol].push(t);
    });
    
    const tbody = document.getElementById('monitor-table');
    if (symbols.length > 0) {
      tbody.innerHTML = symbols.map(s => {
        const symbolTargetList = symbolTargets[s.symbol] || [];
        const firstTarget = symbolTargetList[0];
        
        // 方向显示（上穿/下破）
        let directionDisplay = '-';
        let targetPriceDisplay = '-';
        if (firstTarget) {
          const directionText = firstTarget.type === 'above' ? '上穿 🟢' : '下破 🔴';
          const directionClass = firstTarget.type === 'above' ? 'up' : 'down';
          directionDisplay = `<span class="direction-badge ${directionClass}">${directionText}</span>`;
          targetPriceDisplay = `<span class="target-price-cell">$${formatNumber(firstTarget.price)}</span>`;
        }
        
        // 状态显示
        // 逻辑：
        // - status=triggered → 已触发 ✅（不管开关如何）
        // - status=waiting && enabled=false → 已暂停 ⏸️（手动关闭）
        // - status=waiting && enabled=true → 监控中 🔵
        let statusBadge = '';
        const hasTriggered = symbolTargetList.some(t => t.status === 'triggered');
        if (hasTriggered) {
          // 只要状态是 triggered，不管开关如何，都显示"已触发✅"
          statusBadge = '<span class="status-badge triggered">已触发 ✅</span>';
        } else if (!s.enabled) {
          // 状态是 waiting，但开关关闭 → 手动暂停
          statusBadge = '<span class="status-badge paused">已暂停 ⏸️</span>';
        } else {
          // enabled=true && status=waiting → 监控中
          statusBadge = '<span class="status-badge monitoring">监控中 🔵</span>';
        }
        
        // 类型标签
        const typeLabel = s.source === 'alpha' 
          ? '<span class="type-badge alpha">Alpha</span>'
          : '<span class="type-badge spot">现货</span>';
        
        return `
          <tr>
            <td><strong>${s.symbol}</strong></td>
            <td>${typeLabel}</td>
            <td class="price-cell">$${formatNumber(s.currentPrice)}</td>
            <td class="direction-cell">${directionDisplay}</td>
            <td>${targetPriceDisplay}</td>
            <td>${statusBadge}</td>
            <td>
              <label class="switch">
                <input type="checkbox" ${s.enabled ? 'checked' : ''} 
                  onchange="toggleSymbol('${s.symbol}', this.checked)">
                <span class="slider"></span>
              </label>
            </td>
            <td>
              <button class="btn btn-small btn-edit" onclick="openEditModal('${s.symbol}')">编辑</button>
            </td>
            <td>
              <button class="btn btn-small btn-danger" onclick="showDeleteConfirm('${s.symbol}')">删除</button>
            </td>
          </tr>
        `;
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">暂无币种</td></tr>';
    }
    
    // 更新报警过滤器的币种选择器
    updateSymbolSelect('alert-symbol-filter', symbols, true);
  } catch (err) {
    console.error('加载币种监控列表失败:', err);
  }
}

// 更新币种选择器
function updateSymbolSelect(selectId, symbols, includeAll = false) {
  const select = document.getElementById(selectId);
  if (!select) return;
  
  let options = includeAll ? '<option value="">全部币种</option>' : '';
  symbols.forEach(s => {
    const source = s.source || 'spot';
    const status = s.status || 'TRADING';
    const alphaId = s.alphaId || '';
    
    // Alpha 代币显示格式：UP (ALPHA_804)
    let displaySymbol = s.symbol;
    if (source === 'alpha' && alphaId && !s.symbol.includes(alphaId)) {
      displaySymbol = `${s.symbol} (${alphaId})`;
    }
    
    options += `<option value="${s.symbol}" data-source="${source}" data-alpha-id="${alphaId}">${displaySymbol} (${status})</option>`;
  });
  select.innerHTML = options;
}

// 切换币种状态
async function toggleSymbol(symbol, enabled) {
  try {
    await api(`/symbols/${symbol}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled })
    });
    loadMonitor();
    loadDashboard();
  } catch (err) {
    alert('操作失败：' + err.message);
  }
}

// 显示删除确认弹窗
function showDeleteConfirm(symbol) {
  symbolToDelete = symbol;
  document.getElementById('delete-confirm-text').textContent = `确定要删除币种 ${symbol} 吗？`;
  document.getElementById('delete-confirm-modal').classList.add('active');
}

// 关闭删除确认弹窗
function closeDeleteModal() {
  document.getElementById('delete-confirm-modal').classList.remove('active');
  symbolToDelete = null;
}

// 确认删除币种
async function confirmDeleteSymbol() {
  if (!symbolToDelete) return;
  
  try {
    await api(`/symbols/${symbolToDelete}`, { method: 'DELETE' });
    closeDeleteModal();
    loadMonitor();
    loadDashboard();
  } catch (err) {
    alert('删除失败：' + err.message);
  }
}

// ==================== 编辑币种功能 ====================

// 显示编辑弹窗内错误提示
function showEditError(message) {
  const errorDiv = document.getElementById('editSymbolError');
  const errorText = errorDiv?.querySelector('.error-text');
  if (errorDiv && errorText) {
    errorText.textContent = message;
    errorDiv.style.display = 'flex';
  }
}

// 隐藏编辑弹窗内错误提示
function hideEditError() {
  const errorDiv = document.getElementById('editSymbolError');
  if (errorDiv) {
    errorDiv.style.display = 'none';
  }
}

// 打开编辑弹窗
async function openEditModal(symbol) {
  try {
    console.log('[openEditModal] 开始加载 symbol:', symbol);
    
    // 获取币种配置（使用 api 函数，自动添加 Token）
    const data = await api(`/symbols?symbol=${encodeURIComponent(symbol)}`);
    console.log('[openEditModal] API 返回数据:', data);
    
    const config = data.data[0];
    console.log('[openEditModal] config:', config);
    
    if (!config) {
      showEditError('币种配置不存在');
      return;
    }
    
    // 填充表单
    document.getElementById('edit-symbol-name').value = config.symbol;
    const sourceValue = config.source === 'alpha' ? 'Alpha' : '现货';
    document.getElementById('edit-source').value = sourceValue;
    console.log('[openEditModal] 填充数据源:', sourceValue, '(config.source =', config.source + ')');
    
    // 填充目标
    const target = config.targets?.[0];
    console.log('[openEditModal] target:', target);
    
    if (target) {
      console.log('[openEditModal] 填充目标类型:', target.type, '价格:', target.price);
      
      const targetRadio = document.querySelector(`input[name="edit-targetType"][value="${target.type}"]`);
      console.log('[openEditModal] 找到的单选按钮:', targetRadio);
      
      if (targetRadio) {
        targetRadio.checked = true;
        console.log('[openEditModal] 单选按钮已选中，checked =', targetRadio.checked);
      } else {
        console.error('[openEditModal] 未找到对应的单选按钮，value =', target.type);
      }
      
      document.getElementById('edit-targetPrice').value = target.price;
      console.log('[openEditModal] 填充目标价格:', target.price);
    } else {
      console.warn('[openEditModal] 没有找到目标配置，targets =', config.targets);
    }
    
    // 隐藏错误提示
    hideEditError();
    
    // 显示弹窗
    document.getElementById('edit-symbol-modal').classList.add('active');
    console.log('[openEditModal] 弹窗已显示');
  } catch (err) {
    console.error('[openEditModal] 错误:', err);
    showEditError('加载配置失败：' + err.message);
  }
}

// 保存修改
async function updateSymbol() {
  const symbol = document.getElementById('edit-symbol-name').value;
  const targetType = document.querySelector('input[name="edit-targetType"]:checked')?.value;
  const targetPrice = document.getElementById('edit-targetPrice').value.trim();
  
  // 验证
  if (!targetType) {
    showEditError('请选择目标类型（上穿或下破）');
    return;
  }
  
  if (!targetPrice || isNaN(targetPrice) || parseFloat(targetPrice) <= 0) {
    showEditError('请填写有效的目标价格');
    return;
  }
  
  try {
    // 保存
    const response = await fetch('/api/targets', {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'X-API-Token': API_TOKEN
      },
      body: JSON.stringify({
        symbol,
        type: targetType,
        price: parseFloat(targetPrice)
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      closeModal('edit-symbol-modal');
      loadMonitor();
      showToast('修改已保存', 'success');
    } else {
      showEditError('保存失败：' + (result.error || '未知错误'));
    }
  } catch (err) {
    console.error('保存修改失败:', err);
    showEditError('保存失败：' + err.message);
  }
}

// 显示添加币种模态框
function showAddSymbolModal() {
  const modal = document.getElementById('add-symbol-modal');
  
  // 防御性检查：确保模态框存在
  if (!modal) {
    console.error('错误：模态框元素 #add-symbol-modal 不存在！');
    alert('系统错误：弹窗组件未找到，请刷新页面重试');
    return;
  }
  
  const searchInput = document.getElementById('addSymbolSearch');
  
  // 重置表单
  const form = document.getElementById('add-symbol-form');
  if (form) form.reset();
  
  const hiddenInput = document.getElementById('new-symbol');
  if (hiddenInput) hiddenInput.value = '';
  
  const resultsDiv = document.getElementById('addSymbolResults');
  if (resultsDiv) resultsDiv.innerHTML = '';
  
  // 重置单选按钮为上穿（默认值）
  const defaultRadio = document.querySelector('input[name="targetType"][value="above"]');
  if (defaultRadio) defaultRadio.checked = true;
  
  const targetPriceInput = document.getElementById('targetPrice');
  if (targetPriceInput) targetPriceInput.value = '';
  
  // 隐藏错误提示
  hideAddSymbolError();
  
  // 显示弹窗
  modal.classList.add('active');
  
  // 聚焦搜索框
  if (searchInput) {
    setTimeout(() => searchInput.focus(), 100);
  }
}

// 显示弹窗内错误提示
function showAddSymbolError(message) {
  const errorDiv = document.getElementById('addSymbolError');
  const errorText = errorDiv?.querySelector('.error-text');
  if (errorDiv && errorText) {
    errorText.textContent = message;
    errorDiv.style.display = 'flex';
  }
}

// 隐藏弹窗内错误提示
function hideAddSymbolError() {
  const errorDiv = document.getElementById('addSymbolError');
  if (errorDiv) {
    errorDiv.style.display = 'none';
  }
}

// 数据源变化时清空搜索
function onSourceChange() {
  document.getElementById('addSymbolSearch').value = '';
  document.getElementById('addSymbolResults').innerHTML = '';
}

// 添加币种
document.getElementById('add-symbol-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // 隐藏之前的错误
  hideAddSymbolError();
  
  const symbolInput = document.getElementById('new-symbol');
  const symbol = symbolInput.value.trim();
  const source = document.getElementById('addSymbolSource').value;
  const enabled = document.getElementById('new-symbol-enabled').checked;
  // 获取 alphaId（如果是 Alpha 代币）
  const alphaId = symbolInput.dataset.alphaId || null;
  // 从单选按钮获取目标类型
  const targetTypeRadio = document.querySelector('input[name="targetType"]:checked');
  const targetType = targetTypeRadio ? targetTypeRadio.value : '';
  const targetPriceValue = document.getElementById('targetPrice').value.trim();
  const targetPrice = targetPriceValue ? parseFloat(targetPriceValue) : null;
  
  // 构建提交给后端的符号（Alpha 代币需要带 alphaId 格式）
  const submitSymbol = (source === 'alpha' && alphaId) ? `${symbol} (${alphaId})` : symbol;
  
  // 调试日志
  console.log('[添加币种] 表单数据:', { 
    symbol, 
    alphaId,
    submitSymbol,
    source, 
    enabled, 
    targetType, 
    targetPriceValue, 
    targetPrice,
    hasTarget: !!(targetType && targetPrice !== null && !isNaN(targetPrice))
  });
  
  if (!symbol) {
    showAddSymbolError('请先搜索并选择币种');
    return;
  }
  
  // 验证目标类型是否选择
  if (!targetType) {
    showAddSymbolError('请选择目标类型（上穿或下破）');
    return;
  }
  
  // 验证目标价格是否填写
  if (!targetPriceValue || isNaN(targetPrice) || parseFloat(targetPrice) <= 0) {
    showAddSymbolError('请填写有效的目标价格');
    return;
  }
  
  // 验证目标数据
  const hasValidTarget = targetType && targetPrice !== null && !isNaN(targetPrice) && targetPrice > 0;
  console.log('[添加币种] 目标数据验证:', { 
    hasTargetType: !!targetType, 
    targetType, 
    hasTargetPrice: targetPrice !== null && !isNaN(targetPrice),
    targetPriceValue,
    targetPrice,
    targetPricePositive: targetPrice > 0,
    hasValidTarget
  });
  
  try {
    // 先添加币种（使用完整格式，让后端解析）
    console.log('[添加币种] 调用 /api/symbols...', { submitSymbol, source, enabled, alphaId });
    const symbolResult = await api('/symbols', {
      method: 'POST',
      body: JSON.stringify({ symbol: submitSymbol, source, enabled })
    });
    console.log('[添加币种] 币种添加结果:', symbolResult);
    
    if (!symbolResult.success) {
      throw new Error(symbolResult.error || '添加币种失败');
    }
    
    // 如果有价格目标，添加目标（使用纯符号名，和后端存储的一致）
    if (hasValidTarget) {
      // 后端存储的是纯符号名（如 "CYS"），所以这里也要用纯符号名
      const targetSymbol = symbol;  // 使用解析后的纯符号名
      console.log('[添加币种] 调用 /api/targets...', { symbol: targetSymbol, type: targetType, price: targetPrice });
      const targetResult = await api('/targets', {
        method: 'POST',
        body: JSON.stringify({ symbol: targetSymbol, type: targetType, price: targetPrice })
      });
      console.log('[添加币种] 目标添加结果:', targetResult);
      if (!targetResult.success) {
        console.error('[添加币种] 目标添加失败:', targetResult.error);
        // 不抛出错误，因为币种已经添加成功
      }
    } else {
      console.log('[添加币种] 跳过目标添加', { 
        reason: !targetType ? '无目标类型' : !hasValidTarget ? '目标价格无效' : '未知'
      });
    }
    
    closeModal('add-symbol-modal');
    document.getElementById('add-symbol-form').reset();
    document.getElementById('addSymbolResults').innerHTML = '';
    // 重置单选按钮为默认值（上穿）
    const defaultRadio = document.querySelector('input[name="targetType"][value="above"]');
    if (defaultRadio) defaultRadio.checked = true;
    loadMonitor();
    loadDashboard();
  } catch (err) {
    showAddSymbolError('添加失败：' + err.message);
  }
});

// 加载报警历史
async function loadAlerts() {
  const symbolFilter = document.getElementById('alert-symbol-filter').value;
  
  try {
    // 获取报警历史记录
    const result = await api('/alerts/history');
    let alerts = result.data || [];
    
    // 应用筛选
    if (symbolFilter) {
      alerts = alerts.filter(a => a.symbol && a.symbol.toUpperCase().includes(symbolFilter.toUpperCase()));
    }
    
    const tbody = document.getElementById('alerts-table');
    if (alerts.length > 0) {
      tbody.innerHTML = alerts.map(a => {
        const direction = a.type === 'above' ? '上破 🟢' : '下破 🔴';
        return `
          <tr>
            <td>🎯 价格报警</td>
            <td>${a.symbol || '-'}</td>
            <td>
              ${direction} $${formatNumber(a.targetPrice)}
              <div style="font-size: 0.85em; opacity: 0.8; margin-top: 4px;">
                触发价：$${formatNumber(a.currentPrice)}
              </div>
            </td>
            <td>${formatTime(a.triggeredAt)}</td>
            <td>
              <span class="status-badge ${a.read ? 'paused' : 'monitoring'}">
                ${a.read ? '已读' : '未读'}
              </span>
            </td>
          </tr>
        `;
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">暂无报警记录</td></tr>';
    }
  } catch (err) {
    console.error('加载报警历史失败:', err);
  }
}

// 加载设置
async function loadSettings() {
  try {
    const result = await api('/settings');
    const data = result.data || {};
    
    // Bark 配置
    if (data.bark) {
      document.getElementById('bark-device-key').value = data.bark.deviceKey || '';
      document.getElementById('bark-server-url').value = data.bark.serverUrl || 'https://api.day.app';
      document.getElementById('bark-sound').value = data.bark.sound || 'minuet';
      document.getElementById('bark-group').value = data.bark.group || 'crypto_radar';
    }
    
    // 系统设置
    if (data.settings) {
      document.getElementById('check-interval').value = data.settings.checkIntervalMinutes || 1;
      document.getElementById('silence-interval').value = data.settings.alertSilenceMinutes || 5;
      document.getElementById('max-records').value = data.settings.maxPriceRecordsPerSymbol || 1440;
      document.getElementById('max-symbols').value = data.settings.maxSymbols || 20;
    }
  } catch (err) {
    console.error('加载设置失败:', err);
  }
}

// 保存 Bark 配置
document.getElementById('bark-notification-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const bark = {
    deviceKey: document.getElementById('bark-device-key').value.trim(),
    serverUrl: document.getElementById('bark-server-url').value.trim(),
    sound: document.getElementById('bark-sound').value.trim(),
    group: document.getElementById('bark-group').value.trim()
  };
  
  try {
    await api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ bark })
    });
    alert('Bark 配置已保存');
  } catch (err) {
    alert('保存失败：' + err.message);
  }
});

// 保存系统设置
document.getElementById('system-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const settings = {
    checkIntervalMinutes: parseInt(document.getElementById('check-interval').value),
    alertSilenceMinutes: parseInt(document.getElementById('silence-interval').value),
    maxPriceRecordsPerSymbol: parseInt(document.getElementById('max-records').value),
    maxSymbols: parseInt(document.getElementById('max-symbols').value)
  };
  
  try {
    await api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings })
    });
    alert('系统设置已保存');
  } catch (err) {
    alert('保存失败：' + err.message);
  }
});

// ==================== 系统开关功能 ====================

// 初始化系统开关（仪表盘）
function initSystemToggle() {
  const toggle = document.getElementById('systemToggle');
  
  if (toggle) {
    // 加载当前状态
    loadSystemStatus();
    
    // 监听开关变化
    toggle.addEventListener('change', async (e) => {
      if (!e.target.checked) {
        // 关闭时显示确认弹窗
        showStopConfirmModal();
      } else {
        // 开启时直接调用 API
        await toggleSystem(true);
      }
    });
  }
}

// 初始化设置页面的系统开关
function initSettingsSystemToggle() {
  const toggle = document.getElementById('settings-system-toggle');
  
  if (toggle) {
    // 加载当前状态
    loadSystemStatusFromSettings();
    
    // 监听开关变化
    toggle.addEventListener('change', async (e) => {
      if (!e.target.checked) {
        // 关闭时显示确认弹窗
        showStopConfirmModal();
      } else {
        // 开启时直接调用 API
        await toggleSystemFromSettings(true);
      }
    });
  }
}

// 从设置页面切换系统状态
async function toggleSystemFromSettings(enabled) {
  try {
    const response = await fetch('/api/system/toggle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': API_TOKEN
      },
      body: JSON.stringify({ enabled })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 更新状态显示
      const statusEl = document.getElementById('settings-toggle-status');
      if (statusEl) {
        statusEl.textContent = enabled ? '系统运行中' : '系统已停止';
      }
      
      // 提示用户
      showToast(enabled ? '系统已启动' : '系统已停止监控');
    }
  } catch (error) {
    console.error('切换系统失败:', error);
    showToast('操作失败，请重试');
    // 恢复开关状态
    document.getElementById('settings-system-toggle').checked = !enabled;
  }
}

// 加载系统状态（设置页面）
async function loadSystemStatusFromSettings() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    
    const toggle = document.getElementById('settings-system-toggle');
    const status = document.getElementById('settings-toggle-status');
    
    if (toggle && status) {
      const isEnabled = data.data?.systemEnabled !== false && data.data?.running !== false;
      toggle.checked = isEnabled;
      status.textContent = isEnabled ? '系统运行中' : '系统已停止';
    }
  } catch (error) {
    console.error('加载系统状态失败:', error);
  }
}

// 显示确认弹窗
function showStopConfirmModal() {
  document.getElementById('stopConfirmModal').classList.add('active');
}

// 关闭确认弹窗
function closeStopModal(restore = true) {
  document.getElementById('stopConfirmModal').classList.remove('active');
  if (restore) {
    // 只有取消时才恢复开关状态（两个页面都要恢复）
    const dashboardToggle = document.getElementById('systemToggle');
    const settingsToggle = document.getElementById('settings-system-toggle');
    if (dashboardToggle) dashboardToggle.checked = true;
    if (settingsToggle) settingsToggle.checked = true;
  }
}

// 确认关闭
async function confirmStopSystem() {
  await toggleSystem(false);
  closeStopModal(false); // 不恢复状态
  
  // 同步设置页面的开关状态
  const settingsToggle = document.getElementById('settings-system-toggle');
  if (settingsToggle) {
    settingsToggle.checked = false;
  }
  const settingsStatus = document.getElementById('settings-toggle-status');
  if (settingsStatus) {
    settingsStatus.textContent = '系统已停止';
  }
}

// 切换系统状态
async function toggleSystem(enabled) {
  try {
    const response = await fetch('/api/system/toggle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Token': API_TOKEN
      },
      body: JSON.stringify({ enabled })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 更新状态显示（仪表盘）
      const dashboardStatusEl = document.getElementById('toggleStatus');
      if (dashboardStatusEl) {
        dashboardStatusEl.textContent = enabled ? '系统运行中' : '系统已停止';
      }
      
      // 更新状态显示（设置页面）
      const settingsStatusEl = document.getElementById('settings-toggle-status');
      if (settingsStatusEl) {
        settingsStatusEl.textContent = enabled ? '系统运行中' : '系统已停止';
      }
      
      // 提示用户
      showToast(enabled ? '系统已启动' : '系统已停止监控');
    }
  } catch (error) {
    console.error('切换系统失败:', error);
    showToast('操作失败，请重试');
    // 恢复开关状态
    const dashboardToggle = document.getElementById('systemToggle');
    const settingsToggle = document.getElementById('settings-system-toggle');
    if (dashboardToggle) dashboardToggle.checked = !enabled;
    if (settingsToggle) settingsToggle.checked = !enabled;
  }
}

// 加载系统状态（仪表盘）
async function loadSystemStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    
    const toggle = document.getElementById('systemToggle');
    const status = document.getElementById('toggleStatus');
    
    if (toggle && status) {
      const isEnabled = data.data?.systemEnabled !== false && data.data?.running !== false;
      toggle.checked = isEnabled;
      status.textContent = isEnabled ? '系统运行中' : '系统已停止';
    }
    
    // 同步设置页面的开关状态
    const settingsToggle = document.getElementById('settings-system-toggle');
    const settingsStatus = document.getElementById('settings-toggle-status');
    if (settingsToggle && settingsStatus) {
      settingsToggle.checked = isEnabled;
      settingsStatus.textContent = isEnabled ? '系统运行中' : '系统已停止';
    }
  } catch (error) {
    console.error('加载系统状态失败:', error);
  }
}

// 显示提示消息
function showToast(message, type = 'info') {
  // 创建 toast 元素
  const toast = document.createElement('div');
  toast.className = 'toast-message' + (type === 'error' ? ' error' : '');
  toast.textContent = message;
  
  const bgColor = type === 'error' ? 'rgba(220, 53, 69, 0.9)' : 'rgba(0, 217, 255, 0.9)';
  const textColor = type === 'error' ? 'white' : '#1a1a2e';
  
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bgColor};
    color: ${textColor};
    padding: 12px 24px;
    border-radius: 8px;
    font-weight: 600;
    z-index: 2000;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(toast);
  
  // 3 秒后移除
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 关闭模态框
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  } else {
    console.error('警告：模态框 #' + modalId + ' 不存在');
  }
}

// 点击模态框外部关闭
window.onclick = (event) => {
  if (event.target.classList.contains('modal')) {
    event.target.classList.remove('active');
  }
};

// 页面导航
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const pageId = link.dataset.page;
    if (pageId) {
      showPage(pageId);
      
      // 加载对应页面数据
      const loaders = {
        'dashboard': loadDashboard,
        'monitor': loadMonitor,
        'alerts': loadAlerts,
        'settings': loadSettings
      };
      if (loaders[pageId]) {
        loaders[pageId]();
      }
    }
  });
});

// ==================== 波动侦测功能 ====================

// 初始化波动设置（只绑定事件，不设置默认值）
function initVolatilitySettings() {
  const windowSelect = document.getElementById('volatilityWindow');
  const windowInput = document.getElementById('volatilityWindowCustom');
  const thresholdSelect = document.getElementById('volatilityThreshold');
  const thresholdInput = document.getElementById('volatilityThresholdCustom');
  
  // 监听下拉框变化
  windowSelect.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      windowInput.disabled = false;
      windowInput.value = '';
      windowInput.focus();
    } else {
      windowInput.disabled = true;
      windowInput.value = e.target.value;
      // 调用 API 设置
      setVolatilityWindow(parseInt(e.target.value));
    }
  });
  
  thresholdSelect.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      thresholdInput.disabled = false;
      thresholdInput.value = '';
      thresholdInput.focus();
    } else {
      thresholdInput.disabled = true;
      thresholdInput.value = e.target.value;
      // 调用 API 设置
      setVolatilityThreshold(parseInt(e.target.value));
    }
  });
}

// 更新波动侦测范围
async function updateVolatilityScope() {
  const scope = document.querySelector('input[name="volatilityScope"]:checked').value;
  try {
    await api('/volatility/scope', {
      method: 'PUT',
      body: JSON.stringify({ scope })
    });
    showToast(`监控范围已更新：${scope === 'global' ? '全局监控' : '仅已添加币种'}`);
  } catch (err) {
    console.error('更新波动范围失败:', err);
  }
}

// 设置波动时间窗口
async function setVolatilityWindow(minutes) {
  try {
    await api('/volatility/settings', {
      method: 'PUT',
      body: JSON.stringify({ windowMinutes: minutes })
    });
    showToast(`时间窗口已设置为 ${minutes} 分钟`);
  } catch (err) {
    console.error('设置时间窗口失败:', err);
  }
}

// 设置自定义时间窗口（输入框变化时调用）
async function setVolatilityWindowCustom() {
  const value = parseInt(document.getElementById('volatilityWindowCustom').value);
  if (!value || value < 1) return;
  
  try {
    await api('/volatility/settings', {
      method: 'PUT',
      body: JSON.stringify({ windowMinutes: value })
    });
    showToast(`时间窗口已设置为 ${value} 分钟`);
  } catch (err) {
    console.error('设置自定义时间窗口失败:', err);
  }
}

// 设置波动阈值
async function setVolatilityThreshold(percent) {
  try {
    await api('/volatility/settings', {
      method: 'PUT',
      body: JSON.stringify({ thresholdPercent: percent })
    });
    showToast(`涨跌幅阈值已设置为 ${percent}%`);
  } catch (err) {
    console.error('设置阈值失败:', err);
  }
}

// 设置自定义阈值（输入框变化时调用）
async function setVolatilityThresholdCustom() {
  const value = parseFloat(document.getElementById('volatilityThresholdCustom').value);
  if (!value || value < 1) return;
  
  try {
    await api('/volatility/settings', {
      method: 'PUT',
      body: JSON.stringify({ thresholdPercent: value })
    });
    showToast(`涨跌幅阈值已设置为 ${value}%`);
  } catch (err) {
    console.error('设置自定义阈值失败:', err);
  }
}

// 切换波动侦测
async function toggleVolatility(enabled) {
  try {
    await api('/volatility/toggle', {
      method: 'POST',
      body: JSON.stringify({ enabled })
    });
    document.getElementById('volatilityStatus').textContent = enabled ? '启用' : '禁用';
    showToast(`波动侦测已${enabled ? '启用' : '禁用'}`);
  } catch (err) {
    console.error('切换波动侦测失败:', err);
  }
}

// 加载波动侦测设置
async function loadVolatilitySettings() {
  try {
    const result = await api('/volatility/settings');
    const settings = result.data || {};
    
    // 设置范围
    const scope = settings.scope || 'global';
    const scopeRadio = document.querySelector(`input[name="volatilityScope"][value="${scope}"]`);
    if (scopeRadio) {
      scopeRadio.checked = true;
    }
    
    // 设置时间窗口（强制默认值 5 分钟）
    const windowSelect = document.getElementById('volatilityWindow');
    const windowCustomInput = document.getElementById('volatilityWindowCustom');
    const windowValue = settings.windowMinutes !== undefined ? settings.windowMinutes : 5;
    const presetValues = ['3', '5'];
    if (presetValues.includes(String(windowValue))) {
      windowSelect.value = String(windowValue);
      windowCustomInput.value = windowValue;
      windowCustomInput.disabled = true;
    } else {
      windowSelect.value = 'custom';
      windowCustomInput.value = windowValue;
      windowCustomInput.disabled = false;
    }
    
    // 设置阈值（强制默认值 20%）
    const thresholdSelect = document.getElementById('volatilityThreshold');
    const thresholdCustomInput = document.getElementById('volatilityThresholdCustom');
    const thresholdValue = settings.thresholdPercent !== undefined ? settings.thresholdPercent : 20;
    const thresholdPresetValues = ['10', '20', '30'];
    if (thresholdPresetValues.includes(String(thresholdValue))) {
      thresholdSelect.value = String(thresholdValue);
      thresholdCustomInput.value = thresholdValue;
      thresholdCustomInput.disabled = true;
    } else {
      thresholdSelect.value = 'custom';
      thresholdCustomInput.value = thresholdValue;
      thresholdCustomInput.disabled = false;
    }
    
    // 设置开关状态
    const toggle = document.getElementById('volatilityToggle');
    const statusText = document.getElementById('volatilityStatus');
    if (toggle && statusText) {
      toggle.checked = settings.enabled !== false;
      statusText.textContent = settings.enabled !== false ? '启用' : '禁用';
    }
  } catch (err) {
    console.error('加载波动设置失败:', err);
  }
}

// ==================== 自动补全功能 ====================

// 初始化自动补全
function initAutocomplete() {
  const input = document.getElementById('new-symbol');
  if (!input) return;
  
  // 输入事件
  input.addEventListener('input', (e) => {
    const value = e.target.value.trim();
    
    // 清除之前的定时器
    if (autocompleteTimeout) {
      clearTimeout(autocompleteTimeout);
    }
    
    // 延迟 300ms 再搜索，避免频繁请求
    autocompleteTimeout = setTimeout(() => {
      if (value.length >= 1) {
        searchSymbols(value);
      } else {
        hideAutocomplete();
      }
    }, 300);
  });
  
  // 键盘事件
  input.addEventListener('keydown', (e) => {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (!dropdown || !dropdown.classList.contains('active')) return;
    
    const items = dropdown.querySelectorAll('.autocomplete-item');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
      updateAutocompleteSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
      updateAutocompleteSelection(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (autocompleteIndex >= 0 && items[autocompleteIndex]) {
        selectSymbol(items[autocompleteIndex].textContent);
      }
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    }
  });
  
  // 点击外部隐藏
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-container')) {
      hideAutocomplete();
    }
  });
}

// 搜索币种
async function searchSymbols(query) {
  try {
    const result = await api(`/symbols/search?q=${encodeURIComponent(query)}`);
    autocompleteResults = result.data || [];
    showAutocomplete(autocompleteResults);
  } catch (err) {
    console.error('搜索失败:', err);
  }
}

// 显示自动补全下拉
function showAutocomplete(results) {
  const input = document.getElementById('new-symbol');
  let dropdown = document.getElementById('autocomplete-dropdown');
  
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'autocomplete-dropdown';
    dropdown.className = 'autocomplete-dropdown';
    input.parentNode.appendChild(dropdown);
  }
  
  if (results.length === 0) {
    hideAutocomplete();
    return;
  }
  
  dropdown.innerHTML = results.map(symbol => {
    // 解析 Alpha 代币格式：SYMBOL (ALPHA_xxx) (STATUS)
    const alphaMatch = symbol.match(/^(.+)\s+\((ALPHA_\d+)\)\s+\((TRADING|BREAK)\)$/i);
    const normalMatch = symbol.match(/^(.+)\s+\((TRADING|BREAK)\)$/i);
    
    let displayName, status;
    if (alphaMatch) {
      displayName = `${alphaMatch[1]} (${alphaMatch[2]})`;
      status = alphaMatch[3].toUpperCase();
    } else if (normalMatch) {
      displayName = normalMatch[1];
      status = normalMatch[2].toUpperCase();
    } else {
      displayName = symbol;
      status = 'TRADING';
    }
    
    return `
      <div class="autocomplete-item" data-symbol="${symbol}">
        <span class="autocomplete-symbol">${displayName}</span>
        <span class="autocomplete-status status-${status.toLowerCase()}">${status}</span>
      </div>
    `;
  }).join('');
  
  // 添加点击事件
  dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('click', () => {
      selectSymbol(item.dataset.symbol);
    });
  });
  
  dropdown.classList.add('active');
  autocompleteIndex = -1;
}

// 隐藏自动补全
function hideAutocomplete() {
  const dropdown = document.getElementById('autocomplete-dropdown');
  if (dropdown) {
    dropdown.classList.remove('active');
  }
  autocompleteIndex = -1;
  autocompleteResults = [];
}

// 更新选中状态
function updateAutocompleteSelection(items) {
  items.forEach((item, index) => {
    if (index === autocompleteIndex) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// 选择币种
function selectSymbol(symbol) {
  const input = document.getElementById('new-symbol');
  const sourceSelect = document.getElementById('new-symbol-source');
  
  // 解析 Alpha 代币格式：SYMBOL (ALPHA_xxx) (STATUS)
  const alphaMatch = symbol.match(/^(.+)\s+\((ALPHA_\d+)\)\s+\((TRADING|BREAK)\)$/i);
  if (alphaMatch) {
    input.value = `${alphaMatch[1]} (${alphaMatch[2]})`;
    if (sourceSelect) {
      sourceSelect.value = 'alpha';
    }
  } else {
    // 解析状态并自动设置来源
    const match = symbol.match(/^(.+)\s+\((TRADING|BREAK)\)$/i);
    if (match) {
      input.value = match[1];
      if (sourceSelect) {
        // TRADING/BREAK 状态都使用 'new' 来源
        sourceSelect.value = 'new';
      }
    } else {
      input.value = symbol;
    }
  }
  
  hideAutocomplete();
  input.focus();
}

// ==================== 弹窗内搜索功能 ====================

// 初始化弹窗内搜索
function initAddSymbolSearch() {
  const searchInput = document.getElementById('addSymbolSearch');
  const sourceSelect = document.getElementById('addSymbolSource');
  
  if (!searchInput || !sourceSelect) return;
  
  // 搜索输入事件
  searchInput.addEventListener('input', (e) => {
    const value = e.target.value.trim();
    
    // 清除之前的定时器
    if (autocompleteTimeout) {
      clearTimeout(autocompleteTimeout);
    }
    
    // 延迟 300ms 再搜索
    autocompleteTimeout = setTimeout(() => {
      if (value.length >= 1) {
        searchAddSymbol(value);
      } else {
        hideAddSymbolResults();
      }
    }, 300);
  });
  
  // 键盘事件
  searchInput.addEventListener('keydown', (e) => {
    const resultsDiv = document.getElementById('addSymbolResults');
    if (!resultsDiv || !resultsDiv.classList.contains('active')) return;
    
    const items = resultsDiv.querySelectorAll('.autocomplete-item');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
      updateAddSymbolSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteIndex = Math.max(autocompleteIndex - 1, 0);
      updateAddSymbolSelection(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (autocompleteIndex >= 0 && items[autocompleteIndex]) {
        selectAddSymbol(items[autocompleteIndex].dataset.symbol);
      }
    } else if (e.key === 'Escape') {
      hideAddSymbolResults();
    }
  });
  
  // 数据源变化时，清空搜索框
  sourceSelect.addEventListener('change', () => {
    searchInput.value = '';
    hideAddSymbolResults();
  });
  
  // 点击外部隐藏
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#add-symbol-modal')) {
      hideAddSymbolResults();
    }
  });
}

// 弹窗内的搜索，带数据源参数
async function searchAddSymbol(query) {
  const source = document.getElementById('addSymbolSource').value;
  try {
    const result = await api(`/symbols/search?q=${encodeURIComponent(query)}&source=${source}`);
    
    autocompleteResults = result.data || [];
    
    showAddSymbolResults(autocompleteResults, {});
  } catch (err) {
    console.error('搜索失败:', err);
    hideAddSymbolResults();
  }
}

// 显示弹窗内搜索结果（带价格）
function showAddSymbolResults(results, prices = {}) {
  const resultsDiv = document.getElementById('addSymbolResults');
  
  if (!resultsDiv) return;
  
  if (results.length === 0) {
    hideAddSymbolResults();
    return;
  }
  
  resultsDiv.innerHTML = results.map(item => {
    // 后端现在返回对象格式：{ symbol, source, price, status }
    let displayName, status, priceDisplay;
    
    if (typeof item === 'object') {
      // 对象格式
      const alphaMatch = item.symbol.match(/^(.+)\s+\((ALPHA_\d+)\)$/i);
      displayName = alphaMatch ? `${alphaMatch[1]} (${alphaMatch[2]})` : item.symbol;
      status = item.status || 'TRADING';
      priceDisplay = (typeof item.price === 'number' && item.price !== null) ? `$${formatNumber(item.price)}` : '暂无价格';
    } else {
      // 兼容旧格式：字符串 "SYMBOL (STATUS)"
      const alphaMatch = item.match(/^(.+)\s+\((ALPHA_\d+)\)\s+\((TRADING|BREAK)\)$/i);
      const normalMatch = item.match(/^(.+)\s+\((TRADING|BREAK)\)$/i);
      
      if (alphaMatch) {
        displayName = `${alphaMatch[1]} (${alphaMatch[2]})`;
        status = alphaMatch[3].toUpperCase();
      } else if (normalMatch) {
        displayName = normalMatch[1];
        status = normalMatch[2].toUpperCase();
      } else {
        displayName = item;
        status = 'TRADING';
      }
      priceDisplay = '暂无价格';
    }
    
    return `
      <div class="autocomplete-item" data-symbol="${item.symbol || item}" data-source="${item.source || 'spot'}">
        <span class="autocomplete-symbol">${displayName} (${item.source === 'alpha' ? 'Alpha' : '现货'})</span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="search-price">${priceDisplay}</span>
          <span class="autocomplete-status status-${status.toLowerCase()}">${status}</span>
        </div>
      </div>
    `;
  }).join('');
  
  // 添加点击事件
  resultsDiv.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('click', () => {
      selectAddSymbol(item.dataset.symbol);
    });
  });
  
  resultsDiv.classList.add('active');
  autocompleteIndex = -1;
}

// 隐藏弹窗内搜索结果
function hideAddSymbolResults() {
  const resultsDiv = document.getElementById('addSymbolResults');
  if (resultsDiv) {
    resultsDiv.classList.remove('active');
    resultsDiv.innerHTML = '';
  }
  autocompleteIndex = -1;
  autocompleteResults = [];
}

// 更新弹窗内选中状态
function updateAddSymbolSelection(items) {
  items.forEach((item, index) => {
    if (index === autocompleteIndex) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// 选择弹窗内搜索的币种
function selectAddSymbol(symbol) {
  const hiddenInput = document.getElementById('new-symbol');
  const sourceSelect = document.getElementById('addSymbolSource');
  const searchInput = document.getElementById('addSymbolSearch');
  
  // 解析 Alpha 代币格式：SYMBOL (ALPHA_xxx) (STATUS) 或 SYMBOL (ALPHA_xxx)
  const alphaMatch = symbol.match(/^(.+)\s+\((ALPHA_\d+)\)(?:\s+\((TRADING|BREAK)\))?$/i);
  if (alphaMatch) {
    // 存储纯符号名（用于 API 提交），同时存储 alphaId
    hiddenInput.value = alphaMatch[1];  // 只存 "CYS"，不存 "CYS (ALPHA_495)"
    sourceSelect.value = 'alpha';
    // 存储 alphaId 到 data 属性，供提交时使用
    hiddenInput.dataset.alphaId = alphaMatch[2];
  } else {
    // 解析状态并自动设置来源
    const match = symbol.match(/^(.+)\s+\((TRADING|BREAK)\)$/i);
    if (match) {
      hiddenInput.value = match[1];
      sourceSelect.value = 'spot';
      delete hiddenInput.dataset.alphaId;
    } else {
      hiddenInput.value = symbol;
      delete hiddenInput.dataset.alphaId;
    }
  }
  
  hideAddSymbolResults();
  if (searchInput) searchInput.focus();
}

// ==================== WebSocket 报警推送 ====================

// WebSocket 连接
let ws = null;

// 连接 WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('[WebSocket] 已连接');
  };
  
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      
      if (message.type === 'ALERT') {
        // 显示弹窗
        showPriceAlert(message.data);
        
        // 播放提示音
        playAlertSound();
      }
    } catch (err) {
      console.error('[WebSocket] 消息解析失败:', err);
    }
  };
  
  ws.onclose = () => {
    console.log('[WebSocket] 连接关闭，5 秒后重连...');
    setTimeout(connectWebSocket, 5000);
  };
  
  ws.onerror = (err) => {
    console.error('[WebSocket] 错误:', err);
  };
}

// 显示报警弹窗
function showPriceAlert(alert) {
  const direction = alert.type === 'above' ? '上破' : '下破';
  const emoji = alert.type === 'above' ? '🟢' : '🔴';
  
  // 使用浏览器通知 API（如果支持）
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(`价格报警 ${emoji}`, {
      body: `${alert.symbol} ${direction} $${formatNumber(alert.targetPrice)}（当前：$${formatNumber(alert.currentPrice)}）`,
      icon: '/logo.png'
    });
  }
  
  // 显示网页内弹窗
  const alertDiv = document.createElement('div');
  alertDiv.className = 'price-alert-toast';
  alertDiv.innerHTML = `
    <div class="alert-icon">${emoji}</div>
    <div class="alert-content">
      <div class="alert-title">价格报警</div>
      <div class="alert-message">
        ${alert.symbol} ${direction} $${formatNumber(alert.targetPrice)}<br>
        当前价格：$${formatNumber(alert.currentPrice)}
      </div>
    </div>
    <button class="alert-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  document.body.appendChild(alertDiv);
  
  // 5 秒后自动消失
  setTimeout(() => {
    if (alertDiv.parentElement) {
      alertDiv.remove();
    }
  }, 5000);
}

// 播放提示音
function playAlertSound() {
  // 创建简单的提示音（使用 Web Audio API，无需外部文件）
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800; // 800Hz
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (err) {
    console.log('提示音播放失败:', err);
  }
}

// 请求通知权限
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ==================== 通知设置 ====================

// 加载通知配置
async function loadNotificationConfig() {
  try {
    const response = await api('/notification/config');
    const config = response.data;
    
    // 填充 Bark 表单
    const barkEnabledEl = document.getElementById('bark-enabled');
    if (barkEnabledEl) {
      barkEnabledEl.checked = config.bark.enabled;
    }
    const barkKeyEl = document.getElementById('bark-key');
    if (barkKeyEl) {
      barkKeyEl.value = config.bark.deviceKey === '***' ? '' : config.bark.deviceKey;
    }
    const barkSoundEl = document.getElementById('bark-sound');
    if (barkSoundEl) {
      barkSoundEl.value = config.bark.sound;
    }
    const barkVolumeEl = document.getElementById('bark-volume');
    if (barkVolumeEl) {
      barkVolumeEl.value = config.bark.volume || 5;
    }
    
    // 填充 Telegram 表单
    const tgEnabledEl = document.getElementById('tg-enabled');
    if (tgEnabledEl) {
      tgEnabledEl.checked = config.telegram.enabled;
    }
    const tgTokenEl = document.getElementById('tg-token');
    if (tgTokenEl) {
      tgTokenEl.value = config.telegram.botToken === '***' ? '' : config.telegram.botToken;
    }
    const tgChatIdEl = document.getElementById('tg-chat-id');
    if (tgChatIdEl) {
      tgChatIdEl.value = config.telegram.chatId;
    }
    
    // 填充全局设置
    const testModeEl = document.getElementById('test-mode-enabled');
    if (testModeEl) {
      testModeEl.checked = config.settings.notificationTestMode;
    }
    
    // 更新测试模式提示条
    updateTestModeBanner();
  } catch (err) {
    console.error('加载通知配置失败:', err);
  }
}

// 保存 Bark 配置（从设置页面）
async function saveBarkConfig() {
  try {
    const config = {
      bark: {
        enabled: true, // Bark 开关已移除，默认启用
        deviceKey: document.getElementById('bark-key').value.trim(),
        sound: document.getElementById('bark-sound').value.trim(),
        volume: parseInt(document.getElementById('bark-volume').value)
      }
    };
    
    const response = await api('/notification/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    });
    
    if (response.success) {
      showToast('Bark 配置已保存', 'success');
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('保存失败：' + err.message, 'error');
  }
}

// 保存 Telegram 配置（从设置页面）
async function saveTelegramConfig() {
  try {
    const config = {
      telegram: {
        enabled: document.getElementById('tg-enabled').checked,
        botToken: document.getElementById('tg-token').value.trim(),
        chatId: document.getElementById('tg-chat-id').value.trim()
      }
    };
    
    const response = await api('/notification/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    });
    
    if (response.success) {
      showToast('Telegram 配置已保存', 'success');
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('保存失败：' + err.message, 'error');
  }
}

// 保存通知配置（兼容旧版）
async function saveNotificationConfig() {
  try {
    const config = {
      bark: {
        enabled: true, // Bark 开关已移除，默认启用
        deviceKey: document.getElementById('bark-key').value.trim(),
        sound: document.getElementById('bark-sound').value.trim(),
        volume: parseInt(document.getElementById('bark-volume').value)
      },
      telegram: {
        enabled: document.getElementById('tg-enabled').checked,
        botToken: document.getElementById('tg-token').value.trim(),
        chatId: document.getElementById('tg-chat-id').value.trim()
      },
      settings: {
        notificationTestMode: document.getElementById('test-mode-enabled').checked
      }
    };
    
    const response = await api('/notification/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    });
    
    if (response.success) {
      showToast('配置已保存', 'success');
      updateTestModeBanner();
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('保存失败：' + err.message, 'error');
  }
}

// 测试 Bark 通知
async function testBarkNotification() {
  const testData = {
    type: 'target',
    symbol: 'BTCUSDT',
    targetType: 'above',
    targetPrice: 50000,
    currentPrice: 50100,
    mode: 'normal'
  };
  
  try {
    const response = await api('/notification/test', {
      method: 'POST',
      body: JSON.stringify(testData)
    });
    
    if (response.success) {
      showTestResult(response.data);
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('测试失败：' + err.message, 'error');
  }
}

// 测试 Telegram 通知
async function testTelegramNotification() {
  const testData = {
    type: 'target',
    symbol: 'BTCUSDT',
    targetType: 'above',
    targetPrice: 50000,
    currentPrice: 50100
  };
  
  try {
    const response = await api('/notification/test', {
      method: 'POST',
      body: JSON.stringify(testData)
    });
    
    if (response.success) {
      showTestResult(response.data);
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('测试失败：' + err.message, 'error');
  }
}

// 显示测试结果
function showTestResult(data) {
  document.getElementById('test-bark-url').textContent = data.bark.url;
  document.getElementById('test-bark-title').textContent = data.bark.title;
  document.getElementById('test-bark-content').textContent = data.bark.content;
  
  const modeEl = document.getElementById('test-bark-mode');
  modeEl.textContent = data.bark.mode === 'normal' ? '普通模式' : '紧急模式';
  modeEl.className = `info-value ${data.bark.mode}`;
  
  document.getElementById('test-tg-url').textContent = data.telegram.url;
  document.getElementById('test-tg-text').textContent = data.telegram.text;
  
  document.getElementById('test-notification-modal').classList.add('active');
}

// 更新测试模式提示条
function updateTestModeBanner() {
  const testModeEnabled = document.getElementById('test-mode-enabled').checked;
  const banner = document.getElementById('test-mode-banner');
  banner.style.display = testModeEnabled ? 'flex' : 'none';
}

// 禁用测试模式
function disableTestMode() {
  document.getElementById('test-mode-enabled').checked = false;
  updateTestModeBanner();
}

// ==================== Bark 通知控制 ====================

// 加载 Bark 全局配置
// ==================== Bark 通知开关辅助函数 ====================

/**
 * 更新监控列表模式选择可见性
 * @param {boolean} isVisible - 是否显示模式选择
 */
function updateMonitorModeVisibility(isVisible) {
  const container = document.getElementById('monitor-bark-mode-container');
  if (container) {
    if (isVisible) {
      container.classList.add('visible');
    } else {
      container.classList.remove('visible');
    }
  }
}

/**
 * 更新波动侦测模式选择可见性
 * @param {boolean} isVisible - 是否显示模式选择
 */
function updateVolatilityModeVisibility(isVisible) {
  const container = document.getElementById('volatility-bark-mode-container');
  if (container) {
    if (isVisible) {
      container.classList.add('visible');
    } else {
      container.classList.remove('visible');
    }
  }
}

async function loadBarkGlobalConfig() {
  try {
    const response = await api('/notification/config');
    const config = response.data;
    
    // 加载监控列表 Bark 设置
    const monitorEnabled = config.bark.monitorEnabled !== false;  // 默认 true
    const monitorMode = config.bark.monitorMode || 'normal';
    
    // 更新开关状态
    const monitorToggle = document.getElementById('monitor-bark-toggle');
    if (monitorToggle) {
      monitorToggle.checked = monitorEnabled;
    }
    
    // 更新模式选择可见性
    updateMonitorModeVisibility(monitorEnabled);
    
    // 更新单选按钮选中状态
    const monitorModeRadio = document.querySelector(`input[name="monitor-bark-mode"][value="${monitorMode}"]`);
    if (monitorModeRadio) {
      monitorModeRadio.checked = true;
    }
    
    // 加载波动侦测 Bark 设置
    const volatilityEnabled = config.bark.volatilityEnabled === true;  // 默认 false
    const volatilityMode = config.bark.volatilityMode || 'normal';
    
    const volatilityToggle = document.getElementById('volatility-bark-toggle');
    if (volatilityToggle) {
      volatilityToggle.checked = volatilityEnabled;
    }
    
    updateVolatilityModeVisibility(volatilityEnabled);
    
    const volatilityModeRadio = document.querySelector(`input[name="volatility-bark-mode"][value="${volatilityMode}"]`);
    if (volatilityModeRadio) {
      volatilityModeRadio.checked = true;
    }
  } catch (err) {
    console.error('加载 Bark 配置失败:', err);
  }
}

// 切换监控列表 Bark 通知
async function toggleMonitorBark() {
  const checkbox = document.getElementById('monitor-bark-toggle');
  const enabled = checkbox.checked;
  
  // 如果尝试开启，先校验配置
  if (enabled) {
    try {
      const config = await api('/notification/config');
      const bark = config.data?.bark || {};
      
      // 校验 API Key 和铃声
      if (!bark.deviceKey || !bark.sound) {
        alert('请先在配置页面完成 Bark API Key 与铃声名称的设置');
        checkbox.checked = false;  // 强制关闭
        updateMonitorModeVisibility(false);
        return;
      }
    } catch (err) {
      console.error('[toggleMonitorBark] 配置校验失败:', err);
      checkbox.checked = false;
      updateMonitorModeVisibility(false);
      showToast('配置校验失败：' + err.message, 'error');
      return;
    }
  }
  
  // 开启时默认设置为普通模式
  if (enabled) {
    const normalRadio = document.querySelector('input[name="monitor-bark-mode"][value="normal"]');
    if (normalRadio) {
      normalRadio.checked = true;
    }
  }
  
  // 1. 立即更新 UI（不等待 API）
  updateMonitorModeVisibility(enabled);
  
  // 2. 异步保存配置（不阻塞 UI）
  api('/notification/config/bark/monitor', {
    method: 'PUT',
    body: JSON.stringify({})
  }).then((response) => {
    // 3. API 返回后显示提示
    if (response.success) {
      showToast(
        enabled ? '已启用监控列表 Bark 通知' : '已禁用监控列表 Bark 通知',
        'success'
      );
    } else {
      // 失败时回滚 UI
      checkbox.checked = !enabled;
      updateMonitorModeVisibility(!enabled);
      showToast(response.message, 'error');
    }
  }).catch(err => {
    // 4. 如果失败，回滚 UI
    checkbox.checked = !enabled;
    updateMonitorModeVisibility(!enabled);
    showToast('操作失败：' + err.message, 'error');
  });
}

// 保存监控列表 Bark 模式
async function saveMonitorBarkMode() {
  const mode = document.querySelector('input[name="monitor-bark-mode"]:checked')?.value;
  
  if (!mode) {
    console.warn('未选中任何 Bark 模式');
    return;
  }
  
  try {
    const response = await api('/notification/config/bark/monitor/mode', {
      method: 'PUT',
      body: JSON.stringify({ mode })
    });
    
    if (response.success) {
      showToast('模式已保存', 'success');
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('操作失败：' + err.message, 'error');
  }
}

// 切换波动侦测 Bark 通知
async function toggleVolatilityBark() {
  const checkbox = document.getElementById('volatility-bark-toggle');
  const enabled = checkbox.checked;
  
  // 如果尝试开启，先校验配置
  if (enabled) {
    try {
      const config = await api('/notification/config');
      const bark = config.data?.bark || {};
      
      // 校验 API Key 和铃声
      if (!bark.deviceKey || !bark.sound) {
        alert('请先在配置页面完成 Bark API Key 与铃声名称的设置');
        checkbox.checked = false;  // 强制关闭
        updateVolatilityModeVisibility(false);
        return;
      }
    } catch (err) {
      console.error('[toggleVolatilityBark] 配置校验失败:', err);
      checkbox.checked = false;
      updateVolatilityModeVisibility(false);
      showToast('配置校验失败：' + err.message, 'error');
      return;
    }
  }
  
  // 开启时默认设置为普通模式
  if (enabled) {
    const normalRadio = document.querySelector('input[name="volatility-bark-mode"][value="normal"]');
    if (normalRadio) {
      normalRadio.checked = true;
    }
  }
  
  // 1. 立即更新 UI（不等待 API）
  updateVolatilityModeVisibility(enabled);
  
  // 2. 异步保存配置（不阻塞 UI）
  api('/notification/config/bark/volatility', {
    method: 'PUT',
    body: JSON.stringify({})
  }).then((response) => {
    // 3. API 返回后显示提示
    if (response.success) {
      showToast(
        enabled ? '已启用波动侦测 Bark 通知' : '已禁用波动侦测 Bark 通知',
        'success'
      );
    } else {
      // 失败时回滚 UI
      checkbox.checked = !enabled;
      updateVolatilityModeVisibility(!enabled);
      showToast(response.message, 'error');
    }
  }).catch(err => {
    // 4. 如果失败，回滚 UI
    checkbox.checked = !enabled;
    updateVolatilityModeVisibility(!enabled);
    showToast('操作失败：' + err.message, 'error');
  });
}

// 保存波动侦测 Bark 模式
async function saveVolatilityBarkMode() {
  const mode = document.querySelector('input[name="volatility-bark-mode"]:checked')?.value;
  
  if (!mode) {
    console.warn('未选中任何 Bark 模式');
    return;
  }
  
  try {
    const response = await api('/notification/config/bark/volatility/mode', {
      method: 'PUT',
      body: JSON.stringify({ mode })
    });
    
    if (response.success) {
      showToast('模式已保存', 'success');
    } else {
      showToast(response.message, 'error');
    }
  } catch (err) {
    showToast('操作失败：' + err.message, 'error');
  }
}

// ==================== 初始化 ====================

// 初始化
async function init() {
  showPage('dashboard');
  loadDashboard();
  
  // 初始化系统开关（仪表盘）
  initSystemToggle();
  
  // 初始化系统开关（设置页面）
  initSettingsSystemToggle();
  
  // 初始化自动补全
  initAutocomplete();
  
  // 初始化弹窗内搜索
  initAddSymbolSearch();
  
  // 初始化波动设置
  initVolatilitySettings();
  
  // 加载波动侦测设置（从服务器）
  loadVolatilitySettings();
  
  // 加载 Bark 全局配置
  loadBarkGlobalConfig();
  
  // 定时刷新仪表盘（每 10 秒）
  setInterval(loadDashboard, 10000);
  
  // 连接 WebSocket
  connectWebSocket();
  
  // 请求通知权限
  requestNotificationPermission();
}

// 启动
init();
