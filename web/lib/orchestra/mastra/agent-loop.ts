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
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import type { LLMMessage } from '@/lib/chat/llm-providers';
import { generateId, generateText, tool as createTool } from 'ai';
import type { Tool } from 'ai';
import {
  buildWorkspaceSnapshot,
  buildAgentSystemPrompt,
  createLoopDetectorState,
  recordStepAndCheckLoop,
  type LoopDetectorState,
} from '@/lib/orchestra/shared-agent-context';

// CoreMessage may not be exported in all AI SDK versions
// @ts-ignore - CoreMessage is used for type hints but may not be available
import type { CoreMessage } from 'ai';

const log = createLogger('MastraAgent');

// ToolLoopAgent is available in AI SDK 6.0+
// If not available, falls back to manual agent loop
// 
// NOTE: ToolLoopAgent requires Vercel AI SDK 6.0+ and may not work with all provider wrappers.
// For best compatibility, use direct Vercel AI SDK providers (openai, anthropic, google, mistral)
// or OpenAI-compatible providers with proper API keys configured.
let ToolLoopAgent: any = null;
try {
  ToolLoopAgent = require('ai').ToolLoopAgent;
  log.info('ToolLoopAgent loaded from Vercel AI SDK');
} catch (error: any) {
  log.warn('ToolLoopAgent not available, using fallback agent loop', {
    error: error.message,
    aiSdkVersion: require('ai/package.json')?.version || 'unknown',
  });
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
  /** Whether this invocation came from a fallback path */
  isFallback?: boolean;
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
  private configuredModel?: string;
  /** Optional bootstrapped agency for learned tool selection */
  private agency: any = null;
  // Track tool invocations manually since ToolLoopAgent may not populate result.toolInvocations
  private lastExecutedToolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, any>; result: any }> = [];

  /**
   * Set the bootstrapped agency for learned tool selection.
   * When set, `parseTextToolCalls` prefers capabilities the agency
   * has learned to be successful for similar tasks.
   */
  setAgency(agency: any): void {
    this.agency = agency;
  }

  constructor(
    userId: string,
    workspacePath: string,
    maxIterations: number = 10,
    toolOptions: FilesystemToolOptions = {},
    model?: string,
  ) {
    this.context = {
      userId,
      workspacePath,
      conversationHistory: [],
    };
    this.maxIterations = maxIterations;
    this.configuredModel = model;
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
                const errMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
                throw new Error(errMsg || 'Tool execution failed');
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
    // Reset tracking array for each execution to avoid stale data from prior tasks
    this.lastExecutedToolCalls = [];

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

      // FALLBACK 1: If no tool invocations from stream, try manually tracked invocations
      if (toolInvocations.length === 0 && this.lastExecutedToolCalls.length > 0) {
        log.debug(`Stream didn't report tool invocations, using manually tracked: ${this.lastExecutedToolCalls.length} calls`);
        for (const tc of this.lastExecutedToolCalls) {
          const inv = {
            toolInvocation: {
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              args: tc.args,
              result: tc.result,
              state: 'result',
            },
          };
          toolInvocations.push(inv);
          results.push({
            iteration: results.length + 1,
            tool: tc.toolName,
            arguments: tc.args,
            result: tc.result,
          });
        }
      }

      // FALLBACK 2: If still no tool invocations, try parsing text-based tool calls from response
      if (toolInvocations.length === 0 && finalResult.text) {
        log.debug('Stream completed without tool calls, LLM response:', finalResult.text.substring(0, 300));
        const textToolCalls = await this.parseTextToolCalls(finalResult.text);
        if (textToolCalls.length > 0) {
          log.info(`ToolLoopAgent: No function calls, found ${textToolCalls.length} text-based tool calls, executing fallback`);
          
          for (const tc of textToolCalls) {
            const tool = this.tools.find(t => t.name === tc.name);
            if (tool) {
              try {
                const result2 = await tool.execute(tc.arguments);
                toolInvocations.push({
                  toolInvocation: {
                    toolCallId: generateId(),
                    toolName: tc.name,
                    args: tc.arguments,
                    result: result2,
                    state: 'completed',
                    isFallback: true,
                  },
                });
                results.push({
                  iteration: results.length + 1,
                  tool: tc.name,
                  arguments: tc.arguments,
                  result: result2,
                  isFallback: true,
                });
              } catch (err: any) {
                log.error(`Fallback tool execution failed: ${tc.name}`, err.message);
              }
            }
          }
        }
      }

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
          sourceAgent: inv.toolInvocation.isFallback || (results.find(r => r.tool === inv.toolInvocation.toolName) as any)?.isFallback ? 'tool-loop-agent-fallback' : 'tool-loop-agent',
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
    // Reset tracking array for each execution to avoid stale data from prior tasks
    this.lastExecutedToolCalls = [];

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
      const result = await this.toolLoopAgent.generate({ messages });

      // Transform ToolLoopAgent result to AgentResult format
      // FIX: ToolLoopAgent may not populate toolInvocations correctly, so fall back to manually tracked invocations
      let toolInvocations = result.toolInvocations || [];
      if (toolInvocations.length === 0 && this.lastExecutedToolCalls.length > 0) {
        log.debug(`ToolLoopAgent didn't report tool invocations, using manually tracked: ${this.lastExecutedToolCalls.length} calls`);
        toolInvocations = this.lastExecutedToolCalls.map(tc => ({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
          result: tc.result,
          state: 'result',
        }));
      }
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

      // Log response text when no tools were called (for debugging model behavior)
      if (toolInvocations.length === 0 && result.text) {
        log.debug('ToolLoopAgent completed without tool calls, LLM response:', result.text.substring(0, 300));
      }

      // FALLBACK: If no tool invocations, try parsing text-based tool calls from response
      if (toolInvocations.length === 0 && result.text) {
        const textToolCalls = await this.parseTextToolCalls(result.text);
        if (textToolCalls.length > 0) {
          log.info(`ToolLoopAgent (non-streaming): No function calls, found ${textToolCalls.length} text-based tool calls, executing fallback`);
          
          for (const tc of textToolCalls) {
            const tool = this.tools.find(t => t.name === tc.name);
            if (tool) {
              try {
                const result2 = await tool.execute(tc.arguments);
                toolInvocations.push({
                  toolCallId: generateId(),
                  toolName: tc.name,
                  args: tc.arguments,
                  result: result2,
                  state: 'completed',
                  isFallback: true,
                });
                results.push({
                  iteration: results.length + 1,
                  tool: tc.name,
                  arguments: tc.arguments,
                  result: result2,
                  isFallback: true,
                });
              } catch (err: any) {
                log.error(`Fallback tool execution failed: ${tc.name}`, err.message);
              }
            }
          }
        }
      }

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
          sourceAgent: inv.isFallback || (results.find(r => r.tool === inv.toolName) as any)?.isFallback ? 'tool-loop-agent-fallback' : 'tool-loop-agent',
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
   * Track recent failed tool calls to detect loops.
   * Uses shared loop detector from shared-agent-context.ts.
   */
  private failedToolCalls: Map<string, number> = new Map();
  private loopState: LoopDetectorState = createLoopDetectorState();

  /**
   * Execute task using manual agent loop with Vercel AI SDK streaming
   */
  private async executeManual(task: string): Promise<AgentResult> {
    const results: AgentIterationResult[] = [];
    let iterations = 0;
    const allText: string[] = [];
    const allToolCalls: any[] = [];
    
    // Reset all loop-detection state for new task
    this.failedToolCalls.clear();
    this.loopState = createLoopDetectorState();
    
    log.info(`Executing task with Vercel AI SDK: ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}`);

    // Pre-build workspace snapshot before constructing system prompt
    this.cachedWorkspaceSnapshot = await buildWorkspaceSnapshot(this.context.userId);

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
      vercelTools[tool.name] = createTool({
        description: tool.description,
        // @ts-ignore AI SDK v6 tool type signature changed frequently
        parameters: tool.parameters as any,
        // @ts-ignore AI SDK v6 execute signature changed
        execute: async (args: any) => {
          const result = await tool.execute(args);
          if (!result.success) {
            const errMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
            throw new Error(errMsg || 'Tool execution failed');
          }
          return result;
        },
      });
    }
    
    // DIAGNOSTIC: Log converted tools
    log.info(`[TOOLS-DIAG] executeManual converted ${Object.keys(vercelTools).length} tools`, {
      toolNames: Object.keys(vercelTools),
    });

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
                const isSuccess = result?.success !== false;

                // Track with shared loop detector
                const loopMsg = recordStepAndCheckLoop(this.loopState, tc.name, tc.arguments, isSuccess);

                allToolCalls.push({
                  toolName: tc.name,
                  toolCallId: tc.id,
                  args: tc.arguments,
                  result,
                });
                results.push({
                  iteration: this.loopState.totalSteps,
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

                // Check no-progress guard after each tool execution
                if (loopMsg) {
                  log.warn(`No-progress loop detected: ${loopMsg}`);
                  return {
                    success: false,
                    results,
                    iterations: allToolCalls.length,
                    message: allText.join(''),
                    error: loopMsg,
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
              } catch (toolError: any) {
                recordStepAndCheckLoop(this.loopState, tc.name, tc.arguments, false);
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
          const fullText = allText.join('');
          
          // FALLBACK: If no function calls were made, try parsing text-based tool calls
          // This handles models that don't support function calling
          if (allToolCalls.length === 0 && fullText.length > 0) {
            const textToolCalls = await this.parseTextToolCalls(fullText);
            if (textToolCalls.length > 0) {
              log.info(`No function calls detected, found ${textToolCalls.length} text-based tool calls, executing fallback`);
              
              const executedAny = await this.executeFallbackToolCalls(
                textToolCalls,
                allText,
                allToolCalls,
                results
              );
              
              if (executedAny) {
                // Continue the conversation with tool results to get final response
                const continuationResult = await this.continueWithToolResults(allToolCalls, fullText);
                if (continuationResult) {
                  allText.push(continuationResult);
                }
              }
            }
          }
          
          log.info(`Task completed with Vercel AI SDK`, {
            textLength: fullText.length,
            toolCalls: allToolCalls.length,
            finishReason: chunk.finishReason,
          });
          
          return {
            success: true,
            results,
            iterations: allToolCalls.length > 0 ? allToolCalls.length : 1,
            message: allText.join(''),
            toolInvocations: allToolCalls.map(tc => normalizeToolInvocation({
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              state: 'completed',
              args: tc.args,
              result: tc.result,
              sourceSystem: 'mastra',
              sourceAgent: tc.isFallback ? 'vercel-ai-sdk-fallback' : 'vercel-ai-sdk',
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
   * Cached workspace snapshot for prompt injection.
   * Built lazily once per task via shared utility.
   */
  private cachedWorkspaceSnapshot: string | null = null;

  /**
   * Build system prompt for agent using shared prompt builder.
   */
  private buildSystemPrompt(): string {
    return buildAgentSystemPrompt({
      workspacePath: this.context.workspacePath,
      workspaceSnapshot: this.cachedWorkspaceSnapshot || '(loading...)',
      currentFile: this.context.currentFile,
      lastAction: this.context.lastAction,
      toolDescriptions: this.tools.map(t => `- **${t.name}**: ${t.description}`).join('\n'),
    });
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
   * 
   * FIX: Added better error handling for ToolLoopAgent initialization
   * Some provider wrappers may not be compatible with ToolLoopAgent
   */
  private async initializeToolLoopAgent(): Promise<void> {
    // ToolLoopAgent is optional - we can use Vercel AI SDK streaming directly
    // This method kept for potential future use with ToolLoopAgent
    if (this.toolLoopAgent || !this.useToolLoopAgent) return;

    try {
      const { provider, model } = this.getProviderConfig();
      
      // Check if provider is compatible with ToolLoopAgent
      // ToolLoopAgent works best with direct Vercel AI SDK providers
      const compatibleProviders = ['openai', 'anthropic', 'google', 'mistral', 'openrouter'];
      const isCompatible = compatibleProviders.includes(provider.toLowerCase());
      
      if (!isCompatible) {
        log.warn('Provider may not be fully compatible with ToolLoopAgent', {
          provider,
          model,
          recommendedProviders: compatibleProviders.join(', '),
        });
        // Continue anyway - may still work with OpenAI-compatible providers
      }
      
      // Create ToolLoopAgent instance with configured model
      const vercelModel = await this.createModelInstance(provider, model);
      
      // Build SDK tool map from the filesystem tools array
      const sdkTools: Record<string, any> = {};
      for (const tool of this.tools) {
        sdkTools[tool.name] = {
          description: tool.description,
          parameters: tool.parameters as any,
          execute: async (args: any) => {
            log.debug(`Tool executed: ${tool.name}`, args);
            const result = await tool.execute(args);
            log.debug(`Tool completed: ${tool.name}`, { success: result.success });
            
            // Track invocation manually since ToolLoopAgent may not report them
            const toolCallId = `${tool.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this.lastExecutedToolCalls.push({
              toolCallId,
              toolName: tool.name,
              args,
              result,
            });
            
            if (!result.success) {
              const errMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
              throw new Error(errMsg || 'Tool execution failed');
            }
            return result;
          },
        };
      }

      this.toolLoopAgent = new ToolLoopAgent({
        model: vercelModel,
        maxIterations: this.maxIterations,
        tools: sdkTools,
      });

      log.info('ToolLoopAgent initialized successfully', {
        provider,
        model,
        isCompatible,
        toolCount: Object.keys(sdkTools).length,
        toolNames: Object.keys(sdkTools).join(', '),
      });
    } catch (error: any) {
      log.error('Failed to initialize ToolLoopAgent', {
        error: error.message,
        stack: error.stack,
      });
      this.useToolLoopAgent = false;
    }
  }

  /**
   * Create model instance for ToolLoopAgent
   * Uses the same logic as vercel-ai-streaming.ts for consistency
   */
  private async createModelInstance(provider: string, model: string): Promise<any> {
    // Import vercel-ai-streaming to reuse model creation logic
    const { streamWithVercelAI } = await import('@/lib/chat/vercel-ai-streaming');
    
    // We can't directly access getVercelModel, so we'll use a workaround
    // by creating a minimal stream and extracting the model
    // For now, just return the provider/model pair for ToolLoopAgent to handle
    
    // FIX: Use dynamic import to get the model creator
    const currentEnv: any = typeof process !== 'undefined' ? process.env : {};
    
    switch (provider.toLowerCase()) {
      case 'openai':
      case 'openrouter':
      case 'chutes':
      case 'github':
      case 'nvidia':
      case 'together':
      case 'groq':
      case 'fireworks':
      case 'anyscale':
      case 'deepinfra':
      case 'lepton': {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const config = {
          openrouter: { baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY' },
          chutes: { baseURL: process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1', apiKeyEnv: 'CHUTES_API_KEY' },
          github: { baseURL: process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com', apiKeyEnv: 'GITHUB_MODELS_API_KEY' },
          nvidia: { baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1', apiKeyEnv: 'NVIDIA_API_KEY' },
          together: { baseURL: process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1', apiKeyEnv: 'TOGETHER_API_KEY' },
          groq: { baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1', apiKeyEnv: 'GROQ_API_KEY' },
          fireworks: { baseURL: process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1', apiKeyEnv: 'FIREWORKS_API_KEY' },
          anyscale: { baseURL: process.env.ANYSCALE_BASE_URL || 'https://api.endpoints.anyscale.com/v1', apiKeyEnv: 'ANYSCALE_API_KEY' },
          deepinfra: { baseURL: process.env.DEEPINFRA_BASE_URL || 'https://api.deepinfra.com/v1/openai', apiKeyEnv: 'DEEPINFRA_API_KEY' },
          lepton: { baseURL: process.env.LEPTON_BASE_URL || 'https://models.lepton.ai/v1', apiKeyEnv: 'LEPTON_API_KEY' },
        }[provider.toLowerCase()] || { baseURL: currentEnv.OPENAI_BASE_URL, apiKeyEnv: 'OPENAI_API_KEY' };
        
        const openai = createOpenAI({
          apiKey: currentEnv[config.apiKeyEnv],
          baseURL: config.baseURL,
        });
        return openai(model);
      }
      
      case 'anthropic': {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        const anthropic = createAnthropic({
          apiKey: currentEnv.ANTHROPIC_API_KEY,
          baseURL: currentEnv.ANTHROPIC_BASE_URL,
        });
        return anthropic(model);
      }
      
      case 'google': {
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        const google = createGoogleGenerativeAI({
          apiKey: currentEnv.GOOGLE_API_KEY,
        });
        return google(model);
      }
      
      case 'mistral': {
        const { createMistral } = await import('@ai-sdk/mistral');
        const mistral = createMistral({
          apiKey: currentEnv.MISTRAL_API_KEY,
          baseURL: currentEnv.MISTRAL_BASE_URL,
        });
        return mistral(model);
      }
      
      default:
        throw new Error(`Unsupported provider for ToolLoopAgent: ${provider}`);
    }
  }

  /**
   * Create model instance based on user's configured provider
   * Uses dynamic import to support multiple provider SDKs
   */
  /**
   * Get provider and model from user's configuration
   * Uses the model passed to constructor, or falls back to DEFAULT_MODEL env var
   * 
   * FIX: Use widely available model instead of provider name
   * mistral-small-latest is available on Mistral direct and via OpenRouter
   */
  private getProviderConfig(): { provider: string; model: string } {
    const provider = getProviderForTask('agent');
    
    // Use configured model if provided, otherwise use env var or widely-available default
    // Priority: constructor model > AGENT_MODEL env > DEFAULT_MODEL env > sensible default
    const defaultModel = process.env.AGENT_MODEL || process.env.DEFAULT_MODEL || 'mistral-small-latest';
    const model = this.configuredModel || getModelForTask('agent', defaultModel);
    
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
   * Parse text-based tool calls from LLM response
   * Fallback for models that don't support function calling
   * Delegates to the master extractFileEdits which handles ALL formats:
   *   - write_file({ "path": "...", "content": "..." })
   *   - { "tool": "write_file", "path": "...", "content": "..." }
   *   - { "tool": "write_file", "arguments": { "path": "...", "content": "..." } }
   *   - [Tool: write_file] { "path": "...", "content": "..." }
   *   - <file_edit path="...">content</file_edit>
   *   - cat > file << 'EOF' ... EOF
   *   - WRITE path <<<content>>>
   *   - <!-- path -->content
   *   - ```file: path\ncontent```
   */
  private async parseTextToolCalls(text: string): Promise<Array<{ name: string; arguments: Record<string, any> }>> {
    const { extractFileEdits } = await import('@/lib/chat/file-edit-parser');

    // extractFileEdits is the master dispatcher — handles every known format
    const fileEdits = extractFileEdits(text);

    // Convert FileEdit[] to generic tool call format
    const toolCalls: Array<{ name: string; arguments: Record<string, any> }> = [];
    for (const edit of fileEdits) {
      // Map action to tool name
      let toolName: string = edit.action || 'write_file';
      if (edit.action === 'write') toolName = 'write_file';
      else if (edit.action === 'patch') toolName = 'apply_diff';
      else if (edit.action === 'mkdir') toolName = 'create_directory';
      else if (edit.action === 'delete') toolName = 'delete_file';

      // Deduplicate by tool name + path
      if (toolCalls.some(t => t.name === toolName && t.arguments.path === edit.path)) continue;

      const args: Record<string, any> = { path: edit.path };
      if (edit.content) args.content = edit.content;
      if (edit.diff) args.diff = edit.diff;

      toolCalls.push({ name: toolName, arguments: args });
    }

    if (toolCalls.length > 0) {
      log.debug(`Parsed ${toolCalls.length} text-based tool calls from LLM response`);
    }

    return toolCalls;
  }

  /**
   * Execute fallback text-based tool calls (for models without function calling support)
   */
  private async executeFallbackToolCalls(
    toolCalls: Array<{ name: string; arguments: Record<string, any> }>,
    allText: string[],
    allToolCalls: any[],
    results: AgentIterationResult[]
  ): Promise<boolean> {
    let executedAny = false;
    
    for (const tc of toolCalls) {
      const tool = this.tools.find(t => t.name === tc.name);
      if (!tool) {
        log.warn(`Unknown tool in fallback: ${tc.name}`);
        continue;
      }
      
      try {
        log.info(`Executing fallback tool call: ${tc.name}`);
        const result = await tool.execute(tc.arguments);
        
        const toolCallId = generateId();
        allToolCalls.push({
          toolName: tc.name,
          toolCallId,
          args: tc.arguments,
          result,
          isFallback: true,
        });
        
        results.push({
          iteration: results.length + 1,
          tool: tc.name,
          arguments: tc.arguments,
          result,
        });
        
        // Add tool response to conversation
        this.context.conversationHistory.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId,
          toolName: tc.name,
        });
        
        // Remove the tool call text from the response
        // This is optional - the LLM will see the tool result and continue
        executedAny = true;
        
      } catch (toolError: any) {
        log.error(`Fallback tool execution failed: ${tc.name}`, toolError.message);
        allToolCalls.push({
          toolName: tc.name,
          toolCallId: generateId(),
          args: tc.arguments,
          result: { success: false, error: toolError.message },
          isFallback: true,
        });
      }
    }
    
    return executedAny;
  }

  /**
   * Continue conversation after fallback tool execution to get final response
   */
  private async continueWithToolResults(
    allToolCalls: any[],
    originalText: string
  ): Promise<string | null> {
    try {
      log.info('Continuing conversation after fallback tool execution');
      
      // Build messages with tool results
      const messages: CoreMessage[] = [
        { role: 'system', content: this.buildSystemPrompt() },
        ...this.context.conversationHistory.map(m => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'assistant', content: originalText },
      ];
      
      // Add tool result messages
      for (const tc of allToolCalls) {
        if (tc.isFallback) {
          messages.push({
            role: 'tool',
            content: JSON.stringify(tc.result),
            toolCallId: tc.toolCallId,
          });
        }
      }
      
      // Ask for final response
      messages.push({
        role: 'user',
        content: 'The tool execution is complete. Please provide your final response to the user.',
      });
      
      // Convert tools
      const vercelTools: Record<string, Tool> = {};
      for (const tool of this.tools) {
        vercelTools[tool.name] = createTool({
          description: tool.description,
          // @ts-ignore - parameters may not be in Tool type but is needed for AI SDK
          parameters: tool.parameters as any,
          // @ts-ignore AI SDK v6 execute signature changed
          execute: async (args: any) => {
            const result = await tool.execute(args);
            if (!result.success) {
              const errMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
              throw new Error(errMsg || 'Tool execution failed');
            }
            return result;
          },
        });
      }
      
      // Stream the continuation
      let continuationText = '';
      for await (const chunk of this.executeLLMStreaming(
        messages.map(m => ({ role: m.role as any, content: m.content })),
        vercelTools
      )) {
        if (chunk.content) {
          continuationText += chunk.content;
        }
        if (chunk.isComplete) {
          break;
        }
      }
      
      return continuationText || null;
    } catch (error: any) {
      log.error('Failed to continue with tool results', error.message);
      return null;
    }
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
    
    // DIAGNOSTIC: Log tools status before passing to streamWithVercelAI
    log.info(`[TOOLS-DIAG] executeLLMStreaming tools count: ${Object.keys(tools || {}).length}`, {
      provider,
      model,
      toolNames: tools ? Object.keys(tools) : [],
    });

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
  model?: string,
): AgentLoop {
  return new AgentLoop(userId, workspacePath, maxIterations, toolOptions, model);
}
