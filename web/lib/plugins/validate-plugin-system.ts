/**
 * Validation script for Plugin Isolation System
 */

import { PluginIsolationManager } from './plugin-isolation';
import { EnhancedPluginManager } from './enhanced-plugin-manager';

async function validatePluginSystem() {
  console.log('🔧 Validating Plugin Isolation System...');
  
  const isolationManager = new PluginIsolationManager();
  const pluginManager = new EnhancedPluginManager(isolationManager);
  
  try {
    // Test 1: Basic sandbox creation
    console.log('✅ Test 1: Creating sandbox...');
    const sandboxId = isolationManager.createSandbox('test-plugin');
    const sandbox = isolationManager.getSandboxInfo(sandboxId);
    
    if (!sandbox || sandbox.pluginId !== 'test-plugin') {
      throw new Error('Sandbox creation failed');
    }
    console.log('✅ Sandbox created successfully');
    
    // Test 2: Safe execution
    console.log('✅ Test 2: Testing safe execution...');
    const result = await isolationManager.executeInSandbox(sandboxId, async () => {
      return 'test-result';
    });
    
    if (result !== 'test-result') {
      throw new Error('Safe execution failed');
    }
    console.log('✅ Safe execution works');
    
    // Test 3: Error handling
    console.log('✅ Test 3: Testing error handling...');
    let errorCaught = false;
    
    try {
      await isolationManager.executeInSandbox(sandboxId, async () => {
        throw new Error('Test error');
      });
    } catch (error) {
      errorCaught = true;
    }
    
    if (!errorCaught) {
      throw new Error('Error handling failed');
    }
    
    const updatedSandbox = isolationManager.getSandboxInfo(sandboxId);
    if (!updatedSandbox || updatedSandbox.errors.length === 0) {
      throw new Error('Error tracking failed');
    }
    console.log('✅ Error handling works');
    
    // Test 4: Resource monitoring
    console.log('✅ Test 4: Testing resource monitoring...');
    if (!updatedSandbox.resourceUsage) {
      throw new Error('Resource monitoring failed');
    }
    console.log('✅ Resource monitoring works');
    
    // Test 5: Enhanced plugin registration
    console.log('✅ Test 5: Testing enhanced plugin registration...');
    const testPlugin = {
      id: 'test-enhanced-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'Test plugin for validation',
      icon: () => null,
      component: () => null,
      category: 'utility' as const,
      defaultSize: { width: 300, height: 200 },
      minSize: { width: 200, height: 150 }
    };
    
    pluginManager.registerPlugin(testPlugin);
    const registeredPlugin = pluginManager.getPlugin('test-enhanced-plugin');
    
    if (!registeredPlugin || registeredPlugin.id !== 'test-enhanced-plugin') {
      throw new Error('Plugin registration failed');
    }
    console.log('✅ Enhanced plugin registration works');
    
    // Test 6: Plugin health monitoring
    console.log('✅ Test 6: Testing plugin health monitoring...');
    const health = pluginManager.getPluginHealth('test-enhanced-plugin');
    
    if (!health || typeof health.status !== 'string') {
      throw new Error('Plugin health monitoring failed');
    }
    console.log('✅ Plugin health monitoring works');
    
    // Cleanup
    isolationManager.cleanup();
    await pluginManager.cleanup();
    
    console.log('🎉 All tests passed! Plugin Isolation System is working correctly.');
    return true;
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
    
    // Cleanup on error
    isolationManager.cleanup();
    await pluginManager.cleanup();
    
    return false;
  }
}

// Export for use in other modules
export { validatePluginSystem };

// Run validation if this file is executed directly
if (require.main === module) {
  validatePluginSystem().then(success => {
    process.exit(success ? 0 : 1);
  });
}