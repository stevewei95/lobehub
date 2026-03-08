import type { PlatformModule } from '../platformModule';
import type { PlatformBotClass } from '../types';
import { Discord } from './discord';
import { discordModule } from './discordModule';
import { Lark } from './lark';
import { feishuModule, larkModule } from './larkModule';
import { Telegram } from './telegram';
import { telegramModule } from './telegramModule';

export const platformBotRegistry: Record<string, PlatformBotClass> = {
  discord: Discord,
  feishu: Lark,
  lark: Lark,
  telegram: Telegram,
};

/**
 * Registry mapping platform keys to their PlatformModule implementation.
 *
 * Adding a new platform only requires:
 * 1. Creating a `<platform>Module.ts` implementing PlatformModule
 * 2. Registering it here
 * 3. Adding the PlatformBot class above (for gateway lifecycle)
 */
export const platformModuleRegistry: Record<string, PlatformModule> = {
  discord: discordModule,
  feishu: feishuModule,
  lark: larkModule,
  telegram: telegramModule,
};

/**
 * Retrieve the PlatformModule for a given platform key.
 * Returns undefined for unknown platforms.
 */
export function getPlatformModule(platform: string): PlatformModule | undefined {
  return platformModuleRegistry[platform];
}
