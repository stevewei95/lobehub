import { createLarkAdapter } from '@lobechat/adapter-lark';

import { LarkRestApi } from '../larkRestApi';
import type { PlatformMessenger, PlatformModule } from '../platformModule';

/**
 * Extract chat ID from Lark platformThreadId (e.g. "lark:oc_xxx" or "feishu:oc_xxx").
 */
export function extractLarkChatId(platformThreadId: string): string {
  return platformThreadId.split(':')[1];
}

function createLarkMessenger(lark: LarkRestApi, chatId: string): PlatformMessenger {
  return {
    createMessage: (content) => lark.sendMessage(chatId, content).then(() => {}),
    editMessage: (messageId, content) => lark.editMessage(messageId, content),
    // Lark has no reaction/typing API for bots
    removeReaction: () => Promise.resolve(),
    triggerTyping: () => Promise.resolve(),
  };
}

/**
 * Factory: creates a PlatformModule for the given Lark variant ('lark' or 'feishu').
 * Both variants share the same logic but differ in API base URL.
 */
export function createLarkModule(platform: 'lark' | 'feishu'): PlatformModule {
  return {
    charLimit: 4000,

    supportsCatchAllMessages: true,

    requiredCredentials: ['appId', 'appSecret'],

    createChatAdapter(credentials, _applicationId) {
      return {
        [platform]: createLarkAdapter({
          appId: credentials.appId,
          appSecret: credentials.appSecret,
          encryptKey: credentials.encryptKey,
          platform,
          verificationToken: credentials.verificationToken,
        }),
      };
    },

    createMessenger(credentials, platformThreadId) {
      const lark = new LarkRestApi(credentials.appId, credentials.appSecret, platform);
      const chatId = extractLarkChatId(platformThreadId);
      return createLarkMessenger(lark, chatId);
    },
  };
}

export const larkModule: PlatformModule = createLarkModule('lark');
export const feishuModule: PlatformModule = createLarkModule('feishu');
