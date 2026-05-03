/**
 * Plugin Registry
 * 
 * Provides a persistent source of truth for installed plugins,
 * replacing the fake "Install/Uninstall" stubs in the Marketplace.
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('PluginRegistry');

export interface InstalledPlugin {
  id: string;
  name: string;
  installedAt: number;
}

export interface BasicPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  icon?: string;
  component?: any;
  tags?: string[];
}

/**
 * Basic plugins list - used as base for enhanced registry
 */
export const pluginRegistry: BasicPlugin[] = [
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Advanced calculator with scientific functions and history',
    version: '1.2.0',
    author: 'binG Team',
    category: 'utility',
    tags: ['math', 'calculator', 'utility'],
  },
  {
    id: 'simple-calculator',
    name: 'Simple Calculator',
    description: 'Basic math operations',
    version: '1.0.0',
    author: 'binG Team',
    category: 'utility',
  },
  {
    id: 'json-validator',
    name: 'JSON Validator',
    description: 'Validate, format, and analyze JSON data with advanced features',
    version: '1.0.0',
    author: 'Kiro Team',
    category: 'utility',
    tags: ['json', 'validator', 'formatter', 'developer'],
  },
  {
    id: 'url-utilities',
    name: 'URL Utilities',
    description: 'Comprehensive URL validation, shortening, and analysis tools',
    version: '1.0.0',
    author: 'Kiro Team',
    category: 'utility',
    tags: ['url', 'validator', 'shortener', 'web'],
  },
  {
    id: 'code-formatter',
    name: 'Code Formatter',
    description: 'Format and beautify code',
    version: '1.2.0',
    author: 'binG Team',
    category: 'code',
  },
  {
    id: 'note-taker',
    name: 'Note Taker',
    description: 'Quick notes and snippets',
    version: '2.1.0',
    author: 'binG Team',
    category: 'utility',
  },
  {
    id: 'advanced-calculator',
    name: 'Advanced Calculator',
    description: 'Scientific calculator with plotting',
    version: '2.0.0',
    author: 'binG Team',
    category: 'utility',
  }
];

export class PluginRegistry {
  private static STORAGE_KEY = 'bing-installed-plugins';

  static getInstalled(): InstalledPlugin[] {
    if (typeof window === 'undefined') return [];
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static install(id: string, name: string) {
    const plugins = this.getInstalled();
    if (!plugins.find(p => p.id === id)) {
      plugins.push({ id, name, installedAt: Date.now() });
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(plugins));
      log.info(`[PluginRegistry] Installed: ${id}`);
    }
  }

  static uninstall(id: string) {
    const plugins = this.getInstalled().filter(p => p.id !== id);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(plugins));
    log.info(`[PluginRegistry] Uninstalled: ${id}`);
  }
}

