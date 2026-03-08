import { createTelegramAdapter } from '@chat-adapter/telegram';
import debug from 'debug';

import { appEnv } from '@/envs/app';

import type { PlatformMessenger, PlatformModule } from '../platformModule';
import { TelegramRestApi } from '../telegramRestApi';

const log = debug('lobe-server:bot:telegram-module');

/**
 * Parse a Chat SDK platformThreadId (e.g. "telegram:chatId[:messageThreadId]")
 * and return the Telegram chat ID.
 */
export function extractTelegramChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[1];
}

/**
 * Parse a Chat SDK composite Telegram message ID ("chatId:messageId") into
 * the raw numeric message ID that the Telegram Bot API expects.
 */
export function parseTelegramMessageId(compositeId: string): number {
  const colonIdx = compositeId.lastIndexOf(':');
  if (colonIdx !== -1) {
    return Number(compositeId.slice(colonIdx + 1));
  }
  return Number(compositeId);
}

function createTelegramMessenger(telegram: TelegramRestApi, chatId: string): PlatformMessenger {
  return {
    createMessage: (content) => telegram.sendMessage(chatId, content).then(() => {}),
    editMessage: (messageId, content) =>
      telegram.editMessageText(chatId, parseTelegramMessageId(messageId), content),
    removeReaction: (messageId) =>
      telegram.removeMessageReaction(chatId, parseTelegramMessageId(messageId)),
    triggerTyping: () => telegram.sendChatAction(chatId, 'typing'),
  };
}

/**
 * Call Telegram setWebhook API. Idempotent — safe to call on every startup.
 */
export async function setTelegramWebhook(
  botToken: string,
  url: string,
  secretToken?: string,
): Promise<void> {
  const params: Record<string, string> = { url };
  if (secretToken) {
    params.secret_token = secretToken;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to set Telegram webhook: ${response.status} ${text}`);
  }
}

export const telegramModule: PlatformModule = {
  charLimit: 4000,

  supportsCatchAllMessages: true,

  requiredCredentials: ['botToken'],

  createChatAdapter(credentials) {
    return {
      telegram: createTelegramAdapter({
        botToken: credentials.botToken,
        secretToken: credentials.secretToken,
      }),
    };
  },

  createMessenger(credentials, platformThreadId) {
    const telegram = new TelegramRestApi(credentials.botToken);
    const chatId = extractTelegramChatId(platformThreadId);
    return createTelegramMessenger(telegram, chatId);
  },

  async onBotInitialized(credentials, applicationId) {
    if (!credentials.botToken) return;

    const baseUrl = (credentials.webhookProxyUrl || appEnv.APP_URL || '').replace(/\/$/, '');
    const webhookUrl = `${baseUrl}/api/agent/webhooks/telegram/${applicationId}`;

    setTelegramWebhook(credentials.botToken, webhookUrl, credentials.secretToken).catch((err) => {
      log('Failed to set Telegram webhook for appId=%s: %O', applicationId, err);
    });
  },
};
