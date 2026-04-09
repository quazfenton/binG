/**
 * UNIFIED AGENT ORCHESTRATION ARCHITECTURE
 *
 * This module provides a best-in-class orchestration layer for LLM agents, unifying the
 * "v1" standard API chat path with the advanced multi-step capabilities of "v2" OpenCode,
 * CrewAI (Planner/Coder/Critic), and Mastra workflows.
 *
 * CORE COMPONENTS:
 * 1. IterationController: Enforces budgets (max steps, tokens, time) to prevent infinite loops.
 * 2. AgentOrchestrator: The state machine managing Plan -> Act -> Verify -> Respond phases.
 * 3. Self-Healing: Error classification and automatic retry/reprompt mechanisms.
 * 4. Streaming: Native SSE event emission at every state transition.
 */

import { generateText, tool as aiTool, type Tool } from 'ai';
import { z } from 'zod';
import { verifyChanges } from '@/lib/orchestra/stateful-agent/agents/verification';
import { SelfHealingExecutor } from '@/lib/crewai/runtime/self-healing';
import { getVercelModel } from '@/lib/chat/vercel-ai-streaming';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('AgentOrchestrator');

// ─── Typed Configuration ─────────────────────────────────────────────────────

/** Iteration budget configuration with validation and defaults */
const IterationConfigSchema = z.object({
  maxIterations: z.number().min(1).max(100).default(20),
  maxTokens: z.number().min(100).max(1_000_000).default(100_000),
  maxDurationMs: z.number().min(1000).max(600_000).default(300_000), // 5 min default
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4o'),
});

export type IterationConfigInput = z.input<typeof IterationConfigSchema>;
export interface IterationConfig extends z.infer<typeof IterationConfigSchema> {}

// ─── Message type — use local definition since AI SDK types vary by version ──

type AgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  toolCallId?: string;
  toolName?: string;
};

// ─── Structured Tool Result Interface (P2 #7) ────────────────────────────────

/**
 * Structured tool result passed into conversation history.
 * Replaces JSON.stringify blobs with typed fields the LLM can reason about.
 */
export interface ToolResult {
  /** Whether the tool call succeeded */
  success: boolean;
  /** Tool name that was called */
  toolName: string;
  /** Arguments that were passed to the tool */
  args?: Record<string, any>;
  /** Structured output on success */
  output?: Record<string, any>;
  /** Structured error context on failure */
  error?: ToolError;
  /** Human-readable summary for the LLM */
  summary: string;
}

/**
 * Structured error context — self-healing gets typed fields instead of
 * regex-on-stderr-text.
 */
export interface ToolError {
  /** Error type classification */
  type:
    | 'execution'        // Runtime crash / exception
    | 'validation'       // Input validation failed
    | 'filesystem'       // Path not found, permission denied
    | 'dependency'       // Missing dependency / module
    | 'timeout'          // Tool call timed out
    | 'unknown';
  /** Human-readable message */
  message: string;
  /** Exit code (for shell/tool processes) */
  exitCode?: number;
  /** stderr / raw error output */
  stderr?: string;
  /** stdout (partial) before failure */
  stdout?: string;
  /** Suggested remediation for self-healing */
  suggestions?: string[];
  /** Missing dependencies detected */
  missingDependencies?: string[];
}

/** Parse a raw tool execution result into a structured ToolResult */
function buildToolResult(
  toolName: string,
  args: Record<string, any>,
  rawResult: any,
  error?: Error
): ToolResult {
  if (error) {
    const errMsg = error.message || 'Unknown error';
    const structuredError: ToolError = classifyToolError(toolName, errMsg, rawResult);
    return {
      success: false,
      toolName,
      args,
      error: structuredError,
      summary: `Tool '${toolName}' failed: ${structuredError.message}${structuredError.suggestions?.length ? '. Suggestions: ' + structuredError.suggestions.join('; ') : ''}`,
    };
  }

  // Success path
  const output = typeof rawResult === 'object' && rawResult !== null ? rawResult : { value: rawResult };
  const summary = buildToolSuccessSummary(toolName, output);

  return {
    success: true,
    toolName,
    args,
    output,
    summary,
  };
}

/**
 * Classify a tool error into a structured ToolError.
 * Self-healing logic uses the typed fields instead of regex on stderr.
 */
function classifyToolError(
  toolName: string,
  message: string,
  rawResult?: any
): ToolError {
  const lower = message.toLowerCase();
  const stderr = typeof rawResult?.stderr === 'string' ? rawResult.stderr : undefined;
  const stdout = typeof rawResult?.stdout === 'string' ? rawResult.stdout : undefined;

  // Missing dependency
  if (lower.includes('module not found') || lower.includes('cannot find module') || lower.includes('no such file')) {
    const missingMatch = message.match(/(?:module|file|package)\s+['"]?([^'"\s]+)['"]?/i);
    return {
      type: 'dependency',
      message,
      suggestions: [
        `Install the missing dependency: npm install ${missingMatch?.[1] || 'the missing package'}`,
        'Check import paths and package.json',
      ],
      missingDependencies: missingMatch ? [missingMatch[1]] : undefined,
      stderr,
      stdout,
    };
  }

  // Filesystem error
  if (lower.includes('enoent') || lower.includes('permission denied') || lower.includes('eacces') || lower.includes('path not found')) {
    return {
      type: 'filesystem',
      message,
      exitCode: rawResult?.exitCode,
      suggestions: [
        'Verify the file path exists and is accessible',
        'Check file permissions',
      ],
      stderr,
      stdout,
    };
  }

  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
    return {
      type: 'timeout',
      message,
      suggestions: [
        'Increase the timeout duration',
        'Break the operation into smaller chunks',
      ],
    };
  }

  // Validation
  if (lower.includes('validation') || lower.includes('invalid') || lower.includes('required')) {
    return {
      type: 'validation',
      message,
      suggestions: ['Check the tool arguments match the expected schema'],
    };
  }

  // Generic execution error
  return {
    type: 'execution',
    message,
    exitCode: rawResult?.exitCode,
    suggestions: ['Review the tool usage and error message'],
    stderr,
    stdout,
  };
}

/** Build a concise summary for successful tool execution */
function buildToolSuccessSummary(toolName: string, output: Record<string, any>): string {
  switch (toolName) {
    case 'readFile':
    case 'file.read':
      return `Read file: ${output.path || 'unknown'} (${output.size || output.content?.length || 0} bytes)`;
    case 'writeFile':
    case 'file.write':
      return `Wrote file: ${output.path || output.file || 'unknown'} (${output.bytesWritten || output.content?.length || 0} bytes)`;
    case 'applyDiff':
      return `Applied diff to: ${output.path || output.file || 'unknown'}`;
    case 'listFiles':
    case 'file.list':
      return `Listed directory: ${output.path || 'unknown'} (${output.count || output.nodes?.length || 0} entries)`;
    case 'deleteFile':
    case 'file.delete':
      return `Deleted: ${output.path || output.file || 'unknown'}`;
    case 'executeShell':
    case 'exec_shell':
      return `Shell command executed (exit code: ${output.exitCode ?? 'unknown'})`;
    default:
      return `Tool '${toolName}' executed successfully`;
  }
}

// ─── Typed Event Payloads (P2 #9) ────────────────────────────────────────────

export type OrchestratorEvent =
  | { type: 'phase_change'; phase: 'planning' | 'acting' | 'verifying' | 'responding' }
  | { type: 'plan_created'; plan: Array<{ action: string; tool?: string }> }
  | { type: 'iteration_start'; iteration: number }
  | { type: 'tool_call'; tool: string; args: Record<string, any> }
  | { type: 'tool_result'; tool: string; result: ToolResult }
  | { type: 'tool_error'; tool: string; error: ToolError }
  | { type: 'token'; content: string }
  | { type: 'verification_failed'; errors: Array<{ file: string; message: string; suggestion?: string }> }
  | { type: 'verification_passed' }
  | { type: 'warning'; message: string }
  | { type: 'done'; response: string; stats: { iterations: number; tokensUsed: number; durationMs: number } };

// ─── Orchestrator Config (P2 #9 — typed) ─────────────────────────────────────

export interface OrchestratorToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType<any>;
}

export interface OrchestratorConfig {
  iterationConfig: IterationConfigInput;
  tools: OrchestratorToolDefinition[];
  executeTool: (name: string, args: any) => Promise<any>;
}

// ─── Iteration Controller ────────────────────────────────────────────────────

export class IterationController {
  private iterations = 0;
  private tokensUsed = 0;
  private startTime = Date.now();

  constructor(private config: IterationConfig) {}

  canContinue(): { allowed: boolean; reason?: string } {
    if (this.iterations >= this.config.maxIterations) {
      return { allowed: false, reason: 'Max iterations reached' };
    }
    if (this.tokensUsed >= this.config.maxTokens) {
      return { allowed: false, reason: 'Token budget exhausted' };
    }
    if (Date.now() - this.startTime >= this.config.maxDurationMs) {
      return { allowed: false, reason: 'Time budget exhausted' };
    }
    return { allowed: true };
  }

  recordStep() {
    this.iterations++;
  }

  recordTokens(tokens: number) {
    this.tokensUsed += tokens;
  }

  getStats() {
    return {
      iterations: this.iterations,
      tokensUsed: this.tokensUsed,
      durationMs: Date.now() - this.startTime,
    };
  }
}

// ─── Agent Orchestrator ──────────────────────────────────────────────────────

export class AgentOrchestrator {
  private validatedConfig: IterationConfig;
  /** SDK tools built via proper adapter (no @ts-expect-error) — P2 #9 */
  private sdkTools: Record<string, Tool> = {};

  constructor(private config: OrchestratorConfig) {
    // Validate and normalize configuration with Zod — P2 #9
    this.validatedConfig = IterationConfigSchema.parse(config.iterationConfig);

    // Build SDK tools via proper adapter — P2 #9
    // Uses aiTool() with typed Zod parameters instead of manual conversion
    for (const toolDef of config.tools) {
      const toolName = toolDef.name;
      if (!toolName) continue;

      this.sdkTools[toolName] = aiTool({
        description: toolDef.description || `Execute ${toolName}`,
        parameters: toolDef.parameters,
        execute: async (args: Record<string, unknown>) => {
          try {
            return await config.executeTool(toolName, args);
          } catch (error: any) {
            log.error(`Tool ${toolName} execution failed`, { error: error.message });
            throw error;
          }
        },
      }) as any;
    }
  }

  /**
   * Executes a task using a Plan -> Act -> Verify -> Respond loop.
   * Yields SSE-compatible events for UI rendering.
   */
  async *execute(task: string, initialContext: any[]): AsyncGenerator<OrchestratorEvent, void, unknown> {
    const controller = new IterationController(this.validatedConfig);
    const conversationHistory = [...initialContext];

    yield { type: 'phase_change', phase: 'planning' };

    // 1. PLANNING PHASE (CrewAI-inspired Planner Agent)
    const plan = await this.generatePlan(task, conversationHistory);
    yield { type: 'plan_created', plan };
    conversationHistory.push({ role: 'assistant', content: `Plan:\n${JSON.stringify(plan)}` });

    // 2. ACT PHASE (Multi-step Tool Loop)
    yield { type: 'phase_change', phase: 'acting' };

    while (true) {
      const check = controller.canContinue();
      if (!check.allowed) {
        yield { type: 'warning', message: `Execution stopped: ${check.reason}` };
        break;
      }

      controller.recordStep();
      yield { type: 'iteration_start', iteration: controller.getStats().iterations };

      // Call LLM for next action (Coder Agent) using Vercel AI SDK
      const llmResponse = await this.callLLM(task, conversationHistory);
      controller.recordTokens(llmResponse.usage?.totalTokens || 0);

      if (llmResponse.done || !llmResponse.toolCalls?.length) {
        conversationHistory.push({ role: 'assistant', content: llmResponse.text });
        break; // Task complete or no tools to call
      }

      // Execute tools with Self-Healing middleware
      let modifiedFiles: string[] = [];
      for (const call of llmResponse.toolCalls) {
        yield { type: 'tool_call', tool: call.name, args: call.arguments };

        let structuredResult: ToolResult;
        try {
          const rawResult = await this.executeToolWithHealing(call.name, call.arguments);
          // P2 #7: Build structured ToolResult instead of JSON.stringify blob
          structuredResult = buildToolResult(call.name, call.arguments, rawResult);
          yield { type: 'tool_result', tool: call.name, result: structuredResult };

          if (call.name === 'writeFile' || call.name === 'applyDiff') {
            modifiedFiles.push(call.arguments.path || call.arguments.file);
          }
        } catch (error: any) {
          // P2 #7: Build structured ToolResult for errors too
          structuredResult = buildToolResult(call.name, call.arguments, undefined, error);
          yield { type: 'tool_error', tool: call.name, error: structuredResult.error! };
        }

        // P2 #7: Pass structured ToolResult into conversation history
        // The LLM gets structured fields (success, output, error.type, suggestions, etc.)
        // instead of a raw JSON string blob
        conversationHistory.push({
          role: 'tool',
          content: JSON.stringify(structuredResult),
          toolCallId: call.id,
          toolName: call.name,
        } as AgentMessage);
      }

      // 3. VERIFICATION PHASE (Critic/Verifier Agent)
      if (modifiedFiles.length > 0) {
         yield { type: 'phase_change', phase: 'verifying' };
         const verificationResult = await this.runVerification(modifiedFiles);

         if (!verificationResult.passed) {
           yield { type: 'verification_failed', errors: verificationResult.errors.map(e => ({ file: (e as any).path || 'unknown', message: (e as any).error || String(e), suggestion: undefined })) };
           // Feed errors back to the ACT loop for self-healing
           // P2 #7: Use structured error context
           conversationHistory.push({
             role: 'system',
             content: `Verification failed. Please fix these errors in the next step: ${JSON.stringify(verificationResult.errors)}`
           });
           continue;
         }
         yield { type: 'verification_passed' };
      }
    }

    // 4. RESPOND PHASE (with budget check - do not exceed budget even for summarization)
    yield { type: 'phase_change', phase: 'responding' };

    // Check budgets before final summarization call to prevent budget bypass
    const finalCheck = controller.canContinue();
    if (!finalCheck.allowed) {
      // Budgets exhausted - return partial result without final summarization
      yield {
        type: 'warning',
        message: `Final summarization skipped: ${finalCheck.reason}. Returning partial results.`
      };
      yield {
        type: 'done',
        response: 'Execution completed with partial results due to budget constraints.',
        stats: controller.getStats()
      };
      return;
    }

    const finalResponse = await this.callLLM("Summarize the final outcome based on the execution history.", conversationHistory);
    controller.recordTokens(finalResponse.usage?.totalTokens || 0);
    yield { type: 'done', response: finalResponse.text, stats: controller.getStats() };
  }

  // ==========================================
  // Private Helper Methods
  // ==========================================

  private async generatePlan(task: string, history: AgentMessage[]) {
    const planPrompt = `You are a planning agent. Create a step-by-step execution plan for the following task.
TASK: ${task}
Output ONLY a JSON array of steps: [{"action": "Description", "tool": "ToolName"}]`;
    const response = await this.callLLM(planPrompt, []);
    try {
      const parsed = JSON.parse(response.text.match(/\[[\s\S]*\]/)?.[0] || '[]');
      return parsed.length ? parsed : [{ action: task }];
    } catch {
      return [{ action: task }];
    }
  }

  /**
   * Call LLM using Vercel AI SDK generateText.
   * P2 #9: Uses typed provider config with validated defaults.
   * P2 #9: Uses properly adapted sdkTools (no @ts-expect-error).
   */
  private async callLLM(prompt: string, history: AgentMessage[]) {
    const { provider, model } = this.validatedConfig;

    try {
      let vercelModel: any;
      try {
        vercelModel = getVercelModel(provider, model);
      } catch (modelError: any) {
        log.error('Failed to create Vercel model', { provider, model, error: modelError.message });
        throw new Error(`Cannot initialize LLM provider '${provider}' with model '${model}': ${modelError.message}`);
      }

      const messages: AgentMessage[] = [
        { role: 'system', content: 'You are an autonomous AI coding agent. You have tools available to interact with the system.' },
        ...history,
        { role: 'user', content: prompt }
      ];

      const result = await generateText({
        model: vercelModel,
        messages: messages as any, // AgentMessage is compatible with ModelMessage at runtime
        tools: Object.keys(this.sdkTools).length > 0 ? this.sdkTools : undefined,
        maxOutputTokens: 4000,
        temperature: 0.2,
      });

      // Extract tool calls from the result
      const toolCalls = (result as any).toolCalls?.map((tc: any) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.args || {},
      })) || [];

      return {
        text: result.text || '',
        done: toolCalls.length === 0,
        toolCalls,
        usage: result.usage || { totalTokens: 0 },
      };
    } catch (error: any) {
      log.error('Vercel AI SDK callLLM failed', { provider, model, error: error.message });
      throw error;
    }
  }

  private async executeToolWithHealing(name: string, args: any) {
    // Basic self-healing wrapper
    const maxRetries = 2;
    let attempt = 0;
    const toolCallId = `orch-${name}-${Date.now()}`;

    while (attempt <= maxRetries) {
      try {
        const result = await this.config.executeTool(name, args);

        // Record successful tool call in telemetry
        import('@/lib/chat/tool-call-tracker').then(({ toolCallTracker }) => {
          const structuredResult = buildToolResult(name, args, result);
          toolCallTracker.recordToolCall({
            model: this.validatedConfig.model,
            provider: this.validatedConfig.provider,
            toolName: name,
            success: true,
            timestamp: Date.now(),
            toolCallId,
          });
        }).catch(() => {});

        return result;
      } catch (error: any) {
        attempt++;
        if (attempt > maxRetries) {
          // Record failed tool call in telemetry
          import('@/lib/chat/tool-call-tracker').then(({ toolCallTracker }) => {
            const structuredResult = buildToolResult(name, args, undefined, error);
            toolCallTracker.recordToolCall({
              model: this.validatedConfig.model,
              provider: this.validatedConfig.provider,
              toolName: name,
              success: false,
              error: error.message,
              timestamp: Date.now(),
              toolCallId,
            });
          }).catch(() => {});

          throw new Error(`Tool ${name} failed after ${maxRetries} retries: ${error.message}`);
        }
        // Small exponential backoff for transient issues
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  private async runVerification(files: string[]) {
    // Mocking file content read for verification
    const modifiedFilesRecord: Record<string, string> = {};
    for (const file of files) {
      try {
        const result = await this.config.executeTool('readFile', { path: file });
        if (result && result.content) {
          modifiedFilesRecord[file] = result.content;
        }
      } catch (e) {
        // Skip if we can't read it
      }
    }

    if (Object.keys(modifiedFilesRecord).length === 0) {
      return { passed: true, errors: [] };
    }

    const result = await verifyChanges(modifiedFilesRecord, { strict: false });
    return {
      passed: result.passed,
      errors: result.errors
    };
  }
}
