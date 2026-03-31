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

import { createFilesystemTools, type FilesystemTool, type FilesystemToolOptions } from './tools/filesystem-tools';
import { normalizeToolInvocation, type ToolInvocation } from '@/lib/types/tool-invocation';
import { createLogger } from '@/lib/utils/logger';
import { getProviderForTask, getModelForTask } from '@/lib/config/task-providers';
import { streamWithVercelAI, type VercelStreamOptions } from '@/lib/chat/vercel-ai-streaming';
import type { LLMMessage } from '@/lib/chat/llm-providers';
import { generateId, generateText } from 'ai';
import type { Tool } from 'ai';

// CoreMessage may not be exported in all AI SDK versions
// @ts-ignore - CoreMessage is used for type hints but may not be available
import type { CoreMessage } from 'ai';

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

  constructor(
    userId: string,
    workspacePath: string,
    maxIterations: number = 10,
    toolOptions: FilesystemToolOptions = {},
  ) {
    this.context = {
      userId,
      workspacePath,
      conversationHistory: [],
    };
    this.maxIterations = maxIterations;
    this.tools = createFilesystemTools(userId, {
      ...toolOptions,
      workspacePath,
    });
    
    // Initialize ToolLoopAgent if available
    if (ToolLoopAgent) {
      try {
        // Convert filesystem tools to AI SDK tool format
        const sdkTools: Record<string, Tool> = {};
        for (const tool of this.tools) {
          sdkTools[tool.name] = {
            description: tool.description,
            // @ts-ignore - parameters is tool-specific and varies by implementation
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
        
        // Defer model creation to first use (can't await in constructor)
        // Model will be created in executeTask when needed
        this.useToolLoopAgent = true;
        log.info('ToolLoopAgent initialized (model will be created on first use)');
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
    if (this.useToolLoopAgent && !this.toolLoopAgent) {
      // Lazy initialize ToolLoopAgent with user's configured provider
      await this.initializeToolLoopAgent();
    }
    
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
    if (this.useToolLoopAgent && !this.toolLoopAgent) {
      // Lazy initialize ToolLoopAgent with user's configured provider
      await this.initializeToolLoopAgent();
    }
    
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
   * Track recent failed tool calls to detect loops
   */
  private failedToolCalls: Map<string, number> = new Map();

  /**
   * Execute task using manual agent loop with Vercel AI SDK streaming
   */
  private async executeManual(task: string): Promise<AgentResult> {
    const results: AgentIterationResult[] = [];
    let iterations = 0;
    const allText: string[] = [];
    const allToolCalls: any[] = [];
    
    // Reset failed tool calls tracking for new task
    this.failedToolCalls.clear();
    
    log.info(`Executing task with Vercel AI SDK: ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}`);

    // Add system prompt first
    const systemPrompt = this.buildSystemPrompt();
    this.context.conversationHistory = [
      { role: 'system', content: systemPrompt },
      ...this.context.conversationHistory,
    ];

    // Add user task
    this.context.conversationHistory.push({
      role: 'user',
      content: task,
    });

    // Convert tools to Vercel format
    const vercelTools: Record<string, Tool> = {};
    for (const tool of this.tools) {
      vercelTools[tool.name] = {
        description: tool.description,
        // @ts-ignore
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

    try {
      // Stream with Vercel AI SDK using user's configured provider
      for await (const chunk of this.executeLLMStreaming(this.context.conversationHistory, vercelTools)) {
        // Handle text chunks
        if (chunk.content) {
          allText.push(chunk.content);
        }
        
        // Handle tool calls
        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            log.debug(`Executing tool: ${tc.name}`);
            const tool = this.tools.find(t => t.name === tc.name);
            if (tool) {
              try {
                const result = await tool.execute(tc.arguments);
                allToolCalls.push({
                  toolName: tc.name,
                  toolCallId: tc.id,
                  args: tc.arguments,
                  result,
                });
                results.push({
                  iteration: 1,
                  tool: tc.name,
                  arguments: tc.arguments,
                  result,
                });
                
                // Add tool response to conversation
                this.context.conversationHistory.push({
                  role: 'tool',
                  content: JSON.stringify(result),
                  toolCallId: tc.id,
                  toolName: tc.name,
                });
              } catch (toolError: any) {
                log.error(`Tool execution failed: ${tc.name}`, toolError.message);
                
                // Track failed tool calls to detect loops
                const toolKey = `${tc.name}:${JSON.stringify(tc.arguments)}`;
                const failedCount = (this.failedToolCalls.get(toolKey) || 0) + 1;
                this.failedToolCalls.set(toolKey, failedCount);
                
                // If same tool call failed 2+ times, we're in a loop - prevent further attempts
                if (failedCount >= 2) {
                  log.warn(`Detected possible infinite loop: ${tc.name} failed ${failedCount} times with same args`);
                  allToolCalls.push({
                    toolName: tc.name,
                    toolCallId: tc.id,
                    args: tc.arguments,
                    result: { success: false, error: toolError.message, loopDetected: true, message: `STOPPED: ${tc.name} failed repeatedly. Do NOT retry.` },
                  });
                  // Return early to stop the loop - no more tool calls
                  log.info('Stopping agent loop due to repeated tool failures');
                  return {
                    success: false,
                    results,
                    iterations: allToolCalls.length,
                    message: allText.join(''),
                    error: `Agent stopped: ${tc.name} failed repeatedly (${failedCount} times). The file may not exist or path may be incorrect.`,
                    toolInvocations: allToolCalls.map(tc => normalizeToolInvocation({
                      toolCallId: tc.toolCallId,
                      toolName: tc.toolName,
                      state: 'completed',
                      args: tc.args,
                      result: tc.result,
                      sourceSystem: 'mastra',
                      sourceAgent: 'vercel-ai-sdk',
                    })),
                  };
                }
                
                allToolCalls.push({
                  toolName: tc.name,
                  toolCallId: tc.id,
                  args: tc.arguments,
                  result: { success: false, error: toolError.message },
                });
              }
            }
          }
        }
        
        // Check if complete
        if (chunk.isComplete) {
          log.info(`Task completed with Vercel AI SDK`, {
            textLength: allText.join('').length,
            toolCalls: allToolCalls.length,
            finishReason: chunk.finishReason,
          });
          
          return {
            success: true,
            results,
            iterations: 1,
            message: allText.join(''),
            toolInvocations: allToolCalls.map(tc => normalizeToolInvocation({
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              state: 'completed',
              args: tc.args,
              result: tc.result,
              sourceSystem: 'mastra',
              sourceAgent: 'vercel-ai-sdk',
            })),
          };
        }
      }
    } catch (error: any) {
      log.error('Vercel AI SDK streaming failed:', error.message);
      return {
        success: false,
        results,
        iterations,
        error: error.message || 'Vercel AI SDK streaming failed',
      };
    }

    // Fallback if no completion chunk
    return {
      success: true,
      results,
      iterations: 1,
      message: allText.join(''),
      toolInvocations: allToolCalls.map(tc => normalizeToolInvocation({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        state: 'completed',
        args: tc.args,
        result: tc.result,
        sourceSystem: 'mastra',
        sourceAgent: 'vercel-ai-sdk',
      })),
    };
  }

  /**
   * Call LLM with current context (legacy, kept for compatibility)
   */
  private async callLLM(task: string, previousResults: AgentIterationResult[]): Promise<LLMResponse> {
    // This is now handled by executeLLMStreaming in executeManual
    // Kept for interface compatibility
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
You have access to workspace tools to read, write, edit files, and optionally run bash commands.

Current workspace: ${this.context.workspacePath}

Available Tools:
${this.tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

FILE OPERATIONS:
- To read files: use the read_file tool
- To write files: use the write_file tool  
- To list directories: use the list_directory tool
- To create directories: use the create_directory tool
- To delete files/directories: use the delete_file tool
- To run installs/tests/builds when available: use the execute_bash tool

CAPABILITY USAGE RULES:
1. Inspect before editing: use read_file, list_directory, file_exists, or context_pack before changing unfamiliar files.
2. Prefer surgical changes to existing files. Read the target file, then write the smallest correct update.
3. Use write_file freely for new files, generated files, and deliberate full rewrites.
4. Use execute_bash only for real workspace commands such as installs, tests, builds, formatting, or grep/find style inspection.
5. Do not use execute_bash if a filesystem capability can answer the question more directly.

DIFF-BASED SELF-HEALING:
1. If an edit or follow-up write seems likely to be stale, read the latest file again before applying the fix.
2. When repairing a failed change, preserve unaffected code and change only the smallest necessary region.
3. Do not repeat the same failing broad rewrite. Narrow the target after re-reading the file.
4. After a fix, validate with read_file or execute_bash when appropriate.

BASH RULES:
- Keep commands scoped to the workspace.
- Prefer deterministic commands such as pnpm, npm, yarn, node, python, git status, rg, ls, cat.
- Avoid destructive commands unless the task explicitly requires them and the impact is clear.
- If a command fails, use the stderr/stdout to choose the next minimal repair step.

Examples:
write_file({ "path": "package.json", "content": "{\\n  \\"name\\": \\"my-app\\",\\n  \\"version\\": \\"1.0.0\\"\\n}" })

read_file({ "path": "src/index.js" })

list_directory({ "path": "src" })

create_directory({ "path": "src/components" })

delete_file({ "path": "old-file.txt" })

Best Practices:
1. Always check if a file exists before editing (use read_file or list_directory)
2. Use relative paths from workspace root (e.g., "toDoApp/src/app.js")
3. Use create_directory to create directories before writing files in them
4. After creating files, suggest or run validation commands when available
5. Prefer minimal edits and preserve user-authored code outside the target change

Response Format:
- Use structured tool calls: [Tool: tool_name] { "arg": "value" }
- When task is complete, respond with { "done": true, "message": "..." }
- Provide clear explanations of what you're doing

Example:
User: "Create a todo app"
Assistant:
[Tool: create_directory] { "path": "src" }
[Tool: write_file] { "path": "package.json", "content": "{\\n  \\"name\\": \\"todo-app\\",\\n  \\"version\\": \\"1.0.0\\"\\n}" }
[Tool: write_file] { "path": "src/index.js", "content": "// Todo app code\\nconsole.log('Hello from todo app');" }
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

  /**
   * Lazy initialize ToolLoopAgent with user's configured provider
   * Note: We're using Vercel AI SDK streaming directly, so ToolLoopAgent is optional
   */
  private async initializeToolLoopAgent(): Promise<void> {
    // ToolLoopAgent is optional - we can use Vercel AI SDK streaming directly
    // This method kept for potential future use with ToolLoopAgent
    if (this.toolLoopAgent || !this.useToolLoopAgent) return;
    
    const { provider, model } = this.getProviderConfig();
    log.info(`ToolLoopAgent initialized for provider: ${provider}, model: ${model}`);
  }

  /**
   * Create model instance based on user's configured provider
   * Uses dynamic import to support multiple provider SDKs
   */
  /**
   * Get provider and model from user's configuration
   */
  private getProviderConfig(): { provider: string; model: string } {
    const provider = getProviderForTask('agent');
    const model = getModelForTask('agent', 'gpt-4o');
    return { provider, model };
  }

  /**
   * Convert messages to LLMMessage format for Vercel AI SDK
   */
  private convertToLLMMessages(messages: AgentMessage[]): LLMMessage[] {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
  }

  /**
   * Execute LLM call using existing Vercel AI SDK streaming
   * This uses the already-configured provider from the chat system
   */
  private async* executeLLMStreaming(
    messages: AgentMessage[],
    tools?: Record<string, Tool>
  ): AsyncGenerator<any> {
    const { provider, model } = this.getProviderConfig();
    const llmMessages = this.convertToLLMMessages(messages);

    log.info(`Using Vercel AI SDK with provider: ${provider}, model: ${model}`);

    yield* streamWithVercelAI({
      provider,
      model,
      messages: llmMessages,
      temperature: 0.7,
      maxTokens: 4096,
      tools,
      toolCallStreaming: true,
      maxSteps: this.maxIterations,
    });
  }
}

/**
 * Create a new agent loop instance
 */
export function createAgentLoop(
  userId: string,
  workspacePath: string,
  maxIterations?: number,
  toolOptions?: FilesystemToolOptions,
): AgentLoop {
  return new AgentLoop(userId, workspacePath, maxIterations, toolOptions);
}
