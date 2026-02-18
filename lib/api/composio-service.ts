/**
 * Composio Service - Advanced Tool Integration with 800+ Toolkits
 */

import { generateSecureId } from '@/lib/utils';

// Composio uses its own internal LLM handling, so we just need to set up the service
export interface ComposioService {
  healthCheck(): Promise<boolean>;
  processToolRequest(request: ComposioToolRequest): Promise<ComposioToolResponse>;
  getAvailableToolkits(): Promise<any[]>;
  getConnectedAccounts(userId: string): Promise<any[]>;
  getAuthUrl(toolkit: string, userId: string): Promise<string>;
}

export interface ComposioToolRequest {
  messages: any[];
  userId: string;
  stream?: boolean;
  requestId?: string;
  toolkits?: string[];
  enableAllTools?: boolean;
  llmProvider?: 'openrouter' | 'google' | 'openai';
}

export interface ComposioToolResponse {
  content: string;
  requiresAuth?: boolean;
  authUrl?: string;
  authToolkit?: string;
  toolCalls?: any[];
  connectedAccounts?: any[];
  metadata?: {
    sessionId?: string;
    toolsUsed?: string[];
    executionTime?: number;
  };
}

export interface ComposioServiceConfig {
  apiKey: string;
  llmProvider?: 'openrouter' | 'google' | 'openai';
  llmModel?: string;
  enableAllTools?: boolean;
  restrictedToolkits?: string[];
}

let composioServiceInstance: ComposioService | null = null;

/**
 * Initialize Composio service
 * This creates a singleton instance that can be used throughout the app
 */
export function initializeComposioService(
  config?: ComposioServiceConfig
): ComposioService | null {
  if (composioServiceInstance) {
    return composioServiceInstance;
  }

  const apiKey = config?.apiKey || process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    return null;
  }

  composioServiceInstance = createComposioService(config || { apiKey });
  return composioServiceInstance;
}

/**
 * Get existing Composio service instance
 */
export function getComposioService(): ComposioService | null {
  return composioServiceInstance;
}

/**
 * Create a Composio service instance
 */
function createComposioService(config: ComposioServiceConfig): ComposioService {
  const llmProvider = config.llmProvider || (process.env.COMPOSIO_LLM_PROVIDER as any) || 'openrouter';
  const llmModel = config.llmModel || process.env.COMPOSIO_LLM_MODEL;

  // Default models per provider
  const defaultModels: Record<string, string> = {
    openrouter: 'openai/gpt-oss-120b:free',
    google: 'google/gemini-2.5-flash',
    openai: 'gpt-4o-mini',
  };

  const selectedModel = llmModel || defaultModels[llmProvider] || defaultModels.openrouter;

  return {
    async healthCheck(): Promise<boolean> {
      try {
        const { Composio } = await import('@composio/core');
        const composio = new Composio({ apiKey: config.apiKey });
        // Verify API connectivity with read-only call (no side effects)
        await composio.toolkits.list();
        return true;
      } catch (error) {
        console.error('[ComposioService] Health check failed:', error);
        return false;
      }
    },

    async processToolRequest(request: ComposioToolRequest): Promise<ComposioToolResponse> {
      const startTime = Date.now();
      
      try {
        const { Composio } = await import('@composio/core');
        const composio = new Composio({ apiKey: config.apiKey });

        // Create session for user (create() only takes userId)
        const session = await composio.create(request.userId);

        // Get available tools - filter by requested toolkits if specified
        let tools;
        if (request.toolkits && request.toolkits.length > 0) {
          // If restrictedToolkits is configured, intersect with request.toolkits to prevent bypass
          const allowedToolkits = config.restrictedToolkits && config.restrictedToolkits.length > 0
            ? request.toolkits.filter((toolkit) => config.restrictedToolkits!.includes(toolkit))
            : request.toolkits;
          tools = await composio.tools.list({ apps: allowedToolkits.join(',') });
        } else if (config.restrictedToolkits && config.restrictedToolkits.length > 0) {
          // Use configured restricted toolkits
          tools = await composio.tools.list({ apps: config.restrictedToolkits.join(',') });
        } else {
          // No restrictions - get all tools (use with caution)
          tools = await composio.tools.list();
        }

        // Extract the last user message
        const lastMessage = request.messages
          .filter((m: any) => m.role === 'user')
          .pop()?.content;

        if (!lastMessage) {
          return {
            content: 'No user message found to process',
            metadata: { sessionId: session.id, executionTime: Date.now() - startTime },
          };
        }

        // Use the appropriate provider for executing with tools
        const provider = request.llmProvider || llmProvider;
        
        let content = '';
        let toolCalls: any[] = [];

        // Execute based on provider preference
        if (provider === 'openrouter' || provider === 'openai') {
          // Use OpenRouter with OpenAI client
          const { OpenAI } = await import('openai');
          const baseUrl = provider === 'openrouter' 
            ? 'https://openrouter.ai/api/v1'
            : undefined;
          const apiKey = provider === 'openrouter'
            ? process.env.OPENROUTER_API_KEY
            : process.env.OPENAI_API_KEY;

          const client = new OpenAI({
            apiKey: apiKey || '',
            baseURL: baseUrl,
          });

          // First call to get tool selection
          const response = await client.chat.completions.create({
            model: selectedModel,
            messages: request.messages.map((m: any) => ({
              role: m.role,
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
            })),
            tools: tools.map((t: any) => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            })),
          });

          const choice = response.choices[0];
          content = choice.message.content || '';

          // Process tool calls if present
          if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
            toolCalls = choice.message.tool_calls;

            // Work with a copy to avoid mutating the caller's messages
            const messages = [...request.messages];

            // Execute the tool calls via Composio
            for (const toolCall of choice.message.tool_calls) {
              try {
                const toolSlug = toolCall.function.name;
                const toolArgs = JSON.parse(toolCall.function.arguments);
                const result = await composio.tools.execute(toolSlug, {
                  connectedAccountId: request.userId,
                  input: toolArgs,
                });

                // Add to message history
                messages.push({
                  role: 'assistant',
                  content: '',
                  tool_calls: [{
                    id: toolCall.id,
                    type: 'function',
                    function: {
                      name: toolCall.function.name,
                      arguments: toolCall.function.arguments,
                    },
                  }],
                });

                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(result),
                });
              } catch (toolError: any) {
                // Check if tool requires auth
                if (toolError.message?.includes('auth') || toolError.message?.includes('connect')) {
                  const kitName = toolCall.function.name.split('_')[0].toUpperCase();
                  const authUrl = await this.getAuthUrl(kitName, request.userId);
                  return {
                    content: `Authorization required for ${kitName}. Please connect your account.`,
                    requiresAuth: true,
                    authUrl,
                    authToolkit: kitName,
                    metadata: { sessionId: session.id, toolsUsed: toolCalls.map((t: any) => t.function?.name) },
                  };
                }
              }
            }

            // Second call to get final response with tool results
            const finalResponse = await client.chat.completions.create({
              model: selectedModel,
              messages: messages.map((m: any) => ({
                ...m,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              })),
            });

            content = finalResponse.choices[0].message.content || content;
          }
        } else if (provider === 'google') {
          // Use Google Gemini with function calling support
          const { GoogleGenerativeAI } = await import('@google/generative-ai');
          const apiKey = process.env.GOOGLE_API_KEY;

          if (!apiKey) {
            throw new Error('GOOGLE_API_KEY not configured');
          }

          const genAI = new GoogleGenerativeAI(apiKey);
          
          // Convert tools to Gemini functionDeclarations format
          const functionDeclarations = tools?.map((tool: any) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })) || [];

          const model = genAI.getGenerativeModel({ 
            model: selectedModel,
            tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
          });

          // Convert messages to Gemini format
          const geminiHistory = request.messages.map((m: any) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
          }));

          const result = await model.generateContent({
            contents: geminiHistory,
          });

          content = result.response.text();

          // Extract function calls from Gemini response if present
          // Gemini SDK doesn't have functionCalls() - extract from candidates[].content.parts[].functionCall
          const functionCalls =
            result.response.candidates?.flatMap((candidate: any) =>
              (candidate.content?.parts || [])
                .filter((part: any) => part.functionCall)
                .map((part: any) => part.functionCall)
            ) || [];
          if (functionCalls.length > 0) {
            toolCalls = functionCalls.map((call: any) => ({
              id: generateSecureId('call'),
              type: 'function',
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args),
              },
            }));

            // Execute tool calls via Composio (same as OpenAI path)
            const functionResponses: any[] = [];
            for (const call of functionCalls) {
              try {
                const toolResult = await composio.tools.execute(call.name, {
                  connectedAccountId: request.userId,
                  input: call.args,
                });
                functionResponses.push({
                  name: call.name,
                  response: toolResult,
                });
              } catch (toolError: any) {
                if (toolError.message?.includes('auth') || toolError.message?.includes('connect')) {
                  const kitName = call.name.split('_')[0].toUpperCase();
                  const authUrl = await this.getAuthUrl(kitName, request.userId);
                  return {
                    content: `Authorization required for ${kitName}. Please connect your account.`,
                    requiresAuth: true,
                    authUrl,
                    authToolkit: kitName,
                    metadata: { sessionId: session.id, toolsUsed: toolCalls.map((t: any) => t.function?.name) },
                  };
                }
                functionResponses.push({
                  name: call.name,
                  response: { error: toolError.message },
                });
              }
            }

            // Second Gemini call with tool results
            const updatedHistory = [
              ...geminiHistory,
              { role: 'model', parts: result.response.candidates?.[0]?.content?.parts || [{ text: content }] },
              { role: 'function', parts: functionResponses.map((fr: any) => ({ functionResponse: fr })) },
            ];

            const finalResult = await model.generateContent({
              contents: updatedHistory,
            });

            content = finalResult.response.text() || content;
          }
        }

        // Get connected accounts
        const connectedAccounts = await composio.connectedAccounts.list({ userId: request.userId });

        return {
          content,
          toolCalls,
          connectedAccounts: connectedAccounts?.items || [],
          metadata: {
            sessionId: session.id,
            toolsUsed: toolCalls.map((t: any) => t.function?.name),
            executionTime: Date.now() - startTime,
          },
        };

      } catch (error: any) {
        console.error('[ComposioService] Error processing request:', error);

        // Check if it's an auth error using specific error codes/types
        // Composio SDK uses specific error codes for auth failures
        if (error.code === 'AUTH_REQUIRED' || error.name === 'AuthError' || error.authToolkit) {
          // Use toolkit from error if provided, otherwise try to extract from message
          let toolkit = error.authToolkit || error.toolkit;
          
          if (!toolkit) {
            // Try to extract toolkit name from error message as fallback
            // Filter out error codes like AUTH_REQUIRED to get actual toolkit name
            const toolkitMatches = error.message?.match(/\b[A-Z][A-Z_]+\b/g);
            const toolkitCandidate = toolkitMatches?.find((match) => 
              match !== 'AUTH_REQUIRED' && match !== 'AUTH_ERROR' && match.length > 2
            );
            if (toolkitCandidate) {
              toolkit = toolkitCandidate;
            }
          }
          
          if (toolkit) {
            const authUrl = await this.getAuthUrl(toolkit, request.userId);
            return {
              content: `Authorization required for ${toolkit}. Please connect your account to use this feature.`,
              requiresAuth: true,
              authUrl,
              authToolkit: toolkit,
              metadata: { executionTime: Date.now() - startTime },
            };
          } else {
            // Auth required but no toolkit identified - return generic auth prompt
            return {
              content: 'Authorization required. Please connect your account to use this feature.',
              requiresAuth: true,
              metadata: { executionTime: Date.now() - startTime },
            };
          }
        }

        // For other errors, log and rethrow
        throw error;
      }
    },

    async getAvailableToolkits(): Promise<any[]> {
      try {
        const { Composio } = await import('@composio/core');
        const composio = new Composio({ apiKey: config.apiKey });
        const tools = await composio.tools.list();
        // Group tools by toolkit/app
        const toolkitMap = new Map<string, any>();
        for (const tool of (tools || [])) {
          const appName = tool.appName || tool.name?.split('_')[0] || 'unknown';
          if (!toolkitMap.has(appName)) {
            toolkitMap.set(appName, { name: appName, tools: [] });
          }
          toolkitMap.get(appName)!.tools.push(tool);
        }
        return Array.from(toolkitMap.values());
      } catch (error: any) {
        console.error('[ComposioService] Failed to get toolkits:', error.message);
        return [];
      }
    },

    async getConnectedAccounts(userId: string): Promise<any[]> {
      try {
        const { Composio } = await import('@composio/core');
        const composio = new Composio({ apiKey: config.apiKey });
        const accounts = await composio.connectedAccounts.list({ userId });
        return accounts?.items || [];
      } catch (error: any) {
        console.error('[ComposioService] Failed to get connected accounts:', error.message);
        return [];
      }
    },

    async getAuthUrl(toolkit: string, userId: string): Promise<string> {
      try {
        const { Composio } = await import('@composio/core');
        const composio = new Composio({ apiKey: config.apiKey });

        // Check if we have a connected account for this toolkit
        const accounts = await composio.connectedAccounts.list({ userId });
        const existingAccount = (accounts?.items || []).find((a: any) =>
          a.appName?.toLowerCase() === toolkit.toLowerCase()
        );

        if (existingAccount && existingAccount.status === 'active') {
          return '';
        }

        // Use initiateConnection for new connections
        const connectionRequest = await composio.connectedAccounts.initiate({
          userId,
          integrationId: toolkit.toLowerCase(),
        });
        return connectionRequest?.redirectUrl || connectionRequest?.url || '';
      } catch (error: any) {
        console.error('[ComposioService] Failed to get auth URL:', error.message);
        return '';
      }
    },
  };
}

/**
 * Get or create Composio service from environment
 */
export function getOrCreateComposioServiceFromEnv(): ComposioService | null {
  if (composioServiceInstance) {
    return composioServiceInstance;
  }

  if (!process.env.COMPOSIO_API_KEY) {
    return null;
  }

  const config: ComposioServiceConfig = {
    apiKey: process.env.COMPOSIO_API_KEY,
    llmProvider: (process.env.COMPOSIO_LLM_PROVIDER as any) || 'openrouter',
    llmModel: process.env.COMPOSIO_LLM_MODEL,
    enableAllTools: process.env.COMPOSIO_ENABLE_ALL_TOOLS !== 'false',
    restrictedToolkits: process.env.COMPOSIO_RESTRICTED_TOOLKITS
      ? process.env.COMPOSIO_RESTRICTED_TOOLKITS.split(',')
      : undefined,
  };

  return initializeComposioService(config);
}

/**
 * Check if Composio service is available
 */
export function isComposioAvailable(): boolean {
  return !!process.env.COMPOSIO_API_KEY;
}
