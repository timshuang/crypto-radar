/**
 * Bark 通知发送器
 * 支持普通模式和紧急模式
 */

const https = require('https');

class BarkSender {
  /**
   * 构建 Bark URL
   * @param {Object} config - Bark 配置
   * @param {Object} message - 消息对象
   * @param {string} mode - 通知模式：'normal' | 'critical'
   * @returns {string} 完整的 URL
   */
  buildUrl(config, message, mode = 'normal') {
    const baseUrl = config.serverUrl || 'https://api.day.app';
    
    // URL 编码标题和内容
    const encodedTitle = encodeURIComponent(message.title);
    const encodedContent = encodeURIComponent(message.content);
    
    // 根据模式选择铃声：普通模式用 soundNormal，紧急模式用 soundCritical
    const sound = mode === 'critical' 
      ? (config.soundCritical || config.sound || 'alarm')
      : (config.soundNormal || config.sound || 'minuet');
    
    // 基础参数
    let url = `${baseUrl}/${config.key}/${encodedTitle}/${encodedContent}?sound=${encodeURIComponent(sound)}`;
    
    // 紧急模式参数
    if (mode === 'critical') {
      url += `&level=critical&volume=${config.volume}`;
    }
    
    return url;
  }

  /**
   * 发送 Bark 通知
   * @param {Object} config - Bark 配置
   * @param {Object} message - 消息对象
   * @param {string} mode - 通知模式
   * @returns {Promise<Object>} 发送结果
   */
  async send(config, message, mode = 'normal') {
    const url = this.buildUrl(config, message, mode);
    
    // 打印日志（脱敏 key，不打印完整 URL）
    const maskedKey = config.key ? config.key.substring(0, 3) + '***' : 'N/A';
    console.log(`[Bark] 发送通知：title="${message.title}", mode=${mode}, key=${maskedKey}`);
    // 不打印完整 URL（避免泄露 Key），只打印目标地址
    console.log(`[Bark] 发送到：${config.serverUrl || 'https://api.day.app'}`);

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            console.log(`[Bark] 响应：code=${result.code}, message=${result.message}`);
            resolve({
              success: result.code === 200,
              message: result.message,
              mode
            });
          } catch (err) {
            resolve({
              success: res.statusCode === 200,
              message: data,
              mode
            });
          }
        });
      }).on('error', (err) => {
        console.error(`[Bark] 请求错误：${err.message}`);
        reject(err);
      });
    });
  }
}

module.exports = BarkSender;
