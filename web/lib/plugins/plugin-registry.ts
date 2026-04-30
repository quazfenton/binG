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
