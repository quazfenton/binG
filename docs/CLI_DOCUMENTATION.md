# binG CLI - Comprehensive Documentation

## Table of Contents

1. [Overview](#overview)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Authentication](#authentication)
5. [Configuration](#configuration)
6. [Command Reference](#command-reference)
7. [Examples](#examples)
8. [Troubleshooting](#troubleshooting)
9. [API Reference](#api-reference)

---

## Overview

The **binG CLI** is a powerful command-line interface that provides access to all binG workspace features directly from your terminal. It integrates:

- **AI Agents**: Chat with V1 API, V2 OpenCode, or StatefulAgent
- **Sandbox Providers**: Daytona, E2B, Modal.com, Sprites, CodeSandbox, and more
- **Filesystem**: Read, write, sync files with version control
- **Media**: Image generation, text-to-speech
- **Tools**: 800+ tools via Composio, Nango, Arcade, Smithery, MCP
- **Workflows**: Mastra and LangGraph orchestration

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     binG CLI                             │
├─────────────────────────────────────────────────────────┤
│  Chat  │ Sandbox │ Files │ Image │ Voice │ Tools │ Config│
├─────────────────────────────────────────────────────────┤
│              REST API Client (Axios)                     │
├─────────────────────────────────────────────────────────┤
│           Authentication & Configuration                 │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                  binG API Server                         │
│  (Next.js API Routes + WebSocket Server)                 │
├─────────────────────────────────────────────────────────┤
│  /api/chat  │ /api/sandbox │ /api/filesystem │ /api/tools│
├─────────────────────────────────────────────────────────┤
│           Orchestra │ Providers │ Services               │
└─────────────────────────────────────────────────────────┘
```

---

## Installation

### Prerequisites

- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **binG Server**: Running locally or accessible via network

### From Source

```bash
# Navigate to CLI directory
cd binG/cli

# Install dependencies
npm install

# Link globally
npm link

# Verify installation
bing --version
```

### Manual Installation

```bash
# Clone repository
git clone https://github.com/quazfenton/binG.git
cd binG/cli

# Install
npm install
npm link
```

### Verify Installation

```bash
# Check version
bing --version

# Show help
bing --help

# Check status
bing status
```

---

## Quick Start

### 1. Start binG Server

```bash
# From binG root directory
pnpm dev
pnpm dev:ws  # In another terminal
```

### 2. Configure CLI

```bash
# Set API URL
bing config --api http://localhost:3000/api

# Set defaults
bing config --provider mistral --model mistral-large-latest
```

### 3. Authenticate

```bash
# Interactive login
bing login

# Or use environment variable
export BING_API_KEY="your-api-key"
```

### 4. Create Sandbox

```bash
# Create with GPU
bing sandbox:create --gpu H100 --cpu 4 --memory 8192
```

### 5. Start Chat

```bash
# Interactive chat
bing chat

# Or ask a question
bing ask "Explain quantum computing"
```

---

## Authentication

### Login Methods

#### Interactive Login

```bash
bing login
```

Prompts for email and password.

#### With Credentials

```bash
bing login --email user@example.com --password secret
```

#### API Key (Environment)

```bash
export BING_API_KEY="your-api-key"
```

### Logout

```bash
bing logout
```

### Auth Storage

- **Location**: `~/.bing-cli/auth.json`
- **Permissions**: 600 (owner read/write only)
- **Contents**: JWT token, user ID, email

### Token Refresh

Tokens are automatically refreshed when expired. Manual refresh:

```bash
bing logout
bing login
```

---

## Configuration

### Config File

**Location**: `~/.bing-cli/config.json`

**Structure**:
```json
{
  "apiBase": "http://localhost:3000/api",
  "provider": "mistral",
  "model": "mistral-large-latest",
  "sandboxProvider": "modal-com",
  "currentSandbox": "modal-com-123456"
}
```

### Environment Variables

```bash
# API Configuration
BING_API_URL=http://localhost:3000/api
BING_API_KEY=your-api-key

# LLM Defaults
DEFAULT_LLM_PROVIDER=mistral
DEFAULT_MODEL=mistral-large-latest

# Sandbox
SANDBOX_PROVIDER=modal-com
MODAL_API_TOKEN=your-modal-token
DAYTONA_API_KEY=your-daytona-key
E2B_API_KEY=your-e2b-key

# Features
ENABLE_IMAGE_GENERATION=true
ENABLE_VOICE_FEATURES=true
```

### Config Commands

```bash
# View config
bing config

# Set provider
bing config --provider openai

# Set model
bing config --model gpt-4-turbo

# Set sandbox
bing config --sandbox modal-com

# Set API URL
bing config --api http://localhost:3001/api

# Reset to defaults
bing config --reset
```

---

## Command Reference

### Chat Commands

#### `bing chat`

Start interactive chat session.

**Syntax**:
```bash
bing chat [options]
```

**Options**:
| Option | Description | Default |
|--------|-------------|---------|
| `-a, --agent <mode>` | Agent mode: v1, v2, auto | auto |
| `-s, --stream` | Enable streaming | true |
| `-p, --provider <provider>` | LLM provider | config |
| `-m, --model <model>` | Model name | config |

**Interactive Commands**:
- `exit` / `quit` - End conversation
- `clear` - Clear history
- `help` - Show help
- `config` - Show configuration

**Examples**:
```bash
# Default chat
bing chat

# V2 agent mode
bing chat --agent v2

# With specific model
bing chat --provider anthropic --model claude-3-5-sonnet
```

#### `bing ask <message>`

Ask a single question.

**Syntax**:
```bash
bing ask <message> [options]
```

**Examples**:
```bash
bing ask "What is TypeScript?"
bing ask "How to install Python?" --provider google
```

### Sandbox Commands

#### `bing sandbox:create`

Create new sandbox workspace.

**Syntax**:
```bash
bing sandbox:create [options]
```

**Options**:
| Option | Description | Default |
|--------|-------------|---------|
| `-p, --provider` | Sandbox provider | config |
| `-i, --image` | Base image | python:3.13 |
| `--gpu` | GPU type | none |
| `--cpu` | CPU count | 1 |
| `--memory` | Memory (MB) | 2048 |

**GPU Types**: H100, A100, A10G, T4, L4, A10

**Examples**:
```bash
# Basic sandbox
bing sandbox:create

# GPU sandbox
bing sandbox:create --gpu H100 --cpu 8 --memory 32768

# Specific provider
bing sandbox:create --provider e2b --image python:3.13
```

#### `bing sandbox:exec <command>`

Execute command in sandbox.

**Syntax**:
```bash
bing sandbox:exec <command...> [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-s, --sandbox <id>` | Sandbox ID |
| `-c, --cwd <path>` | Working directory |

**Examples**:
```bash
# Run Python
bing sandbox:exec python train.py

# Install packages
bing sandbox:exec pip install torch transformers

# With working directory
bing sandbox:exec ls -la --cwd /workspace/src
```

#### `bing sandbox:destroy [id]`

Destroy sandbox.

**Syntax**:
```bash
bing sandbox:destroy [id] [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-f, --force` | Skip confirmation |

**Examples**:
```bash
# Destroy current
bing sandbox:destroy

# Destroy specific
bing sandbox:destroy my-sandbox-id

# Force destroy
bing sandbox:destroy --force
```

#### `bing sandbox:list`

List active sandboxes.

**Syntax**:
```bash
bing sandbox:list
```

### Filesystem Commands

#### `bing file:read <path>`

Read file content.

**Syntax**:
```bash
bing file:read <path> [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-s, --sandbox <id>` | Sandbox ID |

**Examples**:
```bash
bing file:read /workspace/app.py
bing file:read /workspace/config.json --sandbox abc123
```

#### `bing file:write <path> [content]`

Write file content.

**Syntax**:
```bash
bing file:write <path> [content] [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-s, --sandbox <id>` | Sandbox ID |
| `-f, --force` | Skip confirmation |

**Examples**:
```bash
# With content
bing file:write /workspace/hello.py "print('Hello')"

# Interactive mode
bing file:write /workspace/app.py
```

#### `bing file:list [path]`

List directory.

**Syntax**:
```bash
bing file:list [path] [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-s, --sandbox <id>` | Sandbox ID |

**Examples**:
```bash
bing file:list
bing file:list /workspace/src
```

### Image Generation

#### `bing image:generate <prompt>`

Generate image from prompt.

**Syntax**:
```bash
bing image:generate <prompt> [options]
```

**Options**:
| Option | Description | Default |
|--------|-------------|---------|
| `-p, --provider` | Provider (mistral, replicate) | mistral |
| `-q, --quality` | Quality (low, medium, high, ultra) | high |
| `-a, --aspect` | Aspect ratio (1:1, 16:9, 9:16) | 1:1 |
| `-o, --output` | Output file | none |

**Examples**:
```bash
# Basic
bing image:generate "A cute cat"

# High quality
bing image:generate "Cyberpunk city" --quality ultra

# Save to file
bing image:generate "Mountain" --output mountain.png
```

### Voice Commands

#### `bing tts <text>`

Text-to-speech.

**Syntax**:
```bash
bing tts <text> [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `-v, --voice` | Voice name |
| `-m, --model` | TTS model |
| `-o, --output` | Output file |

**Examples**:
```bash
bing tts "Hello World"
bing tts "Welcome" --voice Bruno --output welcome.mp3
```

### Tool Commands

#### `bing tools:list`

List available tools.

```bash
bing tools:list
```

#### `bing tools:execute <tool> [args]`

Execute tool.

**Syntax**:
```bash
bing tools:execute <tool> [args...] [options]
```

**Options**:
| Option | Description |
|--------|-------------|
| `--json <json>` | Arguments as JSON |

**Examples**:
```bash
# With arguments
bing tools:execute github.create_issue "Title" "Body"

# With JSON
bing tools:execute composio.run --json '{"action": "gmail.send"}'
```

### Configuration Commands

#### `bing config`

Show/edit configuration.

```bash
# View
bing config

# Set provider
bing config --provider openai

# Reset
bing config --reset
```

#### `bing login`

Authenticate.

```bash
bing login
bing login --email user@example.com --password secret
```

#### `bing logout`

Logout.

```bash
bing logout
```

#### `bing status`

Show system status.

```bash
bing status
```

---

## Examples

### ML Training Workflow

```bash
# 1. Create GPU sandbox
bing sandbox:create --gpu H100 --cpu 8 --memory 32768

# 2. Install dependencies
bing sandbox:exec pip install torch transformers accelerate

# 3. Write training script
bing file:write /workspace/train.py "
from transformers import AutoModel
model = AutoModel.from_pretrained('bert-base-uncased')
print('Model loaded!')
"

# 4. Run training
bing sandbox:exec python /workspace/train.py

# 5. Ask about results
bing ask "Explain what this model does"

# 6. Generate visualization
bing image:generate "Neural network diagram" --output arch.png

# 7. Cleanup
bing sandbox:destroy
```

### Interactive Development

```bash
# Start chat
bing chat --agent v2

# Conversation:
# > Create a FastAPI app
# > Add database models
# > Write tests
# > Run tests
# > Fix failures
# > exit
```

### Automation Script

```bash
#!/bin/bash

# Create sandbox
SANDBOX=$(bing sandbox:create --json | jq -r '.sandboxId')

# Setup
bing sandbox:exec --sandbox $SANDBOX "pip install -r requirements.txt"
bing sandbox:exec --sandbox $SANDBOX "python train.py"

# Cleanup
bing sandbox:destroy $SANDBOX
```

---

## Troubleshooting

### Authentication Issues

```bash
# Check login status
bing status

# Re-login
bing logout && bing login
```

### Sandbox Creation Fails

```bash
# Check provider config
bing config

# Verify API keys
echo $MODAL_API_TOKEN
echo $DAYTONA_API_KEY

# Try different provider
bing sandbox:create --provider e2b
```

### Connection Errors

```bash
# Check API URL
bing config --api http://localhost:3000/api

# Test connection
curl http://localhost:3000/api/health
```

### Command Execution Fails

```bash
# Verify sandbox exists
bing sandbox:list

# Check sandbox ownership
bing sandbox:exec "whoami" --sandbox <id>
```

---

## API Reference

### Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | Chat completions |
| `/api/sandbox` | POST/DELETE | Sandbox lifecycle |
| `/api/sandbox/execute` | POST | Command execution |
| `/api/sandbox/session` | POST | List sessions |
| `/api/filesystem/read` | POST | Read file |
| `/api/filesystem/write` | POST | Write file |
| `/api/filesystem/list` | POST | List directory |
| `/api/image/generate` | POST | Generate image |
| `/api/tts` | POST | Text-to-speech |
| `/api/tools` | GET | List tools |
| `/api/tools/execute` | POST | Execute tool |
| `/api/auth/login` | POST | Authenticate |
| `/api/health` | GET | Health check |
| `/api/providers` | GET | List providers |

### Request Format

```typescript
interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  provider: string;
  model: string;
  stream?: boolean;
  agentMode?: 'v1' | 'v2' | 'auto';
}

interface SandboxCreateRequest {
  provider: string;
  image?: string;
  gpu?: string;
  cpu?: number;
  memory?: number;
}

interface ExecuteCommandRequest {
  sandboxId: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}
```

### Response Format

```typescript
interface ChatResponse {
  response: string;
  content?: string;
  stream?: boolean;
  metadata?: {
    model?: string;
    provider?: string;
    duration?: number;
  };
}

interface SandboxCreateResponse {
  sessionId: string;
  sandboxId: string;
  provider: string;
  workspacePath?: string;
  status: 'creating' | 'ready';
}

interface ExecuteCommandResponse {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  executionTime?: number;
}
```

---

## Contributing

1. Fork repository
2. Create feature branch (`git checkout -b feature/cli-improvement`)
3. Make changes
4. Run tests (`npm test`)
5. Submit pull request

## License

MIT License - see LICENSE file.

## Support

- **Docs**: https://github.com/quazfenton/binG/tree/main/docs
- **Issues**: https://github.com/quazfenton/binG/issues
- **Discussions**: https://github.com/quazfenton/binG/discussions
