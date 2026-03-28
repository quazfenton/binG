# Modal.com Sandbox Provider

Integration with [Modal.com](https://modal.com)'s serverless container platform using the official Modal SDK.

## Features

- **Fast Cold Starts**: Serverless containers that boot in seconds
- **GPU Support**: Access to H100, A100, A10G, T4, L4, and other GPUs
- **Live Tunnels**: Automatic TLS port forwarding for previews
- **Custom Images**: Build images with dockerfile commands
- **Persistent Storage**: Volume mounting for data persistence
- **Secret Management**: Secure environment variable injection
- **PTY Support**: Interactive terminal sessions

## Setup

### 1. Get API Credentials

1. Sign up at [modal.com](https://modal.com)
2. Go to Settings → API Keys
3. Generate a new API token and secret

### 2. Configure Environment Variables

Add to your `.env.local`:

```env
MODAL_API_TOKEN=your-token-id-here
MODAL_API_SECRET=your-token-secret-here
```

### 3. Select Modal Provider

Set as your sandbox provider:

```env
SANDBOX_PROVIDER=modal-com
```

Or use programmatically:

```typescript
import { getSandboxProvider } from '@/lib/sandbox/providers';

const provider = await getSandboxProvider('modal-com');
const sandbox = await provider.createSandbox({
  image: 'python:3.13-slim',
  cpu: 2,
  memory: 4096,
});
```

## Usage Examples

### Basic Sandbox

```typescript
import { modalComProvider } from '@/lib/sandbox/providers/modal-com-provider';

const sandbox = await modalComProvider.createSandbox({
  image: 'python:3.13-slim',
  cpu: 1,
  memory: 1024,
  timeout: 300, // 5 minutes
});

// Execute commands
const result = await sandbox.executeCommand('python --version');
console.log(result.output); // Python 3.13.x

// Cleanup
await modalComProvider.destroySandbox(sandbox.id);
```

### Named Sandboxes (Long-running Services)

```typescript
import { createNamedSandbox, getSandboxByName } from '@/lib/sandbox/providers/modal-com-provider';

// Create a named sandbox
const sandbox = await createNamedSandbox('my-service', {
  image: 'python:3.13-slim',
  cpu: 2,
  memory: 2048,
  command: ['python', '-m', 'http.server', '8000'],
  encryptedPorts: [8000],
});

// Later, retrieve the same sandbox by name
const existingSandbox = await getSandboxByName('bings-workspace', 'my-service');
```

### Connect Tokens (Authenticated HTTP Access)

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'python:3.13-slim',
  command: ['python', '-m', 'http.server', '8080'],
});

// Create connect token for authenticated access
const creds = await sandbox.createConnectToken({ userMetadata: 'my-app' });
console.log(`URL: ${creds.url}, Token: ${creds.token}`);

// Make authenticated request
const response = await fetch(creds.url, {
  headers: { Authorization: `Bearer ${creds.token}` },
});
```

### Filesystem Snapshots

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'python:3.13-slim',
});

// Prepare environment
await sandbox.executeCommand('pip install numpy pandas');
await sandbox.writeFile('/app/data.json', '{"key": "value"}');

// Snapshot filesystem
const snapshot = await sandbox.snapshotFilesystem();
console.log(`Snapshot image ID: ${snapshot.imageId}`);

// Mount snapshot in new sandbox for fast startup
const sandbox2 = await modalComProvider.createSandbox({
  image: 'python:3.13-slim',
});
await sandbox2.mountImage('/cached', snapshot.imageId);
```

### Directory Snapshots

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'alpine:3.21',
});

// Clone a repo
await sandbox.executeCommand('git clone https://github.com/example/repo /app/repo');

// Snapshot just the repo directory
const repoSnapshot = await sandbox.snapshotDirectory('/app/repo');

// Mount in another sandbox
const sandbox2 = await modalComProvider.createSandbox({ image: 'alpine:3.21' });
await sandbox2.mountImage('/app/repo', repoSnapshot.imageId);
```

### GPU Workloads

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'nvidia/cuda:12.4.0-devel-ubuntu22.04',
  gpu: 'A10G', // or 'H100', 'A100', 'T4', etc.
  cpu: 4,
  memory: 8192,
});

const result = await sandbox.executeCommand('nvidia-smi');
console.log(result.output);
```

### Custom Image Building

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'python:3.13-slim',
  dockerfileCommands: [
    'RUN apt-get update && apt-get install -y git curl',
    'RUN pip install numpy pandas requests',
    'ENV APP_ENV=production',
  ],
  cpu: 2,
  memory: 4096,
});
```

### Port Forwarding / Tunnels

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'python:3.13-slim',
  encryptedPorts: [8000], // HTTPS tunnel
  unencryptedPorts: [3000], // HTTP tunnel
});

// Start a server in the sandbox
await sandbox.executeCommand('python -m http.server 8000 &');

// Get tunnel URL
const tunnel = await sandbox.getPreviewLink(8000);
console.log(tunnel.url); // https://xxxxx.r5.modal.host
```

### Filesystem Operations

```typescript
// Write file
await sandbox.writeFile('/app/main.py', `
def hello():
    print("Hello from Modal!")

if __name__ == "__main__":
    hello()
`);

// Read file
const result = await sandbox.readFile('/app/main.py');
console.log(result.content);

// List directory
const listing = await sandbox.listDirectory('/app');
console.log(listing.content);
```

### Cloud Bucket Mounts (S3, GCS)

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'python:3.13-slim',
  cloudBucketMounts: [
    {
      bucketName: 'my-s3-bucket',
      mountPath: '/mnt/s3',
      secretName: 'aws-credentials', // Modal secret with AWS keys
      keyPrefix: 'data/',
      readOnly: true,
    },
  ],
});

// Access S3 bucket directly from sandbox filesystem
await sandbox.executeCommand('ls -la /mnt/s3/data/');
```

### Proxy Support (Static IP)

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'alpine/curl',
  proxy: 'my-proxy', // Proxy name from Modal dashboard
});

// All outbound traffic uses proxy's static IP
const result = await sandbox.executeCommand('curl -s ifconfig.me');
console.log('External IP:', result.output.trim());
```

### Secrets Management

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'python:3.13-slim',
  secrets: ['my-secret', 'api-keys'], // Secret names from Modal dashboard
  envVars: {
    CUSTOM_VAR: 'value',
  },
});
```

### Volumes (Persistent Storage)

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'python:3.13-slim',
  volumes: [
    {
      name: 'my-data-volume',
      mountPath: '/data',
      mode: 'rw', // or 'ro' for read-only
    },
  ],
});

// Data persists across sandbox instances
await sandbox.writeFile('/data/persistent.txt', 'This data persists!');
```

### PTY Sessions

```typescript
const sandbox = await modalComProvider.createSandbox({
  image: 'ubuntu:22.04',
  pty: true,
});

// Create interactive terminal
const pty = await sandbox.createPty({
  id: 'terminal-1',
  cwd: '/root',
  envs: { TERM: 'xterm-256color' },
  cols: 80,
  rows: 24,
  onData: (data) => {
    // Handle terminal output
    console.log(new TextDecoder().decode(data));
  },
});

// Send input
await pty.sendInput('ls -la\n');

// Resize
await pty.resize(120, 40);
```

## Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `image` | string | Base Docker image (default: `python:3.13-slim`) |
| `gpu` | string | GPU type: `H100`, `A100`, `A10G`, `T4`, `L4` |
| `cpu` | number | CPU cores (fractional allowed, e.g., 0.5) |
| `memory` | number | Memory in MB |
| `timeout` | number | Max sandbox lifetime in seconds (default: 300) |
| `idleTimeoutMs` | number | Idle timeout before auto-termination |
| `workdir` | string | Working directory (default: `/root`) |
| `envVars` | object | Environment variables |
| `secrets` | string[] | Modal secret names to inject |
| `dockerfileCommands` | string[] | Commands to build custom image |
| `encryptedPorts` | number[] | Ports with HTTPS tunnels |
| `unencryptedPorts` | number[] | Ports with HTTP tunnels |
| `pty` | boolean | Enable PTY support |
| `volumes` | array | Volume mount configurations |
| `cloudBucketMounts` | array | S3/GCS bucket mount configurations |
| `proxy` | string | Proxy name for static IP outbound traffic |
| `cloud` | string | Cloud provider preference |
| `regions` | string[] | Region preferences |
| `name` | string | Custom sandbox name (for retrieval by name) |

## API Reference

### ModalComProvider

```typescript
class ModalComProvider implements SandboxProvider {
  // Check if credentials are configured
  isAvailable(): boolean
  
  // Health check
  healthCheck(): Promise<{ healthy: boolean; latency?: number }>
  
  // Create sandbox
  createSandbox(config: ModalComConfig): Promise<ModalComSandboxHandle>
  
  // Get sandbox by ID
  getSandbox(sandboxId: string): Promise<ModalComSandboxHandle>
  
  // Destroy sandbox
  destroySandbox(sandboxId: string): Promise<void>
  
  // Destroy all sandboxes
  destroyAll(): Promise<void>
}
```

### ModalComSandboxHandle

```typescript
class ModalComSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir: string
  
  // Core execution
  executeCommand(cmd: string, cwd?: string, timeout?: number): Promise<ToolResult>
  
  // Filesystem
  writeFile(path: string, content: string): Promise<ToolResult>
  readFile(path: string): Promise<ToolResult>
  listDirectory(path: string): Promise<ToolResult>
  
  // Port forwarding
  getPreviewLink(port: number): Promise<PreviewInfo>
  
  // PTY
  createPty(options: PtyOptions): Promise<PtyHandle>
  killPty(sessionId: string): Promise<void>
  
  // Connect tokens (authenticated HTTP access)
  createConnectToken(userMetadata?: string): Promise<{ url: string; token: string }>
  getConnectToken(): Promise<{ url: string; token: string } | undefined>
  
  // Snapshots
  snapshotFilesystem(timeoutMs?: number): Promise<{ imageId: string }>
  snapshotDirectory(path: string): Promise<{ imageId: string }>
  mountImage(path: string, imageId: string): Promise<void>
  
  // Lifecycle
  terminate(): Promise<void>
  wait(): Promise<number>
  poll(): Promise<number | null>
}
```

## Error Handling

```typescript
try {
  const sandbox = await modalComProvider.createSandbox({
    image: 'python:3.13-slim',
  });
} catch (error: any) {
  if (error.message.includes('credentials')) {
    console.error('API credentials not configured');
  } else if (error.message.includes('quota')) {
    console.error('Modal quota exceeded');
  } else {
    console.error('Sandbox creation failed:', error.message);
  }
}
```

## Best Practices

1. **Set Timeouts**: Always configure `timeout` to prevent runaway sandboxes
2. **Use Persistent Volumes**: For data that needs to survive sandbox termination
3. **Clean Up**: Call `destroySandbox()` when done to release resources
4. **GPU Efficiency**: Only request GPUs when needed; they're more expensive
5. **Image Caching**: Use custom images with pre-installed dependencies for faster startup

## Troubleshooting

### "API credentials required" Error

Ensure both `MODAL_API_TOKEN` and `MODAL_API_SECRET` are set in your environment.

### "Quota exceeded" Error

Check your Modal dashboard for usage limits. You may need to upgrade your plan.

### Sandbox Creation Timeout

Increase the `timeout` value or check your network connection.

### GPU Not Available

Some GPU types may not be available in all regions. Try a different GPU type or region.

## Testing

Run the integration tests (requires valid credentials):

```bash
pnpm test __tests__/sandbox/modal-com-provider.test.ts
```

Or run without live tests:

```bash
pnpm test __tests__/sandbox/modal-com-provider.test.ts -- --testNamePattern="should return false when credentials are not set"
```

## See Also

- [Modal Documentation](https://modal.com/docs)
- [Modal SDK Reference](https://modal.com/docs/guide/sdk-javascript-go)
- [Sandbox Provider Interface](./sandbox-provider.ts)
- [Daytona Provider](./daytona-provider.ts) - Alternative sandbox provider
