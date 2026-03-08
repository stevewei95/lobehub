import { createIoRedisState } from '@chat-adapter/state-ioredis';
import { Chat, ConsoleLogger } from 'chat';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentBridgeService } from './AgentBridgeService';
import type { PlatformModule } from './platformModule';
import { getPlatformModule } from './platforms';

const log = debug('lobe-server:bot:message-router');

interface ResolvedAgentInfo {
  agentId: string;
  userId: string;
}

interface StoredCredentials {
  [key: string]: string;
}

/**
 * Routes incoming webhook events to the correct Chat SDK Bot instance
 * and triggers message processing via AgentBridgeService.
 *
 * Uses lazy per-bot loading: only the bot needed for an incoming webhook
 * is loaded from DB, rather than eagerly loading all bots at startup.
 */
export class BotMessageRouter {
  /** botToken → Chat instance (for Discord webhook routing via x-discord-gateway-token) */
  private botInstancesByToken = new Map<string, Chat<any>>();

  /** "platform:applicationId" → { agentId, userId } */
  private agentMap = new Map<string, ResolvedAgentInfo>();

  /** "platform:applicationId" → Chat instance */
  private botInstances = new Map<string, Chat<any>>();

  /** "platform:applicationId" → credentials */
  private credentialsByKey = new Map<string, StoredCredentials>();

  /** Dedup concurrent loads for the same bot key */
  private loadingPromises = new Map<string, Promise<Chat<any> | null>>();

  /** Dedup concurrent loadPlatformBots calls */
  private platformLoadPromises = new Map<string, Promise<void>>();

  /** Lazily resolved shared dependencies */
  private serverDB: LobeChatDatabase | null = null;
  private gateKeeper: KeyVaultsGateKeeper | null = null;
  private infraPromise: Promise<void> | null = null;

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Get the webhook handler for a given platform.
   * Returns a function compatible with Next.js Route Handler: `(req: Request) => Promise<Response>`
   *
   * @param appId  Optional application ID for direct bot lookup (e.g. Telegram bot-specific endpoints).
   */
  getWebhookHandler(platform: string, appId?: string): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      await this.ensureInfra();

      // Discord has special routing (gateway token + payload parsing)
      if (platform === 'discord') {
        return this.handleDiscordWebhook(req);
      }

      // Generic Chat SDK webhook routing — works for all appId-based platforms
      return this.handleGenericWebhook(req, platform, appId);
    };
  }

  // ------------------------------------------------------------------
  // Discord webhook routing
  // ------------------------------------------------------------------

  private async handleDiscordWebhook(req: Request): Promise<Response> {
    const bodyBuffer = await req.arrayBuffer();

    log('handleDiscordWebhook: method=%s, content-length=%d', req.method, bodyBuffer.byteLength);

    // Check for forwarded Gateway event (from Gateway worker)
    const gatewayToken = req.headers.get('x-discord-gateway-token');
    if (gatewayToken) {
      // Log forwarded event details
      try {
        const bodyText = new TextDecoder().decode(bodyBuffer);
        const event = JSON.parse(bodyText);

        if (event.type === 'GATEWAY_MESSAGE_CREATE') {
          const d = event.data;
          const mentions = d?.mentions?.map((m: any) => m.username).join(', ');
          log(
            'Gateway MESSAGE_CREATE: author=%s (bot=%s), mentions=[%s], content=%s',
            d?.author?.username,
            d?.author?.bot,
            mentions || '',
            d?.content?.slice(0, 100),
          );
        }
      } catch {
        // ignore parse errors
      }

      // Try cached token lookup first
      let bot = this.botInstancesByToken.get(gatewayToken);
      if (bot?.webhooks && 'discord' in bot.webhooks) {
        return bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
      }

      // Fallback: load all Discord bots to find the one matching this token
      await this.loadPlatformBots('discord');
      bot = this.botInstancesByToken.get(gatewayToken);
      if (bot?.webhooks && 'discord' in bot.webhooks) {
        return bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
      }

      log('No matching bot for gateway token');
      return new Response('No matching bot for gateway token', { status: 404 });
    }

    // HTTP Interactions — route by applicationId in the interaction payload
    try {
      const bodyText = new TextDecoder().decode(bodyBuffer);
      const payload = JSON.parse(bodyText);
      const appId = payload.application_id;

      if (appId) {
        const bot = await this.ensureBotLoaded('discord', appId);
        if (bot?.webhooks && 'discord' in bot.webhooks) {
          return bot.webhooks.discord(this.cloneRequest(req, bodyBuffer));
        }
      }
    } catch {
      // Not valid JSON — fall through
    }

    return new Response('No bot configured for Discord', { status: 404 });
  }

  // ------------------------------------------------------------------
  // Generic webhook routing (Telegram, Lark, Feishu, and future platforms)
  // ------------------------------------------------------------------

  private async handleGenericWebhook(
    req: Request,
    platform: string,
    appId?: string,
  ): Promise<Response> {
    log('handleGenericWebhook: platform=%s, appId=%s', platform, appId);

    if (!appId) {
      return new Response(`No bot configured for ${platform}`, { status: 404 });
    }

    const bodyBuffer = await req.arrayBuffer();

    const bot = await this.ensureBotLoaded(platform, appId);
    if (bot?.webhooks && platform in bot.webhooks) {
      return (bot.webhooks as any)[platform](this.cloneRequest(req, bodyBuffer));
    }

    log('handleGenericWebhook: no bot registered for %s:%s', platform, appId);
    return new Response(`No bot configured for ${platform}`, { status: 404 });
  }

  private cloneRequest(req: Request, body: ArrayBuffer): Request {
    return new Request(req.url, {
      body,
      headers: req.headers,
      method: req.method,
    });
  }

  // ------------------------------------------------------------------
  // Lazy loading infrastructure
  // ------------------------------------------------------------------

  private static REFRESH_INTERVAL_MS = 5 * 60_000;

  private lastLoadedAt = 0;

  /**
   * Ensure DB and gateKeeper are ready. Called once per webhook request.
   * Also handles periodic cache invalidation so newly added bots are discovered.
   */
  private async ensureInfra(): Promise<void> {
    if (!this.infraPromise) {
      this.infraPromise = this.initInfra();
    }
    await this.infraPromise;

    // Periodically clear cache so newly added/changed bots are discovered on next request
    if (
      this.lastLoadedAt > 0 &&
      Date.now() - this.lastLoadedAt > BotMessageRouter.REFRESH_INTERVAL_MS
    ) {
      log('Cache expired, clearing bot instances for lazy reload');
      this.botInstances.clear();
      this.agentMap.clear();
      this.credentialsByKey.clear();
      this.botInstancesByToken.clear();
      this.loadingPromises.clear();
      this.platformLoadPromises.clear();
      this.lastLoadedAt = 0;
    }
  }

  private async initInfra(): Promise<void> {
    log('Initializing BotMessageRouter infrastructure');
    this.serverDB = await getServerDB();
    this.gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
    log('Infrastructure ready');
  }

  // ------------------------------------------------------------------
  // Lazy per-bot loading with dedup
  // ------------------------------------------------------------------

  /**
   * Ensure a single bot is loaded and cached. Returns the Chat instance or null.
   * Deduplicates concurrent loads for the same platform:appId.
   */
  private async ensureBotLoaded(platform: string, appId: string): Promise<Chat<any> | null> {
    const key = `${platform}:${appId}`;

    // Already cached
    const existing = this.botInstances.get(key);
    if (existing) return existing;

    // Dedup: another request is already loading this bot
    const pending = this.loadingPromises.get(key);
    if (pending) return pending;

    // Load from DB
    const promise = this.loadBot(platform, appId).finally(() => {
      this.loadingPromises.delete(key);
    });
    this.loadingPromises.set(key, promise);

    return promise;
  }

  /**
   * Load a single bot from DB, create Chat instance, register handlers, initialize.
   */
  private async loadBot(platform: string, appId: string): Promise<Chat<any> | null> {
    const key = `${platform}:${appId}`;
    log('loadBot: loading %s', key);

    try {
      const provider = await AgentBotProviderModel.findEnabledByPlatformAndAppId(
        this.serverDB!,
        platform,
        appId,
        this.gateKeeper ?? undefined,
      );

      if (!provider) {
        log('loadBot: no enabled provider found for %s', key);
        return null;
      }

      return this.initializeBot(platform, provider);
    } catch (error) {
      log('loadBot: failed to load %s: %O', key, error);
      return null;
    }
  }

  /**
   * Load all bots for a given platform with concurrent dedup.
   * Used for Discord gateway token routing where we don't know the appId upfront.
   */
  private async loadPlatformBots(platform: string): Promise<void> {
    const pending = this.platformLoadPromises.get(platform);
    if (pending) return pending;

    const promise = this.doLoadPlatformBots(platform).finally(() => {
      this.platformLoadPromises.delete(platform);
    });
    this.platformLoadPromises.set(platform, promise);

    return promise;
  }

  private async doLoadPlatformBots(platform: string): Promise<void> {
    log('loadPlatformBots: loading all %s bots', platform);

    try {
      const providers = await AgentBotProviderModel.findEnabledByPlatform(
        this.serverDB!,
        platform,
        this.gateKeeper ?? undefined,
      );

      log('loadPlatformBots: found %d %s providers', providers.length, platform);

      for (const provider of providers) {
        const key = `${platform}:${provider.applicationId}`;
        if (this.botInstances.has(key)) continue;
        await this.initializeBot(platform, provider);
      }
    } catch (error) {
      log('loadPlatformBots: failed for %s: %O', platform, error);
    }
  }

  /**
   * Shared bot initialization: create adapter, Chat instance, register handlers,
   * populate caches, call platform-specific onBotInitialized hook.
   */
  private async initializeBot(
    platform: string,
    provider: DecryptedBotProvider,
  ): Promise<Chat<any> | null> {
    const { agentId, userId, applicationId, credentials } = provider;
    const key = `${platform}:${applicationId}`;

    // Double-check: might have been loaded by a concurrent call
    const existing = this.botInstances.get(key);
    if (existing) return existing;

    // Use PlatformModule to create adapter (eliminates platform switch)
    const platformModule = getPlatformModule(platform);
    if (!platformModule) {
      log('initializeBot: unsupported platform %s', platform);
      return null;
    }

    const adapters = platformModule.createChatAdapter(credentials, applicationId);
    if (!adapters) {
      log('initializeBot: adapter creation failed for %s', platform);
      return null;
    }

    const bot = this.createBot(adapters, `agent-${agentId}`);
    this.registerHandlers(bot, this.serverDB!, platformModule, {
      agentId,
      applicationId,
      platform,
      userId,
    });
    await bot.initialize();

    this.botInstances.set(key, bot);
    this.agentMap.set(key, { agentId, userId });
    this.credentialsByKey.set(key, credentials);

    // Discord-specific: also index by botToken for gateway forwarding
    if (platform === 'discord' && credentials.botToken) {
      this.botInstancesByToken.set(credentials.botToken, bot);
    }

    // Platform-specific post-init hook (e.g., Telegram setWebhook)
    if (platformModule.onBotInitialized) {
      await platformModule.onBotInitialized(credentials, applicationId);
    }

    if (!this.lastLoadedAt) this.lastLoadedAt = Date.now();

    log('Created %s bot for agent=%s, appId=%s', platform, agentId, applicationId);
    return bot;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private createBot(adapters: Record<string, any>, label: string): Chat<any> {
    const config: any = {
      adapters,
      logger: 'debug',
      userName: `lobehub-bot-${label}`,
    };

    const redisClient = getAgentRuntimeRedisClient();
    if (redisClient) {
      config.state = createIoRedisState({
        client: redisClient,
        keyPrefix: `chat-sdk:${label}`,
        logger: new ConsoleLogger(),
      });
    }

    return new Chat(config);
  }

  private registerHandlers(
    bot: Chat<any>,
    serverDB: LobeChatDatabase,
    platformModule: PlatformModule,
    info: ResolvedAgentInfo & { applicationId: string; platform: string },
  ): void {
    const { agentId, applicationId, platform, userId } = info;
    const bridge = new AgentBridgeService(serverDB, userId);

    bot.onNewMention(async (thread, message) => {
      log(
        'onNewMention: agent=%s, platform=%s, author=%s, thread=%s',
        agentId,
        platform,
        message.author.userName,
        thread.id,
      );
      await bridge.handleMention(thread, message, {
        agentId,
        botContext: { applicationId, platform, platformThreadId: thread.id },
      });
    });

    bot.onSubscribedMessage(async (thread, message) => {
      if (message.author.isBot === true) return;

      log(
        'onSubscribedMessage: agent=%s, platform=%s, author=%s, thread=%s',
        agentId,
        platform,
        message.author.userName,
        thread.id,
      );

      await bridge.handleSubscribedMessage(thread, message, {
        agentId,
        botContext: { applicationId, platform, platformThreadId: thread.id },
      });
    });

    // Register catch-all handler only for platforms that support it
    // (e.g. Telegram, Lark, Feishu — for handling DMs without @mention).
    // Platforms like Discord should NOT enable this to avoid unsolicited replies.
    if (platformModule.supportsCatchAllMessages) {
      bot.onNewMessage(/./, async (thread, message) => {
        if (message.author.isBot === true) return;

        log(
          'onNewMessage (%s catch-all): agent=%s, author=%s, thread=%s, text=%s',
          platform,
          agentId,
          message.author.userName,
          thread.id,
          message.text?.slice(0, 80),
        );

        await bridge.handleMention(thread, message, {
          agentId,
          botContext: { applicationId, platform, platformThreadId: thread.id },
        });
      });
    }
  }
}

// ------------------------------------------------------------------
// Singleton
// ------------------------------------------------------------------

let instance: BotMessageRouter | null = null;

export function getBotMessageRouter(): BotMessageRouter {
  if (!instance) {
    instance = new BotMessageRouter();
  }
  return instance;
}
