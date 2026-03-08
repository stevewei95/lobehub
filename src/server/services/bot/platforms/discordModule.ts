import { createDiscordAdapter } from '@chat-adapter/discord';

import { DiscordRestApi } from '../discordRestApi';
import type { PlatformMessenger, PlatformModule } from '../platformModule';

/**
 * Parse a Chat SDK platformThreadId (e.g. "discord:guildId:channelId[:threadId]")
 * and return the actual Discord channel ID to send messages to.
 */
export function extractDiscordChannelId(platformThreadId: string): string {
  const parts = platformThreadId.split(':');
  // parts[0]='discord', parts[1]=guildId, parts[2]=channelId, parts[3]=threadId (optional)
  return parts[3] || parts[2];
}

function createDiscordMessenger(
  discord: DiscordRestApi,
  channelId: string,
  platformThreadId: string,
): PlatformMessenger {
  return {
    createMessage: (content) => discord.createMessage(channelId, content).then(() => {}),
    editMessage: (messageId, content) => discord.editMessage(channelId, messageId, content),
    removeReaction: (messageId, emoji) => discord.removeOwnReaction(channelId, messageId, emoji),
    triggerTyping: () => discord.triggerTyping(channelId),
    updateThreadName: (name) => {
      const parts = platformThreadId.split(':');
      const threadId = parts[3];
      if (threadId) {
        return discord.updateChannelName(threadId, name);
      }
      return Promise.resolve();
    },
  };
}

export const discordModule: PlatformModule = {
  charLimit: undefined, // default (~1800)

  supportsCatchAllMessages: false,

  requiredCredentials: ['botToken', 'publicKey'],

  createChatAdapter(credentials, applicationId) {
    return {
      discord: createDiscordAdapter({
        applicationId,
        botToken: credentials.botToken,
        publicKey: credentials.publicKey,
      }),
    };
  },

  createMessenger(credentials, platformThreadId) {
    const discord = new DiscordRestApi(credentials.botToken);
    const channelId = extractDiscordChannelId(platformThreadId);
    return createDiscordMessenger(discord, channelId, platformThreadId);
  },
};
