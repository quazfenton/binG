/**
 * Web Search Power — Auto-inject power for ubiquitous web search capability.
 *
 * This is the canonical example of an auto-inject power: when a user's
 * message contains a URL or asks to look something up, the agent should
 * proactively know that web search / URL fetching is available — no need
 * to discover it on-demand via power_list/power_read.
 *
 * DESIGN:
 *   - `autoInject: true` → appended as a separate USER message via
 *     `appendAutoInjectPowers()` when triggers match.
 *   - Triggers on URLs (http://, https://) and search-related keywords.
 *   - NOT injected into the system prompt — preserves prompt caching.
 *   - All other powers remain discoverable on-demand.
 *
 * @module powers/web-search-power
 */

import type { PowerManifest } from './index';

export const webSearchPowerManifest: PowerManifest = {
  id: 'web-search',
  name: 'Web Search & URL Fetch',
  version: '1.0.0',
  description:
    'Search the web for information and fetch/extract content from URLs. ' +
    'Automatically available when your message contains a link or asks to look something up.',
  triggers: [
    'http://',
    'https://',
    'www.',
    'search for',
    'look up',
    'find online',
  ],
  actions: [
    {
      name: 'search',
      description: 'Search the web using DuckDuckGo. Returns titles, URLs, and snippets.',
      paramsSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'fetch',
      description:
        'Fetch and extract text content from a URL. Lightweight — no JS rendering, just raw content.',
      paramsSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          maxChars: { type: 'number', description: 'Max characters to return (default 8000)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'browse',
      description:
        'Browse a URL with full JavaScript rendering. Use for pages that need JS to display content.',
      paramsSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to browse' },
          action: {
            type: 'string',
            enum: ['fetch', 'extract', 'click', 'screenshot'],
            description: 'Browse action (default: fetch)',
          },
          selector: { type: 'string', description: 'CSS selector for content extraction' },
        },
        required: ['url'],
      },
    },
  ],
  permissions: {
    allowedHosts: ['*'],
  },
  /** Capability IDs that this auto-inject power subsumes.
   *  Prevents duplicate registration in loadCapabilitiesAsPowers(). */
  coversCapabilityIds: ['web.search', 'web.browse', 'web.fetch'],
  source: 'core',
  enabled: true,
  autoInject: true,
  tags: ['web', 'search', 'url', 'fetch', 'browse', 'scrape'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.9,
  },
  runtime: 'native',
  providerPriority: ['nullclaw', 'native'],
};
