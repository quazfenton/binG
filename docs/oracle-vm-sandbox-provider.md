---
id: oracle-vm-sandbox-provider
title: Oracle VM Sandbox Provider
aliases:
  - ORACLE_VM_PROVIDER
  - ORACLE_VM_PROVIDER.md
  - oracle-vm-sandbox-provider
  - oracle-vm-sandbox-provider.md
tags: []
layer: core
summary: "# Oracle VM Sandbox Provider\r\n\r\nConnect to Oracle Cloud Infrastructure (OCI) VM instances via SSH for sandboxed code execution.\r\n\r\n## Features\r\n\r\n- ✅ **Automatic SSH Connection** - Manages SSH sessions automatically\r\n- ✅ **Session Isolation** - Per-user sandbox isolation\r\n- ✅ **Command Execution** -"
anchors:
  - Features
  - Configuration
  - Environment Variables
  - Settings Panel
  - Usage
  - As Sandbox Provider
  - With Circuit Breaker
  - SSH Key Setup
  - Generate SSH Key (if needed)
  - Add Key to Oracle VM
  - Test Connection
  - Security
  - Troubleshooting
  - Connection Failed
  - Permission Denied
  - Health Check Failed
  - Resource Monitoring
  - 'Example: TypeScript Execution'
  - Architecture
  - Comparison with Other Providers
  - Best Practices
  - Support
---
# Oracle VM Sandbox Provider

Connect to Oracle Cloud Infrastructure (OCI) VM instances via SSH for sandboxed code execution.

## Features

- ✅ **Automatic SSH Connection** - Manages SSH sessions automatically
- ✅ **Session Isolation** - Per-user sandbox isolation
- ✅ **Command Execution** - Run commands with configurable timeout
- ✅ **File Transfer** - Upload/download files via SFTP
- ✅ **Resource Monitoring** - CPU, memory, disk usage tracking
- ✅ **PTY Support** - Interactive terminal sessions
- ✅ **Circuit Breaker** - Automatic failure recovery

## Configuration

### Environment Variables

```bash
# Required
ORACLE_VM_HOST=vm-host.oraclecloud.com    # VM hostname or IP address

# Optional (with defaults)
ORACLE_VM_PORT=22                          # SSH port (default: 22)
ORACLE_VM_USER=opc                         # SSH username (default: opc)
ORACLE_VM_KEY_PATH=~/.ssh/id_rsa          # Path to SSH private key
ORACLE_VM_WORKSPACE=/home/opc/workspace   # Working directory (default)
ORACLE_VM_PRIVATE_KEY="-----BEGIN..."     # Or embed private key directly
```

### Settings Panel

Configure via Settings → Oracle VM Sandbox:
1. **VM Host** - Your Oracle VM hostname or IP
2. **SSH Port** - Usually 22
3. **Username** - Default is `opc` for Oracle Linux
4. **SSH Private Key Path** - Path to your private key
5. **Workspace Directory** - Where code will be executed

## Usage

### As Sandbox Provider

```typescript
import { getSandboxProvider } from '@/lib/sandbox/providers';

// Get Oracle VM provider
const provider = await getSandboxProvider('oracle-vm');

// Create sandbox
const sandbox = await provider.createSandbox({
  language: 'typescript',
  userId: 'user123',
});

// Execute command
const result = await sandbox.executeCommand('node --version');
console.log(result.output); // v20.10.0

// Upload file
await sandbox.uploadFile('/home/opc/workspace/app.ts', code);

// Download file
const content = await sandbox.downloadFile('/home/opc/workspace/app.ts');

// Close sandbox
await sandbox.close();
```

### With Circuit Breaker

```typescript
import { providerCircuitBreakers } from '@/lib/sandbox/providers';

// Check if provider is available
const breaker = providerCircuitBreakers.get('oracle-vm');
if (breaker?.isAvailable()) {
  const provider = await getSandboxProvider('oracle-vm');
  // ... use provider
}
```

## SSH Key Setup

### Generate SSH Key (if needed)

```bash
ssh-keygen -t ed25519 -C "oracle-vm"
```

### Add Key to Oracle VM

```bash
# Copy public key to Oracle VM
ssh-copy-id -i ~/.ssh/id_rsa.pub opc@vm-host.oraclecloud.com

# Or manually add to ~/.ssh/authorized_keys on VM
cat ~/.ssh/id_rsa.pub | ssh opc@vm-host.oraclecloud.com "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

### Test Connection

```bash
ssh -i ~/.ssh/id_rsa opc@vm-host.oraclecloud.com
```

## Security

- ✅ **Key-based Authentication** - No passwords stored
- ✅ **Encrypted Connection** - All traffic via SSH
- ✅ **Session Isolation** - Per-user sandboxes
- ✅ **Command Timeout** - Prevents hanging processes
- ✅ **Resource Limits** - Monitors CPU/memory/disk

## Troubleshooting

### Connection Failed

```bash
# Check SSH connectivity
ssh -v opc@vm-host.oraclecloud.com

# Verify key permissions
chmod 600 ~/.ssh/id_rsa

# Test with explicit key
ssh -i ~/.ssh/id_rsa opc@vm-host.oraclecloud.com
```

### Permission Denied

```bash
# Ensure workspace directory exists
ssh opc@vm-host.oraclecloud.com "mkdir -p /home/opc/workspace"

# Check directory permissions
ssh opc@vm-host.oraclecloud.com "ls -la /home/opc/"
```

### Health Check Failed

Check provider health:

```typescript
const provider = await getSandboxProvider('oracle-vm');
const health = await provider.healthCheck();
console.log(health); // { healthy: true, latency: 45 }
```

## Resource Monitoring

```typescript
const usage = await sandbox.getResourceUsage();
console.log(usage);
// { cpu: 12.5, memory: 2048, disk: 45 }
```

## Example: TypeScript Execution

```typescript
const provider = await getSandboxProvider('oracle-vm');
const sandbox = await provider.createSandbox({ language: 'typescript' });

// Install dependencies
await sandbox.executeCommand('npm init -y');
await sandbox.executeCommand('npm install typescript ts-node');

// Create file
await sandbox.uploadFile('app.ts', `
  console.log('Hello from Oracle VM!');
`);

// Run code
const result = await sandbox.executeCommand('npx ts-node app.ts');
console.log(result.output); // Hello from Oracle VM!

await sandbox.close();
```

## Architecture

```
┌─────────────────┐      SSH       ┌─────────────────────┐
│   binG Server   │ ◄───────────►  │  Oracle Cloud VM    │
│                 │                │                     │
│  SandboxManager │                │  /home/opc/         │
│       │         │                │    workspace/       │
│       ▼         │                │                     │
│  OracleVMProvider               │  CPU/Mem/Disk       │
│       │         │                │  Monitoring         │
│       ▼         │                │                     │
│  SSH Connection │                │  Docker (optional)  │
└─────────────────┘                └─────────────────────┘
```

## Comparison with Other Providers

| Feature | Oracle VM | Daytona | E2B |
|---------|-----------|---------|-----|
| **Infrastructure** | Your VM | Managed | Managed |
| **Cost** | Your OCI costs | Pay-per-use | Pay-per-use |
| **Customization** | Full control | Limited | Limited |
| **Setup** | Manual | Automatic | Automatic |
| **Isolation** | Per-session | Per-workspace | Per-sandbox |
| **Persistence** | Full VM | Optional | Ephemeral |

## Best Practices

1. **Use Dedicated VM** - Don't share with production workloads
2. **Regular Updates** - Keep VM packages updated
3. **Monitor Resources** - Set up OCI monitoring alerts
4. **Backup Workspace** - Use OCI block volume backups
5. **Limit SSH Access** - Use security lists to restrict access

## Support

For issues:
1. Check SSH connectivity first
2. Verify environment variables are set
3. Review provider logs: `console.log` output from `OracleVMProvider`
4. Check OCI VM status in Oracle Cloud Console
