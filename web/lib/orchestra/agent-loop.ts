import { getLLMProvider } from '../sandbox/providers/llm-factory'
import { getSandboxProvider } from '../sandbox/providers'
import { coreSandboxService } from '../sandbox/core-sandbox-service'
import { ENHANCED_SANDBOX_TOOLS, type ToolName } from '../sandbox/enhanced-sandbox-tools'
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
Always write files before trying to run them.
Report results clearly and concisely.`
  }
  return `You are an expert software engineer with access to a Linux sandbox workspace.
You can execute shell commands, write files, read files, list directories, run code, use git, and more.
The workspace is at ${workspaceDir}/.
Always write files before trying to run them.
When installing packages, use the appropriate package manager (npm, pip, etc.).
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

  const sandboxHandle = await coreSandboxService.getSandbox(sandboxId)
  const systemPrompt = getSystemPrompt(sandboxHandle.workspaceDir)

  // Create wrapper with rate limiting, HITL, process tracking, and learning
  const wrapper = createAgentLoopWrapper({ sandboxHandle, sandboxId, userId });

  // Get learned capabilities from agency for adaptive tool selection
  const learnedCapabilities = wrapper.getLearnedCapabilities(userMessage, 8);

  try {
    const result = await llm.runAgentLoop({
      userMessage,
      conversationHistory,
      tools: [...ENHANCED_SANDBOX_TOOLS] as any,
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
        const capId = toolNameToCapability(name);
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

/**
 * Map legacy tool names to capability IDs
 */
function toolNameToCapability(toolName: string): string {
  const mapping: Record<string, string> = {
    exec_shell: 'sandbox.shell',
    write_file: 'file.write',
    read_file: 'file.read',
    list_dir: 'file.list',
    run_code: 'code.run',
    git_clone: 'repo.clone',
    git_status: 'repo.git',
    git_commit: 'repo.commit',
    git_push: 'repo.push',
    start_process: 'process.start',
    stop_process: 'process.stop',
    list_processes: 'process.list',
    search_files: 'file.search',
    sync_files: 'file.sync',
    mcp_list_tools: 'mcp.list',
    mcp_call_tool: 'mcp.call',
    computer_use_click: 'computer_use.click',
    computer_use_type: 'computer_use.type',
    computer_use_screenshot: 'computer_use.screenshot',
    computer_use_scroll: 'computer_use.scroll',
    get_previews: 'preview.get',
    forward_port: 'preview.forward_port',
  };
  return mapping[toolName] || toolName;
}
