import { describe, expect, it, vi } from 'vitest';

import { getPlatformModule, platformModuleRegistry } from '../platforms';
import { discordModule } from '../platforms/discordModule';
import { extractDiscordChannelId } from '../platforms/discordModule';
import { createLarkModule, extractLarkChatId, feishuModule, larkModule } from '../platforms/larkModule';
import {
  extractTelegramChatId,
  parseTelegramMessageId,
  telegramModule,
} from '../platforms/telegramModule';

// --------------- Registry ---------------

describe('platformModuleRegistry', () => {
  it('should have all 4 platform keys', () => {
    expect(Object.keys(platformModuleRegistry).sort()).toEqual([
      'discord',
      'feishu',
      'lark',
      'telegram',
    ]);
  });

  it('getPlatformModule returns the correct module for known platforms', () => {
    expect(getPlatformModule('discord')).toBe(discordModule);
    expect(getPlatformModule('telegram')).toBe(telegramModule);
    expect(getPlatformModule('lark')).toBe(larkModule);
    expect(getPlatformModule('feishu')).toBe(feishuModule);
  });

  it('getPlatformModule returns undefined for unknown platforms', () => {
    expect(getPlatformModule('slack')).toBeUndefined();
    expect(getPlatformModule('')).toBeUndefined();
  });
});

// --------------- Discord Module ---------------

describe('discordModule', () => {
  it('should NOT support catch-all messages', () => {
    expect(discordModule.supportsCatchAllMessages).toBe(false);
  });

  it('should have no charLimit (uses default)', () => {
    expect(discordModule.charLimit).toBeUndefined();
  });

  it('should require botToken and publicKey', () => {
    expect(discordModule.requiredCredentials).toEqual(['botToken', 'publicKey']);
  });

  it('should not have onBotInitialized hook', () => {
    expect(discordModule.onBotInitialized).toBeUndefined();
  });

  describe('createChatAdapter', () => {
    it('should create adapter with discord key', () => {
      const adapters = discordModule.createChatAdapter(
        { botToken: 'tok', publicKey: 'pk' },
        'app123',
      );
      expect(adapters).toHaveProperty('discord');
    });
  });

  describe('extractDiscordChannelId', () => {
    it('should return threadId when present (4 parts)', () => {
      expect(extractDiscordChannelId('discord:guild1:chan1:thread1')).toBe('thread1');
    });

    it('should return channelId when no threadId (3 parts)', () => {
      expect(extractDiscordChannelId('discord:guild1:chan1')).toBe('chan1');
    });
  });

  describe('createMessenger', () => {
    it('should return a messenger with all required methods', () => {
      const messenger = discordModule.createMessenger(
        { botToken: 'tok' },
        'discord:guild1:chan1:thread1',
      );
      expect(messenger.createMessage).toBeTypeOf('function');
      expect(messenger.editMessage).toBeTypeOf('function');
      expect(messenger.removeReaction).toBeTypeOf('function');
      expect(messenger.triggerTyping).toBeTypeOf('function');
      expect(messenger.updateThreadName).toBeTypeOf('function');
    });
  });
});

// --------------- Telegram Module ---------------

describe('telegramModule', () => {
  it('should support catch-all messages', () => {
    expect(telegramModule.supportsCatchAllMessages).toBe(true);
  });

  it('should have 4000 char limit', () => {
    expect(telegramModule.charLimit).toBe(4000);
  });

  it('should require botToken', () => {
    expect(telegramModule.requiredCredentials).toEqual(['botToken']);
  });

  it('should have onBotInitialized hook', () => {
    expect(telegramModule.onBotInitialized).toBeTypeOf('function');
  });

  describe('createChatAdapter', () => {
    it('should create adapter with telegram key', () => {
      const adapters = telegramModule.createChatAdapter(
        { botToken: '123:abc', secretToken: 'sec' },
        'app123',
      );
      expect(adapters).toHaveProperty('telegram');
    });
  });

  describe('extractTelegramChatId', () => {
    it('should extract chat ID from platformThreadId', () => {
      expect(extractTelegramChatId('telegram:-100123456')).toBe('-100123456');
    });

    it('should handle thread with messageThreadId', () => {
      expect(extractTelegramChatId('telegram:-100123456:42')).toBe('-100123456');
    });
  });

  describe('parseTelegramMessageId', () => {
    it('should parse composite "chatId:messageId" format', () => {
      expect(parseTelegramMessageId('-100123456:42')).toBe(42);
    });

    it('should handle plain numeric ID', () => {
      expect(parseTelegramMessageId('42')).toBe(42);
    });

    it('should handle negative chatId correctly (uses lastIndexOf)', () => {
      expect(parseTelegramMessageId('-100123456:99')).toBe(99);
    });
  });

  describe('createMessenger', () => {
    it('should return a messenger with all required methods', () => {
      const messenger = telegramModule.createMessenger(
        { botToken: '123:abc' },
        'telegram:-100123456',
      );
      expect(messenger.createMessage).toBeTypeOf('function');
      expect(messenger.editMessage).toBeTypeOf('function');
      expect(messenger.removeReaction).toBeTypeOf('function');
      expect(messenger.triggerTyping).toBeTypeOf('function');
      expect(messenger.updateThreadName).toBeUndefined();
    });
  });
});

// --------------- Lark Module ---------------

describe('larkModule', () => {
  it('should support catch-all messages', () => {
    expect(larkModule.supportsCatchAllMessages).toBe(true);
  });

  it('should have 4000 char limit', () => {
    expect(larkModule.charLimit).toBe(4000);
  });

  it('should require appId and appSecret', () => {
    expect(larkModule.requiredCredentials).toEqual(['appId', 'appSecret']);
  });

  it('should not have onBotInitialized hook', () => {
    expect(larkModule.onBotInitialized).toBeUndefined();
  });

  describe('createChatAdapter', () => {
    it('should create adapter with lark key', () => {
      const adapters = larkModule.createChatAdapter(
        { appId: 'cli_xxx', appSecret: 'secret' },
        'app123',
      );
      expect(adapters).toHaveProperty('lark');
    });
  });

  describe('extractLarkChatId', () => {
    it('should extract chat ID from lark threadId', () => {
      expect(extractLarkChatId('lark:oc_xxx')).toBe('oc_xxx');
    });

    it('should extract chat ID from feishu threadId', () => {
      expect(extractLarkChatId('feishu:oc_yyy')).toBe('oc_yyy');
    });
  });

  describe('createMessenger', () => {
    it('should return a messenger with noop reaction and typing', () => {
      const messenger = larkModule.createMessenger(
        { appId: 'cli_xxx', appSecret: 'secret' },
        'lark:oc_xxx',
      );
      expect(messenger.createMessage).toBeTypeOf('function');
      expect(messenger.editMessage).toBeTypeOf('function');
      expect(messenger.removeReaction).toBeTypeOf('function');
      expect(messenger.triggerTyping).toBeTypeOf('function');
    });
  });
});

// --------------- Feishu Module ---------------

describe('feishuModule', () => {
  it('should be a separate module instance from larkModule', () => {
    expect(feishuModule).not.toBe(larkModule);
  });

  it('should have the same properties as larkModule', () => {
    expect(feishuModule.charLimit).toBe(larkModule.charLimit);
    expect(feishuModule.supportsCatchAllMessages).toBe(larkModule.supportsCatchAllMessages);
    expect(feishuModule.requiredCredentials).toEqual(larkModule.requiredCredentials);
  });

  describe('createChatAdapter', () => {
    it('should create adapter with feishu key', () => {
      const adapters = feishuModule.createChatAdapter(
        { appId: 'cli_xxx', appSecret: 'secret' },
        'app123',
      );
      expect(adapters).toHaveProperty('feishu');
      expect(adapters).not.toHaveProperty('lark');
    });
  });
});

// --------------- createLarkModule factory ---------------

describe('createLarkModule', () => {
  it('should create independent module for each platform variant', () => {
    const custom = createLarkModule('feishu');
    expect(custom).not.toBe(larkModule);
    expect(custom.supportsCatchAllMessages).toBe(true);
    expect(custom.charLimit).toBe(4000);
  });
});
