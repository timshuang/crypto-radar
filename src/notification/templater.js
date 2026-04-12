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
    const sourceLabel = normalizeSourceType(alert.sourceType);
    const direction = alert.direction === 'down' ? '下跌' : '上涨';

    const title = '波动预警';
    const content = `[${sourceLabel}] ${alert.symbol} ${alert.windowMinutes}min ${direction} ${Math.abs(alert.changePercent).toFixed(2)}%`;

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
}

module.exports = Templater;
