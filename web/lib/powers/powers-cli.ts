/**
 * Powers CLI
 *
 * Commands:
 *   npx powers list              — List installed powers
 *   npx powers show <id>         — Show power details
 *   npx powers install <id>      — Install from marketplace
 *   npx powers uninstall <id>    — Remove a power
 *   npx powers search <query>    — Search marketplace
 *   npx powers add <name>        — Add a local power from SKILL.md
 *
 * @module powers/cli
 */

import { powersRegistry, type PowerManifest } from './index';
import { MARKETPLACE_INDEX, searchMarketplace, installFromMarketplace, getMarketplaceSummary } from './market';
import { createLogger } from '@/lib/utils/logger';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const log = createLogger('Powers:CLI');

// ============================================================================
// CLI Command Handlers
// ============================================================================

/**
 * Parse a SKILL.md file into a PowerManifest
 */
function parseSkillMd(content: string, name: string): PowerManifest {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter: Record<string, any> = {};

  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        let value = line.slice(colonIdx + 1).trim();
        if (value.startsWith('[') && value.endsWith(']')) {
          try { value = JSON.parse(value.replace(/'/g, '"')); } catch { /* keep as string */ }
        }
        frontmatter[key] = value;
      }
    }
  }

  // Parse actions from ## headings
  const actions: PowerManifest['actions'] = [];
  const actionHeading = /##+\s+([a-zA-Z0-9_\-]+)\s*\n([\s\S]*?)(?=\n##+|\n$)/g;
  let m;
  while ((m = actionHeading.exec(content)) !== null) {
    actions.push({ name: m[1].trim(), description: m[2].trim().slice(0, 200) });
  }
  if (actions.length === 0) {
    actions.push({ name: 'assist', description: 'General assistance using skill guidance' });
  }

  return {
    id: frontmatter.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: frontmatter.name || name,
    version: frontmatter.version || '1.0.0',
    description: frontmatter.description || '',
    triggers: frontmatter.triggers || [],
    actions,
    source: 'user',
    enabled: true,
    rawMarkdown: content,
  };
}

/**
 * List installed powers
 */
export async function listPowers(json = false): Promise<void> {
  const summary = powersRegistry.getSummary();
  const marketSummary = getMarketplaceSummary();

  if (json) {
    console.log(JSON.stringify({ installed: summary, marketplace: marketSummary }, null, 2));
    return;
  }

  console.log('\n📦 Installed Powers');
  console.log('─'.repeat(50));
  if (summary.length === 0) {
    console.log('  (none installed)\n');
  } else {
    for (const p of summary) {
      console.log(`  ${p.enabled ? '✅' : '⬜'} ${p.name} v${p.version} (${p.actions} actions)`);
      console.log(`     ${p.description}`);
      console.log(`     Source: ${p.source}`);
      console.log('');
    }
  }

  console.log('\n🏪 Marketplace');
  console.log('─'.repeat(50));
  for (const p of marketSummary) {
    console.log(`  ${p.installed ? '✅' : '⬜'} ${p.name} v${p.version} — ${p.author}`);
    console.log(`     ${p.description}`);
    console.log('');
  }
}

/**
 * Show power details
 */
export async function showPower(powerId: string): Promise<void> {
  const power = powersRegistry.getById(powerId);
  if (!power) {
    // Check marketplace
    const marketEntry = MARKETPLACE_INDEX.find(e => e.id === powerId);
    if (marketEntry) {
      console.log(`\n📦 ${marketEntry.name} (marketplace)`);
      console.log(`   Version: ${marketEntry.version}`);
      console.log(`   Author: ${marketEntry.author}`);
      console.log(`   ${marketEntry.description}`);
      console.log(`   Triggers: ${marketEntry.triggers.join(', ')}`);
      console.log(`   Actions: ${marketEntry.capabilities.join(', ')}`);
      console.log(`   Install: npx powers install ${powerId}`);
    } else {
      console.log(`Power not found: ${powerId}`);
    }
    return;
  }

  console.log(`\n✅ ${power.name} v${power.version}`);
  console.log(`   ${power.description}`);
  console.log(`   Source: ${power.source}`);
  console.log(`   Actions: ${power.actions.map(a => a.name).join(', ')}`);
  console.log(`   Triggers: ${power.triggers?.join(', ') || 'none'}`);
}

/**
 * Install a power from marketplace
 */
export async function installPower(powerId: string): Promise<void> {
  const success = await installFromMarketplace(powerId);
  if (success) {
    console.log(`✅ Installed: ${powerId}`);
  } else {
    console.error(`❌ Failed to install: ${powerId}`);
    process.exit(1);
  }
}

/**
 * Uninstall a power
 */
export async function uninstallPower(powerId: string): Promise<void> {
  powersRegistry.remove(powerId);
  console.log(`✅ Uninstalled: ${powerId}`);
}

/**
 * Search marketplace
 */
export async function searchPowers(query: string): Promise<void> {
  const results = searchMarketplace(query);
  if (results.length === 0) {
    console.log('No marketplace results for:', query);
    return;
  }

  console.log(`\n🔍 Marketplace results for "${query}"`);
  console.log('─'.repeat(50));
  for (const entry of results) {
    const installed = powersRegistry.getById(entry.id);
    console.log(`  ${installed ? '✅' : '⬜'} ${entry.name} v${entry.version} — ${entry.author}`);
    console.log(`     ${entry.description}`);
    console.log('');
  }
}

/**
 * Add a local power from a SKILL.md file
 */
export async function addPowerFromMd(filePath: string, name?: string): Promise<void> {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const content = await readFile(filePath, 'utf-8');
  const manifest = parseSkillMd(content, name || 'custom-power');

  powersRegistry.register(manifest);

  console.log(`✅ Added power: ${manifest.id} (${manifest.name} v${manifest.version})`);
  console.log(`   Actions: ${manifest.actions.map(a => a.name).join(', ')}`);
}

/**
 * CLI entry point — parses argv and dispatches
 */
export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  switch (command) {
    case 'list':
      await listPowers(args.includes('--json'));
      break;

    case 'show':
      if (!args[0]) { console.error('Usage: powers show <id>'); process.exit(1); }
      await showPower(args[0]);
      break;

    case 'install':
      if (!args[0]) { console.error('Usage: powers install <id>'); process.exit(1); }
      await installPower(args[0]);
      break;

    case 'uninstall':
      if (!args[0]) { console.error('Usage: powers uninstall <id>'); process.exit(1); }
      await uninstallPower(args[0]);
      break;

    case 'search':
      if (!args[0]) { console.error('Usage: powers search <query>'); process.exit(1); }
      await searchPowers(args.join(' '));
      break;

    case 'add':
      if (!args[0]) { console.error('Usage: powers add <SKILL.md path>'); process.exit(1); }
      await addPowerFromMd(args[0], args[1]);
      break;

    default:
      console.log(`
🔧 Powers CLI

Usage:
  npx powers list [--json]       List installed + marketplace powers
  npx powers show <id>           Show power details
  npx powers install <id>        Install from marketplace
  npx powers uninstall <id>      Remove a power
  npx powers search <query>      Search marketplace
  npx powers add <SKILL.md>      Add a local power from SKILL.md
`);
  }
}
