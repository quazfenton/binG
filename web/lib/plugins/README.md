# Plugin Error Isolation System

This system provides robust error isolation, resource monitoring, and recovery mechanisms for plugins to prevent crashes from affecting the main application.

## Features

### 🛡️ Error Isolation
- **Sandboxed Execution**: Each plugin runs in an isolated sandbox
- **Error Containment**: Plugin errors don't crash the main application
- **Graceful Degradation**: Failed plugins are handled gracefully
- **Recovery Mechanisms**: Automatic restart and recovery strategies

### 📊 Resource Monitoring
- **Memory Usage Tracking**: Monitor and limit memory consumption
- **CPU Usage Monitoring**: Track CPU usage and prevent excessive consumption
- **Network Request Limiting**: Control network access and request counts
- **Storage Quota Management**: Manage plugin storage usage
- **Execution Timeout Protection**: Prevent infinite loops and hanging operations

### 🔄 Automatic Recovery
- **Auto-restart**: Failed plugins can be automatically restarted
- **Circuit Breaker**: Prevent repeated failures from overwhelming the system
- **Cooldown Periods**: Implement delays between restart attempts
- **Fallback Strategies**: Provide alternative behaviors when plugins fail

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Enhanced Plugin Manager                  │
├─────────────────────────────────────────────────────────────┤
│  • Plugin Registration & Lifecycle Management              │
│  • Error Handling & Recovery Strategies                    │
│  • Health Monitoring & Status Tracking                     │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                  Plugin Isolation Manager                   │
├─────────────────────────────────────────────────────────────┤
│  • Sandbox Creation & Management                           │
│  • Resource Usage Monitoring                               │
│  • Execution Timeout & Safety                              │
│  • Error Tracking & Recovery                               │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Plugin Sandboxes                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Plugin A  │  │   Plugin B  │  │   Plugin C  │        │
│  │   Sandbox   │  │   Sandbox   │  │   Sandbox   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Usage

### Basic Plugin Registration

```typescript
import { enhancedPluginManager } from './lib/plugins/enhanced-plugin-manager';

// Register a plugin with enhanced features
const plugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',
  component: MyPluginComponent,
  // ... other properties
  
  // Enhanced configuration
  resourceLimits: {
    maxMemoryMB: 100,
    maxCpuPercent: 25,
    maxNetworkRequests: 50,
    maxStorageKB: 1024,
    timeoutMs: 30000
  },
  isolationConfig: {
    sandboxed: true,
    errorRecovery: true,
    autoRestart: true,
    maxRestarts: 3,
    restartCooldownMs: 5000
  }
};

enhancedPluginManager.registerPlugin(plugin);
```

### Loading and Using Plugins

```typescript
// Load a plugin instance
const instanceId = await enhancedPluginManager.loadPlugin('my-plugin', initialData);

// Execute plugin operations safely
const result = await enhancedPluginManager.executePlugin(instanceId, async () => {
  // Your plugin operation here
  return someResult;
});

// Monitor plugin health
const health = enhancedPluginManager.getPluginHealth('my-plugin');
console.log('Plugin status:', health.status); // 'healthy', 'degraded', or 'unhealthy'
```

### Error Handling

```typescript
// Register error handler
enhancedPluginManager.onPluginError('my-plugin', (error) => {
  console.error('Plugin error:', error);
  
  switch (error.type) {
    case 'resource':
      // Handle resource limit violations
      break;
    case 'timeout':
      // Handle execution timeouts
      break;
    case 'runtime':
      // Handle runtime errors
      break;
  }
});
```

### Using Enhanced Plugin Wrapper

```typescript
import { EnhancedPluginWrapper } from './components/plugins/enhanced-plugin-wrapper';

// Wrap your plugin component for enhanced features
<EnhancedPluginWrapper
  pluginId="my-plugin"
  component={MyPluginComponent}
  onClose={handleClose}
  onResult={handleResult}
  onError={handleError}
  onStatusChange={handleStatusChange}
/>
```

## Configuration Options

### Resource Limits

```typescript
interface PluginResourceLimits {
  maxMemoryMB: number;        // Maximum memory usage in MB
  maxCpuPercent: number;      // Maximum CPU usage percentage
  maxNetworkRequests: number; // Maximum network requests allowed
  maxStorageKB: number;       // Maximum storage usage in KB
  timeoutMs: number;          // Execution timeout in milliseconds
}
```

### Isolation Configuration

```typescript
interface PluginIsolationConfig {
  sandboxed: boolean;         // Enable sandboxed execution
  resourceLimits: PluginResourceLimits;
  errorRecovery: boolean;     // Enable automatic error recovery
  autoRestart: boolean;       // Enable automatic restart on failure
  maxRestarts: number;        // Maximum restart attempts
  restartCooldownMs: number;  // Cooldown period between restarts
}
```

## Error Types

The system handles different types of errors:

- **Runtime Errors**: JavaScript/TypeScript execution errors
- **Resource Errors**: Memory, CPU, or storage limit violations
- **Timeout Errors**: Operations that exceed time limits
- **Security Errors**: Unauthorized access attempts
- **Dependency Errors**: Missing or incompatible dependencies

## Plugin Health States

- **Healthy**: Plugin is running normally with no issues
- **Degraded**: Plugin has some errors but is still functional
- **Unhealthy**: Plugin has critical issues and may not be functional

## Best Practices

### 1. Resource Management
- Set appropriate resource limits based on plugin functionality
- Monitor resource usage regularly
- Implement cleanup in plugin unload hooks

### 2. Error Handling
- Always handle errors gracefully in plugin code
- Provide meaningful error messages
- Implement proper cleanup on errors

### 3. Performance
- Use lazy loading for heavy plugin components
- Implement efficient data structures
- Avoid blocking operations in the main thread

### 4. Testing
- Test plugins with resource constraints
- Simulate error conditions
- Verify recovery mechanisms work correctly

## Components

### Core Components

1. **PluginIsolationManager**: Manages sandboxes and resource monitoring
2. **EnhancedPluginManager**: High-level plugin lifecycle management
3. **EnhancedPluginWrapper**: React component wrapper with error isolation
4. **PluginHealthMonitor**: UI component for monitoring plugin health

### UI Components

- **Plugin Manager**: Main plugin management interface
- **Plugin Health Monitor**: Real-time health monitoring dashboard
- **Enhanced Plugin Wrapper**: Individual plugin wrapper with isolation

## Monitoring and Debugging

### Health Monitoring

```typescript
// Get overall plugin health
const health = enhancedPluginManager.getPluginHealth('my-plugin');

// Monitor specific metrics
console.log('Status:', health.status);
console.log('Active instances:', health.instances);
console.log('Error count:', health.errors);
console.log('Restart count:', health.restarts);
console.log('Resource usage:', health.resourceUsage);
```

### Debug Information

```typescript
// Get sandbox information
const sandbox = pluginIsolationManager.getSandboxInfo(sandboxId);
console.log('Sandbox status:', sandbox.status);
console.log('Resource usage:', sandbox.resourceUsage);
console.log('Error history:', sandbox.errors);
```

## Migration Guide

### Converting Existing Plugins

1. Add enhanced properties to plugin definition:
```typescript
const plugin = {
  // ... existing properties
  enhanced: true,
  resourceLimits: { /* limits */ },
  // ... other enhanced properties
};
```

2. Update plugin manager usage:
```typescript
// Enable enhanced mode
<PluginManager 
  availablePlugins={plugins}
  enableEnhancedMode={true}
/>
```

3. Add error handling to plugin components:
```typescript
const MyPlugin = ({ onClose, onResult }) => {
  try {
    // Plugin logic here
  } catch (error) {
    // Error will be caught by isolation system
    throw error;
  }
};
```

## Troubleshooting

### Common Issues

1. **Plugin won't load**: Check dependencies and resource limits
2. **Frequent restarts**: Increase resource limits or fix plugin bugs
3. **Poor performance**: Optimize plugin code or adjust limits
4. **Memory leaks**: Implement proper cleanup in plugin hooks

### Debug Steps

1. Check plugin health status
2. Review error logs in sandbox
3. Monitor resource usage patterns
4. Verify plugin configuration
5. Test with minimal resource limits

## Future Enhancements

- **Plugin Marketplace Integration**: Support for plugin discovery and installation
- **Advanced Security**: Enhanced sandboxing with Web Workers
- **Performance Analytics**: Detailed performance metrics and optimization suggestions
- **Plugin Communication**: Inter-plugin communication system
- **Hot Reloading**: Development-time plugin hot reloading