/**
 * Plugin Registry API
 *
 * Scans components/plugins/ directory and returns available plugins
 * with metadata extracted from component files
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  component: string;
  tags: string[];
}

// Plugin categories
const PLUGIN_CATEGORIES: Record<string, string[]> = {
  'code': ['code', 'sandbox', 'editor', 'development'],
  'ai': ['ai', 'ml', 'llm', 'prompt', 'enhancer'],
  'media': ['media', 'video', 'music', 'stream', 'embed'],
  'utility': ['utility', 'tool', 'helper', 'manager'],
  'data': ['data', 'visualization', 'chart', 'graph'],
  'integration': ['integration', 'api', 'webhook', 'sync'],
};

// Map of known plugins to their metadata
const KNOWN_PLUGINS: Record<string, Partial<PluginMetadata>> = {
  'ai-enhancer-plugin': {
    name: 'AI Prompt Enhancer',
    description: 'Enhance and improve your AI prompts',
    category: 'ai',
    icon: '✨',
    tags: ['ai', 'prompt', 'enhancement'],
  },
  'code-formatter-plugin': {
    name: 'Code Formatter',
    description: 'Format and beautify code',
    category: 'code',
    icon: '💻',
    tags: ['code', 'formatting', 'beautify'],
  },
  'calculator-plugin': {
    name: 'Calculator',
    description: 'Mathematical calculations',
    category: 'utility',
    icon: '🧮',
    tags: ['math', 'calculator', 'utility'],
  },
  'note-taker-plugin': {
    name: 'Note Taker',
    description: 'Take and organize notes',
    category: 'utility',
    icon: '📝',
    tags: ['notes', 'organization'],
  },
  'github-explorer-plugin': {
    name: 'GitHub Explorer',
    description: 'Browse GitHub repositories',
    category: 'code',
    icon: '🐙',
    tags: ['github', 'code', 'repositories'],
  },
  'huggingface-spaces-plugin': {
    name: 'Hugging Face Spaces',
    description: 'AI models and demos',
    category: 'ai',
    icon: '🤗',
    tags: ['ai', 'huggingface', 'models'],
  },
  'codesandbox-embed-plugin': {
    name: 'CodeSandbox',
    description: 'Online code editor',
    category: 'code',
    icon: '📦',
    tags: ['code', 'sandbox', 'editor'],
  },
  'stackblitz-embed-plugin': {
    name: 'StackBlitz',
    description: 'WebContainers IDE',
    category: 'code',
    icon: '⚡',
    tags: ['code', 'ide', 'webcontainers'],
  },
  'pstream-embed-plugin': {
    name: 'Movies',
    description: 'Stream movies and TV shows',
    category: 'media',
    icon: '🎬',
    tags: ['media', 'video', 'streaming'],
  },
  'e2b-desktop-plugin': {
    name: 'E2B Desktop',
    description: 'Remote desktop environment',
    category: 'code',
    icon: '🖥️',
    tags: ['desktop', 'remote', 'environment'],
  },
};

/**
 * GET /api/plugins - List available plugins
 */
export async function GET() {
  try {
    const pluginsDir = join(process.cwd(), 'components', 'plugins');
    
    // Scan plugins directory
    const files = await readdir(pluginsDir);
    
    // Filter for plugin files
    const pluginFiles = files.filter(f => f.endsWith('-plugin.tsx'));
    
    // Extract metadata from each plugin
    const plugins: PluginMetadata[] = [];
    
    for (const file of pluginFiles) {
      const pluginId = file.replace('-plugin.tsx', '');
      const known = KNOWN_PLUGINS[pluginId];
      
      // Try to extract metadata from file content
      const filePath = join(pluginsDir, file);
      const content = await readFile(filePath, 'utf-8');
      
      // Extract description from JSDoc comments
      const descriptionMatch = content.match(/\/\*\*[\s\S]*?\*\/\s*import/);
      let description = known?.description || 'Plugin component';
      
      if (descriptionMatch) {
        const jsdoc = descriptionMatch[0];
        const descMatch = jsdoc.match(/\*\s*@description\s+(.+)/i);
        if (descMatch) {
          description = descMatch[1].trim();
        }
      }
      
      // Determine category from filename and content
      let category = known?.category || 'utility';
      const lowerContent = content.toLowerCase();
      
      for (const [cat, keywords] of Object.entries(PLUGIN_CATEGORIES)) {
        if (keywords.some(kw => lowerContent.includes(kw))) {
          category = cat;
          break;
        }
      }
      
      plugins.push({
        id: pluginId,
        name: known?.name || pluginId.split('-').map(capitalize).join(' '),
        description,
        category,
        icon: known?.icon,
        component: `/plugins/${file}`,
        tags: known?.tags || [category],
      });
    }
    
    // Sort by category, then name
    plugins.sort((a, b) => {
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });
    
    return NextResponse.json({
      success: true,
      plugins,
      total: plugins.length,
      categories: [...new Set(plugins.map(p => p.category))],
    });
  } catch (error: any) {
    console.error('[Plugins API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load plugins' },
      { status: 500 }
    );
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
