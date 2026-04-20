/**
 * Code Search Power — Auto-inject power for ubiquitous codebase search capability.
 *
 * When a user's message indicates they want to find something in the codebase,
 * this power is proactively injected so the agent knows search tools are
 * available — no need to discover them on-demand via power_list/power_read.
 *
 * DESIGN:
 *   - `autoInject: true` → appended as a separate USER message via
 *     `appendAutoInjectPowers()` when triggers match.
 *   - Triggers on codebase-search keywords ("find in repo", "search codebase",
 *     "where is", "grep for", etc.).
 *   - NOT injected into the system prompt — preserves prompt caching.
 *   - Actions map to existing capabilities:
 *     - `search` → file.search (ripgrep-powered text/regex search)
 *     - `glob`   → file.search with type=name (file name pattern matching)
 *     - `semantic` → repo.semantic-search (embedding-based search)
 *   - Caching: results are cached via `toolResultCache` / `toolCacheKey.fileSearch`
 *     in lib/cache.ts to avoid redundant searches across the same session.
 *   - Indexing: for large repos, the repo-index indexer (lib/repo-index/indexer.ts)
 *     can pre-build a symbol index for faster lookups. This power doesn't
 *     trigger indexing itself — it leverages whatever index already exists.
 *
 * @module powers/code-search-power
 */

import type { PowerManifest } from './index';

export const codeSearchPowerManifest: PowerManifest = {
  id: 'code-search',
  name: 'Code Search & Grep',
  version: '1.0.0',
  description:
    'Search the codebase for files, symbols, and text patterns. ' +
    'Automatically available when your message asks to find something in the repo. ' +
    'Uses ripgrep for fast text search, glob for file name matching, and ' +
    'semantic search for concept-based lookups. Results are cached per-session.',
  triggers: [
    'find in repo',
    'search codebase',
    'search code',
    'where is',
    'where are',
    'grep for',
    'find all',
    'find file',
    'search for file',
    'look for',
    'ripgrep',
    'which file',
    'which files',
    'what file',
  ],
  actions: [
    {
      name: 'search',
      description:
        'Search file contents using ripgrep (regex-capable). Returns matching lines with file paths and line numbers. ' +
        'Caches results per session to avoid redundant searches.',
      paramsSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search pattern (supports regex)' },
          path: { type: 'string', description: 'Root path to search in (optional)' },
          glob: { type: 'string', description: 'File filter glob (e.g., "*.ts", "*.{ts,tsx}")' },
          maxResults: { type: 'number', description: 'Max results per file (default 15)' },
          caseInsensitive: { type: 'boolean', description: 'Case-insensitive search (default false)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'glob',
      description:
        'Find files by name pattern (glob). Fast — only matches file names, not contents. ' +
        'Use to locate files when you know the name or extension pattern.',
      paramsSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.test.ts", "src/utils/*")' },
          path: { type: 'string', description: 'Root path to search in (optional)' },
        },
        required: ['pattern'],
      },
    },
    {
      name: 'semantic',
      description:
        'Search codebase using semantic similarity (embeddings). ' +
        'Use when you need concept-based matching rather than exact text. ' +
        'Slower than text search but understands meaning.',
      paramsSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          path: { type: 'string', description: 'Path to search in (optional)' },
          limit: { type: 'number', description: 'Max results (default 10)' },
          similarityThreshold: { type: 'number', description: 'Min similarity score 0-1 (default 0.3)' },
        },
        required: ['query'],
      },
    },
  ],
  permissions: {
    allowedHosts: ['*'],
  },
  /** Capability IDs that this auto-inject power subsumes.
   *  Prevents duplicate registration in loadCapabilitiesAsPowers(). */
  coversCapabilityIds: ['file.search', 'repo.search', 'repo.semantic-search'],
  source: 'core',
  enabled: true,
  autoInject: true,
  tags: ['code', 'search', 'grep', 'ripgrep', 'glob', 'find', 'semantic', 'repo', 'codebase'],
  metadata: {
    latency: 'low',
    cost: 'low',
    reliability: 0.95,
  },
  runtime: 'native',
  providerPriority: ['ripgrep', 'blaxel', 'embedding-search', 'local-fs'],
};
