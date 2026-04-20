---
id: zeroboot-integration-guide
title: Zeroboot Integration Guide
aliases:
  - zeroboot-integration
  - zeroboot-integration.md
tags:
  - guide
layer: core
summary: "# Zeroboot Integration Guide\r\n\r\n## Overview\r\n\r\n**Zeroboot** provides sub-millisecond VM sandboxes for AI agents using KVM copy-on-write forking. It offers hardware-enforced memory isolation with ~0.79ms spawn latency.\r\n\r\nThis integration adds Zeroboot as an **optional sandbox provider** for hardware"
anchors:
  - Overview
  - 'Architecture: Hybrid Sandbox Model'
  - Key Characteristics
  - Zeroboot (KVM-based)
  - 'Docker Sandboxes (microsandbox, Daytona, etc.)'
  - Installation
  - Prerequisites
  - Docker Compose Setup
  - Managed API (Alternative)
  - Usage
  - 'Execution Policy: `isolated-code-exec`'
  - Risk Levels
  - Detected 'KVM' Risk Patterns
  - Direct API Usage
  - Provider Router Integration
  - Hybrid Architecture Patterns
  - 'Pattern 1: Tool Commands → Docker, Code Exec → Zeroboot'
  - 'Pattern 2: Development Workflow'
  - Configuration Reference
  - Environment Variables
  - Docker Compose Service
  - Limitations
  - What Zeroboot CANNOT Do
  - When NOT to Use Zeroboot
  - Templates
  - Creating a Custom Template
  - Available Templates
  - Troubleshooting
  - '"KVM not available" Error'
  - '"Template not found" Error'
  - High Latency
  - Security Considerations
  - Zeroboot Security Model
  - Docker Security Model
  - Best Practices
  - Performance Benchmarks
  - Migration Guide
  - From Existing Sandbox Providers
  - Resources
  - Summary
relations:
  - type: example-of
    id: trigger-dev-integration-guide
    title: Trigger.dev Integration Guide
    path: trigger-dev-integration-guide.md
    confidence: 0.33
    classified_score: 0.429
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: zo-ai-integration-guide
    title: Zo AI Integration Guide
    path: zo-ai-integration-guide.md
    confidence: 0.329
    classified_score: 0.439
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: mcp-integration-guide
    title: MCP Integration Guide
    path: mcp-integration-guide.md
    confidence: 0.308
    classified_score: 0.412
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: figma-integration-guide
    title: Figma Integration Guide
    path: figma-integration-guide.md
    confidence: 0.308
    classified_score: 0.412
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: websocket-terminal-integration-guide
    title: WebSocket Terminal Integration Guide
    path: websocket-terminal-integration-guide.md
    confidence: 0.307
    classified_score: 0.4
    auto_generated: true
    generator: apply-classified-suggestions
---
# Zeroboot Integration Guide

## Overview

**Zeroboot** provides sub-millisecond VM sandboxes for AI agents using KVM copy-on-write forking. It offers hardware-enforced memory isolation with ~0.79ms spawn latency.

This integration adds Zeroboot as an **optional sandbox provider** for hardware-isolated code execution, designed to work alongside existing Docker-based sandboxes (microsandbox, Daytona, etc.) in a **hybrid architecture**.

---

## Architecture: Hybrid Sandbox Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    Agent / OpenCode Engine                      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Sandbox Orchestrator                          │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              Execution Policy Engine                      │ │
│  │                                                           │ │
│  │  eval(), vm.run() ──────► Zeroboot (KVM isolation)       │ │
│  │  npm install ───────────► Docker (network allowed)       │ │
│  │  git clone ─────────────► Docker (network allowed)       │ │
│  │  npm run dev ───────────► Docker (persistent)            │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
              ▼                                       ▼
┌──────────────────────────┐            ┌──────────────────────────┐
│   Docker Sandbox Pool    │            │   Zeroboot Host          │
│   (Tool Execution)       │            │   (Code Execution)       │
├──────────────────────────┤            ├──────────────────────────┤
│ ✅ npm install           │            │ ❌ No network             │
│ ✅ pip install           │            │ ✅ Hardware isolation     │
│ ✅ git clone             │            │ ✅ ~0.8ms spawn           │
│ ✅ docker build          │            │ ✅ Untrusted code safe    │
│ ✅ apt install           │            │ ❌ No runtime installs    │
│ ⚠️ Process isolation     │            │ ✅ KVM isolation          │
└──────────────────────────┘            └──────────────────────────┘
```

---

## Key Characteristics

### Zeroboot (KVM-based)
| Feature | Description |
|---------|-------------|
| **Isolation** | Hardware-level (KVM) |
| **Spawn Time** | ~0.8ms |
| **Network** | ❌ None (serial I/O only) |
| **Package Install** | Pre-baked templates only |
| **Best For** | `eval()`, untrusted code, security-critical |
| **Host Requirement** | Linux with KVM (`/dev/kvm`) |

### Docker Sandboxes (microsandbox, Daytona, etc.)
| Feature | Description |
|---------|-------------|
| **Isolation** | Process-level (containers) |
| **Spawn Time** | ~10-30s (cold) |
| **Network** | ✅ Full network access |
| **Package Install** | Runtime (`npm install`, etc.) |
| **Best For** | Tool commands, builds, dev servers |
| **Host Requirement** | Any Docker host |

---

## Installation

### Prerequisites

**Zeroboot requires:**
- Linux host with KVM enabled (`/dev/kvm`)
- Hardware virtualization support (Intel VT-x / AMD-V)
- Cannot run on Windows/macOS without WSL2 + nested virtualization

**Check KVM availability:**
```bash
# Check CPU virtualization flags
grep -E 'vmx|svm' /proc/cpuinfo
# vmx = Intel VT-x, svm = AMD-V

# Check if KVM modules are loaded
lsmod | grep kvm

# Check if /dev/kvm exists
ls -la /dev/kvm
```

### Docker Compose Setup

1. **Enable Zeroboot profile** (Linux hosts only):
```bash
docker compose --profile zeroboot up -d
```

2. **Configure environment variables** in `.env`:
```bash
# Zeroboot configuration
ZERObOOT_BASE_URL=http://zeroboot:8080
ZERObOOT_API_KEY=your_api_key_here  # Optional for self-hosted
ZERObOOT_TEMPLATE=node20            # Pre-baked runtime template
```

3. **Verify Zeroboot is running**:
```bash
curl http://localhost:8080/health
```

### Managed API (Alternative)

For development on Windows/macOS or without KVM:

```bash
# Use Zeroboot managed API
ZERObOOT_BASE_URL=https://api.zeroboot.dev/v1
ZERObOOT_API_KEY=zb_live_your_api_key
```

---

## Usage

### Execution Policy: `isolated-code-exec`

The new `isolated-code-exec` policy automatically routes highest-risk code to Zeroboot via the **'kvm' risk level**:

```typescript
import { assessRisk, determineExecutionPolicy } from '@/lib/sandbox/types'

// Automatically detected patterns (severity 96-100 = 'kvm' risk level):
const risk = assessRisk('eval(userInput)')
// → level: 'kvm', score: 98, policy: 'isolated-code-exec'

const policy = determineExecutionPolicy({
  task: 'run untrusted code',  // → 'isolated-code-exec'
})
```

### Risk Levels

| Level | Score | Policy | Use Case |
|-------|-------|--------|----------|
| `safe` | 0-20 | `local-safe` | Simple prompts, read-only |
| `low` | 21-40 | `sandbox-preferred` | Moderate risk |
| `medium` | 41-60 | `sandbox-required` | Code execution, bash |
| `high` | 61-80 | `sandbox-heavy` | Full-stack apps, builds |
| `critical` | 81-95 | `cloud-sandbox` | High-resource tasks |
| `kvm` | 96-100 | `isolated-code-exec` | **Untrusted code (Zeroboot)** |

### Detected 'KVM' Risk Patterns

The following patterns trigger 'kvm' risk level → Zeroboot:

```typescript
eval(...)              // severity: 98
Function(...)          // severity: 98
vm.runInNewContext(...) // severity: 99
vm.runInThisContext(...) // severity: 99
__import__('os').system(...) // severity: 97
os.system(...)         // severity: 97
/untrusted|user.*input|sandbox.*exec/i // severity: 96
```

### Direct API Usage

```typescript
import { ZerobootProvider, executeInZeroboot } from '@/lib/sandbox/providers/zeroboot-provider'

// Option 1: Quick execution
const result = await executeInZeroboot('print("Hello from KVM!")', {
  runtime: 'python',
  timeout: 5000,
})

// Option 2: Provider instance
const provider = new ZerobootProvider({
  baseUrl: process.env.ZERObOOT_BASE_URL,
  apiKey: process.env.ZERObOOT_API_KEY,
  defaultRuntime: 'node',
})

const handle = await provider.createSandbox({})
const result = await provider.executeCode('console.log("Hello!")')
```

### Provider Router Integration

Zeroboot is automatically selected by the provider router for:
- `code-interpreter` tasks with isolated code patterns
- `isolated-code-exec` execution policy
- Tasks requiring hardware isolation

```typescript
import { providerRouter } from '@/lib/sandbox/provider-router'

const provider = await providerRouter.selectOptimalProvider({
  type: 'code-interpreter',
  // Zeroboot selected for eval()/untrusted code
})
```

---

## Hybrid Architecture Patterns

### Pattern 1: Tool Commands → Docker, Code Exec → Zeroboot

```typescript
// Package install (needs network) → Docker
await orchestrator.execute({
  command: 'npm install express',
  policy: 'sandbox-preferred',  // → microsandbox/Daytona
})

// Untrusted code execution → Zeroboot
await orchestrator.execute({
  command: 'eval(userInput)',
  policy: 'isolated-code-exec',  // → Zeroboot
})
```

### Pattern 2: Development Workflow

```typescript
// 1. Install dependencies (Docker - has network)
await sandbox.executeCommand('npm install')

// 2. Run untrusted test code (Zeroboot - hardware isolation)
await zeroboot.executeCode(`
  const result = eval(userProvidedCode);
  console.log(result);
`);

// 3. Start dev server (Docker - persistent, network)
await sandbox.executeCommand('npm run dev', { persistent: true });
```

---

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ZERObOOT_BASE_URL` | Zeroboot API base URL | `http://localhost:8080` |
| `ZERObOOT_API_KEY` | API key (optional for self-hosted) | - |
| `ZERObOOT_TEMPLATE` | Pre-baked template ID | `node20` |
| `ZERObOOT_TIMEOUT` | Default execution timeout (ms) | `5000` |

### Docker Compose Service

```yaml
zeroboot:
  image: ghcr.io/zerobootdev/zeroboot:latest
  container_name: bing-zeroboot
  ports:
    - "8080:8080"
  environment:
    - ZERObOOT_PORT=8080
    - ZERObOOT_API_KEY=${ZERObOOT_API_KEY:-}
    - ZERObOOT_TEMPLATE=${ZERObOOT_TEMPLATE:-node20}
  volumes:
    - zeroboot-templates:/zeroboot/templates
  devices:
    - /dev/kvm:/dev/kvm
  profiles:
    - zeroboot
```

---

## Limitations

### What Zeroboot CANNOT Do

| Limitation | Workaround |
|------------|------------|
| ❌ No network inside sandboxes | Use Docker sandboxes for `npm install`, `git clone`, etc. |
| ❌ No runtime package installs | Pre-bake dependencies into templates |
| ❌ No shell commands | Use Docker sandboxes for bash/terminal |
| ❌ No file writes/reads | Files must be in template snapshot |
| ❌ No PTY/terminal | Use Docker sandboxes for interactive sessions |
| ❌ Linux + KVM only | Use managed API on Windows/macOS |

### When NOT to Use Zeroboot

```typescript
// ❌ WRONG: Package installation (needs network)
await zeroboot.executeCode('npm install express')  // Will fail!

// ❌ WRONG: Shell commands
await zeroboot.executeCommand('ls -la')  // Not supported!

// ✅ CORRECT: Pure code execution
await zeroboot.executeCode('console.log(eval(userInput))')  // Perfect!
```

---

## Templates

Zeroboot uses **pre-baked templates** for fast forking. Templates must include all dependencies.

### Creating a Custom Template

```bash
# 1. Create template VM with dependencies
firecracker --create-template \
  --runtime node20 \
  --install "npm install express lodash"

# 2. Snapshot the template
zeroboot template snapshot --name my-node-template

# 3. Use in execution
await zeroboot.executeCode(code, {
  templateId: 'my-node-template'
})
```

### Available Templates

| Template | Includes | Size |
|----------|----------|------|
| `node20` | Node.js 20, npm, common packages | ~200MB |
| `python311` | Python 3.11, pip, numpy, pandas | ~500MB |
| `fullstack` | Node + Python + build tools | ~1GB |

---

## Troubleshooting

### "KVM not available" Error

```bash
# Check if KVM is enabled
ls -la /dev/kvm

# Load KVM modules (Intel)
sudo modprobe kvm_intel
sudo modprobe kvm

# Load KVM modules (AMD)
sudo modprobe kvm_amd
sudo modprobe kvm

# Verify
lsmod | grep kvm
```

### "Template not found" Error

```bash
# List available templates
curl http://localhost:8080/templates

# Create default template
zeroboot template create --runtime node20
```

### High Latency

```bash
# Check Zeroboot health
curl http://localhost:8080/health

# Check system resources
free -h
top
```

---

## Security Considerations

### Zeroboot Security Model

- ✅ **Hardware isolation** via KVM (VM escape extremely difficult)
- ✅ **Ephemeral sandboxes** (auto-terminate after execution)
- ✅ **No network** (no data exfiltration possible)
- ✅ **Read-only filesystem** (no host modification)

### Docker Security Model

- ⚠️ **Process isolation** (container escape possible)
- ⚠️ **Network access** (can be restricted with policies)
- ⚠️ **Writable filesystem** (can be made read-only)

### Best Practices

```typescript
// ✅ Use Zeroboot for untrusted code
await zeroboot.executeCode(eval(userInput))

// ✅ Use Docker with restrictions for tools
await dockerSandbox.executeCommand('npm install', {
  networkPolicy: 'npm-registry-only',
})

// ❌ Never run untrusted code in Docker
await dockerSandbox.executeCode(eval(userInput))  // Risky!
```

---

## Performance Benchmarks

| Metric | Zeroboot | Docker (microsandbox) |
|--------|----------|----------------------|
| Spawn time | ~0.8ms | ~10-30s |
| Code execution | ~50ms | ~100ms |
| Memory per sandbox | ~64MB | ~256MB |
| Cold start | ~15s (template) | ~10s |
| Warm start | ~0.8ms | ~300ms (warm pool) |

---

## Migration Guide

### From Existing Sandbox Providers

```typescript
// Before: Using microsandbox for everything
const sandbox = await getSandboxProvider('microsandbox')
await sandbox.executeCommand('npm install')
await sandbox.executeCode('eval(code)')

// After: Hybrid approach
const dockerSandbox = await getSandboxProvider('microsandbox')
const zerobootSandbox = await getSandboxProvider('zeroboot')

// Tools → Docker
await dockerSandbox.executeCommand('npm install')

// Untrusted code → Zeroboot
await zerobootSandbox.executeCode('eval(code)')
```

---

## Resources

- [Zeroboot GitHub](https://github.com/zerobootdev/zeroboot)
- [Zeroboot API Docs](https://api.zeroboot.dev/docs)
- [KVM Documentation](https://www.linux-kvm.org/page/Main_Page)
- [binG Architecture Update](./architectureUpdate.md)

---

## Summary

**Zeroboot is an optional provider** for hardware-isolated code execution, designed to complement (not replace) existing Docker-based sandboxes.

**Use Zeroboot when:**
- Executing untrusted code (`eval()`, user input)
- Need hardware-level isolation
- Require sub-millisecond spawn times

**Use Docker sandboxes when:**
- Running tool commands (`npm install`, `git clone`)
- Need network access
- Running dev servers or persistent services

**Hybrid is best:** Use both for optimal security and flexibility.
