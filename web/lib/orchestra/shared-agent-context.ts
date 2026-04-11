/**
 * Shared Agent Context Utilities
 *
 * Centralizes workspace-snapshot building, structured error formatting,
 * no-progress loop detection, and tool-arg normalization so that ALL
 * execution paths (V1 API, V2 Native, StatefulAgent, Mastra agent-loop,
 * Desktop mode) share the same self-healing behaviour.
 *
 * Import and use these from any agent loop or execution path.
 */

import { createLogger } from '@/lib/utils/logger';
import { normalizeToolArgs, tolerantJsonParse } from '@/lib/mcp/vfs-mcp-tools';

export { normalizeToolArgs, tolerantJsonParse };

const log = createLogger('SharedAgentContext');

// ============================================================================
// Workspace Snapshot
// ============================================================================

/**
 * Build a lightweight workspace snapshot (file tree up to 80 paths).
 * Inject this into system prompts so the model doesn't hallucinate paths.
 */
export async function buildWorkspaceSnapshot(userId: string): Promise<string> {
  try {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
    const workspace = await virtualFilesystem.exportWorkspace(userId);
    const paths = workspace.files.map((f: any) => f.path).sort();

    if (paths.length === 0) return '(empty workspace — no files yet)';

    const shown = paths.slice(0, 80);
    const lines = shown.map((p: string) => `  ${p}`);
    if (paths.length > 80) {
      lines.push(`  ... and ${paths.length - 80} more files`);
    }
    return lines.join('\n');
  } catch {
    return '(workspace listing unavailable)';
  }
}

// ============================================================================
// Structured Tool Error Formatting
// ============================================================================

export interface StructuredToolError {
  code: string;
  message: string;
  retryable: boolean;
  attemptedPath?: string;
  parentPath?: string;
  suggestedPaths?: string[];
  suggestedNextAction?: string;
  expectedFields?: string[];
}

/**
 * Format a tool error into a structured object the LLM can reason about.
 * Call this instead of returning raw `error.message` strings.
 */
export function formatToolError(
  toolName: string,
  error: Error | string,
  args?: Record<string, any>,
): StructuredToolError {
  const msg = typeof error === 'string' ? error : error.message || 'Unknown error';
  const lower = msg.toLowerCase();

  // Path not found
  if (/not found|enoent|does not exist/i.test(lower)) {
    const path = args?.path || '';
    const parentPath = path.includes('/')
      ? path.substring(0, path.lastIndexOf('/')) || '/'
      : '/';
    return {
      code: 'PATH_NOT_FOUND',
      message: `"${path}" does not exist.`,
      retryable: true,
      attemptedPath: path,
      parentPath,
      suggestedNextAction: `Call list_directory("${parentPath}") to see what exists.`,
    };
  }

  // Permission denied
  if (/permission denied|forbidden|not authorized/i.test(lower)) {
    return {
      code: 'PERMISSION_DENIED',
      message: msg,
      retryable: false,
    };
  }

  // Generic catchall
  return {
    code: 'TOOL_ERROR',
    message: msg,
    retryable: true,
    suggestedNextAction: `Check the error message and try a different approach.`,
  };
}

/**
 * Validate required tool arguments. Returns a StructuredToolError if missing, null if OK.
 */
export function validateToolArgs(
  toolName: string,
  args: Record<string, any>,
  requiredFields: string[],
): StructuredToolError | null {
  const missing = requiredFields.filter(f => args[f] === undefined || args[f] === null || args[f] === '');
  if (missing.length === 0) return null;

  return {
    code: 'INVALID_ARGS',
    message: `Missing required arguments for ${toolName}: ${missing.join(', ')}`,
    retryable: true,
    expectedFields: requiredFields,
    suggestedNextAction: `Call ${toolName} again with all required fields: ${requiredFields.join(', ')}`,
  };
}

// ============================================================================
// No-Progress Loop Detection
// ============================================================================

export interface LoopDetectorState {
  consecutiveFailures: number;
  lastSuccessfulStep: number;
  totalSteps: number;
  failedToolKeys: Map<string, number>;
}

export function createLoopDetectorState(): LoopDetectorState {
  return {
    consecutiveFailures: 0,
    lastSuccessfulStep: 0,
    totalSteps: 0,
    failedToolKeys: new Map(),
  };
}

/**
 * Record a tool execution result and check for loop conditions.
 * Returns null if OK, or an error message if the agent should stop.
 */
export function recordStepAndCheckLoop(
  state: LoopDetectorState,
  toolName: string,
  args: Record<string, any>,
  success: boolean,
): string | null {
  state.totalSteps++;

  if (success) {
    state.consecutiveFailures = 0;
    state.lastSuccessfulStep = state.totalSteps;
  } else {
    state.consecutiveFailures++;

    // Track identical failed calls
    const toolKey = `${toolName}:${JSON.stringify(args)}`;
    const count = (state.failedToolKeys.get(toolKey) || 0) + 1;
    state.failedToolKeys.set(toolKey, count);

    // Exact-repeat detection
    if (count >= 2) {
      return `Agent stopped: "${toolName}" failed ${count} times with the same arguments. Do NOT retry — try a different approach or path.`;
    }
  }

  // No-progress: 3 consecutive failures
  if (state.consecutiveFailures >= 3) {
    return `Agent stopped: ${state.consecutiveFailures} consecutive tool failures with no success. The task may need a different approach.`;
  }

  // No-progress: 6+ steps with zero successes
  if (state.totalSteps > 6 && state.lastSuccessfulStep === 0) {
    return `Agent stopped: ${state.totalSteps} tool calls with no successful result. Try a simpler approach.`;
  }

  return null;
}

// ============================================================================
// Shared System Prompt Builder
// ============================================================================

export interface AgentPromptContext {
  workspacePath: string;
  workspaceSnapshot: string;
  currentFile?: string;
  lastAction?: string;
  toolDescriptions: string;
  extraInstructions?: string;
}

/**
 * Build a system prompt with workspace context and self-healing instructions.
 * Use this from any execution path for consistency.
 */
export function buildAgentSystemPrompt(ctx: AgentPromptContext): string {
  const currentFileNote = ctx.currentFile ? `\nCurrently focused file: ${ctx.currentFile}` : '';
  const lastActionNote = ctx.lastAction ? `\nLast action: ${ctx.lastAction}` : '';
  const extra = ctx.extraInstructions ? `\n${ctx.extraInstructions}\n` : '';

  return `You are an AI coding assistant with workspace tools.

## Workspace
Root: ${ctx.workspacePath}${currentFileNote}${lastActionNote}

### Existing Files
${ctx.workspaceSnapshot}

## Available Tools
${ctx.toolDescriptions}
${extra}
## Rules
1. ALWAYS use function calls for tools — never output JSON or text like "[Tool: write_file]".
2. Use ONLY paths from the file listing above, or new paths you are creating. Do NOT guess paths.
3. Before editing an unfamiliar file, read it first with read_file.
4. Use create_directory before writing files into a new directory.
5. Prefer minimal, surgical edits. Read → understand → write the smallest correct change.
6. If a tool fails, read the error carefully. Do NOT retry the exact same call — try a different approach.
7. After 2 failures on the same path, call list_directory on the parent to discover what actually exists.

## Error Recovery
- PATH_NOT_FOUND → check suggestedPaths in the error, or call list_directory on the parent
- INVALID_ARGS → check the error's expectedFields list and retry with correct field names
- Do NOT repeat failing calls. Each retry must change something.

When the task is complete, respond naturally with your final answer.
`;
}
