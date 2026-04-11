/**
 * Powers Marketplace
 *
 * Curated index of user-installable powers (SKILL.md + optional WASM handlers).
 * Powers are the "client-facing cousin" to capabilities — less formal,
 * user-customizable, installed from marketplace or uploaded directly.
 *
 * @module powers/marketplace
 */

import { powersRegistry, type PowerManifest } from './index';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('Powers:Marketplace');

// ============================================================================
// Marketplace Index
// ============================================================================

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  capabilities: string[];
  version: string;
  author: string;
  skillMdUrl: string;
  wasmUrl?: string; // optional compiled WASM handler
}

export const MARKETPLACE_INDEX: MarketplaceEntry[] = [
  {
    id: 'react-component-gen',
    name: 'React Component Generator',
    description: 'Generates production-quality React components with accessibility, tests, and Storybook stories.',
    triggers: ['react', 'component', 'tsx', 'jsx'],
    capabilities: ['generate_component', 'generate_test', 'generate_story'],
    version: '1.2.0',
    author: 'community',
    skillMdUrl: 'https://skills.marketplace/react-component-gen/SKILL.md',
  },
  {
    id: 'sql-optimizer',
    name: 'SQL Query Optimizer',
    description: 'Analyzes and rewrites SQL for performance. Suggests indexes.',
    triggers: ['sql', 'query', 'database', 'postgres', 'mysql'],
    capabilities: ['analyze_query', 'rewrite_query', 'suggest_index'],
    version: '0.9.1',
    author: 'community',
    skillMdUrl: 'https://skills.marketplace/sql-optimizer/SKILL.md',
  },
];

// ============================================================================
// Marketplace Operations
// ============================================================================

/**
 * Search the marketplace for powers matching a query
 */
export function searchMarketplace(query: string): MarketplaceEntry[] {
  const lower = query.toLowerCase();
  return MARKETPLACE_INDEX.filter(entry =>
    entry.name.toLowerCase().includes(lower) ||
    entry.description.toLowerCase().includes(lower) ||
    entry.triggers.some(t => t.toLowerCase().includes(lower))
  );
}

/**
 * Install a power from the marketplace into the powers registry
 */
export async function installFromMarketplace(powerId: string): Promise<boolean> {
  const entry = MARKETPLACE_INDEX.find(e => e.id === powerId);
  if (!entry) {
    log.warn('Power not found in marketplace', { powerId });
    return false;
  }

  try {
    // Fetch SKILL.md from marketplace
    const response = await fetch(entry.skillMdUrl);
    if (!response.ok) {
      log.error('Failed to fetch SKILL.md', { powerId, status: response.status });
      return false;
    }

    const skillMd = await response.text();
    const manifest = parseSkillMd(skillMd, entry);

    powersRegistry.register(manifest);

    // Register WASM handler if available
    if (entry.wasmUrl) {
      // In production: download WASM and store locally
      // For now: register the URL for future compilation
      powersRegistry.registerWasmHandler(powerId, entry.wasmUrl);
    }

    log.info('Power installed from marketplace', { powerId, actions: manifest.actions.length });
    return true;
  } catch (error: any) {
    log.error('Failed to install power from marketplace', { powerId, error: error.message });
    return false;
  }
}

/**
 * Parse a SKILL.md into a PowerManifest with marketplace metadata
 */
function parseSkillMd(md: string, marketEntry: MarketplaceEntry): PowerManifest {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter: Record<string, any> = {};

  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        // Parse arrays like ['a', 'b']
        if (value.startsWith('[') && value.endsWith(']')) {
          try {
            value = JSON.parse(value.replace(/'/g, '"'));
          } catch {
            // Keep as string
          }
        }
        frontmatter[key] = value;
      }
    }
  }

  // Parse actions from headings
  const actions: PowerManifest['actions'] = [];
  const actionHeading = /##+\s+([a-zA-Z0-9_\-]+)\s*\n([\s\S]*?)(?=\n##+|\n$)/g;
  let m;
  while ((m = actionHeading.exec(md)) !== null) {
    const name = m[1].trim();
    const desc = m[2].trim().split('\n').slice(0, 5).join(' ');
    actions.push({ name, description: desc });
  }

  // Fallback: create default action from marketplace capabilities
  if (actions.length === 0) {
    for (const cap of marketEntry.capabilities) {
      actions.push({ name: cap, description: `${marketEntry.name} - ${cap}` });
    }
  }

  return {
    id: frontmatter.id || marketEntry.id,
    name: frontmatter.name || marketEntry.name,
    version: frontmatter.version || marketEntry.version,
    description: frontmatter.description || marketEntry.description,
    triggers: frontmatter.triggers || marketEntry.triggers,
    actions,
    permissions: {},
    source: 'marketplace',
    enabled: true,
    rawMarkdown: md,
    installedAt: Date.now(),
    verified: false,
  };
}

/**
 * Get marketplace summary for UI
 */
export function getMarketplaceSummary(): Array<{
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  installed: boolean;
}> {
  return MARKETPLACE_INDEX.map(entry => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    version: entry.version,
    author: entry.author,
    installed: powersRegistry.getById(entry.id) !== undefined,
  }));
}
