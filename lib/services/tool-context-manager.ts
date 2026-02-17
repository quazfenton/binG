import { getToolManager } from '@/lib/tools';
import { toolAuthManager as toolAuthorizationManager } from '@/lib/services/tool-authorization-manager';
import type { LLMMessage } from '@/lib/api/llm-providers';

export interface ToolExecutionContext {
  userId: string;
  conversationId: string;
  sessionId: string;
}

export interface ToolDetectionResult {
  detectedTool: string | null;
  toolInput: any;
  requiresAuth: boolean;
  authUrl?: string;
  toolName?: string;
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
    const toolResult = await toolManager.executeTool(
      detectionResult.detectedTool!,
      detectionResult.toolInput,
      {
        userId,
        conversationId,
        sessionId: `session_${conversationId}` // Generate session ID from conversation ID
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
    const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content;
    if (!lastUserMsg || typeof lastUserMsg !== 'string') {
      return {
        detectedTool: null,
        toolInput: {},
        requiresAuth: false
      };
    }

    const text = lastUserMsg.toLowerCase();
    let detectedTool: string | null = null;
    let toolInput: any = {};

    // Tool detection patterns
    if (text.includes('send') && (text.includes('email') || text.includes('gmail'))) {
      detectedTool = 'gmail.send';
      // Extract email details from message
      const emailMatch = text.match(/to\s+([^\s,]+)/i);
      const subjectMatch = text.match(/subject[:\s]+([^\.]+)/i);
      const bodyMatch = text.match(/body[:\s]+(.+)/i);
      
      toolInput = {
        to: emailMatch ? emailMatch[1] : '',
        subject: subjectMatch ? subjectMatch[1].trim() : 'No Subject',
        body: bodyMatch ? bodyMatch[1].trim() : text
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
      
      toolInput = {
        to: phoneMatch ? phoneMatch[1].replace(/[\s\-\(\)]/g, '') : '',
        body: messageMatch ? messageMatch[1].trim() : text
      };
    } else if (text.includes('create') && text.includes('github') && text.includes('issue')) {
      detectedTool = 'github.create_issue';
      const repoMatch = text.match(/(?:in|for)\s+(?:repository|repo)\s+([^\s,]+)/i);
      const titleMatch = text.match(/(?:create|make|open)\s+(?:an?\s+)?(.+?)\s+issue/i);
      
      toolInput = {
        repo: repoMatch ? repoMatch[1] : 'owner/repo',
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