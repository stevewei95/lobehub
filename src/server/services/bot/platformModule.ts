/**
 * PlatformModule — encapsulates all platform-specific behaviour.
 *
 * Each bot platform (Discord, Telegram, Lark/Feishu) implements this interface
 * so that the core router and callback code remain platform-agnostic.
 */

export interface PlatformMessenger {
  createMessage(content: string): Promise<void>;
  editMessage(messageId: string, content: string): Promise<void>;
  removeReaction(messageId: string, emoji: string): Promise<void>;
  triggerTyping(): Promise<void>;
  updateThreadName?(name: string): Promise<void>;
}

export interface PlatformModule {
  /** Maximum message character limit (undefined → default ~1800) */
  readonly charLimit?: number;

  /**
   * Whether this platform should register an `onNewMessage` catch-all handler
   * so that direct messages (without @mention) are processed.
   * Discord should NOT enable this — it would cause unsolicited replies in channels.
   */
  readonly supportsCatchAllMessages: boolean;

  /** Credential keys that MUST be present to operate. */
  readonly requiredCredentials: string[];

  /**
   * Create the Chat SDK adapter config object (e.g. `{ discord: createDiscordAdapter(...) }`).
   * Returns null if the platform is unsupported or credentials are insufficient.
   */
  createChatAdapter(
    credentials: Record<string, string>,
    applicationId: string,
  ): Record<string, any> | null;

  /**
   * Create a lightweight REST API messenger for bot-callback webhooks.
   * This is used when the Chat SDK adapter is not available (queue mode).
   */
  createMessenger(
    credentials: Record<string, string>,
    platformThreadId: string,
  ): PlatformMessenger;

  /**
   * Hook called after a bot Chat instance is initialised and cached.
   * Use for side-effects like registering webhooks (Telegram) or indexing tokens (Discord).
   */
  onBotInitialized?(
    credentials: Record<string, string>,
    applicationId: string,
    extra?: Record<string, any>,
  ): Promise<void>;
}
