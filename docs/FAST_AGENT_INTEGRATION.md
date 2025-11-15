# Fast-Agent Integration

This document describes the integration of fast-agent as a modular enhancement to binG's existing LLM chat interface.

## Overview

Fast-agent provides advanced capabilities including:
- **Tools & MCP Integration**: Access to Model Context Protocol tools and advanced tooling
- **File Handling**: Advanced file operations, reading, writing, and manipulation
- **Agent Chaining**: Multi-step workflows and agent orchestration
- **Code Execution**: Enhanced code generation and execution capabilities

## Architecture

The integration follows a "first-choice" pattern:

1. **Request Interception**: All chat requests are first evaluated by the fast-agent interceptor
2. **Intelligent Routing**: Requests are analyzed for advanced use cases that fast-agent excels at
3. **Graceful Fallback**: If fast-agent is unavailable or declines to handle a request, it falls back to the original binG system
4. **Modular Design**: The integration can be easily enabled/disabled without affecting core functionality

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Fast-Agent Integration Configuration
FAST_AGENT_ENABLED=true                    # Enable/disable fast-agent integration
FAST_AGENT_ENDPOINT=http://localhost:8080/api/chat  # Fast-agent server endpoint
FAST_AGENT_TIMEOUT=30000                   # Request timeout in milliseconds
FAST_AGENT_API_KEY=                        # Optional API key for fast-agent server
FAST_AGENT_FALLBACK=true                   # Enable fallback to original system
FAST_AGENT_PROVIDERS=openai,anthropic,google,openrouter  # Supported providers
FAST_AGENT_TOOLS=true                      # Enable tool capabilities
FAST_AGENT_FILES=true                      # Enable file handling
FAST_AGENT_CHAINING=true                   # Enable agent chaining
FAST_AGENT_MCP=true                        # Enable MCP tools
```

### Fast-Agent Server Setup

You need to run a fast-agent server on the configured endpoint. Example setup:

```bash
# Install fast-agent
uv tool install -U fast-agent-mcp

# Create and run a basic agent server
fast-agent serve --port 8080 --transport http
```

## Request Routing Logic

The interceptor evaluates requests based on content analysis:

### Tool Usage Indicators
- Keywords: `file`, `create`, `write`, `read`, `execute`, `run`, `tool`, `command`, `script`

### Code-Related Requests
- Keywords: `code`, `function`, `class`, `import`, `export`, `debug`, `test`, `refactor`

### File Operations
- Keywords: `save`, `load`, `download`, `upload`, `directory`, `folder`, `path`

### Agent Chaining
- Keywords: `workflow`, `chain`, `sequence`, `pipeline`, `multi-step`

## API Integration

### Request Flow

1. **Original Request** → Chat API (`/app/api/chat/route.ts`)
2. **Interception** → Fast-Agent Interceptor (`/lib/api/fast-agent-interceptor.ts`)
3. **Evaluation** → Fast-Agent Service (`/lib/api/fast-agent-service.ts`)
4. **Processing** → External Fast-Agent Server OR Original System

### Response Handling

Fast-agent responses are converted to match binG's expected format:

```typescript
{
  success: boolean;
  data: {
    content: string;
    toolCalls?: Array<ToolCall>;
    files?: Array<FileOperation>;
    chainedAgents?: string[];
  };
  source: 'fast-agent' | 'original';
}
```

## Health Monitoring

The integration includes health checking:

- **Automatic Health Checks**: Every 30 seconds
- **Failure Handling**: Automatic fallback when fast-agent is unhealthy
- **Recovery**: Automatic re-enabling when service becomes healthy

## Development & Testing

### Testing Fast-Agent Integration

1. **Enable Integration**: Set `FAST_AGENT_ENABLED=true`
2. **Start Fast-Agent Server**: Run on configured endpoint
3. **Test Advanced Requests**: Send requests with tool/file/code keywords
4. **Verify Fallback**: Stop fast-agent server and verify fallback works

### Debugging

Enable debug logging to see request routing:

```bash
# Check logs for these patterns:
[DEBUG] Chat API: Request handled by fast-agent
[DEBUG] Chat API: Fast-agent declined to handle request  
[DEBUG] Chat API: Fast-agent unavailable, falling back
```

### Disabling Integration

To disable fast-agent integration:

```env
FAST_AGENT_ENABLED=false
```

Or remove the fast-agent imports from `/app/api/chat/route.ts`.

## Use Cases

### Advanced Tool Usage
```
User: "Create a Python script that reads a CSV file and generates a report"
→ Routed to fast-agent (file + code keywords)
→ Fast-agent uses file tools and code generation
```

### File Operations
```
User: "Save this data to a JSON file and create a backup"
→ Routed to fast-agent (save + file keywords)
→ Fast-agent handles file operations
```

### Agent Chaining
```
User: "Create a multi-step workflow to process this data"
→ Routed to fast-agent (workflow + multi-step keywords)
→ Fast-agent orchestrates multiple agents
```

### Regular Chat
```
User: "What's the weather like today?"
→ Not routed to fast-agent (no advanced keywords)
→ Handled by original binG system
```

## Troubleshooting

### Fast-Agent Not Responding
- Check if fast-agent server is running on configured endpoint
- Verify `FAST_AGENT_ENDPOINT` is correct
- Check network connectivity

### Requests Not Being Routed
- Verify `FAST_AGENT_ENABLED=true`
- Check if request contains routing keywords
- Review debug logs for routing decisions

### Fallback Not Working
- Ensure `FAST_AGENT_FALLBACK=true`
- Check original system configuration
- Verify provider availability

## Future Enhancements

- **Dynamic Endpoint Discovery**: Auto-discover fast-agent servers
- **Load Balancing**: Support multiple fast-agent instances
- **Advanced Routing**: ML-based request classification
- **Caching**: Cache fast-agent responses for performance
- **Metrics**: Detailed performance and usage metrics
