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

import { generateText, type Tool } from 'ai';
import { verifyChanges } from '@/lib/orchestra/stateful-agent/agents/verification';
import { SelfHealingExecutor } from '@/lib/crewai/runtime/self-healing';
import { getVercelModel } from '@/lib/chat/vercel-ai-streaming';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('AgentOrchestrator');

// Message type — use local definition since AI SDK types vary by version
type AgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
};

export interface IterationConfig {
  maxIterations: number;
  maxTokens: number;
  maxDurationMs: number;
  /** LLM provider name (openai, anthropic, google, mistral, openrouter, etc.) */
  provider?: string;
  /** Model name (gpt-4o, claude-sonnet-4-5, etc.) */
  model?: string;
}

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

export interface OrchestratorConfig {
  iterationConfig: IterationConfig;
  tools: any[];
  executeTool: (name: string, args: any) => Promise<any>;
}

export type OrchestratorEvent =
  | { type: 'phase_change'; phase: 'planning' | 'acting' | 'verifying' | 'responding' }
  | { type: 'plan_created'; plan: any }
  | { type: 'iteration_start'; iteration: number }
  | { type: 'tool_call'; tool: string; args: any }
  | { type: 'tool_result'; tool: string; result: any }
  | { type: 'tool_error'; tool: string; error: string }
  | { type: 'token'; content: string }
  | { type: 'verification_failed'; errors: any[] }
  | { type: 'verification_passed' }
  | { type: 'warning'; message: string }
  | { type: 'done'; response: string; stats: any };

export class AgentOrchestrator {
  /** Convert internal tools to Vercel AI SDK tool format */
  private sdkTools: Record<string, Tool> = {};

  constructor(private config: OrchestratorConfig) {
    // Convert tools to Vercel AI SDK format
    for (const tool of config.tools) {
      const toolName = tool.name || tool.function?.name;
      if (!toolName) continue;

      const parameters = tool.parameters || tool.function?.parameters;
      this.sdkTools[toolName] = {
        description: tool.description || tool.function?.description || '',
        // Vercel AI SDK Tool expects parameters as JSON schema
        // @ts-expect-error - parameters shape varies by SDK version
        parameters: parameters && typeof parameters === 'object' && 'type' in parameters
          ? parameters
          : { type: 'object', properties: {}, additionalProperties: false },
        execute: async (args: any) => {
          try {
            return await config.executeTool(toolName, args);
          } catch (error: any) {
            log.error(`Tool ${toolName} execution failed`, { error: error.message });
            throw error;
          }
        },
      };
    }
  }

  /**
   * Executes a task using a Plan -> Act -> Verify -> Respond loop.
   * Yields SSE-compatible events for UI rendering.
   */
  async *execute(task: string, initialContext: any[]): AsyncGenerator<OrchestratorEvent, void, unknown> {
    const controller = new IterationController(this.config.iterationConfig);
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

        let toolResult;
        try {
          toolResult = await this.executeToolWithHealing(call.name, call.arguments);
          yield { type: 'tool_result', tool: call.name, result: toolResult };

          if (call.name === 'writeFile' || call.name === 'applyDiff') {
            modifiedFiles.push(call.arguments.path || call.arguments.file);
          }
        } catch (error: any) {
          toolResult = { error: error.message };
          yield { type: 'tool_error', tool: call.name, error: error.message };
        }

        conversationHistory.push({
          role: 'tool',
          content: JSON.stringify(toolResult),
          toolCallId: call.id,
        } as AgentMessage);
      }

      // 3. VERIFICATION PHASE (Critic/Verifier Agent)
      if (modifiedFiles.length > 0) {
         yield { type: 'phase_change', phase: 'verifying' };
         const verificationResult = await this.runVerification(modifiedFiles);

         if (!verificationResult.passed) {
           yield { type: 'verification_failed', errors: verificationResult.errors };
           // Feed errors back to the ACT loop for self-healing
           conversationHistory.push({
             role: 'system',
             content: `Verification failed. Please fix these errors in the next step: ${JSON.stringify(verificationResult.errors)}`
           });
           continue;
         }
         yield { type: 'verification_passed' };
      }
    }

    // 4. RESPOND PHASE (with budget check - do not exceed budgets even for summarization)
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
   * Replaces the old llmService.generateResponse() with unified provider support.
   */
  private async callLLM(prompt: string, history: AgentMessage[]) {
    const provider = this.config.iterationConfig.provider || process.env.LLM_PROVIDER || 'openai';
    const model = this.config.iterationConfig.model || process.env.LLM_MODEL || process.env.DEFAULT_MODEL || 'gpt-4o';

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

    while (attempt <= maxRetries) {
      try {
        return await this.config.executeTool(name, args);
      } catch (error: any) {
        attempt++;
        if (attempt > maxRetries) {
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
