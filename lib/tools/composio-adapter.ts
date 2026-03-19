/**
 * Composio Adapter - Updated for Session-Based Architecture
 * 
 * Adapts LLM prompts/outputs to Composio session-based tool execution.
 * 
 * SECURITY: All tool calls now require userId for proper isolation.
 */

import { getComposioService } from '@/lib/platforms/composio-service';

const composioService = getComposioService();

// Stub implementations for missing session manager
// TODO: Implement proper session management
export const composioSessionManager = {
  getUserTools: async (_userId: string, _options?: any) => [],
  searchTools: async (_userId: string, _query: string, _options?: any) => [],
  connectAccount: async (_userId: string, _toolkit: string, _authMode?: any) => ({ success: false, error: 'Not implemented' }),
  getConnectedAccounts: async (_userId: string) => [],
};

export async function executeToolCall(_userId: string, _tool: string, _args?: any): Promise<any> {
  throw new Error('Tool execution not implemented - use composioService directly');
}

export interface ToolCall {
  tool: string;
  args?: Record<string, any>;
}

export interface ToolCallResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Parse prompt for tool calls
 * 
 * @deprecated Tool discovery should use composioSessionManager.searchTools()
 */
export async function parsePromptForTools(prompt: string): Promise<ToolCall[]> {
  console.warn(
    '[composio-adapter] parsePromptForTools is deprecated. ' +
    'Use composioSessionManager.searchTools() for tool discovery.'
  );
  
  // Simple regex-based extraction as fallback
  // In production, use proper LLM-based tool extraction
  const toolPattern = /<tool\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool>/g;
  const calls: ToolCall[] = [];
  
  let match: RegExpExecArray | null;
  while ((match = toolPattern.exec(prompt)) !== null) {
    try {
      const args = JSON.parse(match[2] || '{}');
      calls.push({ tool: match[1], args });
    } catch {
      // Invalid JSON, skip
    }
  }
  
  return calls;
}

/**
 * Execute tool call with user session
 * 
 * SECURITY: userId is now REQUIRED
 */
export async function executeToolCallWithSession(
  userId: string,
  toolCall: ToolCall
): Promise<ToolCallResult> {
  if (!userId) {
    return {
      success: false,
      error: 'userId is required for tool execution (security requirement)',
    };
  }
  
  try {
    const result = await executeToolCall(userId, toolCall.tool, toolCall.args || {});
    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    console.error('[composio-adapter] executeToolCallWithSession failed', error);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Execute multiple tool calls for user
 */
export async function executeToolCalls(
  userId: string,
  toolCalls: ToolCall[]
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];
  
  for (const call of toolCalls) {
    const result = await executeToolCallWithSession(userId, call);
    results.push(result);
  }
  
  return results;
}

/**
 * Register default tools (backward compatibility)
 * 
 * @deprecated Use composioSessionManager for proper tool management
 */
export async function registerDefaultTools() {
  console.warn(
    '[composio-adapter] registerDefaultTools is deprecated. ' +
    'Tools are now managed per-user via composioSessionManager.'
  );
  
  // Tools are now automatically available via Composio's 1000+ integrations
  // Users connect accounts via composioSessionManager.connectAccount()
}

/**
 * Get available tools for user
 */
export async function getAvailableTools(
  userId: string,
  options?: { toolkit?: string; limit?: number }
) {
  return composioSessionManager.getUserTools(userId, options);
}

/**
 * Search tools for user
 */
export async function searchTools(
  userId: string,
  query: string,
  options?: { toolkit?: string; limit?: number }
) {
  return composioSessionManager.searchTools(userId, query, options);
}

/**
 * Connect new account for user
 */
export async function connectToolAccount(
  userId: string,
  toolkit: string,
  authMode: 'OAUTH2' | 'API_KEY' | 'BASIC' = 'OAUTH2'
) {
  return composioSessionManager.connectAccount(userId, toolkit, authMode);
}

/**
 * Get user's connected accounts
 */
export async function getUserConnectedAccounts(userId: string) {
  return composioSessionManager.getConnectedAccounts(userId);
}
