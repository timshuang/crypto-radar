/**
 * Telegram 通知发送器
 * 通过 Bot API 发送消息
 */

const https = require('https');

class TelegramSender {
  /**
   * 构建 Telegram API URL
   * @param {Object} config - Telegram 配置
   * @param {Object} message - 消息对象
   * @returns {string} 完整的 URL
   */
  buildUrl(config, message) {
    const baseUrl = 'https://api.telegram.org';
    const text = encodeURIComponent(`${message.title}\n${message.content}`);
    
    return `${baseUrl}/bot${config.botToken}/sendMessage?chat_id=${config.chatId}&text=${text}`;
  }

  /**
   * 发送 Telegram 消息
   * @param {Object} config - Telegram 配置
   * @param {Object} message - 消息对象
   * @returns {Promise<Object>} 发送结果
   */
  async send(config, message) {
    const url = this.buildUrl(config, message);

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve({
              success: result.ok === true,
              message_id: result.result?.message_id
            });
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }
}

module.exports = TelegramSender;
