import { getToolManager, getToolErrorHandler } from '../tools';
import { toolAuthManager as toolAuthorizationManager } from './tool-authorization-manager';
import type { LLMMessage } from '../chat/llm-providers';
import type { ToolExecutionContext } from '../tools';
import { authService } from '../auth/auth-service';

export interface ToolDetectionResult {
  detectedTool: string | null;
  toolInput: any;
  requiresAuth: boolean;
  authUrl?: string;
  toolName?: string;
  error?: string;
}

export interface ToolProcessingResult {
  requiresAuth: boolean;
  authUrl?: string;
  toolName?: string;
  toolCalls: any[];
  toolResults: any[];
  content: string;
  error?: {
    type: 'validation' | 'auth' | 'execution' | 'not_found';
    message: string;
    details?: any;
    parameters?: any;
  };
}

export interface OAuthCapabilityResult {
  success: boolean;
  action: 'connect' | 'list' | 'revoke' | 'execute';
  authUrl?: string;
  connections?: any[];
  providers?: string[];
  output?: any;
  error?: string;
  message?: string;
  requiresAuth?: boolean;
}

export class ToolContextManager {
  private errorHandler = getToolErrorHandler();

  private async resolveUserEmail(userId: string): Promise<string | undefined> {
    const numericUserId = Number(userId);
    if (Number.isNaN(numericUserId)) return undefined;
    try {
      const user = await authService.getUserById(numericUserId);
      return user?.email;
    } catch {
      return undefined;
    }
  }

  /**
   * Process a tool request with proper authorization checking and error propagation
   */
  async processToolRequest(
    messages: LLMMessage[],
    userId: string,
    conversationId: string,
    scopePath?: string
  ): Promise<ToolProcessingResult> {
    // Check for OAuth integration capability requests first
    const oauthCapabilityResult = await this.checkOAuthCapabilityRequest(messages, userId, conversationId);
    if (oauthCapabilityResult) {
      return oauthCapabilityResult;
    }

    // Detect tool intent from messages
    const detectionResult = this.detectToolIntent(messages);

    // If detection returned an error (missing parameters), propagate it with full details
    if (detectionResult.error) {
      const toolError = this.errorHandler.createValidationError(detectionResult.error, detectionResult.toolInput);
      return {
        requiresAuth: false,
        toolCalls: [],
        toolResults: [],
        content: `Invalid request: ${toolError.message}\n\nHints:\n${toolError.hints?.join('\n') || 'Check required parameters'}`,
        error: {
          type: 'validation',
          message: toolError.message,
          details: { category: toolError.category, retryable: toolError.retryable },
          parameters: detectionResult.toolInput,
        }
      };
    }

    if (!detectionResult.detectedTool) {
      return {
        requiresAuth: false,
        toolCalls: [],
        toolResults: [],
        content: 'No tool intent detected'
      };
    }

    // Check if user is authorized for the detected tool
    const isAuthorized = await toolAuthorizationManager.isAuthorized(userId, detectionResult.detectedTool);

    if (!isAuthorized) {
      const provider = toolAuthorizationManager.getRequiredProvider(detectionResult.detectedTool);
      if (provider) {
        const authUrl = toolAuthorizationManager.getAuthorizationUrl(provider);
        const toolError = this.errorHandler.createAuthError(`Authorization required for ${detectionResult.detectedTool}`, authUrl);
        return {
          requiresAuth: true,
          authUrl,
          toolName: detectionResult.detectedTool,
          toolCalls: [],
          toolResults: [],
          content: `AUTH_REQUIRED:${authUrl}:${detectionResult.detectedTool}`,
          error: {
            type: 'auth',
            message: toolError.message,
            details: { provider, authUrl },
          }
        };
      }
    }

    // If authorized, execute the tool
    const toolManager = getToolManager();
    const userEmail = await this.resolveUserEmail(userId);
    const strategy = (process.env.ARCADE_USER_ID_STRATEGY || 'email').toLowerCase();
    const arcadeUserId = strategy === 'email' && userEmail ? userEmail : userId;

    try {
      const toolContext = {
        userId,
        conversationId,
        metadata: {
          sessionId: `session_${conversationId}`,
          userEmail,
          arcadeUserId,
          scopePath,
        }
      };

      const toolResult = await toolManager.executeTool(
        detectionResult.detectedTool!,
        detectionResult.toolInput,
        toolContext
      );

      if (toolResult.success) {
        return {
          requiresAuth: false,
          toolCalls: [{ name: detectionResult.detectedTool!, arguments: detectionResult.toolInput }],
          toolResults: [{ name: detectionResult.detectedTool!, result: toolResult.output }],
          content: toolResult.output ? JSON.stringify(toolResult.output) : `Tool ${detectionResult.detectedTool!} executed successfully`
        };
      } else {
        // Handle execution error with unified error handler
        const toolError = this.errorHandler.handleError(
          new Error(toolResult.error || 'Unknown execution error'),
          detectionResult.detectedTool!,
          detectionResult.toolInput
        );

        return {
          requiresAuth: false,
          toolCalls: [{ name: detectionResult.detectedTool!, arguments: detectionResult.toolInput }],
          toolResults: [],
          content: `Tool execution failed: ${toolError.message}\n\nHints:\n${toolError.hints?.join('\n') || 'Please try again'}`,
          error: {
            type: 'execution',
            message: toolError.message,
            details: { category: toolError.category, retryable: toolError.retryable, ...toolResult },
            parameters: detectionResult.toolInput,
          }
        };
      }
    } catch (executionError: any) {
      // Handle unexpected execution error with unified error handler
      const toolError = this.errorHandler.handleError(executionError, detectionResult.detectedTool!, detectionResult.toolInput);

      return {
        requiresAuth: false,
        toolCalls: [{ name: detectionResult.detectedTool!, arguments: detectionResult.toolInput }],
        toolResults: [],
        content: `Tool execution failed: ${toolError.message}\n\nHints:\n${toolError.hints?.join('\n') || 'Please try again'}`,
        error: {
          type: 'execution',
          message: toolError.message,
          details: { category: toolError.category, retryable: toolError.retryable, stack: executionError.stack },
          parameters: detectionResult.toolInput,
        }
      };
    }
  }

  /**
   * Check if request is for OAuth integration capability
   * 
   * Detects patterns like:
   * - "connect my gmail account"
   * - "list my connections"
   * - "revoke github access"
   * - "show available tools"
   */
  private async checkOAuthCapabilityRequest(
    messages: LLMMessage[],
    userId: string,
    conversationId: string
  ): Promise<ToolProcessingResult | null> {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content).filter((c): c is string => typeof c === 'string');
    const lastUserMsg = userMessages[userMessages.length - 1];
    if (!lastUserMsg) return null;

    const text = lastUserMsg.toLowerCase();

    // Detect OAuth capability patterns
    let capability: string | null = null;
    let params: any = {};

    // Known OAuth providers for better pattern matching
    const oauthProviders = ['gmail', 'google', 'github', 'slack', 'discord', 'twitter', 'reddit', 'notion', 'dropbox', 'spotify', 'twilio'];
    
    // Pattern: "connect [provider]" or "authorize [provider]" or "link [provider]"
    // More specific: look for provider names
    for (const provider of oauthProviders) {
      if (text.includes(`connect ${provider}`) || text.includes(`connect my ${provider}`) ||
          text.includes(`authorize ${provider}`) || text.includes(`authorize my ${provider}`) ||
          text.includes(`link ${provider}`) || text.includes(`link my ${provider}`)) {
        capability = 'integration.connect';
        params.provider = provider;
        break;
      }
    }
    
    // Fallback to generic pattern if no specific provider matched
    if (!capability) {
      const connectMatch = text.match(/(?:connect|authorize|link)\s+(?:my\s+)?(\w+)/i);
      if (connectMatch) {
        capability = 'integration.connect';
        params.provider = connectMatch[1];
      }
    }

    // Pattern: "list connections" or "show connections" or "my connections"
    if (text.includes('list connections') || text.includes('show connections') || text.includes('my connections') || text.includes('list my connections')) {
      capability = 'integration.list_connections';
      const providerMatch = text.match(/(?:for|from)\s+(\w+)/i);
      if (providerMatch) {
        params.provider = providerMatch[1];
      }
    }

    // Pattern: "revoke [provider]" or "disconnect [provider]" or "remove [provider]"
    for (const provider of oauthProviders) {
      if (text.includes(`revoke ${provider}`) || text.includes(`revoke my ${provider}`) ||
          text.includes(`disconnect ${provider}`) || text.includes(`disconnect my ${provider}`) ||
          text.includes(`remove ${provider}`) || text.includes(`remove my ${provider}`)) {
        capability = 'integration.revoke';
        params.provider = provider;
        break;
      }
    }
    
    // Fallback to generic pattern
    if (!capability) {
      const revokeMatch = text.match(/(?:revoke|disconnect|remove)\s+(?:my\s+)?(\w+)/i);
      if (revokeMatch) {
        capability = 'integration.revoke';
        params.provider = revokeMatch[1];
      }
    }

    // Pattern: "what tools" or "available tools" or "show tools"
    if (text.includes('what tools') || text.includes('available tools') || text.includes('show tools') || text.includes('list tools')) {
      capability = 'integration.search_tools';
    }

    if (!capability) return null;

    // Process OAuth capability
    const result = await this.processOAuthCapability(capability, params, userId, conversationId);

    // Convert OAuthCapabilityResult to ToolProcessingResult
    if (result.success) {
      return {
        requiresAuth: false,
        toolCalls: [{ name: capability, arguments: params }],
        toolResults: [{ name: capability, result: result }],
        content: this.formatOAuthResult(result),
      };
    } else {
      return {
        requiresAuth: result.requiresAuth || false,
        authUrl: result.authUrl,
        toolName: capability,
        toolCalls: [{ name: capability, arguments: params }],
        toolResults: [],
        content: result.error || 'OAuth operation failed',
        error: {
          type: result.requiresAuth ? 'auth' : 'execution',
          message: result.error || 'Operation failed',
          parameters: params,
        }
      };
    }
  }

  /**
   * Format OAuth capability result as user-friendly message
   */
  private formatOAuthResult(result: OAuthCapabilityResult): string {
    switch (result.action) {
      case 'connect':
        if (result.authUrl) {
          return `To connect your account, please visit: ${result.authUrl}`;
        }
        return result.message || 'Connection initiated';

      case 'list':
        if (result.providers && result.providers.length > 0) {
          return `Connected providers: ${result.providers.join(', ')}`;
        }
        return 'No connected providers found';

      case 'revoke':
        return result.message || 'Connection revoked';

      case 'execute':
        if (result.output) {
          return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
        }
        return 'Tool executed successfully';

      default:
        return result.message || 'Operation completed';
    }
  }

  /**
   * Detect tool intent from messages
   */
  private detectToolIntent(messages: LLMMessage[]): ToolDetectionResult {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content).filter((c): c is string => typeof c === 'string');
    const lastUserMsg = userMessages[userMessages.length - 1];
    if (!lastUserMsg) {
      return {
        detectedTool: null,
        toolInput: {},
        requiresAuth: false
      };
    }

    const text = lastUserMsg.toLowerCase();
    const previousUserMsg = userMessages.length > 1 ? userMessages[userMessages.length - 2] : '';
    const previousText = previousUserMsg.toLowerCase();
    let detectedTool: string | null = null;
    let toolInput: any = {};

    const followUpSendIntent = /\b(send it|send that|do it|go ahead|yes send)\b/i.test(text);
    const emailBaseText = followUpSendIntent && previousText ? previousText : text;

    // Tool detection patterns
    if ((emailBaseText.includes('send') && (emailBaseText.includes('email') || emailBaseText.includes('gmail'))) || (followUpSendIntent && (previousText.includes('email') || previousText.includes('gmail')))) {
      detectedTool = 'gmail.send';
      // Extract email details from message
      const emailMatch = emailBaseText.match(/to\s+([^\s,]+)/i);
      const subjectMatch = emailBaseText.match(/subject[:\s]+([^\.]+)/i);
      const bodyMatch = emailBaseText.match(/body[:\s]+(.+)/i);

      // Require recipient email - don't proceed with empty 'to' field
      if (!emailMatch) {
        return {
          detectedTool: null,
          toolInput: {},
          requiresAuth: false,
          error: 'Missing recipient email address. Please specify who to send the email to.'
        };
      }

      toolInput = {
        to: emailMatch[1],
        subject: subjectMatch ? subjectMatch[1].trim() : 'No Subject',
        body: bodyMatch ? bodyMatch[1].trim() : (followUpSendIntent && previousUserMsg ? previousUserMsg : lastUserMsg)
      };
    } else if (text.includes('read') && (text.includes('email') || text.includes('gmail'))) {
      detectedTool = 'gmail.read';
      toolInput = { maxResults: 5 };
    } else if (text.includes('create') && text.includes('calendar') && text.includes('event')) {
      detectedTool = 'googlecalendar.create';
      // Extract event details
      const titleMatch = text.match(/(?:create|schedule|add)\s+(?:a\s+)?(.+?)\s+(?:event|meeting)/i);
      const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/i);
      const timeMatch = text.match(/\b(\d{1,2}:\d{2}(?:\s*(?:am|pm))?)\b/i);

      toolInput = {
        title: titleMatch ? titleMatch[1].trim() : 'New Event',
        date: dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0],
        time: timeMatch ? timeMatch[1] : '12:00 PM'
      };
    } else if (text.includes('post') && text.includes('twitter')) {
      detectedTool = 'twitter.post';
      toolInput = { content: text.replace(/(please|can you|could you)\s+(post|tweet)/i, '').trim() };
    } else if (text.includes('send') && text.includes('sms')) {
      detectedTool = 'twilio.send_sms';
      const phoneMatch = text.match(/(?:to|phone|number)\s+([+]?[\d\s\-\(\)]+)/i);
      const messageMatch = text.match(/(?:message|sms|text)[:\s]+(.+)/i);

      // Require phone number - don't proceed with empty 'to' field
      if (!phoneMatch) {
        return {
          detectedTool: null,
          toolInput: {},
          requiresAuth: false,
          error: 'Missing phone number. Please specify the recipient\'s phone number.'
        };
      }

      toolInput = {
        to: phoneMatch[1].replace(/[\s\-\(\)]/g, ''),
        body: messageMatch ? messageMatch[1].trim() : text
      };
    } else if (text.includes('create') && text.includes('github') && text.includes('issue')) {
      detectedTool = 'github.create_issue';
      const repoMatch = text.match(/(?:in|for)\s+(?:repository|repo)\s+([^\s,]+)/i);
      const titleMatch = text.match(/(?:create|make|open)\s+(?:an?\s+)?(.+?)\s+issue/i);

      // Require repository - don't proceed with placeholder
      if (!repoMatch) {
        return {
          detectedTool: null,
          toolInput: {},
          requiresAuth: false,
          error: 'Missing repository name. Please specify which repository to create the issue in (e.g., "in owner/repo").'
        };
      }

      toolInput = {
        repo: repoMatch[1],
        title: titleMatch ? titleMatch[1].trim() : 'New Issue',
        body: text
      };
    } else if (text.includes('search') && text.includes('exa')) {
      detectedTool = 'exa.search';
      toolInput = { query: text.replace(/(search|find|look up)\s+(with\s+)?exa\s+/i, '').trim() };
    }

    return {
      detectedTool,
      toolInput,
      requiresAuth: false // Authorization check happens separately
    };
  }

  /**
   * Process OAuth integration capability requests
   * 
   * Handles:
   * - integration.connect: Initiate OAuth connection
   * - integration.list_connections: List user connections
   * - integration.revoke: Revoke connection
   * - integration.execute: Execute tool with auth check
   * 
   * @param capability - OAuth capability name (e.g., 'integration.connect')
   * @param params - Capability parameters
   * @param userId - User identifier
   * @param conversationId - Conversation ID for context
   * @returns OAuth capability result
   */
  async processOAuthCapability(
    capability: string,
    params: any,
    userId: string,
    conversationId: string
  ): Promise<OAuthCapabilityResult> {
    try {
      // Parse capability name
      const capabilityType = capability.replace('integration.', '');

      switch (capabilityType) {
        case 'connect': {
          // Initiate OAuth connection
          const provider = params.provider;
          if (!provider) {
            return {
              success: false,
              action: 'connect',
              error: 'Missing provider parameter',
            };
          }

          const result = await toolAuthorizationManager.initiateConnection(userId, provider);
          return {
            success: result.success,
            action: 'connect',
            authUrl: result.authUrl,
            message: result.message,
          };
        }

        case 'list_connections': {
          // List user connections
          const provider = params.provider;
          const result = await toolAuthorizationManager.listConnections(userId, provider);
          return {
            success: result.success,
            action: 'list',
            connections: result.connections,
            providers: result.providers,
          };
        }

        case 'revoke': {
          // Revoke connection
          const provider = params.provider;
          const connectionId = params.connectionId;
          if (!provider) {
            return {
              success: false,
              action: 'revoke',
              error: 'Missing provider parameter',
            };
          }

          const result = await toolAuthorizationManager.revokeConnection(userId, provider, connectionId);
          return {
            success: result.success,
            action: 'revoke',
            message: result.message,
          };
        }

        case 'execute': {
          // Execute tool with authorization check
          const provider = params.provider;
          const action = params.action;
          const toolParams = params.params || {};

          if (!provider || !action) {
            return {
              success: false,
              action: 'execute',
              error: 'Missing provider or action parameter',
            };
          }

          // Check authorization first
          const toolName = `${provider}.${action}`;
          const isAuthorized = await toolAuthorizationManager.isAuthorized(userId, toolName);

          if (!isAuthorized) {
            const authUrl = toolAuthorizationManager.getAuthorizationUrl(provider);
            return {
              success: false,
              action: 'execute',
              requiresAuth: true,
              authUrl,
              error: `Authorization required for ${provider}.${action}`,
            };
          }

          // Execute via tool manager
          const toolManager = getToolManager();
          const toolResult = await toolManager.executeTool(toolName, toolParams, {
            userId,
            conversationId,
          });

          if (toolResult.success) {
            return {
              success: true,
              action: 'execute',
              output: toolResult.output,
            };
          } else {
            return {
              success: false,
              action: 'execute',
              error: toolResult.error,
              requiresAuth: toolResult.authRequired,
              authUrl: toolResult.authUrl,
            };
          }
        }

        case 'search_tools': {
          // Search available tools
          const result = await toolAuthorizationManager.getAvailableTools(userId);
          return {
            success: true,
            action: 'list',
            output: result.map(tool => ({ name: tool })),
          };
        }

        default:
          return {
            success: false,
            action: 'execute',
            error: `Unknown OAuth capability: ${capability}`,
          };
      }
    } catch (error: any) {
      console.error('[ToolContext] processOAuthCapability failed:', error);
      return {
        success: false,
        action: 'execute',
        error: error.message,
      };
    }
  }

  /**
   * Get available tools for a user based on their authorizations
   */
  async getAvailableTools(userId: string): Promise<string[]> {
    return await toolAuthorizationManager.getAvailableTools(userId);
  }

  /**
   * Check if a specific tool is available for a user
   */
  async isToolAvailable(userId: string, toolName: string): Promise<boolean> {
    return await toolAuthorizationManager.isAuthorized(userId, toolName);
  }
}

export const toolContextManager = new ToolContextManager();
