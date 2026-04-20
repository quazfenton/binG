/**
 * Doc Lookup Power — Auto-inject power for library/framework documentation lookup.
 *
 * When a user's message indicates they want to read documentation, check API
 * references, or understand how to use a library, this power is proactively
 * injected so the agent knows documentation lookup tools are available — no
 * need to discover them on-demand via power_list/power_read.
 *
 * DESIGN:
 *   - `autoInject: true` → appended as a separate USER message via
 *     `appendAutoInjectPowers()` when triggers match.
 *   - Triggers on doc-lookup keywords ("read the docs", "documentation for",
 *     "how to use", "api reference", etc.).
 *   - NOT injected into the system prompt — preserves prompt caching.
 *   - Actions map to existing capabilities:
 *     - `lookup`   → web.fetch + doc extraction (fetch docs from a URL)
 *     - `search`   → web.search (find documentation pages online)
 *     - `api_ref`  → doc-lookup specific: fetch and extract API reference content
 *
 * @module powers/doc-lookup-power
 */

import type { PowerManifest } from './index';

export const docLookupPowerManifest: PowerManifest = {
  id: 'doc-lookup',
  name: 'Documentation Lookup',
  version: '1.0.0',
  description:
    'Look up library and framework documentation, API references, and usage guides. ' +
    'Automatically available when your message asks about docs, how to use something, ' +
    'or API references. Searches the web for documentation pages and extracts key content.',
  triggers: [
    'read the docs',
    'read the documentation',
    'documentation for',
    'docs for',
    'how to use',
    'how do i use',
    'api reference',
    'api docs',
    'api documentation',
    'check the docs',
    'look up the docs',
    'lookup docs',
    'official documentation',
    'reference for',
    'guide for',
    'tutorial for',
    'man page',
    'manpage',
    'rtfm',
    'what does the docs say',
  ],
  actions: [
    {
      name: 'search',
      description:
        'Search the web for documentation pages for a library, framework, or tool. ' +
        'Returns titles, URLs, and snippets from documentation sites.',
      paramsSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Documentation search query (e.g., "React useEffect docs", "Express middleware guide")' },
          library: { type: 'string', description: 'Specific library or framework name (e.g., "react", "express", "django")' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'lookup',
      description:
        'Fetch and extract documentation content from a URL. Lightweight — no JS rendering, ' +
        'just raw content. Use for doc pages that serve static HTML (most official docs).',
      paramsSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Documentation URL to fetch' },
          selector: { type: 'string', description: 'CSS selector to extract specific section (e.g., "main", "article", "#content")' },
          maxChars: { type: 'number', description: 'Max characters to return (default 12000)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'api_ref',
      description:
        'Look up API reference for a specific function, class, or method. ' +
        'Searches official docs and returns the relevant API signature, parameters, ' +
        'return type, and usage examples.',
      paramsSchema: {
        type: 'object',
        properties: {
          library: { type: 'string', description: 'Library or framework name (e.g., "react", "numpy")' },
          symbol: { type: 'string', description: 'Function, class, or method name (e.g., "useState", "array.reshape")' },
          language: { type: 'string', description: 'Programming language context (e.g., "typescript", "python")' },
        },
        required: ['library', 'symbol'],
      },
    },
  ],
  permissions: {
    allowedHosts: ['*'],
  },
  /** Capability IDs that this auto-inject power subsumes.
   *  Prevents duplicate registration in loadCapabilitiesAsPowers(). */
  coversCapabilityIds: ['doc.lookup', 'doc.search', 'doc.api_ref'],
  source: 'core',
  enabled: true,
  autoInject: true,
  tags: ['docs', 'documentation', 'api', 'reference', 'lookup', 'guide', 'tutorial', 'man'],
  metadata: {
    latency: 'medium',
    cost: 'low',
    reliability: 0.85,
  },
  runtime: 'native',
  providerPriority: ['web-fetch', 'web-search', 'native'],
};
