# Composio Integration Summary

## Overview

Composio has been integrated into the binG0 project as a priority tool service, providing access to **800+ toolkits** with advanced authentication and execution capabilities. It is positioned at **Priority 0** in the request router, meaning it's checked before all other tool services (Arcade/Nango at Priority 1, Sandbox at Priority 2, etc.).

## Files Created/Modified

### 1. New Service: `lib/api/composio-service.ts`
This new file provides:
- Composio service initialization and singleton management
- Tool request processing with support for multiple LLM providers
- Connected account management
- Authentication URL generation
- Health check functionality

**Key Interfaces:**
```typescript
interface ComposioService {
  healthCheck(): Promise<boolean>;
  processToolRequest(request: ComposioToolRequest): Promise<ComposioToolResponse>;
  getAvailableToolkits(): Promise<any[]>;
  getConnectedAccounts(userId: string): Promise<any[]>;
  getAuthUrl(toolkit: string, userId: string): Promise<string>;
}
```

### 2. Updated: `lib/api/priority-request-router.ts`
- Added Composio as **Priority 0** endpoint (first to try)
- Added `enableComposio` option to `RouterRequest`
- Added `processComposioRequest` method for handling Composio-specific requests
- Imports Composio service from `composio-service.ts`

### 3. Updated: `lib/api/llm-providers.ts`
- Added Composio provider configuration to `PROVIDERS` constant
- Added Composio to `ProviderConfig` interface
- Added `generateComposioResponse` method for direct LLM integration
- Composio provider supports both **OpenRouter** and **Google** SDKs

### 4. Updated: `lib/tools/index.ts`
- Exported Composio types and functions for easy access throughout the app

### 5. Updated: `package.json`
Added Composio dependencies:
- `@composio/core` - Core SDK
- `@composio/openai-agents` - OpenAI Agents provider
- `@composio/vercel` - Vercel AI SDK provider
- `@composio/anthropic` - Anthropic provider
- `@composio/google` - Google Gemini provider
- `@composio/langchain` - LangChain provider

## Environment Variables

Add these to your `.env` file:

```env
# Required
COMPOSIO_API_KEY=your_composio_api_key

# Optional - LLM Provider Selection
COMPOSIO_LLM_PROVIDER=openrouter  # Options: openrouter, google, openai
COMPOSIO_LLM_MODEL=openai/gpt-oss-120b:free  # Only for custom models

# Optional - Tool Control
COMPOSIO_ENABLED=true
COMPOSIO_ENABLE_ALL_TOOLS=true
COMPOSIO_RESTRICTED_TOOLKITS=gmail,github,notion  # Comma-separated, if restricting

# Required based on LLM provider
OPENROUTER_API_KEY=your_openrouter_key  # If using openrouter
GOOGLE_API_KEY=your_google_key          # If using google
OPENAI_API_KEY=your_openai_key          # If using openai
```

## LLM Provider Configuration

The integration supports three LLM providers:

### 1. OpenRouter (Default)
- **Base URL**: `https://openrouter.ai/api/v1`
- **Default Model**: `openai/gpt-oss-120b:free`
- Uses OpenAI-compatible API client
- Supports many free and paid models

### 2. Google Gemini
- **Model**: `google/gemini-2.5-flash` (configurable)
- Uses Google Generative AI SDK
- Good for multi-modal and long context

### 3. OpenAI
- **Model**: `gpt-4o-mini` (configurable)
- Native OpenAI API
- Full tool calling support

## Usage Examples

### Basic Tool Request
```typescript
import { priorityRequestRouter } from './lib/api/priority-request-router';

const response = await priorityRequestRouter.route({
  messages: [
    { role: 'user', content: 'Send an email to vincefrimps1@gmail.com' }
  ],
  provider: 'composio',
  model: 'openai/gpt-oss-120b:free',
  userId: 'user_123',
  enableComposio: true,
});
```

### Direct Composio Service Access
```typescript
import { initializeComposioService, getComposioService, isComposioAvailable } from './lib/api/composio-service';

if (isComposioAvailable()) {
  const service = initializeComposioService();
  
  const result = await service.processToolRequest({
    messages: [{ role: 'user', content: 'Search my emails' }],
    userId: 'user_123',
    enableAllTools: true,
  });
  
  if (result.requiresAuth) {
    console.log('Auth URL:', result.authUrl);
  } else {
    console.log('Response:', result.content);
  }
}
```

### List Available Toolkits
```typescript
const service = getComposioService();
const toolkits = await service.getAvailableToolkits();
console.log('Available toolkits:', toolkits);
// Returns: [{ name: 'Gmail', slug: 'gmail', toolCount: 15 }, ...]
```

## How It Works

1. **Request Routing**: When a request comes in with `userId`, the router first checks Composio (Priority 0)
2. **Session Creation**: Composio creates a unique session for the user with access to 800+ toolkits
3. **Tool Discovery**: The LLM (OpenRouter/Google) selects appropriate tools based on the request
4. **Authentication**: If a toolkit requires auth, Composio returns an auth URL for the user
5. **Execution**: Once authenticated, tools execute and results flow back through the LLM
6. **Fallback**: If Composio fails or is unavailable, the router falls back to Arcade/Nango (Priority 1)

## Priority Chain

The current priority chain in the router:

| Priority | Endpoint | Purpose |
|----------|----------|---------|
| 0 | **composio-tools** | 800+ toolkits with advanced auth |
| 1 | tool-execution | Arcade/Nango manual integration |
| 2 | sandbox-agent | Code execution |
| 3 | fast-agent | Custom fast-agent service |
| 4 | n8n-agents | Workflow orchestration |
| 5 | custom-fallback | Custom fallback logic |
| 6 | original-system | Built-in LLM service |

## Toolkits Available (Sample)

Composio provides access to 800+ toolkits including:
- **Productivity**: Gmail, Google Calendar, Google Drive, Notion
- **Development**: GitHub, Linear, Jira, Vercel
- **Communication**: Slack, Discord, Twilio
- **Social**: Twitter/X, Reddit, LinkedIn
- **Media**: Spotify, YouTube
- **Infrastructure**: AWS, GCP, Vercel, Railway
- **And many more...**

## Authentication Flow

When a user requests access to a toolkit they haven't connected:

1. Composio detects the request requires the toolkit
2. Returns `requiresAuth: true` with an `authUrl`
3. User visits the auth URL to connect their account
4. After OAuth, Composio stores the connected account
5. Future requests use the connected account automatically

## Installation

```bash
# Install the new dependencies
npm install

# Or if using bun
bun install
```

## Next Steps

1. Get your Composio API key from https://platform.composio.dev/settings
2. Configure your preferred LLM provider (OpenRouter recommended for free tier)
3. Add the environment variables
4. Test with a simple tool request

## Notes

- The existing Arcade/Nango tool integration at Priority 1 is preserved
- Composio is automatically disabled if `COMPOSIO_API_KEY` is not set
- Manual tool integrations in `lib/tools/tool-integration-system.ts` are preserved
- Composio handles authentication automatically through OAuth flows
