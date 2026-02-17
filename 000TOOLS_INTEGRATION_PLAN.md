# Improved Technical Plan: Integrating Third-Party Tools into Working LLM Service

## Executive Summary
This document outlines the production-ready implementation plan to integrate third-party service tools (Gmail, Google Calendar, GitHub, Spotify, Twilio, etc.) into the existing working LLM service. The integration leverages Arcade.dev and Nango for seamless third-party service integration while maintaining the current robust fallback mechanisms and proper security practices.

## Current Architecture Analysis

### Working Components
1. **LLM Providers** (`lib/api/llm-providers.ts`): Supports OpenAI, Anthropic, Google, Cohere, Together, Replicate, Portkey, OpenRouter, Chutes
2. **Enhanced LLM Service** (`lib/api/enhanced-llm-service.ts`): Provides fallback mechanisms and circuit breaker patterns
3. **Enhanced API Client** (`lib/api/enhanced-api-client.ts`): Robust API communication with retry logic and circuit breakers
4. **Chat API Route** (`app/api/chat/route.ts`): Main entry point using priority router
5. **Priority Router** (`lib/api/priority-request-router.ts`): Routes requests with fallback mechanisms
6. **Client-Side Hooks**: `use-conversation.ts`, `use-enhanced-chat.ts`, etc.

### Current Flow
```
User Input → /api/chat → Priority Router → Enhanced LLM Service → LLM Providers → Response
```

## Integration Strategy

### Approach: Direct Tool Integration with Proper Authorization
Integrate tool functionality directly into the working LLM service with proper user authorization and security measures.

## Implementation Plan

### Phase 1: Core Tool Integration Layer

#### 1.1 Enhanced Tool Integration Manager
**Location**: `lib/tools/tool-integration-system.ts` (enhance existing)
**Tasks**:
- Add comprehensive tool definitions for all supported services
- Implement category-based organization (email, calendar, storage, etc.)
- Add input/output schemas for type safety
- Implement improved natural language intent detection
- Add context awareness for tool selection
- Add proper error handling and validation

#### 1.2 Tool-Aware LLM Service Extension
**Location**: `lib/api/enhanced-llm-service.ts` (extend existing)
**Tasks**:
- Add tool detection to `generateResponse` and `generateStreamingResponse`
- Implement proper tool execution loop with authorization checks
- Add support for multi-turn conversations with tool results
- Maintain existing fallback and circuit breaker mechanisms
- Add proper error handling for tool execution

#### 1.3 Tool Authorization Manager
**Location**: `lib/services/tool-authorization-manager.ts` (new)
**Tasks**:
- Manage user authorization status for different services
- Check if user has proper permissions for requested tools
- Handle authorization requirements and return appropriate responses
- Integrate with the existing auth system

### Phase 2: Tool-Aware Request Processing

#### 2.1 Enhanced Request Interface
**Location**: `lib/api/llm-providers.ts`
**Tasks**:
- Extend `LLMRequest` interface to include tool-related fields:
```typescript
export interface LLMRequest {
  // ... existing fields
  tools?: any[];           // Available tools for the LLM
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }; // Tool selection strategy
  userId?: string;         // Required for tool authorization
  conversationId?: string; // For tracking conversation state
}
```

#### 2.2 Tool Detection and Authorization in LLM Service
**Location**: `lib/api/enhanced-llm-service.ts`
**Tasks**:
- Add tool detection logic to identify when user requests require external tools
- Implement authorization checking before tool execution
- Add natural language processing to map user intents to specific tools
- Add tool availability checking based on user authorization

#### 2.3 Complete Tool Execution Loop
**Location**: `lib/api/enhanced-llm-service.ts`
**Tasks**:
- Implement complete tool execution loop with proper error handling
- Execute tools returned by LLM and collect results
- Feed tool results back to LLM for final response generation
- Handle authorization requirements and OAuth flows
- Implement proper retry mechanisms for failed tools

### Phase 3: Modified Priority Router for Tool Handling

#### 3.1 Tool-Aware Routing with Authorization
**Location**: `lib/api/priority-request-router.ts`
**Tasks**:
- Add tool detection to identify when requests require tool execution
- Check user authorization before routing to tool-enabled services
- Modify routing logic to handle tool-enabled requests appropriately
- Implement tool execution within the router when needed
- Maintain existing fallback mechanisms

#### 3.2 Tool Response Normalization
**Location**: `lib/api/priority-request-router.ts`
**Tasks**:
- Update response normalization to handle tool calls and results
- Add tool-specific metadata to responses
- Maintain backward compatibility for non-tool requests
- Add proper error handling for tool-related responses

### Phase 4: API Route Integration

#### 4.1 Enhanced Chat Route with Authorization
**Location**: `app/api/chat/route.ts`
**Tasks**:
- Add tool detection and authorization checking before priority routing
- Implement tool authorization flow handling
- Add streaming support for tool results
- Maintain backward compatibility for existing functionality
- Add proper error handling for tool authorization failures

#### 4.2 Tool Authorization Webhook
**Location**: `app/api/webhooks/route.ts` (enhance existing)
**Tasks**:
- Handle OAuth callbacks from Arcade/Nango
- Resume tool execution after authorization
- Manage user connection state
- Add proper security validation for webhook requests

### Phase 5: Client-Side Integration

#### 5.1 Enhanced Conversation Hook with Tool State
**Location**: `hooks/use-conversation.ts`
**Tasks**:
- Add tool state management
- Handle authorization popups for tool connections
- Display tool results in conversation flow
- Manage tool execution state
- Add proper error handling for tool failures

#### 5.2 Tool-Aware Streaming
**Location**: `hooks/use-enhanced-streaming.ts`
**Tasks**:
- Add support for streaming tool results
- Handle tool authorization events in streaming
- Manage tool execution progress indicators
- Add proper error handling for streaming tools

## Detailed Implementation Steps

### Step 1: Create Tool Authorization Manager
```typescript
// lib/services/tool-authorization-manager.ts
import { oauthService } from '@/lib/auth/oauth-service';

export interface ToolAuthorizationContext {
  userId: number;
  conversationId: string;
  sessionId: string;
}

export class ToolAuthorizationManager {
  /**
   * Check if user is authorized to use a specific tool
   */
  async isAuthorized(userId: number, toolName: string): Promise<boolean> {
    // Map tool names to providers
    const toolProviderMap: Record<string, string> = {
      'gmail.send': 'google',
      'gmail.read': 'google',
      'gmail.search': 'google',
      'googlecalendar.create': 'google',
      'googlecalendar.read': 'google',
      'googledocs.create': 'google',
      'github.create_issue': 'github',
      'github.list_repos': 'github',
      'twitter.post': 'twitter',
      'twilio.send_sms': 'twilio',
      'slack.send_message': 'slack',
      'discord.send_message': 'discord',
      'reddit.post': 'reddit',
      'spotify.play': 'spotify',
      'exa.search': 'exa',
      'vercel.deploy': 'vercel',
      'railway.deploy': 'railway'
    };

    const provider = toolProviderMap[toolName];
    if (!provider) {
      // For tools that don't require specific authorization
      return true;
    }

    // Check if user has an active connection to this provider
    const connections = await oauthService.getUserConnections(userId, provider);
    return connections.some(conn => conn.isActive);
  }

  /**
   * Get authorization URL for a specific tool
   */
  async getAuthorizationUrl(userId: number, toolName: string): Promise<string | null> {
    // Map tool names to providers
    const toolProviderMap: Record<string, string> = {
      'gmail.send': 'google',
      'gmail.read': 'google',
      'gmail.search': 'google',
      'googlecalendar.create': 'google',
      'googlecalendar.read': 'google',
      'googledocs.create': 'google',
      'github.create_issue': 'github',
      'github.list_repos': 'github',
      'twitter.post': 'twitter',
      'twilio.send_sms': 'twilio',
      'slack.send_message': 'slack',
      'discord.send_message': 'discord',
      'reddit.post': 'reddit',
      'spotify.play': 'spotify',
      'exa.search': 'exa',
      'vercel.deploy': 'vercel',
      'railway.deploy': 'railway'
    };

    const provider = toolProviderMap[toolName];
    if (!provider) {
      return null;
    }

    // Return the OAuth initiation URL
    return `${process.env.APP_URL}/api/auth/oauth/initiate?provider=${provider}`;
  }

  /**
   * Get available tools for a user based on their authorizations
   */
  async getAvailableTools(userId: number): Promise<string[]> {
    const connections = await oauthService.getUserConnections(userId);
    const availableProviders = new Set(connections.filter(conn => conn.isActive).map(conn => conn.provider));
    
    const allTools = Object.keys(this.getToolProviderMap());
    return allTools.filter(tool => {
      const provider = this.getToolProviderMap()[tool];
      return !provider || availableProviders.has(provider);
    });
  }

  private getToolProviderMap(): Record<string, string> {
    return {
      'gmail.send': 'google',
      'gmail.read': 'google',
      'gmail.search': 'google',
      'googlecalendar.create': 'google',
      'googlecalendar.read': 'google',
      'googledocs.create': 'google',
      'googledrive.upload': 'google',
      'github.create_issue': 'github',
      'github.list_repos': 'github',
      'twitter.post': 'twitter',
      'twilio.send_sms': 'twilio',
      'slack.send_message': 'slack',
      'discord.send_message': 'discord',
      'reddit.post': 'reddit',
      'spotify.play': 'spotify',
      'exa.search': 'exa',
      'vercel.deploy': 'vercel',
      'railway.deploy': 'railway'
    };
  }
}

export const toolAuthorizationManager = new ToolAuthorizationManager();
```

### Step 2: Enhanced Tool Context Manager
```typescript
// lib/services/tool-context-manager.ts
import { ToolIntegrationManager } from '@/lib/tools/tool-integration-system';
import { toolAuthorizationManager } from './tool-authorization-manager';

export interface ToolExecutionContext {
  userId: number;
  conversationId: string;
  sessionId: string;
}

export class ToolContextManager {
  private toolManager: ToolIntegrationManager;

  constructor() {
    this.toolManager = new ToolIntegrationManager({
      arcade: {
        apiKey: process.env.ARCADE_API_KEY || "",
      },
      nango: {
        apiKey: process.env.NANGO_API_KEY || "",
        host: process.env.NANGO_HOST,
      },
    });
  }

  /**
   * Process a tool request with proper authorization checking
   */
  async processToolRequest(
    messages: any[],
    userId: number,
    conversationId: string
  ): Promise<{ 
    content: string; 
    toolCalls?: any[]; 
    requiresAuth?: boolean; 
    authUrl?: string;
    toolName?: string;
  }> {
    // Check if user has authorized the required tools
    const requiredTools = await this.detectRequiredTools(messages, userId);
    
    for (const tool of requiredTools) {
      const isAuthorized = await toolAuthorizationManager.isAuthorized(userId, tool);
      if (!isAuthorized) {
        const authUrl = await toolAuthorizationManager.getAuthorizationUrl(userId, tool);
        return {
          content: '',
          requiresAuth: true,
          authUrl,
          toolName: tool,
          toolCalls: [{ name: tool, arguments: {} }]
        };
      }
    }

    // All required tools are authorized, proceed with execution
    return await this.executeTools(messages, userId, conversationId);
  }

  /**
   * Detect required tools from messages
   */
  private async detectRequiredTools(messages: any[], userId: number): Promise<string[]> {
    const lastMessage = messages[messages.length - 1]?.content || '';
    const tools: string[] = [];

    // Enhanced tool detection patterns with authorization checking
    if (/(send|write|compose|draft).*email|gmail/i.test(lastMessage)) {
      tools.push('gmail.send');
    }
    if (/(read|get|fetch|list).*email|gmail/i.test(lastMessage)) {
      tools.push('gmail.read');
    }
    if (/(search|find).*email|gmail/i.test(lastMessage)) {
      tools.push('gmail.search');
    }
    if (/(schedule|create|add|book).*event|meeting|calendar/i.test(lastMessage)) {
      tools.push('googlecalendar.create');
    }
    if (/(read|get|fetch|list).*event|calendar/i.test(lastMessage)) {
      tools.push('googlecalendar.read');
    }
    if (/(create|make|write).*issue|ticket/i.test(lastMessage)) {
      tools.push('github.create_issue');
    }
    if (/(list|show|get).*repos|repositories/i.test(lastMessage)) {
      tools.push('github.list_repos');
    }
    if (/(upload|save|store).*file|document|drive/i.test(lastMessage)) {
      tools.push('googledrive.upload');
    }
    if (/(post|tweet|share).*twitter|X/i.test(lastMessage)) {
      tools.push('twitter.post');
    }
    if (/(send|text|sms).*message/i.test(lastMessage)) {
      tools.push('twilio.send_sms');
    }

    // Filter tools based on user's available authorizations
    const availableTools = await toolAuthorizationManager.getAvailableTools(userId);
    return tools.filter(tool => availableTools.includes(tool));
  }

  /**
   * Execute tools with proper error handling
   */
  private async executeTools(
    messages: any[],
    userId: number,
    conversationId: string
  ): Promise<{ content: string; toolCalls?: any[] }> {
    // This would integrate with the LLM to get tool calls
    // For now, we'll return a placeholder indicating tools were detected
    return { 
      content: 'Tools would be executed here',
      toolCalls: [] // Actual tool calls would be returned here
    };
  }
}

export const toolContextManager = new ToolContextManager();
```

### Step 3: Enhanced Enhanced LLM Service with Tool Support
```typescript
// Enhanced lib/api/enhanced-llm-service.ts
import { toolContextManager } from '../services/tool-context-manager';
import { ToolIntegrationManager } from '../tools/tool-integration-system';
import { toolAuthorizationManager } from '../services/tool-authorization-manager';

// Add to EnhancedLLMRequest interface
export interface EnhancedLLMRequest extends LLMRequest {
  // ... existing fields
  enableTools?: boolean;     // Enable tool usage for this request
  userId?: number;          // Required for tool authorization
  conversationId?: string;  // For conversation state management
}

// Enhance the generateResponse method
async generateResponse(request: EnhancedLLMRequest): Promise<LLMResponse> {
  const { enableTools, userId, conversationId, ...llmRequest } = request;

  // If tools are enabled and user ID is provided, process tools
  if (enableTools && userId && conversationId) {
    // Check if this request involves tools
    const toolResult = await toolContextManager.processToolRequest(
      llmRequest.messages,
      userId,
      conversationId
    );

    // If authorization is required, return auth information
    if (toolResult.requiresAuth && toolResult.authUrl) {
      return {
        content: `AUTH_REQUIRED:${toolResult.authUrl}:${toolResult.toolName}`,
        tokensUsed: 0,
        finishReason: 'tool_auth_required',
        timestamp: new Date(),
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      };
    }

    // If there are tool results, incorporate them into the conversation
    if (toolResult.toolCalls && toolResult.toolCalls.length > 0) {
      // Execute tools and get results
      const toolExecutionResults = await this.executeToolCalls(
        toolResult.toolCalls,
        userId,
        conversationId
      );

      // Add tool results to messages and continue conversation
      const updatedMessages = [
        ...llmRequest.messages,
        { role: 'assistant', content: JSON.stringify(toolResult.toolCalls) },
        { role: 'tool', content: JSON.stringify(toolExecutionResults) }
      ];

      // Continue with updated messages
      const updatedRequest = {
        ...llmRequest,
        messages: updatedMessages
      };

      return await llmService.generateResponse(updatedRequest);
    }
  }

  // Fall back to original behavior
  return await llmService.generateResponse(llmRequest);
}

// Add method to execute tool calls with proper error handling
private async executeToolCalls(
  toolCalls: any[],
  userId: number,
  conversationId: string
): Promise<any[]> {
  const results: any[] = [];
  const toolManager = new ToolIntegrationManager({
    arcade: {
      apiKey: process.env.ARCADE_API_KEY || "",
    },
    nango: {
      apiKey: process.env.NANGO_API_KEY || "",
      host: process.env.NANGO_HOST,
    },
  });

  for (const toolCall of toolCalls) {
    try {
      // Execute tool using integrated tool manager
      const toolKey = toolCall.function?.name || toolCall.name;
      const input = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : toolCall.arguments || {};

      // Verify user has authorization for this tool
      const isAuthorized = await toolAuthorizationManager.isAuthorized(userId, toolKey);
      if (!isAuthorized) {
        throw new Error(`User is not authorized to use tool: ${toolKey}`);
      }

      const result = await toolManager.executeTool(toolKey, input, {
        userId,
        conversationId
      });

      results.push({
        id: toolCall.id || toolCall.function?.name,
        result: result.success ? result.output : { error: result.error },
        success: result.success
      });
    } catch (error) {
      console.error(`Tool execution failed for ${toolCall.function?.name || toolCall.name}:`, error);
      results.push({
        id: toolCall.id || toolCall.function?.name,
        result: { 
          error: error instanceof Error ? error.message : 'Tool execution failed',
          details: error instanceof Error ? error.stack : undefined
        },
        success: false
      });
    }
  }

  return results;
}

// Enhance streaming method with tool support
async *generateStreamingResponse(request: EnhancedLLMRequest): AsyncGenerator<StreamingResponse> {
  const { enableTools, userId, conversationId, ...llmRequest } = request;

  // If tools are enabled, handle tool processing
  if (enableTools && userId && conversationId) {
    const toolResult = await toolContextManager.processToolRequest(
      llmRequest.messages,
      userId,
      conversationId
    );

    if (toolResult.requiresAuth && toolResult.authUrl) {
      yield {
        content: `AUTHORIZATION REQUIRED: Please visit ${toolResult.authUrl} to authorize ${toolResult.toolName}`,
        isComplete: true,
        finishReason: 'tool_auth_required'
      };
    }

    if (toolResult.toolCalls && toolResult.toolCalls.length > 0) {
      // Execute tools and get results
      const toolExecutionResults = await this.executeToolCalls(
        toolResult.toolCalls,
        userId,
        conversationId
      );

      // Add tool results to messages and continue streaming
      const updatedMessages = [
        ...llmRequest.messages,
        { role: 'assistant', content: JSON.stringify(toolResult.toolCalls) },
        { role: 'tool', content: JSON.stringify(toolExecutionResults) }
      ];

      const updatedRequest = {
        ...llmRequest,
        messages: updatedMessages
      };

      yield* llmService.generateStreamingResponse(updatedRequest);
      return;
    }
  }

  // Fall back to original behavior
  yield* llmService.generateStreamingResponse(llmRequest);
}
```

### Step 4: Update Priority Router for Tool Handling
```typescript
// Enhanced lib/api/priority-request-router.ts
// Update the original system endpoint to use enhanced LLM service with tools
{
  name: 'original-system',
  priority: 4, // This will be the primary working system
  enabled: true,
  service: enhancedLLMService,
  healthCheck: async () => true, // Always available
  canHandle: (req) => {
    // Always accepts, but check if tools should be enabled
    return true;
  },
  processRequest: async (req) => {
    // Convert to EnhancedLLMRequest with tool support
    const enhancedRequest = {
      ...req,
      enableTools: true, // Enable tools by default
      userId: req.userId, // Pass through user ID if available
      conversationId: req.conversationId // Pass through conversation ID
    };

    const response = await enhancedLLMService.generateResponse(enhancedRequest);
    return this.normalizeOriginalResponse(response);
  }
}

// Add tool-specific normalization
private normalizeOriginalResponse(response: any): any {
  return {
    content: response.content || '',
    data: {
      content: response.content || '',
      usage: response.usage,
      model: response.model,
      provider: response.provider,
      // Extract tool-related content if present
      ...(response.content?.startsWith('AUTH_REQUIRED:') && {
        requiresAuth: true,
        authInfo: response.content.split(':')[1],
        toolName: response.content.split(':')[2]
      })
    }
  };
}
```

### Step 5: Update Chat API Route with Authorization
```typescript
// Enhanced app/api/chat/route.ts
export async function POST(request: NextRequest) {
  console.log('[DEBUG] Chat API: Incoming request');

  try {
    const body = await request.json();
    console.log('[DEBUG] Chat API: Request body parsed:', {
      hasMessages: !!body.messages,
      messageCount: body.messages?.length,
      provider: body.provider,
      model: body.model,
      stream: body.stream,
      userId: body.userId, // Added for tool context
      conversationId: body.conversationId, // Added for tool context
      bodyKeys: Object.keys(body)
    });

    const {
      messages,
      provider,
      model,
      temperature = 0.7,
      maxTokens = 10096,
      stream = true,
      apiKeys = {},
      requestId,
      userId, // Required for tool execution
      conversationId, // Required for tool execution
      enableTools = true, // Enable tools by default
      resumeFromOffset = 0,
    } = body;

    // Validate required fields including userId for tools
    if (enableTools && !userId) {
      console.error('[DEBUG] Chat API: Validation failed - userId required for tools');
      // Continue without tools if userId not provided
      enableTools = false;
    }

    // ... existing validation logic ...

    console.log('[DEBUG] Chat API: Validation passed, routing through priority chain');

    // PRIORITY-BASED ROUTING with tool context
    const routerRequest = {
      messages,
      provider,
      model,
      temperature,
      maxTokens,
      stream,
      apiKeys,
      requestId,
      userId, // Pass user ID for tool context
      conversationId, // Pass conversation ID for tool context
      enableTools, // Pass tool enablement flag
    };

    console.log('[DEBUG] Chat API: Routing request through priority chain');

    // Route through priority chain
    const routerResponse = await priorityRequestRouter.route(routerRequest);

    console.log(`[DEBUG] Chat API: Request handled by ${routerResponse.source} (priority ${routerResponse.priority})`);

    // Check if authorization is required
    if (routerResponse.data?.requiresAuth) {
      return NextResponse.json({
        status: "auth_required",
        authUrl: routerResponse.data.authInfo,
        toolName: routerResponse.data.toolName,
        message: `Please authorize the ${routerResponse.data.toolName} tool to continue`
      });
    }

    // Process response through unified handler
    const unifiedResponse = unifiedResponseHandler.processResponse(routerResponse, requestId);

    // Handle streaming response
    if (stream && selectedProvider.supportsStreaming) {
      // Create streaming events from unified response
      const streamRequestId = requestId || `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const events = unifiedResponseHandler.createStreamingEvents(unifiedResponse, streamRequestId);

      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            // Send events with appropriate delays
            for (let i = 0; i < events.length; i++) {
              const event = events[i];
              controller.enqueue(encoder.encode(event));

              // Add small delays between events for smooth streaming
              if (i < events.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 50));
              }
            }

            controller.close();
          } catch (error) {
            console.error('[DEBUG] Chat API: Streaming error:', error);
            const errorEvent = `event: error\ndata: ${JSON.stringify({
              requestId: streamRequestId,
              message: 'Streaming error occurred',
              canRetry: false
            })}\n\n`;
            controller.enqueue(encoder.encode(errorEvent));
            controller.close();
          }
        },
        cancel() {
          console.log(`[DEBUG] Chat API: Stream cancelled by client: ${streamRequestId}`);
        },
      });

      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Handle non-streaming response
    return NextResponse.json({
      success: unifiedResponse.success,
      data: unifiedResponse.data,
      commands: unifiedResponse.commands,
      metadata: unifiedResponse.metadata,
      timestamp: unifiedResponse.metadata?.timestamp
    });

  } catch (error) {
    // ... existing error handling ...
  }
}
```

## Security Considerations

### 1. Authorization Management
- Implement proper user authorization checks before tool execution
- Validate user permissions for each tool
- Secure token storage and transmission

### 2. Input Validation
- Sanitize all inputs to prevent injection attacks
- Validate tool parameters before execution
- Implement rate limiting for tool calls
- Add proper error handling

### 3. Secure Communication
- Use HTTPS for all API communications
- Implement proper CORS policies
- Validate webhook signatures from third-party services

## Testing Strategy

### 1. Unit Tests
- Test tool detection and classification
- Test authorization checking
- Test tool execution service
- Test error scenarios

### 2. Integration Tests
- Test end-to-end tool execution flow
- Test authorization flows
- Test streaming with tool results
- Test fallback mechanisms

### 3. Security Tests
- Test authorization bypass attempts
- Test injection attacks
- Test rate limiting effectiveness

## Deployment Considerations

### 1. Environment Configuration
- Set up Arcade/Nango accounts
- Configure webhook endpoints
- Set up proper domain for OAuth redirects
- Configure SSL for secure connections

### 2. Monitoring and Logging
- Log tool execution events
- Monitor authorization flows
- Track tool usage metrics
- Set up alerts for failures

### 3. Scaling Considerations
- Tool execution may be slower than regular chat
- Consider queuing for long-running tools
- Implement proper timeout handling
- Plan for increased resource usage

This improved implementation plan provides a production-ready approach to integrating tools directly into the working LLM service with proper authorization, security, and error handling.