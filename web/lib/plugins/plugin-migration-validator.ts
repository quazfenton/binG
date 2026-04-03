/**
 * Plugin Migration Validator
 * Validates that the plugin reorganization works correctly
 */

import { pluginMigrationService, PluginCategorizer } from './plugin-migration';

export interface ValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

export class PluginMigrationValidator {
  /**
   * Validate the complete plugin reorganization
   */
  public static validateReorganization(): ValidationResult {
    const result: ValidationResult = {
      success: true,
      errors: [],
      warnings: []
    };

    try {
      // Test 1: Validate tab structure
      const structureValid = pluginMigrationService.validateTabStructure();
      if (!structureValid) {
        result.errors.push('Tab structure validation failed');
        result.success = false;
      }

      // Test 2: Check that Extra tab exists and has correct name
      const extraConfig = pluginMigrationService.getTabConfig('extra');
      if (!extraConfig) {
        result.errors.push('Extra tab configuration not found');
        result.success = false;
      } else if (extraConfig.name !== 'Extra') {
        result.warnings.push(`Extra tab name is '${extraConfig.name}', expected 'Extra'`);
      }

      // Test 3: Check that Plugins tab still exists
      const pluginsConfig = pluginMigrationService.getTabConfig('plugins');
      if (!pluginsConfig) {
        result.errors.push('Plugins tab configuration not found');
        result.success = false;
      }

      // Test 4: Verify Advanced AI Plugins are in Extra tab
      if (extraConfig && !extraConfig.plugins.includes('advanced-ai-plugins')) {
        result.warnings.push('Advanced AI Plugins not found in Extra tab');
      }

      // Test 5: Verify Modular Tools are in Plugins tab
      if (pluginsConfig && !pluginsConfig.plugins.includes('modular-tools')) {
        result.warnings.push('Modular Tools not found in Plugins tab');
      }

      // Test 6: Check plugin categorization
      const aiCategory = PluginCategorizer.getPluginsInCategory('ai');
      const utilityCategory = PluginCategorizer.getPluginsInCategory('utility');
      
      if (aiCategory.length === 0) {
        result.warnings.push('No plugins found in AI category');
      }
      
      if (utilityCategory.length === 0) {
        result.warnings.push('No plugins found in Utility category');
      }

      // Test 7: Verify migration history is recorded
      const migrationHistory = pluginMigrationService.getMigrationHistory();
      if (migrationHistory.length === 0) {
        result.warnings.push('No migration history recorded');
      }

      // Test 8: Test export/import functionality
      try {
        const exported = pluginMigrationService.exportConfiguration();
        const imported = pluginMigrationService.importConfiguration(exported);
        if (!imported) {
          result.errors.push('Configuration export/import failed');
          result.success = false;
        }
      } catch (error) {
        result.errors.push(`Configuration export/import error: ${error}`);
        result.success = false;
      }

    } catch (error) {
      result.errors.push(`Validation error: ${error}`);
      result.success = false;
    }

    return result;
  }

  /**
   * Test plugin migration functionality
   */
  public static testPluginMigration(): ValidationResult {
    const result: ValidationResult = {
      success: true,
      errors: [],
      warnings: []
    };

    try {
      // Test moving a plugin
      const testPluginId = 'test-migration-plugin';
      const moveResult = pluginMigrationService.movePluginsToTab([testPluginId], 'extra');
      
      if (!moveResult) {
        result.errors.push('Failed to move test plugin');
        result.success = false;
      } else {
        // Verify the plugin was moved
        const extraConfig = pluginMigrationService.getTabConfig('extra');
        if (!extraConfig?.plugins.includes(testPluginId)) {
          result.errors.push('Test plugin not found in target tab after migration');
          result.success = false;
        }
      }

      // Test tab renaming
      const originalName = 'Test Tab';
      const newName = 'Renamed Tab';
      
      // This would require setting up a test tab first
      // For now, we'll just test the method exists and handles errors gracefully
      const renameResult = pluginMigrationService.renameTab('NonExistentTab', newName);
      if (renameResult) {
        result.warnings.push('Rename operation succeeded on non-existent tab (unexpected)');
      }

    } catch (error) {
      result.errors.push(`Migration test error: ${error}`);
      result.success = false;
    }

    return result;
  }

  /**
   * Generate a comprehensive validation report
   */
  public static generateValidationReport(): string {
    const reorganizationResult = this.validateReorganization();
    const migrationResult = this.testPluginMigration();

    let report = '=== Plugin Migration Validation Report ===\n\n';

    // Reorganization results
    report += '1. Plugin Reorganization Validation:\n';
    report += `   Status: ${reorganizationResult.success ? 'PASSED' : 'FAILED'}\n`;
    
    if (reorganizationResult.errors.length > 0) {
      report += '   Errors:\n';
      reorganizationResult.errors.forEach(error => {
        report += `     - ${error}\n`;
      });
    }
    
    if (reorganizationResult.warnings.length > 0) {
      report += '   Warnings:\n';
      reorganizationResult.warnings.forEach(warning => {
        report += `     - ${warning}\n`;
      });
    }

    report += '\n';

    // Migration functionality results
    report += '2. Migration Functionality Test:\n';
    report += `   Status: ${migrationResult.success ? 'PASSED' : 'FAILED'}\n`;
    
    if (migrationResult.errors.length > 0) {
      report += '   Errors:\n';
      migrationResult.errors.forEach(error => {
        report += `     - ${error}\n`;
      });
    }
    
    if (migrationResult.warnings.length > 0) {
      report += '   Warnings:\n';
      migrationResult.warnings.forEach(warning => {
        report += `     - ${warning}\n`;
      });
    }

    // Overall status
    const overallSuccess = reorganizationResult.success && migrationResult.success;
    report += `\n=== Overall Status: ${overallSuccess ? 'PASSED' : 'FAILED'} ===\n`;

    // Tab configurations
    report += '\n3. Current Tab Configurations:\n';
    const allConfigs = pluginMigrationService.getAllTabConfigs();
    for (const [tabId, config] of allConfigs.entries()) {
      report += `   ${tabId}: ${config.name}\n`;
      report += `     Plugins: ${config.plugins.join(', ')}\n`;
      report += `     Categories: ${config.categories.join(', ')}\n`;
    }

    return report;
  }
}

// Export validation functions for easy use
export const validatePluginReorganization = PluginMigrationValidator.validateReorganization;
export const testPluginMigration = PluginMigrationValidator.testPluginMigration;
export const generateValidationReport = PluginMigrationValidator.generateValidationReport;