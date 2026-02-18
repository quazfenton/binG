# Technical Plan: Integrating Third-Party Tools into Working LLM Service

## Executive Summary
This document outlines the implementation plan to integrate third-party service tools (Gmail, Google Calendar, GitHub, Spotify, Twilio, etc.) into the existing working LLM service, bypassing the experimental Fast-Agent system. The integration will leverage Arcade.dev and Nango for seamless third-party service integration while maintaining the current robust fallback mechanisms.

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

### Approach: Direct Tool Integration into Working LLM Service
Instead of relying on Fast-Agent, we'll integrate tool functionality directly into the working LLM service by extending the existing architecture.

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

#### 1.2 Tool-Aware LLM Service Extension
**Location**: `lib/api/enhanced-llm-service.ts` (extend existing)
**Tasks**:
- Add tool detection to `generateResponse` and `generateStreamingResponse`
- Implement tool execution loop similar to OpenAI function calling
- Add support for multi-turn conversations with tool results
- Maintain existing fallback and circuit breaker mechanisms

#### 1.3 Tool Context Manager
**Location**: `lib/services/tool-context-manager.ts` (new)
**Tasks**:
- Manage conversation state for tool interactions
- Track user authorization status for different services
- Handle tool result integration into conversation flow
- Manage tool execution context (userId, conversationId, etc.)

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

#### 2.2 Tool Detection in LLM Service
**Location**: `lib/api/enhanced-llm-service.ts`
**Tasks**:
- Add tool detection logic to identify when user requests require external tools
- Implement natural language processing to map user intents to specific tools
- Add tool availability checking based on user authorization

#### 2.3 Tool Execution Loop
**Location**: `lib/api/enhanced-llm-service.ts`
**Tasks**:
- Implement tool execution loop after initial LLM response
- Execute tools returned by LLM and collect results
- Feed tool results back to LLM for final response generation
- Handle authorization requirements and OAuth flows

### Phase 3: Modified Priority Router for Tool Handling

#### 3.1 Tool-Aware Routing
**Location**: `lib/api/priority-request-router.ts`
**Tasks**:
- Add tool detection to identify when requests require tool execution
- Modify routing logic to handle tool-enabled requests appropriately
- Implement tool execution within the router when needed
- Maintain existing fallback mechanisms

#### 3.2 Tool Response Normalization
**Location**: `lib/api/priority-request-router.ts`
**Tasks**:
- Update response normalization to handle tool calls and results
- Add tool-specific metadata to responses
- Maintain backward compatibility for non-tool requests

### Phase 4: API Route Integration

#### 4.1 Enhanced Chat Route
**Location**: `app/api/chat/route.ts`
**Tasks**:
- Add tool detection and execution logic before priority routing
- Implement tool authorization flow handling
- Add streaming support for tool results
- Maintain backward compatibility for existing functionality

#### 4.2 Tool Authorization Webhook
**Location**: `app/api/webhooks/route.ts` (enhance existing)
**Tasks**:
- Handle OAuth callbacks from Arcade/Nango
- Resume tool execution after authorization
- Manage user connection state

### Phase 5: Client-Side Integration

#### 5.1 Enhanced Conversation Hook
**Location**: `hooks/use-conversation.ts`
**Tasks**:
- Add tool state management
- Handle authorization popups for tool connections
- Display tool results in conversation flow
- Manage tool execution state

#### 5.2 Tool-Aware Streaming
**Location**: `hooks/use-enhanced-streaming.ts`
**Tasks**:
- Add support for streaming tool results
- Handle tool authorization events in streaming
- Manage tool execution progress indicators

## Detailed Implementation Steps

### Step 1: Create Tool Context Manager
```typescript
// lib/services/tool-context-manager.ts
import { ToolIntegrationManager } from '@/lib/tools/tool-integration-system';

export interface ToolExecutionContext {
  userId: string;
  conversationId: string;
  sessionId: string;
  authorizedServices: Set<string>;
}

export class ToolContextManager {
  private toolManager: ToolIntegrationManager;
  private activeSessions: Map<string, ToolExecutionContext>;
  
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
    this.activeSessions = new Map();
  }
  
  async processToolRequest(
    messages: any[],
    userId: string,
    conversationId: string
  ): Promise<{ content: string; toolCalls?: any[]; requiresAuth?: boolean; authUrl?: string }> {
    // Check if user has authorized the required services
    const requiredTools = this.detectRequiredTools(messages);
    const unauthorizedTools = this.getUnauthorizedTools(requiredTools, userId);
    
    if (unauthorizedTools.length > 0) {
      // Return authorization URL for the first unauthorized tool
      const authResult = await this.getAuthorizationUrl(unauthorizedTools[0], userId);
      return {
        content: '',
        requiresAuth: true,
        authUrl: authResult.authUrl,
        toolCalls: [{ name: unauthorizedTools[0], arguments: {} }]
      };
    }
    
    // Execute tools if authorized
    return await this.executeTools(messages, userId, conversationId);
  }
  
  private detectRequiredTools(messages: any[]): string[] {
    const lastMessage = messages[messages.length - 1]?.content || '';
    const tools: string[] = [];
    
    // Enhanced tool detection patterns
    if (/(send|write|compose).*email/i.test(lastMessage)) {
      tools.push('gmail.send');
    }
    if (/(schedule|create|add).*event/i.test(lastMessage)) {
      tools.push('googlecalendar.create');
    }
    if (/(create|make).*issue/i.test(lastMessage)) {
      tools.push('github.create_issue');
    }
    if (/(upload|save).*file/i.test(lastMessage)) {
      tools.push('googledrive.upload');
    }
    if (/(post|tweet).*twitter/i.test(lastMessage)) {
      tools.push('twitter.post');
    }
    if (/(send|text|sms).*message/i.test(lastMessage)) {
      tools.push('twilio.send_sms');
    }
    
    return tools;
  }
  
  private async executeTools(
    messages: any[],
    userId: string,
    conversationId: string
  ): Promise<{ content: string; toolCalls?: any[] }> {
    // This would integrate with the LLM to get tool calls
    // For now, we'll simulate the process
    
    // In a real implementation, this would:
    // 1. Send messages to LLM with available tools
    // 2. Receive tool calls from LLM
    // 3. Execute the tools
    // 4. Return results to LLM for final response
    
    return { content: 'Tool execution results would go here' };
  }
  
  private async getAuthorizationUrl(toolName: string, userId: string) {
    // This would initiate the OAuth flow for the specific tool
    return { authUrl: `https://auth.arcade.dev/connect?tool=${toolName}&userId=${userId}` };
  }
  
  private getUnauthorizedTools(requiredTools: string[], userId: string): string[] {
    // Check which tools the user hasn't authorized
    // This would check against stored user authorizations
    return requiredTools; // Placeholder - all tools considered unauthorized
  }
}

export const toolContextManager = new ToolContextManager();
```

### Step 2: Enhance Enhanced LLM Service with Tool Support
```typescript
// Enhanced lib/api/enhanced-llm-service.ts
import { toolContextManager } from '../services/tool-context-manager';

// Add to EnhancedLLMRequest interface
export interface EnhancedLLMRequest extends LLMRequest {
  // ... existing fields
  enableTools?: boolean;     // Enable tool usage for this request
  userId?: string;          // Required for tool authorization
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
        content: `AUTH_REQUIRED:${toolResult.authUrl}:${toolResult.toolCalls?.[0]?.name}`,
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

// Add method to execute tool calls
private async executeToolCalls(
  toolCalls: any[],
  userId: string,
  conversationId: string
): Promise<any[]> {
  const results: any[] = [];
  
  for (const toolCall of toolCalls) {
    try {
      // Execute tool using integrated tool manager
      const toolKey = toolCall.name.replace(/_/g, '.');
      const input = toolCall.arguments || {};
      
      const toolManager = new ToolIntegrationManager({
        arcade: {
          apiKey: process.env.ARCADE_API_KEY || "",
        },
        nango: {
          apiKey: process.env.NANGO_API_KEY || "",
          host: process.env.NANGO_HOST,
        },
      });
      
      const result = await toolManager.executeTool(toolKey, input, {
        userId,
        conversationId
      });
      
      results.push({
        id: toolCall.id,
        result: result.success ? result.output : { error: result.error },
        success: result.success
      });
    } catch (error) {
      results.push({
        id: toolCall.id,
        result: { error: error instanceof Error ? error.message : 'Tool execution failed' },
        success: false
      });
    }
  }
  
  return results;
}

// Enhance streaming method similarly
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
        content: `AUTHORIZATION REQUIRED: Please visit ${toolResult.authUrl} to authorize ${toolResult.toolCalls?.[0]?.name}`, 
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

### Step 3: Update Priority Router for Tool Handling
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

### Step 4: Update Chat API Route
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
      resumeFromOffset = 0,
    } = body;

    // Validate required fields including userId for tools
    if (!userId) {
      console.error('[DEBUG] Chat API: Validation failed - userId required for tools');
      // Continue without user ID but disable tools
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
      conversationId // Pass conversation ID for tool context
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
      // ... existing streaming logic ...
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

### Step 5: Client-Side Integration
```typescript
// Enhanced hooks/use-conversation.ts
// Add tool state management
const [toolState, setToolState] = useState({
  requiresAuth: false,
  authUrl: null,
  toolName: null,
  isAuthorizing: false
});

// Update sendMessage to handle tool authorization
const handleToolAuthorization = useCallback(async (authUrl: string, toolName: string) => {
  setToolState({
    requiresAuth: true,
    authUrl,
    toolName,
    isAuthorizing: true
  });

  // Open authorization popup
  const authWindow = window.open(authUrl, 'tool-auth', 'width=600,height=700');

  // Poll for authorization completion
  const pollForCompletion = setInterval(() => {
    if (authWindow?.closed) {
      clearInterval(pollForCompletion);
      setToolState({
        requiresAuth: false,
        authUrl: null,
        toolName: null,
        isAuthorizing: false
      });
      // Optionally retry the original request
    }
  }, 1000);
}, []);

// In sendMessage, handle authorization responses
if (data?.status === 'auth_required') {
  handleToolAuthorization(data.authUrl, data.toolName);
  return;
}
```

## Security Considerations

### 1. Credential Management
- Store API keys securely using environment variables
- Implement encrypted storage for user credentials
- Use short-lived tokens where possible
- Implement proper access controls

### 2. Input Validation
- Sanitize all inputs to prevent injection attacks
- Validate tool parameters before execution
- Implement rate limiting for tool calls
- Add proper error handling

### 3. Authorization Flows
- Implement secure OAuth flows
- Use proper state parameters to prevent CSRF
- Validate redirect URIs
- Implement proper session management

## Testing Strategy

### 1. Unit Tests
- Test tool detection and classification
- Test tool execution service
- Test authorization handling
- Test error scenarios

### 2. Integration Tests
- Test end-to-end tool execution flow
- Test authorization flows
- Test streaming with tool results
- Test fallback mechanisms

### 3. Performance Tests
- Test concurrent tool executions
- Test tool execution under load
- Test streaming performance with tools

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

## Rollout Plan

### Phase 1: Internal Testing (Week 1)
- Deploy to development environment
- Test with internal team
- Verify all tool categories work
- Test authorization flows

### Phase 2: Limited Beta (Week 2)
- Deploy to staging environment
- Invite limited beta users
- Gather feedback on tool functionality
- Iterate based on feedback

### Phase 3: Production Rollout (Week 3)
- Deploy to production with feature flag
- Monitor usage and errors
- Gradually increase availability
- Full rollout after stability verification

## Success Metrics

### 1. Functional Metrics
- Tool execution success rate > 95%
- Authorization completion rate > 90%
- Tool response time < 5 seconds average

### 2. User Experience Metrics
- User satisfaction with tool features
- Tool usage adoption rate
- Reduction in manual service interactions

### 3. System Health Metrics
- No degradation in regular chat performance
- Stable error rates
- Proper resource utilization

This implementation plan focuses on integrating tools directly into the working LLM service without relying on the experimental Fast-Agent system, ensuring a stable and reliable tool integration that builds upon the existing robust architecture.