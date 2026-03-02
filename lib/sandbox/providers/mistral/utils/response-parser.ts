/**
 * Mistral Response Parser
 *
 * Parses and validates responses from Mistral AI API.
 * Extracts code execution results, tool calls, and structured outputs.
 */

import type { ToolResult } from '../../types';
import type {
  CodeExecutionResult,
  Conversation,
  TokenUsage,
} from '../mistral-types';

export interface ParsedToolCall {
  toolName: string;
  args: Record<string, any>;
  callId?: string;
  thought?: string;
}

export interface ParsedResponse {
  success: boolean;
  content?: string;
  toolCalls?: ParsedToolCall[];
  usage?: TokenUsage;
  error?: string;
}

export class ResponseParser {
  /**
   * Parse code execution result from conversation response
   */
  parseCodeExecutionResult(response: any): CodeExecutionResult | null {
    if (!response?.outputs || !Array.isArray(response.outputs)) {
      return null;
    }

    // Look for tool execution entries
    for (const entry of response.outputs) {
      if (entry.type === 'tool.execution' && entry.name === 'code_interpreter') {
        const info = entry.info;
        if (info?.code_output !== undefined) {
          return {
            success: true,
            output:
              typeof info.code_output === 'string'
                ? info.code_output
                : JSON.stringify(info.code_output, null, 2),
            exitCode: 0,
            metadata: {
              executedCode: info.code,
              language: 'python',
              executionTime: this.calculateExecutionTime(entry),
            },
          };
        }
      }
    }

    // Fallback: extract text output
    const textOutput = this.extractTextContent(response);
    if (textOutput) {
      return {
        success: true,
        output: textOutput,
        exitCode: 0,
      };
    }

    return null;
  }

  /**
   * Parse tool result from response
   */
  parseToolResult(response: any): ToolResult {
    const codeResult = this.parseCodeExecutionResult(response);

    if (codeResult) {
      return {
        success: codeResult.success,
        output: codeResult.output,
        exitCode: codeResult.exitCode,
      };
    }

    // Fallback to text extraction
    const textOutput = this.extractTextContent(response);
    return {
      success: textOutput.length > 0,
      output: textOutput || 'No output received',
      exitCode: textOutput.length > 0 ? 0 : 1,
    };
  }

  /**
   * Extract text content from conversation response
   */
  extractTextContent(response: any): string {
    if (!response?.outputs || !Array.isArray(response.outputs)) {
      return '';
    }

    const texts: string[] = [];

    for (const entry of response.outputs) {
      if (entry.type === 'message.output') {
        const content = entry.content;

        if (typeof content === 'string') {
          texts.push(content);
        } else if (Array.isArray(content)) {
          for (const chunk of content) {
            if (chunk.type === 'text' && chunk.text) {
              texts.push(chunk.text);
            }
          }
        }
      }
    }

    return texts.join('\n').trim();
  }

  /**
   * Parse tool calls from response
   */
  parseToolCalls(response: any): ParsedToolCall[] {
    if (!response?.outputs || !Array.isArray(response.outputs)) {
      return [];
    }

    const toolCalls: ParsedToolCall[] = [];

    for (const entry of response.outputs) {
      if (entry.type === 'tool.execution') {
        const toolCall: ParsedToolCall = {
          toolName: entry.name,
          args: entry.info || {},
          callId: entry.id,
        };

        // Extract thought if present
        if (entry.thought) {
          toolCall.thought = entry.thought;
        }

        toolCalls.push(toolCall);
      }
    }

    return toolCalls;
  }

  /**
   * Parse token usage from response
   */
  parseTokenUsage(response: any): TokenUsage | undefined {
    if (!response?.usage) {
      return undefined;
    }

    const usage = response.usage;
    return {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      connector_tokens: usage.connector_tokens,
      connectors: usage.connectors,
    };
  }

  /**
   * Parse complete response
   */
  parseResponse(response: any): ParsedResponse {
    try {
      const toolCalls = this.parseToolCalls(response);
      const content = this.extractTextContent(response);
      const usage = this.parseTokenUsage(response);

      return {
        success: true,
        content: content || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Extract JSON from response text
   */
  extractJsonFromResponse(text: string): any | null {
    // Try to find JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  /**
   * Parse structured output (JSON schema response)
   */
  parseStructuredOutput<T>(response: any, schema?: any): T | null {
    const text = this.extractTextContent(response);
    const json = this.extractJsonFromResponse(text);

    if (!json) {
      return null;
    }

    // Validate against schema if provided
    if (schema) {
      return this.validateAgainstSchema(json, schema) as T;
    }

    return json as T;
  }

  /**
   * Validate object against JSON schema (simplified)
   */
  private validateAgainstSchema(obj: any, schema: any): any {
    // Simplified validation - in production, use a proper JSON schema validator
    if (!schema || typeof schema !== 'object') {
      return obj;
    }

    const validated: any = {};

    for (const [key, valueSchema] of Object.entries(schema.properties || {})) {
      if (key in obj) {
        validated[key] = obj[key];
      } else if (schema.required?.includes(key)) {
        throw new Error(`Missing required field: ${key}`);
      }
    }

    return validated;
  }

  /**
   * Calculate execution time from tool execution entry
   */
  private calculateExecutionTime(entry: any): number {
    if (entry.created_at && entry.completed_at) {
      const start = new Date(entry.created_at).getTime();
      const end = new Date(entry.completed_at).getTime();
      return end - start;
    }
    return 0;
  }

  /**
   * Parse error from response
   */
  parseError(response: any): string | null {
    if (!response) {
      return 'Empty response';
    }

    // Check for error in outputs
    if (response.outputs) {
      for (const entry of response.outputs) {
        if (entry.type === 'error') {
          return entry.message || 'Unknown error';
        }
      }
    }

    // Check for error in response metadata
    if (response.error) {
      return typeof response.error === 'string'
        ? response.error
        : JSON.stringify(response.error);
    }

    return null;
  }

  /**
   * Check if response indicates success
   */
  isSuccess(response: any): boolean {
    if (!response) {
      return false;
    }

    // Check for error
    if (this.parseError(response)) {
      return false;
    }

    // Check for valid outputs
    if (!response.outputs || response.outputs.length === 0) {
      return false;
    }

    return true;
  }
}

export const responseParser = new ResponseParser();
