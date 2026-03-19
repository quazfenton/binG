/**
 * Composio Adapter - Updated for Session-Based Architecture
 * 
 * Adapts LLM prompts/outputs to Composio session-based tool execution.
 * 
 * SECURITY: All tool calls now require userId for proper isolation.
 */

import { getComposioService } from '@/lib/platforms/composio-service';

const composioService = getComposioService();

export const composioSessionManager = {
  getUserTools: async (userId: string, options?: any) => {
    if (!composioService) return [];
    try {
      const { Composio } = await import('@composio/core');
      const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY || '' });
      if (typeof client.create === 'function') {
        const session = await client.create(userId);
        if (typeof session.tools === 'function') {
          return await session.tools();
        }
      }
      return [];
    } catch {
      return [];
    }
  },
  searchTools: async (userId: string, query: string, options?: any) => {
    if (!composioService) return [];
    try {
      const { Composio } = await import('@composio/core');
      const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY || '' });
      const toolkits = await composioService.getAvailableToolkits();
      const filtered = toolkits.filter((t: any) => 
        String(t.name || '').toLowerCase().includes(query.toLowerCase())
      );
      return filtered;
    } catch {
      return [];
    }
  },
  connectAccount: async (userId: string, toolkit: string, _authMode?: any) => {
    if (!composioService) return { success: false, error: 'Service not initialized' };
    try {
      const authUrl = await composioService.getAuthUrl(toolkit, userId);
      return { success: true, authUrl };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
  getConnectedAccounts: async (userId: string) => {
    if (!composioService) return [];
    return composioService.getConnectedAccounts(userId);
  },
};

export async function executeToolCall(userId: string, tool: string, args?: any): Promise<any> {
  if (!userId) {
    throw new Error('userId is required for tool execution (security requirement)');
  }

  if (!composioService) {
    throw new Error('Composio service not available');
  }

  try {
    // Execute tool via Composio SDK directly
    const { Composio } = await import('@composio/core');
    const client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY || '' });
    const session = await client.create(userId);
    // Session has different APIs depending on version - try executeTool
    if (typeof (session as any).executeTool === 'function') {
      const result = await (session as any).executeTool(tool, args || {});
      return result;
    }
    if (typeof (session as any).execute === 'function') {
      const result = await (session as any).execute(tool, args || {});
      return result;
    }
    throw new Error('Session execute method not available');
  } catch (error: any) {
    console.error('[composio-adapter] executeToolCall failed:', error);
    throw error;
  }
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
