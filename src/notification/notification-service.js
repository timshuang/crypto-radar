/**
 * 通知服务 - 核心路由器
 * 负责根据配置选择通知通道并发送通知
 */

const BarkSender = require('./bark-sender');
const TelegramSender = require('./telegram-sender');
const Templater = require('./templater');

class NotificationService {
  constructor(configManager) {
    this.configManager = configManager;
    this.barkSender = new BarkSender();
    this.telegramSender = new TelegramSender();
    this.templater = new Templater();
    
    // 测试模式
    this.testMode = process.env.NOTIFY_TEST_MODE === 'true';
  }

  /**
   * 发送外部通知
   * @param {Object} alert - 告警对象
   * @param {Object} options - 通知选项
   * @returns {Object} 发送结果
   */
  async send(alert, options = {}) {
    const config = this.configManager.config;
    const results = {
      bark: null,
      telegram: null,
      testMode: this.testMode
    };

    // 构建消息
    const message = this.templater.buildMessage(alert);

    // 发送 Bark 通知
    if (options.useBark && config.bark?.enabled) {
      // 检查开关状态：根据警报类型检查对应的开关
      const isMonitorAlert = alert.source === 'target';
      const isVolatilityAlert = alert.source === 'volatility';
      
      // 监控列表警报检查 monitorEnabled，波动警报检查 volatilityEnabled
      if (isMonitorAlert && config.bark.monitorEnabled === false) {
        console.log('[Bark] 监控列表开关关闭，跳过推送');
        results.bark = { success: false, skipped: true, reason: 'monitorEnabled=false' };
      } else if (isVolatilityAlert && config.bark.volatilityEnabled !== true) {
        console.log('[Bark] 波动侦测开关关闭，跳过推送');
        results.bark = { success: false, skipped: true, reason: 'volatilityEnabled=false' };
      } else {
        // 开关已开启，执行推送
        try {
          // 敏感数据只从 .env 读取
          const barkKey = process.env.BARK_KEY;
          if (!barkKey) {
            console.log('[Bark] 跳过发送：BARK_KEY 未配置');
            results.bark = { success: false, skipped: true, reason: 'key_not_configured' };
          } else {
            const barkConfig = {
              key: barkKey,
              soundNormal: process.env.BARK_SOUND_NORMAL || config.bark.soundNormal || 'minuet',
              soundCritical: process.env.BARK_SOUND_CRITICAL || config.bark.soundCritical || 'alarm',
              volume: parseInt(process.env.BARK_VOLUME) || config.bark.volume || 5,
              serverUrl: config.bark.serverUrl || 'https://api.day.app'
            };

            if (this.testMode) {
              results.bark = {
                success: true,
                testMode: true,
                url: this.barkSender.buildUrl(barkConfig, message, options.mode),
                title: message.title,
                content: message.content
              };
            } else {
              results.bark = await this.barkSender.send(barkConfig, message, options.mode);
            }
          }
        } catch (err) {
          console.error(`[Notification] Bark 发送失败：${err.message}`);
          results.bark = { success: false, error: err.message };
        }
      }
    }

    // 发送 Telegram 通知
    if (options.useTelegram && config.telegram?.enabled) {
      try {
        // 敏感数据只从 .env 读取
        const tgBotToken = process.env.TG_BOT_TOKEN;
        const tgChatId = process.env.TG_CHAT_ID;
        
        if (!tgBotToken || !tgChatId) {
          console.log('[Telegram] 跳过发送：TG_BOT_TOKEN 或 TG_CHAT_ID 未配置');
          results.telegram = { success: false, skipped: true, reason: 'credentials_not_configured' };
        } else {
          const tgConfig = {
            botToken: tgBotToken,
            chatId: tgChatId
          };

          if (this.testMode) {
            results.telegram = {
              success: true,
              testMode: true,
              url: this.telegramSender.buildUrl(tgConfig, message),
              text: `${message.title}\n${message.content}`
            };
          } else {
            results.telegram = await this.telegramSender.send(tgConfig, message);
          }
        }
      } catch (err) {
        console.error(`[Notification] Telegram 发送失败：${err.message || 'unknown_error'}`);
        results.telegram = {
          success: false,
          error: err.message || 'unknown_error',
          description: 'request_exception'
        };
      }
    }

    return results;
  }

  /**
   * 构建 Bark URL (用于测试)
   */
  buildBarkUrl(alert, barkConfig, mode) {
    const message = this.templater.buildMessage(alert);
    // 敏感数据只从 .env 读取
    const config = {
      key: process.env.BARK_KEY,
      sound: process.env.BARK_SOUND || barkConfig.soundNormal || 'minuet',
      volume: parseInt(process.env.BARK_VOLUME) || barkConfig.volume || 8
    };
    if (!config.key) {
      return { error: 'BARK_KEY 未配置' };
    }
    return this.barkSender.buildUrl(config, message, mode);
  }

  /**
   * 构建 Telegram URL (用于测试)
   */
  buildTelegramUrl(alert, tgConfig) {
    const message = this.templater.buildMessage(alert);
    // 敏感数据只从 .env 读取
    const config = {
      botToken: process.env.TG_BOT_TOKEN,
      chatId: process.env.TG_CHAT_ID
    };
    if (!config.botToken || !config.chatId) {
      return { error: 'TG_BOT_TOKEN 或 TG_CHAT_ID 未配置' };
    }
    return this.telegramSender.buildUrl(config, message);
  }

  /**
   * 构建消息 (用于测试)
   */
  buildMessage(alert) {
    return this.templater.buildMessage(alert);
  }
}

module.exports = NotificationService;
