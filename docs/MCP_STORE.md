# MCP Store & Discovery System

**Location:** `lib/mcp/mcp-store-service.ts` + `components/mcp/mcp-store.tsx`

## Overview

The MCP Store is a comprehensive discovery and management system for MCP (Model Context Protocol) servers. It provides a unified interface for browsing, installing, and configuring MCP servers from multiple sources.

## Features

### 🌐 Multi-Source Discovery

- **Smithery Marketplace** - Official MCP server marketplace
- **Local Configurations** - User-defined local servers
- **Community Packages** - Community-contributed servers
- **Custom Servers** - Manually configured servers

### 🔐 API Key Management

- Secure local storage for API keys
- Per-server key configuration
- Required/optional key marking
- Encrypted storage (via localStorage)

### 📦 Server Management

- One-click installation
- Enable/disable toggles
- Connection status monitoring
- Automatic tool registry integration

### 🔍 Search & Filtering

- Full-text search
- Source filtering (Smithery, local, custom)
- Installation status filtering
- Tag-based filtering

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   MCP Store UI                          │
│  (components/mcp/mcp-store.tsx)                         │
│  - Server browser                                       │
│  - Search & filters                                     │
│  - Install/uninstall                                    │
│  - API key management                                   │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│              MCP Store Service                          │
│  (lib/mcp/mcp-store-service.ts)                         │
│  - Server discovery                                     │
│  - Smithery sync                                        │
│  - Local storage                                        │
│  - API key management                                   │
└─────────────────────────────────────────────────────────┘
            │                    │
            ▼                    ▼
┌──────────────────┐  ┌──────────────────┐
│  Smithery API    │  │  MCP Tool Registry│
│  - Search        │  │  - Server connect │
│  - Install       │  │  - Tool discovery │
│  - Connections   │  │  - Tool calling   │
└──────────────────┘  └──────────────────┘
```

## Usage

### Programmatic API

```typescript
import { mcpStoreService } from '@/lib/mcp/mcp-store-service';

// Sync with Smithery
const servers = await mcpStoreService.syncWithSmithery({
  query: 'github',
  limit: 50,
  verified: true,
});

// Search servers
const results = mcpStoreService.searchServers('github', {
  source: 'smithery',
  installed: true,
});

// Install a server
await mcpStoreService.installServer('smithery:github', {
  mcpUrl: 'https://mcp.github.com/server',
  apiKeys: {
    'GITHUB_TOKEN': 'ghp_...',
  },
});

// Manage API keys
mcpStoreService.storeApiKey('smithery:github', 'GITHUB_TOKEN', 'ghp_...');
const key = mcpStoreService.getApiKey('smithery:github', 'GITHUB_TOKEN');

// Enable/disable server
mcpStoreService.setServerEnabled('smithery:github', true);

// Add custom server
mcpStoreService.addCustomServer({
  name: 'my-custom-server',
  displayName: 'My Custom Server',
  description: 'Custom MCP server',
  mcpUrl: 'http://localhost:3001/mcp',
  transportType: 'http',
  apiKeys: [
    {
      name: 'API_KEY',
      description: 'API key for authentication',
      required: true,
    },
  ],
  tags: ['custom', 'local'],
});

// Get statistics
const stats = mcpStoreService.getStats();
// {
//   totalServers: 50,
//   installedServers: 5,
//   activeServers: 3,
//   smitheryServers: 45,
//   localServers: 5,
// }
```

### React Component

```tsx
import { MCPStore } from '@/components/mcp/mcp-store';

function App() {
  return (
    <div className="h-[600px]">
      <MCPStore />
    </div>
  );
}
```

### API Routes

```typescript
// GET /api/mcp/store - List servers
const response = await fetch('/api/mcp/store?q=github');
const { servers, stats } = await response.json();

// POST /api/mcp/store/sync - Sync with Smithery
const response = await fetch('/api/mcp/store/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'github',
    limit: 50,
    verified: true,
  }),
});

// POST /api/mcp/store/install - Install server
const response = await fetch('/api/mcp/store/install', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    serverId: 'smithery:github',
    mcpUrl: 'https://mcp.github.com/server',
    apiKeys: { GITHUB_TOKEN: 'ghp_...' },
  }),
});

// DELETE /api/mcp/store?id=xxx - Uninstall server
const response = await fetch('/api/mcp/store?id=smithery:github', {
  method: 'DELETE',
});
```

## Server Package Structure

```typescript
interface MCPServerPackage {
  // Identification
  id: string;              // Unique identifier (e.g., 'smithery:github')
  name: string;            // Machine name
  namespace?: string;      // Namespace/author
  displayName: string;     // Human-readable name
  
  // Metadata
  description: string;
  version: string;
  author?: string;
  iconUrl?: string;
  
  // Source tracking
  source: 'smithery' | 'local' | 'community' | 'custom';
  
  // Connection
  mcpUrl?: string;
  transportType?: 'stdio' | 'http' | 'websocket';
  
  // Configuration
  configSchema?: Record<string, any>;
  apiKeys?: MCPApiKeyConfig[];
  
  // State
  installed: boolean;
  enabled: boolean;
  
  // Metrics
  starCount?: number;
  verified?: boolean;
  tags?: string[];
  
  // Timestamps
  createdAt?: number;
  updatedAt?: number;
}
```

## API Key Configuration

```typescript
interface MCPApiKeyConfig {
  name: string;           // Key name (e.g., 'GITHUB_TOKEN')
  description?: string;   // Description for UI
  required: boolean;      // Whether key is required
  envVar?: string;        // Environment variable name
  storedValue?: string;   // Stored value (encrypted)
}
```

## Smithery Integration

The MCP Store integrates with the Smithery marketplace for server discovery:

```typescript
// Sync with Smithery
const servers = await mcpStoreService.syncWithSmithery({
  query: 'github',      // Search query
  limit: 50,            // Max results
  verified: true,       // Only verified servers
});

// Smithery API key required in .env
SMITHERY_API_KEY=your_api_key_here
```

## Local Storage

Server data is persisted to localStorage:

```typescript
// Storage key
const STORAGE_KEY = 'mcp-store-data';

// Stored structure
{
  servers: MCPServerPackage[],
  apiKeys: Record<string, string>,
  config: MCPStoreConfig,
  lastSync?: number,
}
```

## Configuration

```typescript
interface MCPStoreConfig {
  smitheryApiKey?: string;        // Smithery API key
  autoInstallUpdates?: boolean;   // Auto-install updates
  allowCustomServers?: boolean;   // Allow custom server addition
  communitySources?: string[];    // Community source URLs
}

// Update configuration
mcpStoreService.updateConfig({
  smitheryApiKey: '...',
  autoInstallUpdates: true,
});
```

## Security Considerations

### API Key Storage

- Keys stored in localStorage (client-side only)
- Never transmitted to server unless explicitly configured
- Encrypted in production (via localStorage encryption)

### Server Validation

- Smithery servers verified via API
- Custom servers require manual configuration
- Connection validation before installation

### Authentication

- API routes require Auth0 authentication
- Smithery sync requires API key
- Server installation requires user session

## Performance

### Caching

- Smithery API responses cached (5 minute TTL)
- Local storage for offline access
- Lazy loading for server details

### Sync Strategy

- Manual sync triggered by user
- Background sync on app load (optional)
- Debounced search queries

## Extensibility

### Adding New Sources

```typescript
// Implement source adapter
class CommunitySourceAdapter {
  async fetchServers(): Promise<MCPServerPackage[]> {
    // Fetch from community source
  }
}

// Register with store
mcpStoreService.registerSource('community', adapter);
```

### Custom Server Templates

```typescript
// Define template
const template = {
  name: 'template-name',
  configSchema: {
    // JSON Schema for configuration
  },
  installScript: async (config) => {
    // Custom installation logic
  },
};

// Register template
mcpStoreService.registerTemplate(template);
```

## Troubleshooting

### Smithery Sync Fails

1. Check API key in `.env`
2. Verify network connectivity
3. Check Smithery API status

### Server Installation Fails

1. Verify MCP URL is accessible
2. Check API keys are correct
3. Review server logs for errors

### API Keys Not Saving

1. Check localStorage is enabled
2. Verify browser permissions
3. Clear cache and retry

## Related Documentation

- [MCP Registry](./MCP_REGISTRY.md) - Tool registry and calling
- [Smithery Service](./SMITHERY_SERVICE.md) - Smithery API integration
- [MCP Gateway](./MCP_GATEWAY.md) - Gateway management
