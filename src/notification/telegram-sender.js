/**
 * Telegram 通知发送器
 * 通过 Bot API 发送消息
 */

const https = require('https');

class TelegramSender {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.minIntervalMs = 1000;
    this.lastSendAt = 0;
  }

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

  maskChatId(chatId) {
    if (!chatId) return '***';
    const raw = String(chatId);
    if (raw.length <= 4) return '***';
    return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  }

  sanitizeDescription(description) {
    if (!description) return 'unknown_error';
    return String(description)
      .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot***')
      .replace(/chat_id[=:\s-]*-?\d+/gi, 'chat_id=***');
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _waitForSlot() {
    const elapsed = Date.now() - this.lastSendAt;
    const waitMs = this.minIntervalMs - elapsed;
    if (waitMs > 0) {
      await this._sleep(waitMs);
    }
  }

  async _processQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();

      try {
        await this._waitForSlot();
        const result = await this._sendImmediate(job.config, job.message);
        this.lastSendAt = Date.now();

        if (result?.errorCode === 429) {
          const retryAfterSeconds = Number(result.retryAfter || 1);
          console.warn(`[Telegram] 命中限速，${retryAfterSeconds}s 后继续队列发送`);
          await this._sleep(retryAfterSeconds * 1000);
        }

        job.resolve(result);
      } catch (err) {
        this.lastSendAt = Date.now();
        job.reject(err);
      }
    }

    this.processing = false;
  }

  _sendImmediate(config, message) {
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
            const success = result.ok === true;

            if (!success) {
              resolve({
                success: false,
                statusCode: res.statusCode,
                errorCode: result.error_code || res.statusCode,
                description: this.sanitizeDescription(result.description),
                chatIdMasked: this.maskChatId(config.chatId),
                retryAfter: result.parameters?.retry_after
              });
              return;
            }

            resolve({
              success: true,
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

  /**
   * 发送 Telegram 消息
   * @param {Object} config - Telegram 配置
   * @param {Object} message - 消息对象
   * @returns {Promise<Object>} 发送结果
   */
  async send(config, message) {
    return new Promise((resolve, reject) => {
      this.queue.push({ config, message, resolve, reject });
      this._processQueue().catch(reject);
    });
  }
}

module.exports = TelegramSender;
