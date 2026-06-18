/**
 * Plan-Act-Verify Orchestrator
 *
 * This module provides a Plan-Act-Verify state machine for LLM agents,
 * supporting iteration budgets, tool execution with self-healing,
 * file verification, and streaming SSE events.
 *
 * CORE COMPONENTS:
 * 1. IterationController: Enforces budgets (max steps, tokens, time) to prevent infinite loops.
 * 2. PlanActVerifyOrchestrator: The state machine managing Plan -> Act -> Verify -> Respond phases.
 * 3. Self-Healing: Error classification and automatic retry/reprompt mechanisms.
 * 4. Streaming: Native SSE event emission at every state transition.
 */

import { generateText, stepCountIs, tool as aiTool, type Tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { normalizeSchemaForAI } from '../tool-schema';
import { verifyChanges } from '@/lib/orchestra/stateful-agent/agents/verification';
import { getVercelModel } from '@/lib/chat/vercel-ai-streaming';
import { createLogger } from '@/lib/utils/logger';
import { createOriginStack, redactArgsForLogging } from '@/lib/errors/logging-utils';
import { sanitizeMessages } from '@/lib/chat/message-sanitizer';
import { normalizeAndValidateRole } from '../unified-role-selector';
import { CHOOSE_ROLE_DIRECTIVE } from '../system-prompts-dynamic';

const log = createLogger('PlanActVerify');

/**
 * Check if an error is an AI SDK ModelMessage[] schema validation error.
 * These occur when system-role messages leak into the messages array,
 * tool-role messages have plain-string content, or assistant messages
 * have empty content with no tool_calls.
 *
 * Exported so tests and other modules can reuse this detection logic
 * without duplicating the fragile string-matching patterns.
 */
export function isModelSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = (error as any).message;
  if (typeof message !== 'string') return false;
  return (
    message.includes('ModelMessage[]') ||
    message.includes('messages do not match')
  );
}

/**
 * Check if an error is an AI SDK "Invalid JSON response" error.
 * This occurs when the provider returns a non-JSON response (HTML error page,
 * empty body, malformed payload) instead of valid JSON. These errors are
 * thrown by the AI SDK's provider layer (inside generateText) and are NOT
 * schema validation errors, but retrying + plain-text fallback is still
 * the correct recovery path.
 */
function isInvalidJsonError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = (error as any).message;
  if (typeof message !== 'string') return false;
  return message.includes('Invalid JSON');
}

/**
 * Redact tool args for safe logging.
 * - Replaces large or sensitive fields (content, body) with <redacted>
 * - Preserves file paths / names when present
 */

// ─── Typed Configuration ─────────────────────────────────────────────────────

/** Iteration budget configuration with validation and defaults */
const IterationConfigSchema = z.object({
  maxIterations: z.number().min(1).max(100).default(20),
  maxTokens: z.number().min(100).max(1_000_000).default(100_000),
  maxDurationMs: z.number().min(1000).max(3_600_000).default(300_000), // 5 min default (rolling idle timeout)
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4o'),
});

export type IterationConfigInput = z.input<typeof IterationConfigSchema>;
export interface IterationConfig extends z.infer<typeof IterationConfigSchema> {}

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
  error?: Error | ToolError
): ToolResult {
  if (error) {
    // SEV-12 pre-existing tsc TS2345 (`Argument of type 'ToolError' is not assignable to parameter of type 'Error'`) fix:
    // callers (e.g. validateAndNormalizeArgs in this file at the tool-validation error path) now hand us a structured ToolError;
    // preserve it directly via discriminant (`.type` is a string field on ToolError) instead of re-classifying.
    // Runtime behavior unchanged for callers passing a raw Error — classifyToolError still derives from .message.
    const structuredError: ToolError =
      typeof (error as ToolError).type === 'string'
        ? (error as ToolError)
        : classifyToolError(toolName, (error as Error).message || 'Unknown error', rawResult);
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

// ─── Pre-Execution Validation ────────────────────────────────────────────────

/**
 * Map of tool names to their required fields and sensible defaults.
 * When the LLM generates a tool call with empty/missing required fields,
 * we either fill sensible defaults or return a structured error the model
 * can recover from — avoiding blind "EMPTY_ARGS" / "Path is required" failures.
 */
const TOOL_VALIDATION_SCHEMAS: Record<
  string,
  { required: string[]; defaults?: Record<string, any>; help: string }
> = {
  writeFile: {
    required: ['path', 'content'],
    defaults: {},
    help: 'writeFile requires: path (string) — file path relative to workspace, content (string) — complete file content',
  },
  write_file: {
    required: ['path', 'content'],
    defaults: {},
    help: 'write_file requires: path (string), content (string) — complete file content',
  },
  'file.write': {
    required: ['path', 'content'],
    defaults: {},
    help: 'file.write requires: path (string), content (string) — complete file content',
  },
  readFile: {
    required: ['path'],
    defaults: {},
    help: 'readFile requires: path (string) — file path relative to workspace',
  },
  read_file: {
    required: ['path'],
    defaults: {},
    help: 'read_file requires: path (string) — file path relative to workspace',
  },
  'file.read': {
    required: ['path'],
    defaults: {},
    help: 'file.read requires: path (string) — file path relative to workspace',
  },
  listFiles: {
    required: ['path'],
    defaults: { path: '/' },
    help: 'listFiles requires: path (string) — directory path, defaults to "/" (workspace root)',
  },
  list_directory: {
    required: ['path'],
    defaults: { path: '/' },
    help: 'list_directory requires: path (string) — directory path, defaults to "/" (workspace root)',
  },
  'file.list': {
    required: ['path'],
    defaults: { path: '/' },
    help: 'file.list requires: path (string) — directory path, defaults to "/"',
  },
  deleteFile: {
    required: ['path'],
    defaults: {},
    help: 'deleteFile requires: path (string) — file path to delete',
  },
  delete_file: {
    required: ['path'],
    defaults: {},
    help: 'delete_file requires: path (string) — file path to delete',
  },
  'file.delete': {
    required: ['path'],
    defaults: {},
    help: 'file.delete requires: path (string) — file path to delete',
  },
  mkdir: {
    required: ['path'],
    defaults: {},
    help: 'mkdir requires: path (string) — directory path to create',
  },
  applyDiff: {
    required: ['path', 'diff'],
    defaults: {},
    help: 'applyDiff requires: path (string) — file to patch, diff (string) — unified diff content',
  },
  executeShell: {
    required: ['command'],
    defaults: {},
    help: 'executeShell requires: command (string) — shell command to run',
  },
  exec_shell: {
    required: ['command'],
    defaults: {},
    help: 'exec_shell requires: command (string) — shell command to run',
  },
  search_files: {
    required: ['query'],
    defaults: {},
    help: 'search_files requires: query (string) — search pattern or text',
  },
  batch_write: {
    required: ['files'],
    defaults: {},
    help: 'batch_write requires: files (array) — array of { path, content } objects',
  },
  str_replace: {
    required: ['path', 'oldString', 'newString'],
    defaults: {},
    help: 'str_replace requires: path (string) — file to edit, oldString (string) — exact text to replace, newString (string) — replacement text',
  },
  replace_in_file: {
    required: ['path', 'oldString', 'newString'],
    defaults: {},
    help: 'replace_in_file requires: path (string) — file to edit, oldString (string) — exact text to replace, newString (string) — replacement text',
  },
};

/** Result of pre-execution argument validation */
interface ValidationResult {
  /** Normalized / default-filled args (only set when valid) */
  args?: Record<string, any>;
  /** Structured error when validation fails (so the model can recover) */
  error?: ToolError;
}

/**
 * Validate and normalize tool arguments before execution.
 *
 * - Checks required fields exist and are non-empty
 * - Fills in sensible defaults where possible (e.g., listFiles path → "/")
 * - Returns a structured ToolError on failure so the LLM can self-heal
 */
function validateAndNormalizeArgs(
  toolName: string,
  args: Record<string, any>,
): ValidationResult {
  const schema = TOOL_VALIDATION_SCHEMAS[toolName];

  // Unknown tool — pass through without validation
  if (!schema) {
    return { args };
  }

  // Check for null/undefined args
  if (!args || typeof args !== 'object') {
    return {
      error: {
        type: 'validation',
        message: `Tool "${toolName}" called with no arguments. ${schema.help}`,
        suggestions: [`Re-call ${toolName} with valid arguments: ${schema.help}`],
      },
    };
  }

  // Normalize: apply defaults first, then overlay provided args
  const normalized: Record<string, any> = { ...(schema.defaults || {}), ...args };

  // Check each required field
  const missing: string[] = [];
  const empty: string[] = [];

  for (const field of schema.required) {
    if (!(field in normalized)) {
      missing.push(field);
    } else {
      const val = normalized[field];
      // Empty string, empty array, null, undefined are all considered empty
      const isEmpty =
        val === null ||
        val === undefined ||
        (typeof val === 'string' && val.trim() === '') ||
        (Array.isArray(val) && val.length === 0);

      if (isEmpty) {
        // Auto-fill from defaults when available (e.g. empty path for listFiles → "/")
        const defaultVal = schema.defaults?.[field];
        if (defaultVal !== undefined) {
          normalized[field] = defaultVal;
        } else {
          empty.push(field);
        }
      }
    }
  }

  if (missing.length > 0) {
    return {
      error: {
        type: 'validation',
        message: `Tool "${toolName}" is missing required fields: ${missing.join(', ')}. ${schema.help}`,
        suggestions: [
          `Provide values for: ${missing.join(', ')}`,
          `Re-call ${toolName} with all required arguments: ${schema.help}`,
        ],
      },
    };
  }

  if (empty.length > 0) {
    return {
      error: {
        type: 'validation',
        message: `Tool "${toolName}" has empty values for required fields: ${empty.join(', ')}. ${schema.help}`,
        suggestions: [
          `These fields cannot be empty: ${empty.join(', ')}`,
          `Provide meaningful values and re-call ${toolName}`,
        ],
      },
    };
  }

  return { args: normalized };
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
  | { type: 'done'; response: string; stats: { iterations: number; tokensUsed: number; durationMs: number }; budgetExhausted?: boolean };

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
  /**
   * Rolling/reset-on-activity timeout tracker.
   * Reset on every successful step, token recording, or tool execution.
   * The timeout fires only when NO activity occurs within maxDurationMs,
   * allowing arbitrarily long sessions as long as the model makes progress.
   */
  private lastActivityTime = Date.now();

  constructor(private config: IterationConfig) {}

  canContinue(): { allowed: boolean; reason?: string } {
    if (this.iterations >= this.config.maxIterations) {
      return { allowed: false, reason: 'Max iterations reached' };
    }
    if (this.tokensUsed >= this.config.maxTokens) {
      return { allowed: false, reason: 'Token budget exhausted' };
    }
    // Rolling/reset-on-activity timeout: checks idle time since last activity,
    // NOT total elapsed wall-clock time. This allows long-running multi-tool
    // sessions as long as the model is actively making progress.
    if (Date.now() - this.lastActivityTime >= this.config.maxDurationMs) {
      return { allowed: false, reason: 'Time budget exhausted (no activity detected)' };
    }
    return { allowed: true };
  }

  /**
   * Mark activity — resets the idle timeout timer.
   * Call this after any meaningful progress: tool execution, LLM response, etc.
   */
  recordActivity() {
    this.lastActivityTime = Date.now();
  }

  recordStep() {
    this.iterations++;
    this.recordActivity();
  }

  recordTokens(tokens: number) {
    this.tokensUsed += tokens;
    this.recordActivity();
  }

  getStats() {
    return {
      iterations: this.iterations,
      tokensUsed: this.tokensUsed,
      durationMs: Date.now() - this.startTime,
    };
  }
}

// ─── Plan-Act-Verify Orchestrator ────────────────────────────────────────────

export class PlanActVerifyOrchestrator {
  private validatedConfig: IterationConfig;
  /** SDK tools built via proper adapter (no @ts-expect-error) — P2 #9 */
  private sdkTools: Record<string, Tool> = {};
  /** Track plan steps for fresh-context iteration */
  private planSteps: Array<{ action: string; tool?: string }> | null = null;

  constructor(private config: OrchestratorConfig) {
    // Validate and normalize configuration with Zod — P2 #9
    this.validatedConfig = IterationConfigSchema.parse(config.iterationConfig);

    // Build SDK tools via proper adapter — P2 #9
    // Uses aiTool() with the Vercel AI SDK's `inputSchema` field. NOTE: the
    // SDK's `Tool` type uses `inputSchema` (not `parameters`) and the
    // prepareToolsAndToolChoice normalization reads `tool2.inputSchema` —
    // if the field is missing, `asSchema(undefined)` falls back to
    // `{ properties: {}, additionalProperties: false }` with no `type` field,
    // which Azure OpenAI / OpenAI-compatible providers reject with
    // "schema must be a JSON Schema of 'type: \"object\"', got 'type: \"None\"'".
      for (const toolDef of config.tools) {
        const toolName = toolDef.name;
        if (!toolName) continue;

        // Normalize to a JSON Schema with `type: "object"`. See
        // `normalizeSchemaForAI` for the full rationale and Zod handling.
        const normalizedSchema = normalizeSchemaForAI(toolDef.parameters) as Record<string, unknown>;

        this.sdkTools[toolName] = aiTool({
          description: toolDef.description || `Execute ${toolName}`,
          inputSchema: normalizedSchema,
        } as any);
      }

    // Add built-in choose_role tool — enables dynamic role redirection.
    // Unlike tools from config.tools, this one is always available regardless
    // of MCP setup and is self-contained (doesn't delegate to config.executeTool).
    // The result ({ roleAdopted, rolePrompt, ... }) is stored in conversation
    // history and consumed upstream by route.ts to force the selected role.
    this.sdkTools['choose_role'] = aiTool({
      description: 'Switch the current expert role/persona to better handle task complexity, domain, or failure recovery.',
      // Bug #2 fix (audit-C2): AI SDK v6 requires `inputSchema` (not `parameters`).
      // Other tools in this file (search, replace_in_file, file_read, etc.) route
      // through `normalizeSchemaForAI(z.object(...))` for the same reason; choose_role
      // was the lone holdout using `parameters:` directly. Without this, the SDK
      // emits a schema-validation warning at register time and downstream type
      // narrowing in execute() loses the inferred arg shape.
      inputSchema: normalizeSchemaForAI(z.object({
        role: z.string().describe(
          'The target expert role to adopt — must be one of the 9 canonical IDs from CHOOSE_ROLE_DIRECTIVE in system-prompts-dynamic.ts: ' +
          'coder, reviewer, planner, architect, researcher, debugger, specialist, orchestrator, simplifier. ' +
          'Pair `reason` with one of the 3 lineage concepts: complexity, domain, or failure recovery.',
        ),
        reason: z.string().optional().describe('Reasoning for the role switch — must invoke one of the 3 lineage concepts: complexity (e.g. high-complexity refactor), domain (e.g. domain expertise shift to specialist), or failure recovery (e.g. debugging error loops, multi-step read-only stalls).'),
        recentFailures: z.array(z.string()).optional().describe('Recent tool execution error messages — the failure-recovery lineage slice. Provide when reason invokes failure recovery.'),
      })) as Record<string, unknown>,
      execute: async ({ role, reason, recentFailures }: { role: string; reason?: string; recentFailures?: string[] }) => {
        const result = normalizeAndValidateRole(role, reason || '', { recentFailures });
        return {
          success: result.valid,
          roleAdopted: result.roleAdopted,
          rolePrompt: result.valid ? (result as any).rolePrompt || '' : '',
          roleSource: result.valid ? (result as any).roleSource || null : null,
          message: result.message,
        };
      },
    } as any);
  }

  /**
   * Executes a task using a Plan -> Act -> Verify -> Respond loop.
   * Uses plan-driven iteration with fresh context for each phase.
   * Yields SSE-compatible events for UI rendering.
   */
  async *execute(task: string, initialContext: ModelMessage[]): AsyncGenerator<OrchestratorEvent, void, unknown> {
    const controller = new IterationController(this.validatedConfig);

    try {
      // PHASE 1: PLANNING — Use initialContext (conversation history) to seed the planner,
      // but do NOT accumulate tool-call history across steps.
      yield { type: 'phase_change', phase: 'planning' };
      const plan = await this.generatePlan(task, initialContext || []);
      this.planSteps = plan;
      yield { type: 'plan_created', plan };

      // Guard: empty plan — nothing to execute
      if (!this.planSteps?.length) {
        yield { type: 'warning', message: 'Generated plan is empty. Nothing to execute.' };
        yield { type: 'done', response: 'No steps were generated for the given task.', stats: controller.getStats() };
        return;
      }

      // PHASE 2: ACT — Iterate over plan steps with fresh context per step
      yield { type: 'phase_change', phase: 'acting' };
      let stepIndex = 0;
      let consecutiveVerificationFailures = 0;
      const MAX_VERIFICATION_FAILURES = 3;
      let pendingVerificationFeedback: string | null = null;

      // Accumulated conversation history threaded across steps so the LLM
      // can reference tool results from previous steps instead of starting
      // from scratch with [] context each time.
      const stepHistory: ModelMessage[] = [];

      while (stepIndex < this.planSteps.length) {
        const check = controller.canContinue();
        if (!check.allowed) {
          yield { type: 'warning', message: `Execution stopped: ${check.reason}` };
          break;
        }

        const currentStep = this.planSteps[stepIndex];
        controller.recordStep();
        yield { type: 'iteration_start', iteration: controller.getStats().iterations };

        // Fresh context: task + current step + any verification feedback from previous step
        let stepContext = `Task: ${task}\n\nCurrent Step ${stepIndex + 1}/${this.planSteps.length}: ${currentStep.action}`;
        if (pendingVerificationFeedback) {
          stepContext += `\n\nNOTE from previous step verification:\n${pendingVerificationFeedback}`;
          pendingVerificationFeedback = null;
        }
        const llmResponse = await this.callLLM(stepContext, stepHistory);
        controller.recordTokens(llmResponse.usage?.totalTokens || 0);

        // Track modified files during tool execution
        const modifiedFiles: string[] = [];
        // Collect tool execution results for conversation history threading
        // (paired with assistant tool_calls by matching toolCallId)
        const toolResultsHistory: Array<{ toolCallId: string; toolName: string; result: any }> = [];

        if (llmResponse.toolCalls?.length) {
          for (const call of llmResponse.toolCalls) {
            yield { type: 'tool_call', tool: call.name, args: call.arguments };

            try {
              // Pre-execution validation: catch empty/missing args before calling tool
              const validation = validateAndNormalizeArgs(call.name, call.arguments);
              if (validation.error) {
                yield { type: 'tool_error', tool: call.name, error: validation.error };
                // Still record the attempt in history so the model sees the validation failure
                toolResultsHistory.push({ toolCallId: call.id, toolName: call.name, result: buildToolResult(call.name, call.arguments, undefined, validation.error) }); // Bug #6 fix (symmetric): route validation-error through buildToolResult so all three push sites (L703, L717, L728) emit the same ToolResult envelope.
                // Even validation failures represent activity — reset idle timer
                controller.recordActivity();
                continue; // Skip this tool, continue with remaining tools
              }

              const normalizedArgs = validation.args!;
              const result = await this.executeToolWithHealing(call.name, normalizedArgs);
              // Reset idle timer after each successful tool execution
              controller.recordActivity();
              const structuredResult = buildToolResult(call.name, normalizedArgs, result);
              yield { type: 'tool_result', tool: call.name, result: structuredResult };

              // Record result for conversation history threading
              toolResultsHistory.push({ toolCallId: call.id, toolName: call.name, result: buildToolResult(call.name, call.arguments, result, undefined) }); // Bug #6 fix (symmetric): route success through buildToolResult too so both branches produce the same ToolResult shape; LLM sees a consistent schema regardless of success vs. error.

              // Track files modified by writeFile/applyDiff for verification
              if ((call.name === 'writeFile' || call.name === 'applyDiff') && normalizedArgs?.path) {
                modifiedFiles.push(normalizedArgs.path);
              }
            } catch (error: any) {
              // Per-tool resilience: one failure doesn't abort the entire plan
              const structuredResult = buildToolResult(call.name, call.arguments, undefined, error);
              yield { type: 'tool_error', tool: call.name, error: structuredResult.error! };
              // Record the error result so the model can see what went wrong
              toolResultsHistory.push({ toolCallId: call.id, toolName: call.name, result: structuredResult }); // Bug #6 fix: route error through buildToolResult for consistent ToolResult shape
              // Bug #14: When a search tool fails, inject a skip-search directive
              // so the LLM doesn't retry the same broken tool in subsequent steps.
              const isSearchTool = call.name === 'web_search' || call.name === 'web.search' || call.name === 'nullclaw:search';
              if (isSearchTool) {
                pendingVerificationFeedback = (pendingVerificationFeedback || '') +
                  `\nSearch tool "${call.name}" failed and is unavailable. ` +
                  `Skip search for the remainder of this plan and proceed with file/workspace tools only.`;
              }
              // Errors are still activity — don't let error handling trigger idle timeout
              controller.recordActivity();
            }
          }
        } else if (llmResponse.text) {
          yield { type: 'token', content: llmResponse.text };
        }

        // ── Thread tool results into conversation history for next step ──
        if (llmResponse.text || llmResponse.toolCalls?.length) {
          // 1. Assistant message — the model's response text + any tool calls it made.
          //    AI SDK v6 requires the AssistantModelMessage content to be a string
          //    OR an array of content parts. Tool calls MUST be expressed as
          //    `{ type: 'tool-call', toolCallId, toolName, input }` parts inside
          //    the content array — NOT a top-level `toolCalls` property and NOT
          //    using `args`. Using the legacy v4 shape makes the SDK reject the
          //    history with "messages do not match the ModelMessage[] schema",
          //    which previously cascaded into the no-tools plain-text fallback.
          if (llmResponse.toolCalls?.length) {
            const assistantContent: any[] = [];
            if (llmResponse.text) {
              assistantContent.push({ type: 'text' as const, text: llmResponse.text });
            }
            for (const tc of llmResponse.toolCalls) {
              assistantContent.push({
                type: 'tool-call' as const,
                toolCallId: tc.id,
                toolName: tc.name,
                input: tc.arguments ?? {},
              });
            }
            stepHistory.push({ role: 'assistant' as const, content: assistantContent } as ModelMessage);
          } else if (llmResponse.text) {
            // Text-only assistant turn — plain string content is valid.
            stepHistory.push({ role: 'assistant' as const, content: llmResponse.text } as ModelMessage);
          }

          // 2. Tool result messages — results from each executed tool.
          //    AI SDK v6 ToolResultPart requires `output` to be a typed
          //    ToolResultOutput (`{ type: 'json', value }` / `{ type: 'text', value }`),
          //    not a bare `result` value. A raw `result` field also fails schema
          //    validation.
          if (toolResultsHistory.length > 0) {
            for (const tr of toolResultsHistory) {
              stepHistory.push({
                role: 'tool' as const,
                content: [{
                  type: 'tool-result' as const,
                  toolCallId: tr.toolCallId,
                  toolName: tr.toolName,
                  output: { type: 'json' as const, value: (tr.result ?? null) as any },
                }],
              } as any);
            }
            // Clear for next iteration (reused across the while loop)
            toolResultsHistory.length = 0;
          }

          // Guard against unbounded history growth: keep the last N messages
          const MAX_HISTORY_MESSAGES = 30;
          if (stepHistory.length > MAX_HISTORY_MESSAGES) {
            stepHistory.splice(0, stepHistory.length - MAX_HISTORY_MESSAGES);
          }
        }

        // PHASE 3: VERIFICATION — After each step, verify modified files
        if (modifiedFiles.length > 0) {
          yield { type: 'phase_change', phase: 'verifying' };
          const verificationResult = await this.runVerification(modifiedFiles);

          if (!verificationResult.passed) {
            consecutiveVerificationFailures++;
            yield {
              type: 'verification_failed',
              errors: (verificationResult.errors || []).map((e: any) => ({
                file: e?.path || e?.file || 'unknown',
                message: e?.error || e?.message || String(e),
                suggestion: e?.suggestion,
              })),
            };

            if (consecutiveVerificationFailures >= MAX_VERIFICATION_FAILURES) {
              yield { type: 'warning', message: `Aborting due to ${MAX_VERIFICATION_FAILURES} consecutive verification failures.` };
              break;
            }

            // Store feedback for next iteration — retry same step to fix
            pendingVerificationFeedback = `Verification failed for step "${currentStep.action}":\n${JSON.stringify(verificationResult.errors)}\nPlease fix these issues.`;
            continue; // Skip stepIndex++ — retry same step with verification feedback
          } else {
            consecutiveVerificationFailures = 0;
            yield { type: 'verification_passed' };
          }
        }

        stepIndex++; // Move to next plan step
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
        const stats = controller.getStats();
        yield {
          type: 'done',
          response: `Execution halted: ${finalCheck.reason || 'budget exhausted'}. Consumed ${stats.iterations ?? 0} iterations, ${stats.tokensUsed ?? 0} tokens, ${Math.round((stats.durationMs ?? 0) / 1000)}s. Partial results returned.`,
          stats,
          budgetExhausted: true
        };
        return;
      }

      const finalResponse = await this.callLLM(
        `Summarize the completed work. Plan steps executed: ${this.planSteps.map((s, i) => `${i+1}. ${s.action}`).join('\n')}`,
        stepHistory
      );
      controller.recordTokens(finalResponse.usage?.totalTokens || 0);
      yield { type: 'done', response: finalResponse.text, stats: controller.getStats() };

    } catch (error: any) {
      log.error('Orchestrator execution fatal error', { error: error.message });
      yield { type: 'warning', message: `Orchestration failed: ${error.message}` };
      yield { 
        type: 'done', 
        response: `I encountered an error during orchestration: ${error.message}. Please try again or switch to a different model.`,
        stats: controller.getStats()
      };
    }
  }


  // ==========================================
  // Private Helper Methods
  // ==========================================

  private async generatePlan(task: string, history: ModelMessage[]) {
    const planPrompt = `You are a planning agent. Create a step-by-step execution plan for the following task.
TASK: ${task}

Use workspace_graph to understand current workspace state before planning:
- workspace_graph: Get a structured view of all running processes, services, ports, and previews with health diagnostics.
- workspace_graph_diagnostic: Trace service issues to root causes.
- workspace_graph_find_process: Search for processes by command pattern.

IMPORTANT: Do NOT require web_search as a prerequisite step. web_search may be unavailable
or may fail transiently. If search is needed, make it OPTIONAL and ensure the plan can
succeed even if the search step fails. Prefer direct file/workspace tools over search.
If a search step fails during execution, skip it and proceed with file operations.

Output ONLY a JSON array of steps: [{"action": "Description", "tool": "ToolName"}]`;
    const response = await this.callLLM(planPrompt, history || []);
    try {
      // Bug #7 fix: walk the string to find the FIRST balanced `[...]` array
      // before parsing. The previous greedy regex `[\s\S]*` matched up to the
      // LAST closing bracket in the response — so a JSON-then-prose response
      // like `[{"action":"a"}]\n\nSome explanation text` parses the explanation
      // prose too, throwing on the JSON guard. Bracket-walk gives a robust
      // first-matched-array extraction; we keep a bounded lazy regex as a
      // fallback for text-mode LLMs that emit only the bare array.
      const text = response.text;
      let parsed = [];
      let depth = 0;
      let start = -1;
      let matchedBalanced = false;
      let inString = false;
      let stringQuote = '';
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
          // Inside a string literal: brackets are content, only matching quote exits.
          if (ch === '\\') { i++; continue; } // skip escaped char (relies on for-loop's i++ to land us past the escape)
          if (ch === stringQuote) { inString = false; stringQuote = ''; }
          continue;
        }
        // Outside a string: brackets are real delimiters, quotes open a string.
        if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringQuote = ch; continue; }
        if (ch === '[') { if (depth === 0) start = i; depth++; }
        else if (ch === ']') {
          depth--;
          if (depth === 0 && start !== -1) {
            const candidate = text.slice(start, i + 1);
            try { const decoded = JSON.parse(candidate); if (Array.isArray(decoded)) { parsed = decoded; matchedBalanced = true; } break; }
            catch { start = -1; }
          }
        }
      }
      if (!matchedBalanced) {
        const fallbackCandidate = text.match(/\[[\s\S]*?\]/)?.[0] || '[]';
        try { const decoded = JSON.parse(fallbackCandidate); if (Array.isArray(decoded)) parsed = decoded; }
        catch { /* last-resort empty fallback handled below */ }
      }
      return parsed.length ? parsed : [{ action: task }];
    } catch {
      return [{ action: task }];
    }
  }

  /**
   * Call LLM using Vercel AI SDK generateText.
   * P2 #9: Uses typed provider config with validated defaults.
   * P2 #9: Uses properly adapted sdkTools (no @ts-expect-error).
   *
   * Includes a retry wrapper: if generateText throws a schema validation error
   * (e.g. "messages do not match ModelMessage[] schema"), the conversation
   * history is run through `sanitizeMessages` and the call is retried once
   * before giving up. The sanitizer strips system-role messages, converts
   * tool-role plain-string content into the required array form, drops
   * assistant messages with no content and no tool_calls, and coerces any
   * unknown roles to 'user'. System messages must always go via
   * generateText's `system` param, not the messages array.
   */
  private async callLLM(prompt: string, history: ModelMessage[]) {
    const { provider, model } = this.validatedConfig;

    let vercelModel: any;
    try {
      vercelModel = getVercelModel(provider, model);
    } catch (modelError: any) {
      log.error('Failed to create Vercel model', { provider, model, error: modelError.message });
      throw new Error(`Cannot initialize LLM provider '${provider}' with model '${model}': ${modelError.message}`);
    }

    const MAX_ATTEMPTS = 2;
    let lastError: any;
    // Working copy of history — sanitized once up-front (defensive) and again
    // on retry in case the first attempt exposed another malformed message.
    // Defensive fallback to empty array in case of null/undefined at runtime.
    let workingHistory = sanitizeMessages(history || []) as ModelMessage[];

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        // Build messages using AI SDK ModelMessage format.
        // System/user/assistant roles accept plain-string content;
        // tool role MUST use content: [{ type: 'tool-result', ... }] array.
        // The system prompt is passed via generateText's `system` param, not
        // in the messages array; sanitizeMessages() also strips any system
        // message that leaked in from upstream code paths.
        const messages: ModelMessage[] = [
          ...workingHistory,
          { role: 'user' as const, content: prompt },
        ];

        const result = await generateText({
          model: vercelModel,
          messages,
          tools: (Object.keys(this.sdkTools).length > 0 && (this.validatedConfig.provider !== 'ninerouter' || !(this.validatedConfig.model || '').startsWith('gh/'))) ? this.sdkTools : ({} as any),
          system:
            'You are an autonomous AI coding agent. You have tools available to interact with the system.' +
            '\n\n' + CHOOSE_ROLE_DIRECTIVE +
            '\n\n### Workspace State Tools\n' +
            '- workspace_graph: Get a structured view of all workspace state (processes, services, ports, previews) with health diagnostics. Use to understand what\x27s currently running before planning or making changes.\n' +
            '- workspace_graph_diagnostic: Trace a specific service\x27s issues to root causes (port conflicts, crashed processes, stale snapshots).\n' +
            '- workspace_graph_find_process: Search for processes by command pattern across the workspace.\n' +
            'Use these tools to inspect and verify workspace health before and after making changes.',
          maxOutputTokens: 4000,
          temperature: 0.2,
          // NOTE: stopWhen intentionally omitted. The orchestrator's own loop
          // (lines 687-726) already handles tool execution via executeToolWithHealing.
          // Setting stopWhen would make generateText auto-execute tools internally
          // AND then the orchestrator re-executes them — doubling every side effect.
        });

        // Extract tool calls from the result
        const toolCalls = (result as any).toolCalls?.map((tc: any) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: tc.args || tc.input || {},
        })) || [];

        return {
          // Bug #119 (Pass-8 audit) — defensive completion-shape guard.
          // AI SDK v6 should always return `text: string`, but a malformed
          // provider response can occasionally yield undefined/null here.
          // Without this guard we silently coerce to `''` and lose the
          // signal. The shared package cannot import `bing/web/lib/chat/
          // chat-metrics` (cross-package boundary), so we log a warn
          // marker here; the vercel-ai-streaming.ts path bumps the
          // chat-metrics counter via `tryParseToolArgs` (sister fix).
          text: typeof result.text === 'string' ? result.text : _invalidJsonFallback('orchestration.callLLM.happy-path', result.text),
          toolCalls,
          usage: result.usage || { totalTokens: 0 },
        };
      } catch (error: any) {
        lastError = error;

        // Detect AI SDK schema validation errors. The most common causes are
        // a system-role message in the messages array, a tool-role message
        // with plain-string content, an assistant message with empty content
        // and no tool_calls, or a system-role message appearing AFTER an
        // assistant turn (which newer providers reject). Re-sanitize the
        // history (idempotent for already-clean messages) and retry once.
        if ((isModelSchemaError(error) || isInvalidJsonError(error)) && attempt < MAX_ATTEMPTS - 1) {
          log.warn(
            'callLLM: schema validation error, sanitizing history and retrying',
            { provider, model, error: error.message },
          );
          workingHistory = sanitizeMessages(workingHistory) as ModelMessage[];
          continue;
        }

        break; // Non-retryable error, or final attempt exhausted
      }
    }

    // ── Plain-text fallback for schema errors ──
    // If both retries failed due to ModelMessage[] schema errors, the
    // conversation history is likely corrupted beyond repair. Fall back
    // to a plain-text call with NO tools and NO history — just the
    // system prompt and the user's prompt as a bare message. This
    // sacrifices tool-calling ability but ensures the user gets a
    // response instead of a crash.
    if (isModelSchemaError(lastError) || isInvalidJsonError(lastError)) {
      log.warn(
        'callLLM: both retries failed with schema/JSON errors, falling back to plain-text call',
        { provider, model, error: lastError?.message },
      );

      try {
        const fallbackResult = await generateText({
          model: vercelModel,
          messages: [{ role: 'user' as const, content: prompt }],
          system:
            'You are an autonomous AI coding agent.' +
            '\n\n' + CHOOSE_ROLE_DIRECTIVE,
          // `maxSteps` is not a valid AI SDK v6 option (see note above).
          maxOutputTokens: 4000,
          temperature: 0.2,
        });

        log.info('callLLM: plain-text fallback succeeded', { provider, model });

        return {
          // Bug #119 (Pass-8 audit) — defensive completion-shape guard,
          // see callLLM happy-path for rationale.
          text: typeof fallbackResult.text === 'string' ? fallbackResult.text : _invalidJsonFallback('orchestration.callLLM.plain-text-fallback', fallbackResult.text),
          toolCalls: [],
          usage: fallbackResult.usage || { totalTokens: 0 },
        };
      } catch (fallbackError: any) {
        log.error('callLLM: plain-text fallback also failed', {
          provider,
          model,
          error: fallbackError.message,
        });
        // Throw the original error — the fallback is best-effort
        throw lastError;
      }
    }

    log.error('Vercel AI SDK callLLM failed', { provider, model, error: lastError?.message });
    throw lastError;
  }

  private async executeToolWithHealing(name: string, args: any) {
    // Bug #14: Search tools that fail once won't succeed on retry (no backend
    // availability changes mid-request). Skip retries for known-unavailable tools.
    const isSearchTool = name === 'web_search' || name === 'web.search' || name === 'nullclaw:search';
    const maxRetries = isSearchTool ? 0 : 2;
    let attempt = 0;
    const toolCallId = `orch-${name}-${Date.now()}`;

    while (attempt <= maxRetries) {
      try {
        log.debug('PlanActVerify: executing tool with orchestrator', { tool: name, redactedArgs: redactArgsForLogging(args), toolCallId });
        const result = await this.config.executeTool(name, args);

        // Record successful tool call in telemetry
        import('@/lib/tools/tool-call-tracker').then(({ toolCallTracker }) => {
          const structuredResult = buildToolResult(name, args, result);
          toolCallTracker.recordToolCall({
            model: this.validatedConfig.model,
            provider: this.validatedConfig.provider,
            toolName: name,
            success: true,
            timestamp: Date.now(),
            toolCallId,
          });
        }).catch((err) => { log.debug?.('PlanActVerify: recordToolResult failed:', err); });

        return result;
      } catch (error: any) {
        attempt++;
        if (attempt > maxRetries) {
          // Record failed tool call in telemetry
          import('@/lib/tools/tool-call-tracker').then(({ toolCallTracker }) => {
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
          }).catch((err) => { log.debug?.('PlanActVerify: executeTool telemetry failed:', err); });

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

/** @deprecated Use PlanActVerifyOrchestrator instead */
export const AgentOrchestrator = PlanActVerifyOrchestrator;


/**
 * Bug #119 (Pass-8 audit) — defensive completion-shape helper for the
 * shared `orchestration` package. Returns a structured empty-text marker
 * while logging a `[INVALID-JSON-FALLBACK]` warn so operators can grep
 * run.log. This counter does NOT bump `chatMetrics.invalidJsonFallbacks`
 * because the shared package cannot import `bing/web/lib/chat/chat-metrics`
 * (cross-package boundary). The streaming-layer sister site
 * `vercel-ai-streaming.ts` _does_ bump the counter via `tryParseToolArgs`.
 */
function _invalidJsonFallback(source: string, value: unknown): string {
  log.warn(
    '[INVALID-JSON-FALLBACK] orchestration completion shape unexpected — treating as empty text',
    { source, observedType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value },
  );
  return '';
}
