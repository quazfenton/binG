# binG MCP Server

[![npm version](https://badge.fury.io/js/@bing%2Fmcp-server.svg)](https://badge.fury.io/js/@bing%2Fmcp-server)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://smithery.ai/server/@quazfenton/binG)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

**binG** is a full-stack agentic AI workspace that combines AI conversation with real code execution, voice interaction, and multi-agent orchestration. The MCP server provides standardized access to binG's capabilities.

## Features

### 🏖️ Sandbox Execution
- **8+ Providers**: Daytona, Blaxel, Runloop, Sprites, E2B, CodeSandbox, Vercel
- **Warm Pool**: Pre-warmed sandboxes for 300ms startup (vs 10s cold start)
- **Snapshots**: Named environment snapshots for fast restore
- **Health Tracking**: Automatic failure prediction and provider deprioritization
- **Self-Healing**: Automatic migration on provider issues

### 🤖 AI Agent Orchestration
- **Multi-Agent**: Coordinate multiple agents for complex tasks
- **Execution Policies**: Fine-grained control over sandbox requirements
- **Persistent Sessions**: Long-running agent sessions with state
- **Event System**: Durable execution with retry/replay

### 🎤 Voice Integration
- **Neural TTS**: ElevenLabs, Cartesia integration
- **Speech Recognition**: LiveKit-based voice commands
- **Real-time**: Low-latency voice interaction

### 🎨 Image Generation
- **Multi-Provider**: FLUX, SDXL, Mistral
- **Fallback Chain**: Automatic provider failover
- **High Quality**: Up to 1280x720 resolution

### 🔌 Integrations
- **OAuth**: Nango, Composio, Arcade, Smithery
- **Webhooks**: Real-time event delivery
- **Automation**: n8n workflow integration

## Installation

### npm
```bash
npm install -g @bing/mcp-server
```

### Claude Desktop Config

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "binG": {
      "command": "node",
      "args": ["-g", "@bing/mcp-server"],
      "env": {
        "DAYTONA_API_KEY": "your-api-key",
        "OPENROUTER_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Docker
```bash
docker run -it \
  -e DAYTONA_API_KEY=your-key \
  -e OPENROUTER_API_KEY=your-key \
  ghcr.io/quazfenton/bing-mcp-server:latest
```

## Available Tools

| Tool | Description |
|------|-------------|
| `execute_command` | Execute shell commands in isolated sandbox |
| `write_file` | Write files to sandbox workspace |
| `read_file` | Read files from sandbox workspace |
| `list_directory` | List directory contents |
| `create_agent` | Create and spawn AI agent |
| `get_agent_status` | Get status of running agent |
| `stop_agent` | Stop running agent |
| `spawn_agent_session` | Spawn persistent agent session |
| `voice_speech` | Generate speech from text |
| `generate_image` | Generate images |

## Usage Examples

### Execute Command
```typescript
const result = await mcp.invoke('execute_command', {
  command: 'npm install express',
  workingDir: '/workspace/my-project',
  timeout: 60000,
});
```

### Create Agent
```typescript
const agent = await mcp.invoke('create_agent', {
  task: 'Build a REST API with Express',
  model: 'anthropic/claude-3-5-sonnet',
  executionPolicy: 'sandbox-required',
});
```

### Generate Speech
```typescript
const audio = await mcp.invoke('voice_speech', {
  text: 'Hello, I am binG!',
  voice: 'Bruno',
  model: 'elevenlabs',
});
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DAYTONA_API_KEY` | Daytona sandbox API key | Yes* |
| `BLAXEL_API_KEY` | Blaxel sandbox API key | No |
| `OPENROUTER_API_KEY` | OpenRouter API key for LLM | Yes* |
| `ANTHROPIC_API_KEY` | Anthropic API key | No |
| `ELEVENLABS_API_KEY` | ElevenLabs API key | No |
| `MCP_TRANSPORT_TYPE` | Transport type (stdio/http/sse) | No |

*At least one sandbox and one LLM provider required

### Transport Types

```bash
# stdio (default - for Claude Desktop)
MCP_TRANSPORT_TYPE=stdio

# HTTP (for web clients)
MCP_TRANSPORT_TYPE=http
MCP_HTTP_PORT=3001

# SSE (for server-sent events)
MCP_TRANSPORT_TYPE=sse
```

## API Reference

### REST API

If running with HTTP transport:

```bash
# Get available tools
GET http://localhost:3001/tools

# Invoke a tool
POST http://localhost:3001/invoke
Content-Type: application/json

{
  "tool": "execute_command",
  "arguments": {
    "command": "echo hello"
  }
}

# Get server status
GET http://localhost:3001/status
```

### SSE Streaming

```bash
# Subscribe to events
GET http://localhost:3001/events
Accept: text/event-stream
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev

# Test
npm test
```

## Registry Submission

### Smithery
```bash
npx smithery publish
```

### JFrog MCP Registry
```bash
jf mcp publish @bing/mcp-server@1.0.0
```

## Security

- **Sandbox Isolation**: Per-user sandboxes with resource limits
- **Command Filtering**: Dangerous command blocking
- **Rate Limiting**: Per-client rate limits
- **Authentication**: Bearer token or API key auth
- **Audit Logging**: All commands logged for compliance

## Troubleshooting

### Sandbox Creation Fails
1. Verify API keys are valid
2. Check sandbox provider status
3. Review logs: `docker-compose logs | grep sandbox`

### MCP Not Connecting
1. Check Claude Desktop config syntax
2. Verify `node` is in PATH
3. Test standalone: `npx @bing/mcp-server`

### High Memory Usage
1. Enable persistent cache
2. Reduce warm pool size
3. Set memory limits in config

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a PR

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [GitHub](https://github.com/quazfenton/binG)
- [npm](https://www.npmjs.com/package/@bing/mcp-server)
- [Smithery](https://smithery.ai/server/@quazfenton/binG)
- [Documentation](https://github.com/quazfenton/binG/docs)
