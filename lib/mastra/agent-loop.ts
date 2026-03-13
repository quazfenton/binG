/**
 * Enhanced Agent Loop for Multi-Step Filesystem Operations
 *
 * Implements an iterative agent that can read, edit, and save files
 * with context awareness and tool-based LLM interaction.
 *
 * HYBRID APPROACH: Uses ToolLoopAgent from Vercel AI SDK internally
 * while maintaining backward-compatible API for existing code.
 *
 * @see lib/mastra/tools/filesystem-tools.ts
 */

import { createFilesystemTools, type FilesystemTool } from './tools/filesystem-tools';
import { normalizeToolInvocation, type ToolInvocation } from '@/lib/types/tool-invocation';
import { createLogger } from '@/lib/utils/logger';
import { openai } from '@ai-sdk/openai';
import { generateId } from 'ai';
import type { CoreMessage, Tool } from 'ai';

const log = createLogger('MastraAgent');

// ToolLoopAgent is available in AI SDK 6.0+
// If not available, falls back to manual agent loop
let ToolLoopAgent: any = null;
try {
  ToolLoopAgent = require('ai').ToolLoopAgent;
} catch {
  log.warn('ToolLoopAgent not available, using fallback agent loop');
}

export interface AgentContext {
  userId: string;
  workspacePath: string;
  conversationHistory: AgentMessage[];
  currentFile?: string;
  lastAction?: string;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AgentResult {
  success: boolean;
  results: AgentIterationResult[];
  iterations: number;
  message?: string;
  error?: string;
  // New fields for ToolLoopAgent integration
  toolInvocations?: ToolInvocation[];
  reasoning?: string;
}

export interface AgentIterationResult {
  iteration: number;
  tool?: string;
  arguments?: Record<string, any>;
  result: any;
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, any>;
  }>;
  done?: boolean;
  message?: string;
}

/**
 * Enhanced Agent Loop for executing multi-step filesystem tasks
 * Uses ToolLoopAgent internally when available, falls back to manual loop
 */
export class AgentLoop {
  private context: AgentContext;
  private maxIterations: number;
  private tools: FilesystemTool[];
  private toolLoopAgent: any | null = null;
  private useToolLoopAgent: boolean = false;

  constructor(userId: string, workspacePath: string, maxIterations: number = 10) {
    this.context = {
      userId,
      workspacePath,
      conversationHistory: [],
    };
    this.maxIterations = maxIterations;
    this.tools = createFilesystemTools(userId);
    
    // Initialize ToolLoopAgent if available
    if (ToolLoopAgent) {
      try {
        // Convert filesystem tools to AI SDK tool format
        const sdkTools: Record<string, Tool> = {};
        for (const tool of this.tools) {
          sdkTools[tool.name] = {
            description: tool.description,
            parameters: tool.parameters as any,
            execute: async (args: any) => {
              const result = await tool.execute(args);
              if (!result.success) {
                throw new Error(result.error || 'Tool execution failed');
              }
              return result;
            },
          };
        }
        
        this.toolLoopAgent = new ToolLoopAgent({
          model: openai('gpt-4o'),
          maxSteps: maxIterations,
          tools: sdkTools,
        });
        this.useToolLoopAgent = true;
        log.info('ToolLoopAgent initialized successfully');
      } catch (error: any) {
        log.warn('Failed to initialize ToolLoopAgent, using fallback:', error.message);
        this.useToolLoopAgent = false;
      }
    }
  }

  /**
   * Execute a task using ToolLoopAgent (if available) or fallback to manual loop
   */
  async executeTask(task: string): Promise<AgentResult> {
    if (this.useToolLoopAgent && this.toolLoopAgent) {
      return this.executeWithToolLoopAgent(task);
    } else {
      return this.executeManual(task);
    }
  }

  /**
   * Execute task using ToolLoopAgent with real-time streaming
   */
  async *executeTaskStreaming(task: string): AsyncGenerator<any, AgentResult, unknown> {
    if (!this.useToolLoopAgent || !this.toolLoopAgent) {
      // Fallback: execute manually and yield as single chunk
      const result = await this.executeManual(task);
      yield {
        type: 'result',
        result,
      };
      return result;
    }

    const results: AgentIterationResult[] = [];
    const toolInvocations: any[] = [];
    let reasoningChunks: string[] = [];

    try {
      // Add user task to conversation
      this.context.conversationHistory.push({
        role: 'user',
        content: task,
      });

      // Build messages with system prompt
      const systemPrompt = this.buildSystemPrompt();
      const messages: CoreMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.context.conversationHistory.map(m => ({
          role: m.role,
          content: m.content,
        })),
      ];

      // Stream with ToolLoopAgent
      const result = await this.toolLoopAgent.stream({ messages });

      // Process stream chunks in real-time
      for await (const chunk of result.fullStream) {
        yield chunk; // Stream to caller

        // Collect tool invocations and reasoning for final result
        if (chunk.type === 'tool-invocation') {
          toolInvocations.push(chunk);
          results.push({
            iteration: results.length + 1,
            tool: chunk.toolInvocation.toolName,
            arguments: chunk.toolInvocation.args,
            result: chunk.toolInvocation.result,
          });
        } else if (chunk.type === 'reasoning') {
          reasoningChunks.push(chunk.reasoning);
        }
      }

      // Wait for final result
      const finalResult = await result.consumeStream();

      return {
        success: true,
        results,
        iterations: results.length,
        message: finalResult.text,
        toolInvocations: toolInvocations.map((inv: any) => normalizeToolInvocation({
          toolCallId: inv.toolInvocation.toolCallId,
          toolName: inv.toolInvocation.toolName,
          state: inv.toolInvocation.state,
          args: inv.toolInvocation.args,
          result: inv.toolInvocation.result,
          sourceSystem: 'mastra',
          sourceAgent: 'tool-loop-agent',
        })),
        reasoning: reasoningChunks.join('\n\n'),
      };
    } catch (error: any) {
      log.error('ToolLoopAgent streaming failed:', error.message);
      // Fallback to manual execution
      return this.executeManual(task);
    }
  }

  /**
   * Execute with ToolLoopAgent (non-streaming)
   */
  private async executeWithToolLoopAgent(task: string): Promise<AgentResult> {
    log.info(`Executing task with ToolLoopAgent: ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}`);

    try {
      // Add user task to conversation
      this.context.conversationHistory.push({
        role: 'user',
        content: task,
      });

      // Build messages with system prompt
      const systemPrompt = this.buildSystemPrompt();
      const messages: CoreMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.context.conversationHistory.map(m => ({
          role: m.role,
          content: m.content,
        })),
      ];

      // Execute with ToolLoopAgent
      const result = await this.toolLoopAgent.do({ messages });

      // Transform ToolLoopAgent result to AgentResult format
      const toolInvocations = result.toolInvocations || [];
      const results: AgentIterationResult[] = toolInvocations.map((inv: any, idx: number) => ({
        iteration: idx + 1,
        tool: inv.toolName,
        arguments: inv.args,
        result: inv.result,
      }));

      // Update conversation history with tool responses
      for (const inv of toolInvocations) {
        this.context.conversationHistory.push({
          role: 'tool',
          content: JSON.stringify(inv.result),
          toolCallId: inv.toolCallId,
          toolName: inv.toolName,
        });
      }

      // Add assistant response
      if (result.text) {
        this.context.conversationHistory.push({
          role: 'assistant',
          content: result.text,
        });
      }

      log.info(`Task completed with ToolLoopAgent: ${toolInvocations.length} tool calls`);

      return {
        success: true,
        results,
        iterations: toolInvocations.length,
        message: result.text,
        toolInvocations: toolInvocations.map((inv: any) => normalizeToolInvocation({
          toolCallId: inv.toolCallId,
          toolName: inv.toolName,
          state: inv.state,
          args: inv.args,
          result: inv.result,
          sourceSystem: 'mastra',
          sourceAgent: 'tool-loop-agent',
        })),
        reasoning: result.reasoning,
      };
    } catch (error: any) {
      log.error('ToolLoopAgent execution failed:', error.message);
      return {
        success: false,
        results: [],
        iterations: 0,
        error: error.message || 'ToolLoopAgent execution failed',
      };
    }
  }

  /**
   * Execute task using manual agent loop (fallback)
   */
  private async executeManual(task: string): Promise<AgentResult> {
    const results: AgentIterationResult[] = [];
    let iterations = 0;
    log.info(`Executing task (manual loop): ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}`);

    // Add user task (system prompt is added in callLLM)
    this.context.conversationHistory.push({
      role: 'user',
      content: task,
    });

    while (iterations < this.maxIterations) {
      iterations++;
      log.debug(`Agent iteration ${iterations}/${this.maxIterations}`);

      try {
        // Call LLM with current context and available tools
        const llmResponse = await this.callLLM(task, results);

        if (llmResponse.done) {
          // LLM indicates task is complete
          log.info(`Task completed in ${iterations} iterations`);
          return {
            success: true,
            results,
            iterations,
            message: llmResponse.message || 'Task completed successfully',
            toolInvocations: results.filter(r => r.tool).map(r => normalizeToolInvocation({
              toolName: r.tool!,
              args: r.arguments,
              result: r.result,
              sourceSystem: 'mastra',
              sourceAgent: 'manual-loop',
            })),
          };
        }

        // Execute tool calls
        if (llmResponse.toolCalls) {
          for (const toolCall of llmResponse.toolCalls) {
            log.debug(`Executing tool: ${toolCall.name}`);
            const tool = this.tools.find(t => t.name === toolCall.name);
            if (tool) {
              const result = await tool.execute(toolCall.arguments);
              results.push({
                iteration: iterations,
                tool: toolCall.name,
                arguments: toolCall.arguments,
                result,
              });

              // Update context based on result
              this.updateContext(toolCall, result);

              // Add tool response to conversation
              this.context.conversationHistory.push({
                role: 'tool',
                content: JSON.stringify(result),
                toolCallId: toolCall.id,
                toolName: toolCall.name,
              });
            } else {
              results.push({
                iteration: iterations,
                tool: toolCall.name,
                arguments: toolCall.arguments,
                result: {
                  success: false,
                  error: `Unknown tool: ${toolCall.name}`,
                },
              });
            }
          }
        } else if (llmResponse.content) {
          // LLM returned text response
          this.context.conversationHistory.push({
            role: 'assistant',
            content: llmResponse.content,
          });
        }
      } catch (error: any) {
        return {
          success: false,
          results,
          iterations,
          error: error.message || 'Agent loop error',
        };
      }
    }

    return {
      success: false,
      results,
      iterations,
      error: 'Max iterations reached',
      toolInvocations: results.filter(r => r.tool).map(r => normalizeToolInvocation({
        toolName: r.tool!,
        args: r.arguments,
        result: r.result,
        sourceSystem: 'mastra',
        sourceAgent: 'manual-loop',
      })),
    };
  }

  /**
   * Call LLM with current context
   */
  private async callLLM(task: string, previousResults: AgentIterationResult[]): Promise<LLMResponse> {
    // Build prompt with context
    const systemPrompt = this.buildSystemPrompt();

    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      ...this.context.conversationHistory,
    ];

    // For now, return a mock response
    // In production, this would call your LLM provider (Mistral, OpenAI, etc.)
    // Example implementation:
    /*
    const response = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        tools: this.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        toolChoice: 'auto',
      }),
    });

    return response.json();
    */

    // Mock response for demonstration
    return {
      content: 'Task processing...',
      done: false,
    };
  }

  /**
   * Update context based on tool execution
   */
  private updateContext(toolCall: { name: string; arguments: Record<string, any> }, result: any): void {
    // Track current file for context
    if (toolCall.name === 'read_file' || toolCall.name === 'write_file') {
      this.context.currentFile = toolCall.arguments.path;
    }

    // Track last action
    this.context.lastAction = `${toolCall.name}(${JSON.stringify(toolCall.arguments)})`;
  }

  /**
   * Build system prompt for agent
   */
  private buildSystemPrompt(): string {
    return `You are an AI assistant working in a code workspace.
You have access to filesystem tools to read, write, and edit files.

Current workspace: ${this.context.workspacePath}

Available Tools:
${this.tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

TOOL CALLING FORMAT:
When you need to create or modify files, use this exact format:

WRITE path/to/file.ext <<<
file content here
>>>

To read a file:
READ path/to/file.ext

Examples:
WRITE package.json <<<
{
  "name": "my-app",
  "version": "1.0.0"
}
>>>

WRITE src/index.js <<<
console.log('Hello World');
>>>

READ package.json

Best Practices:
1. Always check if a file exists before editing (use READ or list_directory)
2. Use relative paths from workspace root (e.g., "toDoApp/src/app.js")
3. After creating files, suggest running commands
4. Use the WRITE/READ format above to directly manipulate files

Response Format:
- Use WRITE/READ format to create/read files
- When task is complete, respond with { "done": true, "message": "..." }
- Provide clear explanations of what you're doing

Example:
User: "Create a todo app"
Assistant:
WRITE package.json <<<
{
  "name": "todo-app",
  "version": "1.0.0"
}
>>>
WRITE src/index.js <<<
// Todo app code
>>>
Assistant: { "done": true, "message": "Created a todo app with package.json and src/index.js" }`;
  }

  /**
   * Get current context
   */
  getContext(): AgentContext {
    return { ...this.context };
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.context.conversationHistory = [];
  }
}

/**
 * Create a new agent loop instance
 */
export function createAgentLoop(userId: string, workspacePath: string, maxIterations?: number): AgentLoop {
  return new AgentLoop(userId, workspacePath, maxIterations);
}
