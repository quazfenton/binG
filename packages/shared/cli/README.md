# binG CLI - Agentic Workspace Command Line

> A powerful CLI tool that brings all binG features to your terminal

## Features

- 💬 **Chat with AI Agents** - Interactive conversations with V1 API, V2 OpenCode, or StatefulAgent
- 🏖️ **Sandbox Management** - Create, manage, and destroy sandboxes (Daytona, E2B, Modal.com, etc.)
- 📁 **Filesystem Operations** - Read, write, and list files in your workspace
- 🎨 **Image Generation** - Generate images from text prompts (Mistral, Replicate)
- 🎤 **Voice Features** - Text-to-speech conversion
- 🛠️ **Tool Execution** - Execute tools from Composio, Nango, Arcade, Smithery, MCP
- ⚙️ **Configuration** - Manage providers, models, and settings

## Installation

### From npm (coming soon)

```bash
npm install -g @bing/cli
```

### From Source

```bash
# Clone the repository
cd binG/cli

# Install dependencies
npm install

# Link globally
npm link
```

## Quick Start

### 1. Authenticate

```bash
bing login
```

Or use API key:

```bash
export BING_API_KEY="your-api-key"
```

### 2. Configure

```bash
# Set default provider and model
bing config --provider openai --model gpt-4

# Set sandbox provider
bing config --sandbox modal-com
```

### 3. Start Chatting

```bash
# Interactive chat
bing chat

# Quick question
bing ask "Explain quantum computing"
```

## Commands

### Chat Commands

#### `bing chat` - Interactive Chat

Start an interactive chat session with AI agents.

```bash
# Start chat with default settings
bing chat

# Use specific agent mode
bing chat --agent v2

# Disable streaming
bing chat --no-stream

# Use specific provider
bing chat --provider anthropic --model claude-3-5-sonnet
```

**Options:**
- `-a, --agent <mode>` - Agent mode: v1, v2, auto (default: auto)
- `-s, --stream` - Enable streaming (default: true)
- `-p, --provider <provider>` - LLM provider
- `-m, --model <model>` - Model name

**Interactive Commands:**
- `exit` or `quit` - End conversation
- `clear` - Clear history
- `help` - Show help
- `config` - Show configuration

#### `bing ask <message>` - Quick Question

Ask a single question and get a response.

```bash
bing ask "What is the capital of France?"
bing ask "How do I install Python?" --provider google
```

### Sandbox Commands

#### `bing sandbox:create` - Create Sandbox

Create a new sandbox workspace.

```bash
# Create with defaults
bing sandbox:create

# Create with GPU
bing sandbox:create --gpu H100 --cpu 4 --memory 8192

# Use specific provider
bing sandbox:create --provider e2b --image python:3.13
```

**Options:**
- `-p, --provider <provider>` - Sandbox provider
- `-i, --image <image>` - Base image (default: python:3.13)
- `--gpu <type>` - GPU type (H100, A100, A10G, T4, L4)
- `--cpu <count>` - Number of CPUs
- `--memory <MB>` - Memory in MB

#### `bing sandbox:exec <command>` - Execute Command

Execute a command in the sandbox.

```bash
# Run Python script
bing sandbox:exec python train.py

# Install packages
bing sandbox:exec pip install torch transformers

# Specify working directory
bing sandbox:exec ls -la --cwd /workspace

# Use specific sandbox
bing sandbox:exec python app.py --sandbox my-sandbox-id
```

**Options:**
- `-s, --sandbox <id>` - Sandbox ID
- `-c, --cwd <path>` - Working directory

#### `bing sandbox:destroy [id]` - Destroy Sandbox

Destroy a sandbox.

```bash
# Destroy current sandbox
bing sandbox:destroy

# Destroy specific sandbox
bing sandbox:destroy my-sandbox-id

# Force destroy without confirmation
bing sandbox:destroy --force
```

**Options:**
- `-f, --force` - Force destroy without confirmation

#### `bing sandbox:list` - List Sandboxes

List all active sandboxes.

```bash
bing sandbox:list
```

### Filesystem Commands

#### `bing file:read <path>` - Read File

Read a file from the workspace.

```bash
bing file:read /workspace/app.py
bing file:read /workspace/config.json --sandbox my-sandbox-id
```

**Options:**
- `-s, --sandbox <id>` - Sandbox ID

#### `bing file:write <path> [content]` - Write File

Write content to a file.

```bash
# Write with content argument
bing file:write /workspace/hello.py "print('Hello, World!')"

# Interactive mode (prompts for content)
bing file:write /workspace/app.py
```

**Options:**
- `-s, --sandbox <id>` - Sandbox ID
- `-f, --force` - Overwrite without confirmation

#### `bing file:list [path]` - List Directory

List directory contents.

```bash
bing file:list
bing file:list /workspace/src
```

**Options:**
- `-s, --sandbox <id>` - Sandbox ID

### Image Generation Commands

#### `bing image:generate <prompt>` - Generate Image

Generate an image from a text prompt.

```bash
# Basic usage
bing image:generate "A cute cat sitting on a laptop"

# Specify provider and quality
bing image:generate "Cyberpunk city at night" --provider replicate --quality ultra

# Set aspect ratio
bing image:generate "Portrait of a robot" --aspect 9:16

# Save to file
bing image:generate "Mountain landscape" --output mountain.png
```

**Options:**
- `-p, --provider <provider>` - Provider (mistral, replicate)
- `-q, --quality <quality>` - Quality (low, medium, high, ultra)
- `-a, --aspect <ratio>` - Aspect ratio (1:1, 16:9, 9:16, 4:3)
- `-o, --output <file>` - Output file path

### Voice Commands

#### `bing tts <text>` - Text to Speech

Convert text to speech.

```bash
# Basic usage
bing tts "Hello, World!"

# Specify voice
bing tts "Welcome to binG" --voice Bruno

# Save to file
bing tts "The quick brown fox" --output speech.mp3
```

**Options:**
- `-v, --voice <voice>` - Voice name
- `-m, --model <model>` - TTS model
- `-o, --output <file>` - Output audio file path

### Tool Commands

#### `bing tools:list` - List Tools

List all available tools.

```bash
bing tools:list
```

#### `bing tools:execute <tool> [args]` - Execute Tool

Execute a tool.

```bash
# Execute with arguments
bing tools:execute github.create_issue "Add new feature" "Description here"

# Execute with JSON
bing tools:execute composio.run_action --json '{"action": "gmail.send_email", "to": "user@example.com"}'
```

**Options:**
- `--json <json>` - Arguments as JSON string

### Configuration Commands

#### `bing config` - Show/Edit Configuration

```bash
# Show current config
bing config

# Set provider
bing config --provider openai

# Set model
bing config --model gpt-4-turbo

# Set sandbox provider
bing config --sandbox modal-com

# Reset to defaults
bing config --reset
```

**Options:**
- `-p, --provider <provider>` - Set default LLM provider
- `-m, --model <model>` - Set default model
- `-s, --sandbox <provider>` - Set default sandbox provider
- `-a, --api <url>` - Set API base URL
- `--reset` - Reset to defaults

#### `bing login` - Authenticate

```bash
# Interactive login
bing login

# With credentials
bing login --email user@example.com --password secret
```

**Options:**
- `--email <email>` - Email address
- `--password <password>` - Password

#### `bing logout` - Logout

```bash
bing logout
```

#### `bing status` - System Status

Show system status and health.

```bash
bing status
```

### Other Commands

#### `bing start` - Start Development Server

```bash
bing start
bing start --port 3001
bing start --ws-port 8081
```

**Options:**
- `-p, --port <port>` - HTTP port (default: 3000)
- `--ws-port <port>` - WebSocket port (default: 8080)

## Configuration

### Environment Variables

```bash
# API Configuration
export BING_API_URL="http://localhost:3000/api"
export BING_API_KEY="your-api-key"

# Default Providers
export DEFAULT_LLM_PROVIDER="mistral"
export DEFAULT_MODEL="mistral-large-latest"
export SANDBOX_PROVIDER="daytona"

# Provider API Keys
export MODAL_API_TOKEN="your-modal-token"
export DAYTONA_API_KEY="your-daytona-key"
export E2B_API_KEY="your-e2b-key"
```

### Config File

Location: `~/.bing-cli/config.json`

```json
{
  "apiBase": "http://localhost:3000/api",
  "provider": "mistral",
  "model": "mistral-large-latest",
  "sandboxProvider": "daytona",
  "currentSandbox": "sandbox-123"
}
```

### Auth File

Location: `~/.bing-cli/auth.json` (permissions: 600)

```json
{
  "token": "jwt-token-here",
  "userId": "user-123",
  "email": "user@example.com"
}
```

## Examples

### Complete Workflow

```bash
# 1. Login
bing login

# 2. Create GPU sandbox
bing sandbox:create --gpu H100 --cpu 8 --memory 32768

# 3. Install dependencies
bing sandbox:exec pip install torch transformers accelerate

# 4. Write training script
bing file:write /workspace/train.py "
from transformers import AutoModel

model = AutoModel.from_pretrained('bert-base-uncased')
print('Model loaded successfully!')
"

# 5. Run training
bing sandbox:exec python /workspace/train.py

# 6. Ask a question about the output
bing ask "Explain what this model does"

# 7. Generate visualization
bing image:generate "Neural network architecture diagram" --output architecture.png

# 8. Clean up
bing sandbox:destroy
```

### Interactive Development

```bash
# Start chat session
bing chat --agent v2

# In chat:
# > Create a FastAPI app with endpoints
# > Add database models
# > Write tests
# > Run the tests
# > Fix any failures

# Exit chat
> exit
```

### Tool Automation

```bash
# List available GitHub tools
bing tools:list | grep github

# Create GitHub issue
bing tools:execute github.create_issue \
  --json '{"title": "Bug: Login fails", "body": "Steps to reproduce..."}'

# Execute MCP tool
bing tools:execute mcp.call_tool \
  --json '{"server": "github", "tool": "list_issues", "args": {}}'
```

## Troubleshooting

### Authentication Issues

```bash
# Check if logged in
bing status

# Re-login
bing logout
bing login
```

### Sandbox Creation Fails

```bash
# Check provider configuration
bing config

# Verify API keys are set
echo $DAYTONA_API_KEY
echo $MODAL_API_TOKEN

# Try different provider
bing sandbox:create --provider e2b
```

### API Connection Errors

```bash
# Check API URL
bing config --api http://localhost:3000/api

# Verify server is running
curl http://localhost:3000/api/health
```

## Advanced Usage

### Scripting

```bash
#!/bin/bash

# Create sandbox
SANDBOX_ID=$(bing sandbox:create --json | jq -r '.sandboxId')

# Execute commands
bing sandbox:exec --sandbox $SANDBOX_ID "pip install -r requirements.txt"
bing sandbox:exec --sandbox $SANDBOX_ID "python train.py"

# Cleanup
bing sandbox:destroy $SANDBOX_ID
```

### WebSocket Terminal (coming soon)

```bash
# Connect to interactive terminal
bing sandbox:terminal --sandbox my-sandbox-id
```

### File Sync (coming soon)

```bash
# Sync local directory to sandbox
bing sync ./my-project --sandbox my-sandbox-id
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## License

MIT License - see [LICENSE](../LICENSE) for details.

## Support

- **Documentation**: https://github.com/quazfenton/binG/tree/main/docs
- **Issues**: https://github.com/quazfenton/binG/issues
- **Discussions**: https://github.com/quazfenton/binG/discussions
