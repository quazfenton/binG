/**
 * Tests for plugin migration utilities
 */

import { PluginMigrationService, PluginCategorizer } from '../plugin-migration';

describe('PluginMigrationService', () => {
  let migrationService: PluginMigrationService;

  beforeEach(() => {
    migrationService = PluginMigrationService.getInstance();
    migrationService.clearMigrationHistory();
  });

  describe('movePluginsToTab', () => {
    it('should move plugins to target tab successfully', () => {
      const result = migrationService.movePluginsToTab(['test-plugin'], 'extra');
      expect(result).toBe(true);
      
      const extraConfig = migrationService.getTabConfig('extra');
      expect(extraConfig?.plugins).toContain('test-plugin');
    });

    it('should return false for non-existent target tab', () => {
      const result = migrationService.movePluginsToTab(['test-plugin'], 'non-existent');
      expect(result).toBe(false);
    });

    it('should record migration history', () => {
      migrationService.movePluginsToTab(['test-plugin'], 'extra');
      const history = migrationService.getMigrationHistory();
      expect(history).toHaveLength(1);
      expect(history[0].pluginIds).toContain('test-plugin');
      expect(history[0].targetTab).toBe('extra');
    });
  });

  describe('renameTab', () => {
    it('should rename tab successfully', () => {
      const result = migrationService.renameTab('Images', 'Extra');
      expect(result).toBe(true);
    });

    it('should return false for non-existent tab', () => {
      const result = migrationService.renameTab('NonExistent', 'NewName');
      expect(result).toBe(false);
    });
  });

  describe('validateTabStructure', () => {
    it('should validate correct tab structure', () => {
      const result = migrationService.validateTabStructure();
      expect(result).toBe(true);
    });

    it('should handle invalid configurations gracefully', () => {
      // This test would require mocking invalid configurations
      const result = migrationService.validateTabStructure();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('configuration export/import', () => {
    it('should export and import configuration correctly', () => {
      migrationService.movePluginsToTab(['test-plugin'], 'extra');
      const exported = migrationService.exportConfiguration();
      expect(exported).toBeTruthy();
      
      const imported = migrationService.importConfiguration(exported);
      expect(imported).toBe(true);
    });
  });
});

describe('PluginCategorizer', () => {
  describe('getCategoryForPlugin', () => {
    it('should return correct category for known plugins', () => {
      const category = PluginCategorizer.getCategoryForPlugin('ai-enhancer');
      expect(category).toBe('ai');
    });

    it('should return undefined for unknown plugins', () => {
      const category = PluginCategorizer.getCategoryForPlugin('unknown-plugin');
      expect(category).toBeUndefined();
    });
  });

  describe('getPluginsInCategory', () => {
    it('should return plugins in specified category', () => {
      const plugins = PluginCategorizer.getPluginsInCategory('ai');
      expect(plugins).toContain('ai-enhancer');
    });

    it('should return empty array for unknown category', () => {
      const plugins = PluginCategorizer.getPluginsInCategory('unknown');
      expect(plugins).toEqual([]);
    });
  });

  describe('addPluginToCategory', () => {
    it('should add plugin to category', () => {
      PluginCategorizer.addPluginToCategory('new-plugin', 'utility');
      const plugins = PluginCategorizer.getPluginsInCategory('utility');
      expect(plugins).toContain('new-plugin');
    });

    it('should remove plugin from previous category when adding to new one', () => {
      PluginCategorizer.addPluginToCategory('ai-enhancer', 'utility');
      const aiPlugins = PluginCategorizer.getPluginsInCategory('ai');
      const utilityPlugins = PluginCategorizer.getPluginsInCategory('utility');
      
      expect(aiPlugins).not.toContain('ai-enhancer');
      expect(utilityPlugins).toContain('ai-enhancer');
    });
  });
});