/**
 * 消息模板引擎
 * 负责拼装通知标题和内容
 */

function normalizeSourceType(sourceType) {
  const rawSource = String(sourceType || '').trim().toLowerCase();

  if (rawSource === 'alpha' || rawSource === 'alpha代币') {
    return 'alpha';
  }

  if (rawSource === 'spot' || rawSource === '现货') {
    return '现货';
  }

  if (rawSource === 'contract' || rawSource === '合约') {
    return '合约';
  }

  return '现货';
}

class Templater {
  /**
   * 构建消息对象
   * @param {Object} alert - 告警对象
   * @returns {Object} 消息对象 { title, content }
   */
  buildMessage(alert) {
    if (alert.source === 'target') {
      return this.buildTargetAlert(alert);
    } else if (alert.source === 'volatility') {
      return this.buildVolatilityAlert(alert);
    } else {
      throw new Error(`未知的告警类型：${alert.source}`);
    }
  }

  /**
   * 构建价格预警消息（极致极简格式）
   * 格式：[现货/Alpha] {币种名称} {上穿/下破} {目标价格}
   * 示例：[现货] BTCUSDT 上穿 69900
   */
  buildTargetAlert(alert) {
    const sourceType = normalizeSourceType(alert.sourceType);
    const action = alert.type === 'above' ? '上穿' : '下破';
    
    const title = '价格预警';
    const content = `[${sourceType}] ${alert.symbol} ${action} ${this.formatPrice(alert.targetPrice)}`;
    
    return { title, content };
  }

  /**
   * 构建波动预警消息
   * 格式：[现货/alpha] {币种名称} {XX}min {上涨/下跌} {XX}%
   * 示例：[现货] BTCUSDT 5min 上涨 3.5%
   */
  buildVolatilityAlert(alert) {
    if (alert.isHighVolume) {
      return this.buildHighVolumeAlert(alert);
    }

    const sourceLabel = normalizeSourceType(alert.sourceType);
    const direction = alert.direction === 'down' ? '下跌' : '上涨';
    const hasPriceRange = alert.startPrice != null && alert.endPrice != null;
    const priceRangeText = hasPriceRange
      ? `（${this.formatPrice(alert.startPrice)} → ${this.formatPrice(alert.endPrice)}）`
      : '';
    const avgVolumeText = alert.avgQuoteVolume3mPerMinute != null
      ? ` 近3分钟平均交易额：${this.formatVolume(alert.avgQuoteVolume3mPerMinute)} usdt`
      : '';

    const title = '波动预警';
    const content = `[${sourceLabel}] ${alert.symbol} ${alert.windowMinutes}min ${direction} ${Math.abs(alert.changePercent).toFixed(2)}%${priceRangeText}${avgVolumeText}`;

    return { title, content };
  }

  /**
   * 构建大额波动预警消息（醒目格式）
   * 格式：
   * 🚨 大额波动预警
   *
   * [Alpha] PRL 5min 🔺上涨 15.8%（0.52 → 0.60）
   * 📊 近3分钟平均交易额：8,500 usdt
   * ⚡ 触发大额提醒阈值（≥ 5,000 usdt）
   */
  buildHighVolumeAlert(alert) {
    const sourceLabel = normalizeSourceType(alert.sourceType);
    const directionArrow = alert.direction === 'down' ? '🔻' : '🔺';
    const direction = alert.direction === 'down' ? '下跌' : '上涨';
    const hasPriceRange = alert.startPrice != null && alert.endPrice != null;
    const priceRangeText = hasPriceRange
      ? `（${this.formatPrice(alert.startPrice)} → ${this.formatPrice(alert.endPrice)}）`
      : '';

    const lines = [
      `[${sourceLabel}] ${alert.symbol} ${alert.windowMinutes}min ${directionArrow}${direction} ${Math.abs(alert.changePercent).toFixed(2)}%${priceRangeText}`
    ];

    if (alert.avgQuoteVolume3mPerMinute != null) {
      lines.push(`📊 近3分钟平均交易额：${this.formatVolume(alert.avgQuoteVolume3mPerMinute)} usdt`);
    }

    if (alert.highVolumeThreshold != null) {
      lines.push(`⚡ 触发大额提醒阈值（≥ ${this.formatVolume(alert.highVolumeThreshold)} usdt）`);
    }

    const title = '🚨 大额波动预警';
    const content = lines.join('\n');

    return { title, content };
  }

  /**
   * 格式化价格（极致极简格式）
   * 去除千分位逗号，保持简洁
   */
  formatPrice(price) {
    if (typeof price !== 'number') {
      price = parseFloat(price);
    }

    if (!Number.isFinite(price)) {
      return 'N/A';
    }
    
    // 极小价格保留更多小数位，避免显示成 0
    if (price > 0 && price < 0.001) {
      return parseFloat(price.toFixed(10)).toString();
    }

    // 小于 1 的价格显示更多小数位（去除末尾零）
    if (price < 1) {
      return parseFloat(price.toFixed(6)).toString();
    } else if (price < 100) {
      return parseFloat(price.toFixed(2)).toString();
    } else {
      // 整数价格不显示小数位，避免千分位逗号
      return Math.round(price).toString();
    }
  }

  formatVolume(volume) {
    const num = Number(volume);
    if (!Number.isFinite(num)) return 'N/A';
    if (num >= 1000) return parseFloat(num.toFixed(0)).toString();
    if (num >= 1) return parseFloat(num.toFixed(2)).toString();
    return parseFloat(num.toFixed(4)).toString();
  }
}

module.exports = Templater;
