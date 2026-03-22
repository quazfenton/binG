# Cloud Sandbox Preview Improvements

## Current State

The codebase already has substantial preview infrastructure:

### Existing Infrastructure ✅

1. **OpenSandbox Preview Service** (`lib/sandbox/local/opensandbox-preview-service.ts`)
   - Deploys files to OpenSandbox containers
   - Auto-detects framework and sets appropriate commands
   - Port forwarding via `/sandboxes/{id}/endpoints/{port}`
   - Session management with `activeSessions` cache

2. **Sandbox Provider Interface** (`lib/sandbox/providers/sandbox-provider.ts`)
   - `getPreviewLink?(port: number): Promise<PreviewInfo>` - Optional preview method
   - `getPublicUrl?(): Promise<string>` - Sprites-specific
   - `createProxy?(config: ProxyConfig): Promise<{ pid: number; url: string }>` - Sprites-specific
   - `configureHttpService?(port: number): Promise<{ success: boolean; url: string }>` - Service configuration

3. **Preview Types** (`lib/sandbox/types.ts`)
   ```typescript
   export interface PreviewInfo {
     port: number;
     url: string;
     token?: string;
     openedAt?: number;
   }
   ```

4. **API Endpoint** (`app/api/preview/sandbox/route.ts`)
   - POST: Deploy files
   - PUT: Update files (hot reload)
   - DELETE: Destroy sandbox
   - GET: List sessions

## Provider-Specific Preview Support

### 1. CodeSandbox DevBox

**Documentation**: Uses `@codesandbox/sdk`

**Preview Method**:
```typescript
import { CodeSandbox } from '@codesandbox/sdk';

const sdk = new CodeSandbox(API_KEY);
const sandbox = await sdk.sandbox.create();
// DevBox automatically exposes ports 3000, 8080, etc.
const previewUrl = sandbox.getUrl(); // Returns public URL
```

**Template Mapping**:
- `react` → `node`
- `vue` → `node`
- `python` → `python`
- `nextjs` → `node`

### 2. Daytona

**Documentation**: Uses `@daytonaio/sdk`

**Preview Method**:
```typescript
import { Daytona } from '@daytonaio/sdk';

const daytona = new Daytona(API_KEY);
const workspace = await daytona.create({ image: 'node:20' });
// Get preview URL for exposed port
const previewUrl = await workspace.getPreviewUrl(port);
```

**Port Exposure**:
```typescript
await workspace.startService('dev-server', {
  command: 'npm run dev',
  port: 3000,
  public: true  // Makes port publicly accessible
});
```

### 3. Blaxel

**Documentation**: Uses `@blaxel/core`

**Preview Method**:
```typescript
import { BlaxelClient } from '@blaxel/core';

const client = new BlaxelClient({ apiKey: API_KEY });
const box = await client.boxes.create({ image: 'node:20' });

// Create HTTP service with auto-exposed port
const service = await client.services.create({
  boxId: box.id,
  command: 'npm run dev',
  port: 3000,
  public: true,
});

const previewUrl = service.url; // Public URL
```

**Features**:
- Auto-scaling services
- Callback-based deployment verification
- Environment variable services

### 4. Fly.io Sprites

**Documentation**: Uses `@fly/sprites`

**Preview Method**:
```typescript
import { SpritesClient } from '@fly/sprites';

const client = new SpritesClient({ token: API_TOKEN });
const sprite = await client.sprites.create({ image: 'node:20' });

// Get public URL (auto-exposes port 3000 by default)
const publicUrl = await sprite.getPublicUrl();

// Or create explicit proxy
const proxy = await sprite.createProxy({ port: 3000 });
const previewUrl = proxy.url;
```

**Features**:
- Checkpoint/restore
- Tar-pipe sync for fast file transfer
- Persistent volumes

### 5. E2B

**Documentation**: Uses `e2b` or `@e2b/code-interpreter`

**Preview Method**:
```typescript
import { Sandbox } from 'e2b';

const sandbox = await Sandbox.create({ template: 'base' });
// E2B doesn't have native port forwarding
// Use tunneling service or ngrok integration
const previewUrl = await sandbox.getHostname(); // Base URL only
```

**Note**: E2B focuses on code execution, not web serving. Best for:
- Python scripts
- Data processing
- CLI tools

For web previews, recommend CodeSandbox/Daytona.

## Implementation Recommendations

### Priority 1: Universal Preview Interface

Create a unified interface that works across all providers:

```typescript
// lib/sandbox/preview-manager.ts
export interface PreviewManager {
  /**
   * Start a preview server and return URL
   */
  startPreview(config: {
    handle: SandboxHandle;
    port: number;
    startCommand: string;
    framework?: string;
  }): Promise<PreviewInfo>;

  /**
   * Stop preview server
   */
  stopPreview(handle: SandboxHandle, port: number): Promise<void>;

  /**
   * Get current preview URL
   */
  getPreviewUrl(handle: SandboxHandle, port: number): Promise<string | null>;
}
```

### Priority 2: Provider-Specific Implementations

Each provider gets optimized preview support:

| Provider | Method | Auto-Expose | Tunneling |
|----------|--------|-------------|-----------|
| CodeSandbox | `sandbox.getUrl()` | ✅ Yes | N/A |
| Daytona | `workspace.getPreviewUrl(port)` | ✅ Yes | N/A |
| Blaxel | `service.url` | ✅ Yes | N/A |
| Sprites | `sprite.getPublicUrl()` | ✅ Yes | Optional |
| E2B | `sandbox.getHostname()` | ❌ No | Via ngrok |

### Priority 3: Framework Detection & Command Mapping

Enhance existing `FRAMEWORK_COMMANDS` with provider-specific variants:

```typescript
const PROVIDER_FRAMEWORK_COMMANDS = {
  codesandbox: {
    next: { install: 'npm install', start: 'npm run dev', port: 3000 },
    // CodeSandbox auto-detects Next.js, minimal config needed
  },
  daytona: {
    next: { install: 'npm install', start: 'npm run dev -- --port 3000', port: 3000 },
  },
  // ... etc
};
```

### Priority 4: Port Management

Implement smart port selection and conflict resolution:

```typescript
// lib/sandbox/port-manager.ts
export class PortManager {
  private usedPorts = new Set<number>();
  
  async getAvailablePort(handle: SandboxHandle, preferred: number): Promise<number> {
    if (!this.usedPorts.has(preferred)) {
      this.usedPorts.add(preferred);
      return preferred;
    }
    
    // Try next available port
    for (let port = preferred + 1; port < 65535; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    
    throw new Error('No available ports');
  }
  
  releasePort(port: number): void {
    this.usedPorts.delete(port);
  }
}
```

### Priority 5: Preview URL Caching

Cache preview URLs to avoid repeated API calls:

```typescript
// lib/sandbox/preview-cache.ts
export interface PreviewCacheEntry {
  url: string;
  port: number;
  sandboxId: string;
  createdAt: number;
  expiresAt: number;
}

export class PreviewCache {
  private cache = new Map<string, PreviewCacheEntry>();
  private readonly TTL = 30 * 60 * 1000; // 30 minutes
  
  get(sandboxId: string, port: number): string | null {
    const key = `${sandboxId}:${port}`;
    const entry = this.cache.get(key);
    
    if (!entry || Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.url;
  }
  
  set(sandboxId: string, port: number, url: string): void {
    const key = `${sandboxId}:${port}`;
    this.cache.set(key, {
      url,
      port,
      sandboxId,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.TTL,
    });
  }
}
```

## Testing Strategy

1. **Unit Tests**: Test each provider's preview method
2. **Integration Tests**: Deploy real projects to each provider
3. **E2E Tests**: Full workflow from file upload to preview URL

## Migration Path

1. Keep existing `opensandbox-preview-service.ts` as default
2. Add provider selection based on `SANDBOX_PROVIDER` env var
3. Gradually migrate features to universal interface
4. Deprecate provider-specific code paths
