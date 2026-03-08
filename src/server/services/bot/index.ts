export { AgentBridgeService } from './AgentBridgeService';
export { BotMessageRouter, getBotMessageRouter } from './BotMessageRouter';
export type { PlatformMessenger, PlatformModule } from './platformModule';
export { getPlatformModule, platformBotRegistry, platformModuleRegistry } from './platforms';
export { Discord, type DiscordBotConfig } from './platforms/discord';
export { Telegram, type TelegramBotConfig } from './platforms/telegram';
export type { PlatformBot, PlatformBotClass } from './types';
