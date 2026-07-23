#!/usr/bin/env node

/**
 * sync-opencode-models.mjs
 *
 * Syncs the ninerouter model list in ~/.config/opencode/opencode.json
 * from either llm-providers.ts or llm-providers-types.ts (source of truth).
 *
 * Usage:
 *   node scripts/sync-opencode-models.mjs [options]
 *
 * Options:
 *   --source <file>     Source of truth (default: web/lib/providers/llm-providers-types.ts)
 *   --target <file>     Target opencode.json (default: ~/.config/opencode/opencode.json)
 *   --provider <id>     Provider key in opencode.json (default: 9router)
 *   --dry-run           Show what would change without writing
 *   --sync-ts           Also sync llm-providers.ts from the same source
 *   --reverse           Sync FROM opencode.json INTO the TS source (reverse direction)
 *   --verbose           Print detailed output
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';

// ── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
sync-opencode-models.mjs — Sync opencode.json ninerouter models from TS source

Usage:
  node scripts/sync-opencode-models.mjs [options]

Options:
  --source <file>     Source of truth (default: web/lib/providers/llm-providers-types.ts)
  --target <file>     Target opencode.json (default: ~/.config/opencode/opencode.json)
  --provider <id>     Provider key in opencode.json (default: 9router)
  --dry-run           Show what would change without writing
  --sync-ts           Also sync llm-providers.ts from the same source
  --reverse           Sync FROM opencode.json INTO the TS source (reverse direction)
  --verbose           Print detailed output
  --help, -h          Show this help

Examples:
  # Dry run to preview changes (types file → opencode.json)
  node scripts/sync-opencode-models.mjs --dry-run

  # Apply sync from types file
  node scripts/sync-opencode-models.mjs

  # Use llm-providers.ts as source instead
  node scripts/sync-opencode-models.mjs --source web/lib/providers/llm-providers.ts

  # Sync and also update llm-providers.ts from the same source
  node scripts/sync-opencode-models.mjs --sync-ts

  # Reverse: update TS source from opencode.json
  node scripts/sync-opencode-models.mjs --reverse
`);
  process.exit(0);
}

function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const REPO_ROOT = resolve(join(import.meta.dirname, '..'));
const SOURCE_FILE = resolve(getArg('source', join(REPO_ROOT, 'web/lib/providers/llm-providers-types.ts')));
const TARGET_FILE = resolve(getArg('target', join(homedir(), '.config/opencode/opencode.json')));
const SYNC_TS_FILE = resolve(join(REPO_ROOT, 'web/lib/providers/llm-providers.ts'));
const PROVIDER_KEY = getArg('provider', '9router');
const DRY_RUN = hasFlag('dry-run');
const SYNC_TS = hasFlag('sync-ts');
const REVERSE = hasFlag('reverse');
const VERBOSE = hasFlag('verbose');

// ── Parse model IDs from a TS provider file ───────────────────────────────

function extractNinerouterModels(tsContent) {
  // Find the ninerouter models array
  // Match from 'models: [' inside ninerouter block to the closing '],'
  const nrBlock = tsContent.match(
    /ninerouter\s*:\s*\{[\s\S]*?models\s*:\s*\[([\s\S]*?)\]\s*[,}]/
  );
  if (!nrBlock) {
    console.error('ERROR: Could not find ninerouter models array in source file');
    process.exit(1);
  }

  const modelsBlock = nrBlock[1];
  const models = [];

  // Extract quoted strings, skipping comments
  const lines = modelsBlock.split('\n');
  for (const line of lines) {
    // Strip // comments
    const stripped = line.replace(/\/\/.*$/, '');
    // Match quoted model IDs (single or double quotes)
    const match = stripped.match(/['"]([^'"]+)['"]/);
    if (match) {
      models.push(match[1]);
    }
  }

  return models;
}

// ── Parse opencode.json models ────────────────────────────────────────────

function readOpencodeJson(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function getOpencodeModels(config, providerKey) {
  const provider = config.provider?.[providerKey];
  if (!provider?.models) return {};
  return provider.models;
}

// ── Sync logic ────────────────────────────────────────────────────────────

function makeModelEntry(modelId) {
  return {
    name: modelId,
    modalities: {
      input: ['text', 'image'],
      output: ['text'],
    },
  };
}

function syncOpencode(sourceModels, opencodeConfig, providerKey) {
  const provider = opencodeConfig.provider?.[providerKey];
  if (!provider?.models) {
    console.error(`ERROR: provider.${providerKey}.models not found in opencode.json`);
    process.exit(1);
  }

  const existing = new Set(Object.keys(provider.models));
  const source = new Set(sourceModels);

  const toAdd = sourceModels.filter((m) => !existing.has(m));
  const toRemove = [...existing].filter((m) => !source.has(m));

  // Preserve order: interleave existing with new, following source order
  const merged = [];
  const sourceSet = new Set(sourceModels);

  // Walk source order, insert existing entries where they belong
  for (const model of sourceModels) {
    if (existing.has(model)) {
      merged.push([model, provider.models[model]]);
    } else {
      merged.push([model, makeModelEntry(model)]);
    }
  }

  // Append any opencode-only models not in source (at the end, before closing)
  for (const [key, val] of Object.entries(provider.models)) {
    if (!sourceSet.has(key)) {
      merged.push([key, val]);
    }
  }

  // Rebuild the models object preserving insertion order
  provider.models = {};
  for (const [key, val] of merged) {
    provider.models[key] = val;
  }

  return { toAdd, toRemove };
}

// ── Reverse sync: opencode.json → TS source ──────────────────────────────

function reverseSyncToTs(opencodeModels, tsContent) {
  // Find the ninerouter models array and replace its contents
  const nrBlockMatch = tsContent.match(
    /(ninerouter\s*:\s*\{[\s\S]*?models\s*:\s*\[)([\s\S]*?)(\]\s*[,}])/
  );
  if (!nrBlockMatch) {
    console.error('ERROR: Could not find ninerouter models array in TS file');
    process.exit(1);
  }

  const [fullMatch, before, _oldModels, after] = nrBlockMatch;

  // Build grouped model list from opencode keys
  const grouped = groupModelsByPrefix(Object.keys(opencodeModels));

  let modelsStr = '\n';
  for (const [comment, models] of grouped) {
    if (comment) {
      modelsStr += `      // ${comment}\n`;
    }
    for (const m of models) {
      modelsStr += `      '${m}',\n`;
    }
  }

  const replacement = before + modelsStr + '    ' + after;
  return tsContent.replace(fullMatch, replacement);
}

function groupModelsByPrefix(models) {
  const groups = new Map();
  const order = [
    'Gemini', 'Antigravity', 'Gemini CLI', 'GitHub Copilot', 'Kilo Code',
    'Kiro', 'Opencode', 'OpenRouter', 'Ollama', 'Cloudflare', 'Mistral',
    'NVIDIA', 'Codex', 'Qoder', 'Vercel',
  ];
  const prefixToComment = {
    gemini: 'Gemini API models',
    ag: 'Antigravity OAuth models',
    gc: 'Gemini CLI OAuth models',
    gh: 'GitHub Copilot OAuth models',
    kc: 'Kilo Code OAuth models',
    kr: 'Kiro (Amazon) models',
    oc: 'Opencode Free Models',
    openrouter: 'OpenRouter models',
    ollama: 'Ollama Cloud models',
    cf: 'Cloudflare Workers AI models',
    mistral: 'Mistral models',
    nvidia: 'NVIDIA NIM models',
    cx: 'Codex models',
    qd: 'Qoder models',
    vercel: 'Vercel-backed models',
  };

  for (const model of models) {
    const prefix = model.split('/')[0];
    const comment = prefixToComment[prefix] || prefix;
    if (!groups.has(comment)) groups.set(comment, []);
    groups.get(comment).push(model);
  }

  // Return in defined order
  const result = [];
  for (const comment of order) {
    if (groups.has(comment)) {
      result.push([comment, groups.get(comment)]);
    }
  }
  // Any remaining groups not in order
  for (const [comment, models] of groups) {
    if (!order.includes(comment)) {
      result.push([comment, models]);
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  console.log(`Source:   ${SOURCE_FILE}`);
  console.log(`Target:   ${TARGET_FILE}`);
  console.log(`Provider: ${PROVIDER_KEY}`);
  if (DRY_RUN) console.log('Mode:     DRY RUN (no changes written)');
  if (REVERSE) console.log('Direction: opencode.json → TS source');
  console.log('');

  // Read source TS file
  const tsContent = readFileSync(SOURCE_FILE, 'utf-8');
  const sourceModels = extractNinerouterModels(tsContent);
  console.log(`Source models: ${sourceModels.length}`);

  if (VERBOSE) {
    for (const m of sourceModels) console.log(`  ${m}`);
    console.log('');
  }

  // Read target opencode.json
  const opencodeConfig = readOpencodeJson(TARGET_FILE);
  const opencodeModels = getOpencodeModels(opencodeConfig, PROVIDER_KEY);
  console.log(`Target models: ${Object.keys(opencodeModels).length}`);

  // Show diff summary
  const sourceSet = new Set(sourceModels);
  const existingSet = new Set(Object.keys(opencodeModels));

  const toAdd = sourceModels.filter((m) => !existingSet.has(m));
  const toRemove = [...existingSet].filter((m) => !sourceSet.has(m));

  if (toAdd.length === 0 && toRemove.length === 0) {
    console.log('\nAlready in sync. No changes needed.');
    return;
  }

  if (toAdd.length > 0) {
    console.log(`\nWill ADD (${toAdd.length}):`);
    for (const m of toAdd) console.log(`  + ${m}`);
  }

  if (toRemove.length > 0) {
    console.log(`\nWill REMOVE (${toRemove.length}):`);
    for (const m of toRemove) console.log(`  - ${m}`);
  }

  if (DRY_RUN) {
    console.log('\nDry run complete. No files modified.');
    return;
  }

  // Apply sync to opencode.json
  const { toAdd: added, toRemove: removed } = syncOpencode(sourceModels, opencodeConfig, PROVIDER_KEY);
  writeFileSync(TARGET_FILE, JSON.stringify(opencodeConfig, null, 2) + '\n');
  console.log(`\nWrote ${TARGET_FILE}`);
  console.log(`  Added: ${added.length}, Removed: ${removed.length}`);

  // Optionally sync TS provider file
  if (SYNC_TS) {
    const tsContent2 = readFileSync(SYNC_TS_FILE, 'utf-8');
    const updated = reverseSyncToTs(opencodeModels, tsContent2);
    writeFileSync(SYNC_TS_FILE, updated);
    console.log(`\nWrote ${SYNC_TS_FILE} (synced from opencode.json)`);
  }
}

main();
