---
id: modal-com-integration
title: Modal.com Integration
aliases:
  - modal-com-integration
  - modal-com-integration.md
tags: []
layer: core
summary: "# Modal.com Integration\r\n\r\n## Overview\r\n\r\n[Modal.com](https://modal.com) is a serverless container platform that provides:\r\n- **Sub-second cold starts** for Python workloads\r\n- **GPU support** (H100, A100, A10G, T4, L4, A10)\r\n- **Live tunnels** with automatic TLS for port forwarding\r\n- **Custom imag"
anchors:
  - Overview
  - Configuration
  - Environment Variables
  - Getting Your Modal API Token
  - Usage
  - Basic Usage
  - With Python Packages
  - Port Forwarding with Tunnels
  - Interactive Terminal (PTY)
  - With Volumes (Persistent Storage)
  - With Secrets
  - GPU Workloads
  - Provider Selection
  - Advanced Features
  - Image Building
  - Unencrypted TCP Tunnels
  - Sandbox Lifecycle
  - Pricing
  - Comparison with Other Providers
  - Troubleshooting
  - API Token Errors
  - Sandbox Creation Fails
  - Tunnel Not Accessible
  - Best Practices
  - API Reference
  - ModalComProvider
  - ModalComSandboxHandle
  - Related Documentation
---
# Modal.com Integration

## Overview

[Modal.com](https://modal.com) is a serverless container platform that provides:
- **Sub-second cold starts** for Python workloads
- **GPU support** (H100, A100, A10G, T4, L4, A10)
- **Live tunnels** with automatic TLS for port forwarding
- **Custom images** with uv/pip/apt package installation
- **Persistent volumes** for storage
- **Secret management** for API keys and credentials
- **Interactive PTY** support for terminals

## Configuration

### Environment Variables

Add these to your `.env.local`:

```env
# Modal.com API Configuration
MODAL_API_TOKEN=your_modal_api_token_here
MODAL_WORKSPACE_ID=your_workspace_id  # Optional, defaults to primary workspace
```

### Getting Your Modal API Token

1. Sign up at [modal.com](https://modal.com)
2. Go to **Settings** → **API Keys**
3. Click **Create New Token**
4. Copy the token and add it to `.env.local`

## Usage

### Basic Usage

```typescript
import { createModalComProvider } from '@/lib/sandbox/providers'

// Initialize provider
const provider = createModalComProvider()

// Create sandbox with GPU
const sandbox = await provider.createSandbox({
  image: 'python:3.13',
  gpu: 'H100',
  cpu: 2,
  memory: 4096,
  timeout: 600,
})

// Execute commands
const result = await sandbox.executeCommand('python --version')
console.log(result.output) // Python 3.13.x
```

### With Python Packages

```typescript
const sandbox = await provider.createSandbox({
  image: 'python:3.13',
  pythonPackages: ['torch', 'transformers', 'pandas'],
  aptPackages: ['git', 'curl'],
  cpu: 4,
  memory: 8192,
})

await sandbox.executeCommand('python -c "import torch; print(torch.__version__)"')
```

### Port Forwarding with Tunnels

```typescript
// Start a web server
await sandbox.executeCommand('python -m http.server 8000')

// Get public URL
const preview = await sandbox.getPreviewLink(8000)
console.log(preview.url) // https://xxxxx.r5.modal.host
```

### Interactive Terminal (PTY)

```typescript
const pty = await sandbox.createPty({
  id: 'terminal-1',
  cwd: '/root',
  cols: 80,
  rows: 24,
  onData: (data) => {
    // Handle terminal output
    terminal.write(data)
  },
})

// Send commands
await pty.sendInput('ls -la\n')
await pty.sendInput('cd /root/project\n')

// Resize terminal
await pty.resize(120, 40)
```

### With Volumes (Persistent Storage)

```typescript
const sandbox = await provider.createSandbox({
  image: 'python:3.13',
  volumes: [
    {
      name: 'my-data',
      mountPath: '/data',
      mode: 'rw',
    },
  ],
})

// Files in /data persist across sandbox restarts
await sandbox.writeFile('/data/test.txt', 'Hello Modal!')
```

### With Secrets

```typescript
const sandbox = await provider.createSandbox({
  image: 'python:3.13',
  secrets: ['huggingface-secret', 'openai-secret'],
  envVars: {
    MODEL_NAME: 'gpt-4',
  },
})

// Secrets are available as environment variables in the container
await sandbox.executeCommand('echo $HF_TOKEN')
```

### GPU Workloads

```typescript
// ML Training with H100
const sandbox = await provider.createSandbox({
  image: 'python:3.13',
  gpu: 'H100',
  cpu: 8,
  memory: 32768,
  pythonPackages: ['torch', 'transformers', 'accelerate'],
})

await sandbox.executeCommand(`
  python -c "
  import torch
  print(f'CUDA available: {torch.cuda.is_available()}')
  print(f'GPU: {torch.cuda.get_device_name(0)}')
  "
`)
```

## Provider Selection

Modal.com is automatically selected for these task types:

```typescript
import { selectOptimalProvider } from '@/lib/sandbox/provider-router'

// GPU workloads
const provider = await selectOptimalProvider({
  type: 'ml-training',
  requiresGPU: true,
})
// Returns: 'modal-com'

// Agent execution
const provider = await selectOptimalProvider({
  type: 'agent',
  duration: 'medium',
})
// Returns: 'modal-com'

// Full-stack apps
const provider = await selectOptimalProvider({
  type: 'fullstack-app',
  requiresBackend: true,
})
// Returns: 'modal-com' or 'daytona'
```

## Advanced Features

### Image Building

Modal.com supports custom image definitions:

```typescript
const sandbox = await provider.createSandbox({
  dockerImage: 'my-registry/my-image:latest',
  // Or build from base
  image: 'python:3.13',
  pythonPackages: ['torch'],
  aptPackages: ['git'],
  forceBuild: true, // Force rebuild
})
```

### Unencrypted TCP Tunnels

For protocols like SSH:

```typescript
const handle = await sandbox.createPty({ ... })
// Access tunnel info
const tunnel = sandbox.getTunnel(22)
if (tunnel) {
  console.log(tunnel.tcpSocket) // For unencrypted tunnels
}
```

### Sandbox Lifecycle

```typescript
// Create
const sandbox = await provider.createSandbox({ ... })

// Use
await sandbox.executeCommand('...')

// Destroy (cleanup)
await provider.destroySandbox(sandbox.id)
```

## Pricing

Modal.com charges based on:
- **CPU time**: $0.01 per CPU-hour
- **GPU time**: Varies by GPU type (H100: ~$2/hour)
- **Memory**: $0.0005 per GB-hour
- **Storage**: $0.10 per GB-month (volumes)

**Example Cost**: Running a Jupyter notebook for 1 hour with 0.01 CPUs, then using 16 CPUs for 1 minute:
- Idle: 0.01 CPU × 1 hour = 0.01 CPU-hours
- Active: 16 CPU × (1/60) hour = 0.27 CPU-hours
- **Total**: 0.28 CPU-hours ≈ $0.003

## Comparison with Other Providers

| Feature | Modal.com | Daytona | E2B | Sprites |
|---------|-----------|---------|-----|---------|
| Cold Start | <1s | 5-10s | 2-5s | 3-8s |
| GPU Support | ✅ (All) | ✅ (Limited) | ✅ (Limited) | ❌ |
| Tunnels | ✅ (Auto TLS) | ✅ | ✅ | ✅ |
| Volumes | ✅ | ✅ | ✅ | ✅ |
| PTY | ✅ | ✅ | ✅ | ✅ |
| Serverless | ✅ | ❌ | ❌ | ❌ |
| Priority | 3 | 1 | 2 | 6 |

## Troubleshooting

### API Token Errors

```
Error: Modal.com API token not provided
```

**Solution**: Set `MODAL_API_TOKEN` in `.env.local`

### Sandbox Creation Fails

```
Error: Failed to initialize Modal.com sandbox
```

**Solutions**:
1. Check API token is valid
2. Verify workspace has quota
3. Check Modal.com service status

### Tunnel Not Accessible

```
Error: Tunnel connection failed
```

**Solutions**:
1. Ensure server is running on the port
2. Check firewall settings
3. Verify tunnel was created: `sandbox.getTunnel(port)`

## Best Practices

1. **Pin Dependencies**: Use exact versions for reproducibility
   ```typescript
   pythonPackages: ['torch==2.8.0', 'transformers==4.40.0']
   ```

2. **Use Volumes for Large Files**: Avoid rebundling data
   ```typescript
   volumes: [{ name: 'models', mountPath: '/models' }]
   ```

3. **Clean Up Sandboxes**: Destroy when done to avoid charges
   ```typescript
   await provider.destroySandbox(sandbox.id)
   ```

4. **Monitor Usage**: Check Modal dashboard for costs

5. **Use Appropriate GPU**: Match GPU to workload
   - H100: Training large models
   - A100: General ML workloads
   - T4/L4: Inference, light training

## API Reference

### ModalComProvider

```typescript
class ModalComProvider implements SandboxProvider {
  readonly name = 'modal-com'
  
  initialize(apiToken?: string): void
  createSandbox(config: ModalComConfig): Promise<ModalComSandboxHandle>
  getSandbox(sandboxId: string): Promise<ModalComSandboxHandle>
  destroySandbox(sandboxId: string): Promise<void>
  getActiveSandboxes(): ModalComSandboxHandle[]
}
```

### ModalComSandboxHandle

```typescript
class ModalComSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = '/root'
  
  executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult>
  writeFile(filePath: string, content: string): Promise<ToolResult>
  readFile(filePath: string): Promise<ToolResult>
  listDirectory(dirPath: string): Promise<ToolResult>
  getPreviewLink(port: number): Promise<PreviewInfo>
  createPty(options: PtyOptions): Promise<PtyHandle>
  connectPty(sessionId: string, options: PtyConnectOptions): Promise<PtyHandle>
  killPty(sessionId: string): Promise<void>
  resizePty(sessionId: string, cols: number, rows: number): Promise<void>
  
  // Modal.com specific
  getTunnel(port: number): ModalTunnelInfo | undefined
  getTunnels(): ModalTunnelInfo[]
  closeTunnel(port: number): Promise<void>
  getSandboxData(): ModalSandboxData | undefined
}
```

## Related Documentation

- [Modal.com Docs](https://modal.com/docs)
- [Sandbox Providers Overview](./sandbox-providers.md)
- [Provider Router](./provider-router.md)
- [GPU Workloads](./gpu-workloads.md)
