/**
 * Register Nullclaw Tools
 *
 * Auto-registers Nullclaw automation tools:
 * - Discord messaging
 * - Telegram messaging
 * - Web browsing
 * - API integrations
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Tools:Nullclaw-Bootstrap');

/**
 * Register Nullclaw automation tools
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerNullclawTools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  let count = 0;

  try {
    // Check if Nullclaw is configured
    const nullclawUrl = process.env.NULLCLAW_URL;

    if (!nullclawUrl) {
      logger.debug('Nullclaw not configured (no NULLCLAW_URL)');
      return 0;
    }

    // Register Discord tool
    await registry.registerTool({
      name: 'nullclaw:sendDiscord',
      capability: 'automation.discord',
      provider: 'nullclaw',
      handler: async (args: any, context: any) => {
        const { nullclawIntegration } = await import('../../agent/nullclaw-integration');
        return await nullclawIntegration.sendDiscordMessage(args.channelId, args.message);
      },
      metadata: {
        latency: 'medium',
        cost: 'low',
        reliability: 0.95,
        tags: ['nullclaw', 'discord', 'messaging'],
      },
      permissions: ['automation:discord'],
    });
    count++;

    // Register Telegram tool
    await registry.registerTool({
      name: 'nullclaw:sendTelegram',
      capability: 'automation.telegram',
      provider: 'nullclaw',
      handler: async (args: any, context: any) => {
        const { nullclawIntegration } = await import('../../agent/nullclaw-integration');
        return await nullclawIntegration.sendTelegramMessage(args.chatId, args.message);
      },
      metadata: {
        latency: 'medium',
        cost: 'low',
        reliability: 0.95,
        tags: ['nullclaw', 'telegram', 'messaging'],
      },
      permissions: ['automation:telegram'],
    });
    count++;

    // Register web browse tool
    await registry.registerTool({
      name: 'nullclaw:browse',
      capability: 'web.browse',
      provider: 'nullclaw',
      handler: async (args: any, context: any) => {
        const { nullclawIntegration } = await import('../../agent/nullclaw-integration');
        return await nullclawIntegration.browseUrl(args.url);
      },
      metadata: {
        latency: 'high',
        cost: 'low',
        reliability: 0.90,
        tags: ['nullclaw', 'web', 'browse'],
      },
      permissions: ['web:browse'],
    });
    count++;

    // Register web search tool
    await registry.registerTool({
      name: 'nullclaw:search',
      capability: 'web.search',
      provider: 'nullclaw',
      handler: async (args: any, context: any) => {
        const { nullclawIntegration } = await import('../../agent/nullclaw-integration');
        return await (nullclawIntegration as any).searchWeb(args.query);
      },
      metadata: {
        latency: 'medium',
        cost: 'low',
        reliability: 0.92,
        tags: ['nullclaw', 'web', 'search'],
      },
      permissions: ['web:search'],
    });
    count++;

    logger.info(`Registered ${count} Nullclaw tools`);
  } catch (error: any) {
    logger.error('Failed to register Nullclaw tools', error);
  }

  return count;
}

/**
 * Unregister all Nullclaw tools
 */
export async function unregisterNullclawTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools();
  const nullclawTools = tools.filter(t => t.provider === 'nullclaw');

  for (const tool of nullclawTools) {
    await registry.unregisterTool(tool.name);
  }

  logger.info(`Unregistered ${nullclawTools.length} Nullclaw tools`);
}
