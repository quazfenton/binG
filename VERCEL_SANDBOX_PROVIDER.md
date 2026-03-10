# Vercel Sandbox Provider - Complete Implementation

## Overview

Vercel Sandbox provider provides isolated Linux microVMs for secure code execution with live preview support.

**Official Documentation:**
- [Quickstart](https://vercel.com/docs/vercel-sandbox/quickstart)
- [SDK Reference](https://vercel.com/docs/vercel-sandbox/sdk-reference)
- [Working with Sandbox](https://vercel.com/docs/vercel-sandbox/working-with-sandbox)
- [Snapshots](https://vercel.com/docs/vercel-sandbox/concepts/snapshots)
- [Firewall](https://vercel.com/docs/vercel-sandbox/concepts/firewall)
- [Pricing](https://vercel.com/docs/vercel-sandbox/pricing)

## Installation

```bash
npm install @vercel/sandbox
```

## Configuration

Add to `.env.local`:

```bash
# Authentication (choose one)
VERCEL_TOKEN=your_vercel_access_token_here
# OR
VERCEL_SANDBOX_TOKEN=your_dedicated_sandbox_token_here

# Optional
VERCEL_TEAM_ID=your_team_id_here
VERCEL_SANDBOX_FIREWALL=true
QUOTA_VERCEL_SANDBOX_MONTHLY=1000
```

### Getting a Token

1. Go to https://vercel.com/account/tokens
2. Click "Create Token"
3. Copy token to `.env.local`

**OR** use OIDC when deployed to Vercel:
```bash
vercel link
vercel env pull
```

## Usage

### Basic Usage

```typescript
import { vercelSandboxProvider } from '@/lib/sandbox/providers'

// Create sandbox
const sandbox = await vercelSandboxProvider.createSandbox({
  language: 'typescript',
  resources: { cpu: 2 }
})

// Run command
const result = await sandbox.executeCommand('node', ['--version'])
console.log(result.output) // v22.x.x

// Write file
await sandbox.writeFile('package.json', JSON.stringify({ name: 'my-app' }))

// Read file
const content = await sandbox.readFile('package.json')

// Stop sandbox
await sandbox.stop()
```

### Live Preview Service

```typescript
import { vercelPreviewService } from '@/lib/sandbox/services/vercel-preview-service'

// Start preview (runs dev server and exposes port)
const { url, port, startedAt } = await vercelPreviewService.startPreview({
  sandboxId: sandbox.id,
  port: 3000,
  command: 'npm run dev',
  autoStop: true,
  timeout: 30 * 60 * 1000, // 30 minutes
})

console.log(`Preview available at: ${url}`)

// Extend timeout
await vercelPreviewService.extendPreview(sandbox.id, 60 * 60 * 1000)

// Stop preview
await vercelPreviewService.stopPreview(sandbox.id)
```

### Snapshots

```typescript
// Create snapshot
const snapshot = await sandbox.createSnapshot()
console.log('Snapshot ID:', snapshot.id)

// Later: Create sandbox from snapshot (faster startup)
const restoredSandbox = await vercelSandboxProvider.restoreSnapshot(snapshot.id)

// List snapshots
const snapshots = await vercelSandboxProvider.listSnapshots()

// Delete snapshot
await sandbox.deleteSnapshot(snapshot.id)
```

### Network Firewall

```typescript
// Restrict outbound traffic
await vercelPreviewService.updateNetworkPolicy(sandbox.id, {
  allow: [
    'api.vercel.com',
    'registry.npmjs.org',
    'pypi.org',
  ]
})

// Allow all (default)
await vercelPreviewService.updateNetworkPolicy(sandbox.id, 'allow-all')

// Deny all (isolated)
await vercelPreviewService.updateNetworkPolicy(sandbox.id, 'deny-all')
```

## SDK Methods

### Sandbox Creation

```typescript
const sandbox = await Sandbox.create({
  runtime: 'node22' | 'node24' | 'python3.13',
  resources: { vcpus: 1 | 2 | 4 | 8 },
  timeout: 300000, // ms (default: 5 min, max: 5 hours)
  networkPolicy: 'allow-all' | 'deny-all' | { allow: string[] },
  env: { NODE_ENV: 'production' },
  source: { type: 'snapshot', snapshotId: 'snap_xxx' }, // Optional
})
```

### Command Execution

```typescript
// Simple command
const result = await sandbox.runCommand('npm', ['install'])
console.log(await result.stdout())

// With options
const result = await sandbox.runCommand('python', ['app.py'], {
  cwd: '/vercel/sandbox/workspace',
  env: { PYTHONPATH: '.' },
  detached: false, // Run in background if true
})

// Get output
const stdout = await result.stdout()
const stderr = await result.stderr()
const exitCode = result.exitCode

// Stream logs
for await (const log of result.logs()) {
  if (log.stream === 'stdout') {
    process.stdout.write(log.data)
  }
}
```

### File Operations

```typescript
// Write files
await sandbox.writeFiles([
  { path: 'package.json', content: Buffer.from('{}') },
  { path: 'src/index.ts', content: Buffer.from('console.log("hi")') },
])

// Read file to buffer
const buffer = await sandbox.readFileToBuffer({ path: 'package.json' })

// Read file as stream
const stream = await sandbox.readFile({ path: 'package.json' })

// Download file to local
const localPath = await sandbox.downloadFile(
  { path: 'dist/bundle.js', cwd: '/vercel/sandbox' },
  { path: 'bundle.js', cwd: '/tmp' }
)

// Create directory
await sandbox.mkDir('src/components')
```

### Preview URLs

```typescript
// Start dev server
await sandbox.runCommand('npm', ['run', 'dev'])

// Get preview URL
const previewUrl = sandbox.domain(3000)
console.log('Preview:', previewUrl)
// Output: https://sandbox-xxx-3000.app.vercel-sandbox.dev
```

### Snapshots

```typescript
// Create snapshot
const snapshot = await sandbox.snapshot({
  expiration: 14 * 24 * 60 * 60 * 1000, // 14 days
})

// List snapshots
const { json } = await Snapshot.list({ limit: 50 })
console.log(json.snapshots)

// Get snapshot
const snapshot = await Snapshot.get({ snapshotId: 'snap_xxx' })

// Delete snapshot
await snapshot.delete()

// Create sandbox from snapshot
const sandbox = await Sandbox.create({
  source: { type: 'snapshot', snapshotId: 'snap_xxx' }
})
```

### Lifecycle Management

```typescript
// Extend timeout
await sandbox.extendTimeout(60000) // Add 60 seconds

// Stop sandbox
await sandbox.stop()

// Stop with blocking (wait for completion)
const stoppedSandbox = await sandbox.stop({ blocking: true })

// Get sandbox status
console.log(sandbox.status) // 'running' | 'stopped' | 'failed'

// Get resource usage
console.log('CPU:', sandbox.activeCpuUsageMs, 'ms')
console.log('Network:', sandbox.networkUsage)
```

## Provider Integration

### As Primary Provider

```bash
SANDBOX_PROVIDER=vercel-sandbox
```

### In Fallback Chain

Vercel Sandbox is priority 8 in the fallback chain:
1. daytona
2. e2b
3. runloop
4. microsandbox
5. blaxel
6. sprites
7. codesandbox
8. **vercel-sandbox** ← NEW
9. webcontainer
10. opensandbox
11. e2b
12. mistral

### Health Check

```typescript
import { getSandboxProvider } from '@/lib/sandbox/providers'

const provider = await getSandboxProvider('vercel-sandbox')
const health = await provider.healthCheck()

console.log(health)
// {
//   healthy: true,
//   latency: 150,
//   details: {
//     hasToken: true,
//     runningOnVercel: false,
//     teamId: 'personal'
//   }
// }
```

## System Specifications

| Resource | Default | Maximum |
|----------|---------|---------|
| vCPUs | 2 | 8 |
| Memory | 4 GB | 16 GB |
| Disk | 10 GB | 50 GB |
| Timeout | 5 min | 5 hours* |

*Pro/Enterprise plans only

## Pricing

- **Sandbox Provisioned Memory**: GB-seconds
- **Sandbox Active CPU**: vCPU-seconds
- **Sandbox Data Transfer**: GB
- **Snapshot Storage**: GB-month

See https://vercel.com/docs/vercel-sandbox/pricing for current rates.

## Limitations

- **No PTY**: Interactive terminal sessions not supported
- **Ephemeral FS**: Files lost when sandbox stops (use snapshots)
- **No WebSocket**: Use command-mode or polling for terminal
- **Timeout**: Max 5 minutes on Hobby, 5 hours on Pro/Enterprise

## Troubleshooting

### "@vercel/sandbox not installed"

```bash
npm install @vercel/sandbox
```

### "VERCEL_TOKEN not set"

Add to `.env.local`:
```bash
VERCEL_TOKEN=your_token_here
```

### "Port did not become ready"

Increase timeout:
```typescript
await vercelPreviewService.startPreview({
  port: 3000,
  command: 'npm run dev',
  timeout: 120000, // 2 minutes
})
```

### "Snapshot not found"

Snapshots expire. Check expiration:
```typescript
const snapshot = await Snapshot.get({ snapshotId })
console.log('Expires:', snapshot.expiresAt)
```

## Examples

### React Dev Server

```typescript
const sandbox = await vercelSandboxProvider.createSandbox({
  language: 'typescript',
})

await sandbox.writeFile('package.json', JSON.stringify({
  name: 'react-app',
  scripts: { dev: 'vite' },
  dependencies: { react: '^18', vite: '^5' }
}))

await sandbox.executeCommand('npm', ['install'])

const { url } = await vercelPreviewService.startPreview({
  sandboxId: sandbox.id,
  port: 5173,
  command: 'npm run dev',
})

console.log('React app:', url)
```

### Python API

```typescript
const sandbox = await vercelSandboxProvider.createSandbox({
  language: 'python',
})

await sandbox.writeFile('requirements.txt', 'fastapi\nuvicorn')
await sandbox.writeFile('main.py', '''
from fastapi import FastAPI
app = FastAPI()

@app.get("/")
def read_root():
    return {"Hello": "World"}
''')

await sandbox.executeCommand('pip', ['install', '-r', 'requirements.txt'])

const { url } = await vercelPreviewService.startPreview({
  sandboxId: sandbox.id,
  port: 8000,
  command: 'uvicorn main:app --host 0.0.0.0',
})

console.log('API:', url)
```

### ML Environment with Snapshot

```typescript
// Create base ML environment
const sandbox = await vercelSandboxProvider.createSandbox({
  language: 'python',
})

await sandbox.executeCommand('pip', ['install', 'numpy', 'pandas', 'scikit-learn'])

// Create snapshot for reuse
const snapshot = await sandbox.createSnapshot()
console.log('ML snapshot:', snapshot.id)

// Later: Instant ML environment
const mlSandbox = await vercelSandboxProvider.restoreSnapshot(snapshot.id)
// Ready in ~2 seconds instead of ~30 seconds
```

## Files

- `lib/sandbox/providers/vercel-sandbox-provider.ts` - Provider implementation
- `lib/sandbox/services/vercel-preview-service.ts` - Live preview service
- `lib/sandbox/providers/index.ts` - Provider registration
- `env.example` - Configuration documentation
