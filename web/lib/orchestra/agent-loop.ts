import { getLLMProvider } from '../sandbox/providers/llm-factory'
import { getSandboxProvider } from '../sandbox/providers'
import { coreSandboxService } from '../sandbox/core-sandbox-service'
import { EXTENDED_SANDBOX_TOOLS, mapToolToCapability, getToolDescription } from '../sandbox/extended-sandbox-tools'
import type { ToolResult } from '../sandbox/types'
import type { SandboxHandle } from '../sandbox/providers/sandbox-provider'
import { sandboxEvents } from '../sandbox/sandbox-events'
import { createAgentLoopWrapper, getProcessesForSandbox, registerProcess, type TrackedProcess } from './agent-loop-wrapper'
import { getCapabilityRouter } from '@/lib/tools/router'
import { ALL_CAPABILITIES } from '@/lib/tools/capabilities'

// Re-export process registry for external access
export { processRegistry, getProcessesForSandbox, registerProcess, type TrackedProcess } from './agent-loop-wrapper'

function getSystemPrompt(workspaceDir: string): string {
  const isDesktop = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';
  if (isDesktop) {
    const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    return `You are an expert software engineer running on the user's ${platform} desktop.
You have direct access to the local filesystem and shell. You can execute any commands natively.
The workspace is at ${workspaceDir}/.
You can use bash/shell commands, git, npm/pnpm/yarn, python, and any tools installed on this machine.

Additional capabilities:
- terminal_create_session / terminal_send_input / terminal_get_output: Interactive terminal sessions for running dev servers, TUIs, etc.
- project_analyze: Detect framework, package manager, recommended commands.
- project_list_scripts: List all runnable scripts (npm, Makefile, pyproject, cargo, go, etc.).
- port_status: Check which ports are listening.

Always write files before trying to run them.
Report results clearly and concisely.`
  }
  return `You are an expert software engineer with access to a Linux sandbox workspace.
You can execute shell commands, write files, read files, list directories, run code, use git, and more.
The workspace is at ${workspaceDir}/.

Additional capabilities:
- terminal_create_session / terminal_send_input / terminal_get_output: Interactive terminal sessions for running dev servers, monitoring output (with waitForPattern), navigating TUIs.
- terminal_list_sessions: See all active terminal sessions.
- project_analyze: Detect framework, package manager, entry points, config files, and recommended commands.
- project_list_scripts: List all runnable scripts/tasks (npm scripts, Makefile, pyproject.toml, cargo, go, deno, turbo, nx).
- project_dependencies: Check installed packages and detect issues.
- project_structure: Get file tree with semantic understanding.
- port_status: Check which ports are listening and what processes own them.

Always write files before trying to run them.
When installing packages, use the appropriate package manager (npm, pip, etc.).
Use project_analyze before running commands to understand the project structure.
For interactive programs (dev servers, TUIs), use terminal_create_session + terminal_get_output with waitForPattern.
Report results clearly and concisely.`
}

interface AgentLoopOptions {
  userMessage: string
  sandboxId: string
  userId?: string
  conversationHistory?: any[]
  onToolExecution?: (toolName: string, args: Record<string, any>, result: ToolResult) => void
  onStreamChunk?: (chunk: string) => void
  onReasoningChunk?: (chunk: string, type?: 'thought' | 'reasoning' | 'plan' | 'reflection') => void
}

interface AgentLoopResult {
  response: string
  steps: Array<{ toolName: string; args: Record<string, any>; result: ToolResult }>
  totalSteps: number
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { userMessage, sandboxId, userId, conversationHistory, onToolExecution, onStreamChunk, onReasoningChunk } = options
  const llm = getLLMProvider()

  const sandboxHandle = await (coreSandboxService as any).getSandbox(sandboxId)
  const systemPrompt = getSystemPrompt(sandboxHandle.workspaceDir)

  // Create wrapper with rate limiting, HITL, process tracking, and learning
  const wrapper = createAgentLoopWrapper({ sandboxHandle, sandboxId, userId });

  // Get learned capabilities from agency for adaptive tool selection
  const learnedCapabilities = wrapper.getLearnedCapabilities(userMessage, 8);

  try {
    const result = await llm.runAgentLoop({
      userMessage,
      conversationHistory,
      tools: [...EXTENDED_SANDBOX_TOOLS] as any,
      systemPrompt,
      maxSteps: 15,
      onToolExecution(toolName: string, args: Record<string, any>, toolResult: ToolResult) {
        sandboxEvents.emit(sandboxId, 'agent:tool_start', { toolName, args });
        sandboxEvents.emit(sandboxId, 'agent:tool_result', { toolName, args, result: toolResult })
        onToolExecution?.(toolName, args, toolResult)
      },
      onStreamChunk(chunk: string) {
        sandboxEvents.emit(sandboxId, 'agent:stream', { text: chunk })
        onStreamChunk?.(chunk)
      },
      async executeTool(name: string, args: Record<string, any>): Promise<ToolResult> {
        sandboxEvents.emit(sandboxId, 'agent:tool_start', { toolName: name, args })
        const capId = mapToolToCapability(name);
        const wrapperResult = await wrapper.execute(capId, args);
        // Record execution with agency for learning
        wrapper.recordExecution(userMessage, wrapperResult.success, [capId]);
        sandboxEvents.emit(sandboxId, 'agent:tool_result', { toolName: name, args, result: wrapperResult })
        return {
          success: wrapperResult.success,
          output: wrapperResult.output,
          exitCode: wrapperResult.exitCode,
          error: wrapperResult.error,
        };
      },
      onReasoningChunk(chunk: string, type?: 'thought' | 'reasoning' | 'plan' | 'reflection') {
        sandboxEvents.emit(sandboxId, 'agent:reasoning_chunk', { text: chunk, type })
        onReasoningChunk?.(chunk, type)
      },
      onReasoningComplete: () => {
        sandboxEvents.emit(sandboxId, 'agent:reasoning_complete', {})
      },
      learnedCapabilities,
    } as any)

    sandboxEvents.emit(sandboxId, 'agent:complete', {
      response: result.response,
      totalSteps: result.totalSteps,
    })

    return result
  } catch (error) {
    sandboxEvents.emit(sandboxId, 'agent:error', {
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
