import { getToolManager } from '@/lib/tools';
import { toolAuthManager as toolAuthorizationManager } from '@/lib/services/tool-authorization-manager';
import type { LLMMessage } from '@/lib/api/llm-providers';
import type { ToolExecutionContext } from '@/lib/tools';
import { authService } from '@/lib/auth/auth-service';

export interface ToolDetectionResult {
  detectedTool: string | null;
  toolInput: any;
  requiresAuth: boolean;
  authUrl?: string;
  toolName?: string;
  error?: string;  // Error message for missing parameters
}

export interface ToolProcessingResult {
  requiresAuth: boolean;
  authUrl?: string;
  toolName?: string;
  toolCalls: any[];
  toolResults: any[];
  content: string;
}

export class ToolContextManager {
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
   * Process a tool request with proper authorization checking
   */
  async processToolRequest(
    messages: LLMMessage[],
    userId: string,
    conversationId: string
  ): Promise<ToolProcessingResult> {
    // Detect tool intent from messages
    const detectionResult = this.detectToolIntent(messages);

    // If detection returned an error (missing parameters), propagate it first
    if (detectionResult.error) {
      return {
        requiresAuth: false,
        toolCalls: [],
        toolResults: [],
        content: `Invalid request: ${detectionResult.error}`
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
        return {
          requiresAuth: true,
          authUrl,
          toolName: detectionResult.detectedTool,
          toolCalls: [],
          toolResults: [],
          content: `AUTH_REQUIRED:${authUrl}:${detectionResult.detectedTool}`
        };
      }
    }

    // If authorized, execute the tool
    const toolManager = getToolManager();
    const userEmail = await this.resolveUserEmail(userId);
    const strategy = (process.env.ARCADE_USER_ID_STRATEGY || 'email').toLowerCase();
    const arcadeUserId = strategy === 'email' && userEmail ? userEmail : userId;

    const toolResult = await toolManager.executeTool(
      detectionResult.detectedTool!,
      detectionResult.toolInput,
      {
        userId,
        conversationId,
        metadata: {
          sessionId: `session_${conversationId}`, // Store session ID in metadata
          userEmail,
          arcadeUserId,
        }
      }
    );

    if (toolResult.success) {
      return {
        requiresAuth: false,
        toolCalls: [{ name: detectionResult.detectedTool!, arguments: detectionResult.toolInput }],
        toolResults: [{ name: detectionResult.detectedTool!, result: toolResult.output }],
        content: toolResult.output ? JSON.stringify(toolResult.output) : `Tool ${detectionResult.detectedTool!} executed successfully`
      };
    } else {
      return {
        requiresAuth: false,
        toolCalls: [],
        toolResults: [],
        content: `Tool execution failed: ${toolResult.error}`
      };
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
