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
  const appBase = process.env.NEXT_PUBLIC_APP_URL || '';

  const inferProviderFromToolkit = (toolkit?: string): string => {
    const value = String(toolkit || '').toLowerCase();
    if (!value) return 'google';
    if (value.includes('gmail') || value.includes('google')) return 'google';
    if (value.includes('github')) return 'github';
    if (value.includes('slack')) return 'slack';
    if (value.includes('notion')) return 'notion';
    if (value.includes('discord')) return 'discord';
    if (value.includes('twitter') || value === 'x') return 'twitter';
    if (value.includes('spotify')) return 'spotify';
    return value;
  };

  const buildFallbackAuthUrl = (toolkit?: string): string => {
    const provider = inferProviderFromToolkit(toolkit);
    const arcadeProviders = ['google', 'gmail', 'googledocs', 'googlesheets', 'googlecalendar', 'googledrive', 'googlemaps', 'exa', 'twilio', 'spotify', 'vercel', 'railway'];
    const nangoProviders = ['github', 'slack', 'discord', 'twitter', 'reddit'];
    if (arcadeProviders.includes(provider)) {
      return `${appBase}/api/auth/arcade/authorize?provider=${encodeURIComponent(provider)}&redirect=1`;
    }
    if (nangoProviders.includes(provider)) {
      return `${appBase}/api/auth/nango/authorize?provider=${encodeURIComponent(provider)}&redirect=1`;
    }
    return `${appBase}/api/auth/oauth/initiate?provider=${encodeURIComponent(provider)}`;
  };

  const isAuthFailure = (payload: any): boolean => {
    const haystack = JSON.stringify(payload || {}).toLowerCase();
    return (
      haystack.includes('auth_required') ||
      haystack.includes('authorization required') ||
      haystack.includes('connect your account') ||
      haystack.includes('oauth')
    );
  };

  const extractToolArray = (raw: any): any[] => {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.items)) return raw.items;
    if (Array.isArray(raw?.tools)) return raw.tools;
    return [];
  };

  const normalizeTool = (tool: any) => {
    const name = tool?.slug || tool?.name || tool?.toolSlug;
    const description = tool?.description || tool?.deprecated?.displayName || `Tool ${name}`;
    const parameters =
      tool?.inputParameters ||
      tool?.input_parameters ||
      tool?.parameters ||
      {
        type: 'object',
        properties: {},
        additionalProperties: true,
      };

    const toolkit =
      tool?.toolkit?.slug ||
      tool?.toolkitSlug ||
      tool?.appName ||
      (typeof name === 'string' ? String(name).split('_')[0]?.toLowerCase() : 'unknown');

    return { ...tool, name, description, parameters, toolkit };
  };

  const loadToolsForRequest = async (
    composio: any,
    userId: string,
    requestedToolkits?: string[]
  ): Promise<any[]> => {
    const requested = (requestedToolkits || []).map((t) => t.toLowerCase());

    const filterByToolkit = (tools: any[]) => {
      if (requested.length === 0) return tools;
      return tools.filter((tool) => requested.includes(String(tool.toolkit || '').toLowerCase()));
    };

    // Preferred path for newer SDK docs: composio.tools.get(userId, filters)
    if (typeof composio?.tools?.get === 'function') {
      try {
        const result = await composio.tools.get(userId, {
          ...(requested.length > 0 ? { toolkits: requested } : {}),
          limit: 300,
        });
        const tools = extractToolArray(result).map(normalizeTool);
        if (tools.length > 0) return filterByToolkit(tools);
      } catch {}
    }

    // Common list path in several SDK versions
    if (typeof composio?.tools?.list === 'function') {
      const tryParams = [
        requested.length > 0 ? { toolkit_slug: requested[0], limit: 300 } : { limit: 300 },
        requested.length > 0 ? { apps: requested.join(','), limit: 300 } : { limit: 300 },
        requested.length > 0 ? { toolkits: requested, limit: 300 } : { limit: 300 },
        undefined,
      ];
      for (const params of tryParams) {
        try {
          const result = params ? await composio.tools.list(params) : await composio.tools.list();
          const tools = extractToolArray(result).map(normalizeTool);
          if (tools.length > 0) return filterByToolkit(tools);
        } catch {}
      }
    }

    // Session-based native tools path
    if (typeof composio?.create === 'function') {
      try {
        const session = await composio.create(userId);
        if (typeof session?.tools === 'function') {
          const result = await session.tools();
          const tools = extractToolArray(result).map(normalizeTool);
          if (tools.length > 0) return filterByToolkit(tools);
        }
      } catch {}
    }

    // Raw tools fallback
    if (typeof composio?.tools?.getRawComposioTools === 'function') {
      try {
        const result = await composio.tools.getRawComposioTools({
          ...(requested.length > 0 ? { toolkits: requested } : {}),
          limit: 300,
        });
        const tools = extractToolArray(result).map(normalizeTool);
        if (tools.length > 0) return filterByToolkit(tools);
      } catch {}
    }

    return [];
  };

  const inferToolkitFromUserMessage = (raw: string): string | null => {
    const text = String(raw || '').toLowerCase();
    if (!text) return null;
    if (text.includes('gmail') || text.includes('email')) return 'google';
    if (text.includes('github')) return 'github';
    if (text.includes('slack')) return 'slack';
    if (text.includes('notion')) return 'notion';
    if (text.includes('discord')) return 'discord';
    if (text.includes('twitter') || text.includes('tweet') || text.includes('x ')) return 'twitter';
    if (text.includes('spotify')) return 'spotify';
    return null;
  };

  const hasActiveConnectionForToolkit = (accounts: any[], toolkit: string): boolean => {
    const target = inferProviderFromToolkit(toolkit);
    return (accounts || []).some((a: any) => {
      const appName = String(a?.appName || a?.integrationId || a?.toolkitSlug || a?.provider || '').toLowerCase();
      const status = String(a?.status || '').toLowerCase();
      const statusOk = !status || status === 'active' || status === 'connected' || status === 'authorized';
      return statusOk && (appName === target || appName.includes(target));
    });
  };

  return {
    async healthCheck(): Promise<boolean> {
      try {
        const { Composio } = await import('@composio/core');
        const composio = new Composio({ apiKey: config.apiKey });

        // Verify API connectivity with read-only methods, across SDK variants.
        if (typeof (composio as any)?.tools?.list === 'function') {
          await (composio as any).tools.list({ limit: 1 });
          return true;
        }
        if (typeof (composio as any)?.tools?.getToolsEnum === 'function') {
          await (composio as any).tools.getToolsEnum();
          return true;
        }
        if (typeof (composio as any)?.tools?.getRawComposioTools === 'function') {
          await (composio as any).tools.getRawComposioTools({ limit: 1 });
          return true;
        }
        if (typeof (composio as any)?.connectedAccounts?.list === 'function') {
          await (composio as any).connectedAccounts.list({ userId: 'healthcheck' });
          return true;
        }

        return false;
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

        // Create session for user when available (not required on all SDK paths)
        const session = typeof (composio as any).create === 'function'
          ? await composio.create(request.userId)
          : null;

        // Get available tools - filter by requested toolkits if specified
        let effectiveToolkits: string[] | undefined = request.toolkits;
        if (config.restrictedToolkits && config.restrictedToolkits.length > 0) {
          effectiveToolkits = request.toolkits && request.toolkits.length > 0
            ? request.toolkits.filter((toolkit) => config.restrictedToolkits!.includes(toolkit))
            : config.restrictedToolkits;
        }
        const tools = await loadToolsForRequest(composio, request.userId, effectiveToolkits);

        // Extract the last user message
        const lastMessage = request.messages
          .filter((m: any) => m.role === 'user')
          .pop()?.content;

        if (!lastMessage) {
          return {
            content: 'No user message found to process',
            metadata: { sessionId: session?.id, executionTime: Date.now() - startTime },
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
                let result: any;
                try {
                  result = await composio.tools.execute(toolSlug, {
                    userId: request.userId,
                    arguments: toolArgs,
                    dangerouslySkipVersionCheck: true,
                  });
                } catch {
                  // Backward-compatible payload shape fallback
                  result = await composio.tools.execute(toolSlug, {
                    connectedAccountId: request.userId,
                    input: toolArgs,
                  });
                }

                // Some SDK versions return auth-required as a normal unsuccessful payload, not thrown error
                if (result?.successful === false && isAuthFailure(result)) {
                  const kitName = toolSlug.split('_')[0].toUpperCase();
                  const authUrl = (await this.getAuthUrl(kitName, request.userId)) || buildFallbackAuthUrl(kitName);
                  return {
                    content: `Authorization required for ${kitName}. Please connect your account.`,
                    requiresAuth: true,
                    authUrl,
                    authToolkit: kitName,
                    metadata: { sessionId: session?.id, toolsUsed: toolCalls.map((t: any) => t.function?.name) },
                  };
                }

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
                  const authUrl = (await this.getAuthUrl(kitName, request.userId)) || buildFallbackAuthUrl(kitName);
                  return {
                    content: `Authorization required for ${kitName}. Please connect your account.`,
                    requiresAuth: true,
                    authUrl,
                    authToolkit: kitName,
                    metadata: { sessionId: session?.id, toolsUsed: toolCalls.map((t: any) => t.function?.name) },
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
                  userId: request.userId,
                  arguments: call.args,
                  dangerouslySkipVersionCheck: true,
                });
                if (toolResult?.successful === false && isAuthFailure(toolResult)) {
                  const kitName = call.name.split('_')[0].toUpperCase();
                  const authUrl = (await this.getAuthUrl(kitName, request.userId)) || buildFallbackAuthUrl(kitName);
                  return {
                    content: `Authorization required for ${kitName}. Please connect your account.`,
                    requiresAuth: true,
                    authUrl,
                    authToolkit: kitName,
                    metadata: { sessionId: session?.id, toolsUsed: toolCalls.map((t: any) => t.function?.name) },
                  };
                }
                functionResponses.push({
                  name: call.name,
                  response: toolResult,
                });
              } catch (toolError: any) {
                if (toolError.message?.includes('auth') || toolError.message?.includes('connect')) {
                  const kitName = call.name.split('_')[0].toUpperCase();
                  const authUrl = (await this.getAuthUrl(kitName, request.userId)) || buildFallbackAuthUrl(kitName);
                  return {
                    content: `Authorization required for ${kitName}. Please connect your account.`,
                    requiresAuth: true,
                    authUrl,
                    authToolkit: kitName,
                    metadata: { sessionId: session?.id, toolsUsed: toolCalls.map((t: any) => t.function?.name) },
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
        const connectedItems = connectedAccounts?.items || [];

        // Deterministic auth fallback:
        // if no textual output and no successful tool outcome, guide user to connect the likely toolkit.
        if (!content || !String(content).trim()) {
          const inferredToolkit = inferToolkitFromUserMessage(String(lastMessage));
          if (inferredToolkit && !hasActiveConnectionForToolkit(connectedItems, inferredToolkit)) {
            const authUrl = (await this.getAuthUrl(inferredToolkit, request.userId)) || buildFallbackAuthUrl(inferredToolkit);
            return {
              content: `Authorization required for ${inferredToolkit}. Please connect your account to proceed.`,
              requiresAuth: true,
              authUrl,
              authToolkit: inferredToolkit,
              metadata: {
                sessionId: session?.id,
                toolsUsed: toolCalls.map((t: any) => t.function?.name),
                executionTime: Date.now() - startTime,
              },
            };
          }

          content = toolCalls.length > 0
            ? `Tool request was processed (${toolCalls.length} tool call${toolCalls.length > 1 ? 's' : ''}) but returned no text output.`
            : 'Tool request was processed but returned no text output.';
        }

        return {
          content,
          toolCalls,
          connectedAccounts: connectedItems,
          metadata: {
            sessionId: session?.id,
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
            const authUrl = (await this.getAuthUrl(toolkit, request.userId)) || buildFallbackAuthUrl(toolkit);
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
              authUrl: buildFallbackAuthUrl('google'),
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
        const tools = await loadToolsForRequest(composio, 'default');
        // Group tools by toolkit/app
        const toolkitMap = new Map<string, any>();
        for (const tool of (tools || [])) {
          const appName = tool.toolkit || tool.appName || tool.name?.split('_')[0] || 'unknown';
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
        // Prefer direct Composio connection init; skip pre-list query because
        // some SDK versions reject list() with optional fields shaping.
        try {
          const connectionRequest = await composio.connectedAccounts.initiate({
            userId,
            integrationId: toolkit.toLowerCase(),
          });
          const directUrl = connectionRequest?.redirectUrl || connectionRequest?.url;
          if (directUrl) return directUrl;
        } catch (initErr: any) {
          console.warn('[ComposioService] Direct initiate failed, using provider auth fallback:', initErr?.message);
        }
        return buildFallbackAuthUrl(toolkit);
      } catch (error: any) {
        console.error('[ComposioService] Failed to get auth URL:', error.message);
        return buildFallbackAuthUrl(toolkit);
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
