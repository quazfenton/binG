import { getLLMProvider } from './providers/llm-factory'
import { getSandboxProvider } from './providers'
import { SANDBOX_TOOLS, validateCommand, type ToolName } from './sandbox-tools'
import type { ToolResult } from './types'
import type { SandboxHandle } from './providers/sandbox-provider'

function getSystemPrompt(workspaceDir: string): string {
  return `You are an expert software engineer with access to a Linux sandbox workspace.
You can execute shell commands, write files, read files, and list directories.
The workspace is at ${workspaceDir}/.
Always write files before trying to run them.
When installing packages, use the appropriate package manager (npm, pip, etc.).
Report results clearly and concisely.`
}

interface AgentLoopOptions {
  userMessage: string
  sandboxId: string
  conversationHistory?: any[]
  onToolExecution?: (toolName: string, args: Record<string, any>, result: ToolResult) => void
  onStreamChunk?: (chunk: string) => void
}

interface AgentLoopResult {
  response: string
  steps: Array<{ toolName: string; args: Record<string, any>; result: ToolResult }>
  totalSteps: number
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { userMessage, sandboxId, conversationHistory, onToolExecution, onStreamChunk } = options
  const provider = getSandboxProvider()
  const llm = getLLMProvider()

  const sandboxHandle = await provider.getSandbox(sandboxId)
  const systemPrompt = getSystemPrompt(sandboxHandle.workspaceDir)

  return llm.runAgentLoop({
    userMessage,
    conversationHistory,
    tools: [...SANDBOX_TOOLS],
    systemPrompt,
    maxSteps: 15,
    onToolExecution,
    onStreamChunk,
    async executeTool(name: string, args: Record<string, any>): Promise<ToolResult> {
      return executeToolOnSandbox(sandboxHandle, name as ToolName, args)
    },
  })
}

async function executeToolOnSandbox(
  sandbox: SandboxHandle,
  toolName: ToolName,
  args: Record<string, any>,
): Promise<ToolResult> {
  switch (toolName) {
    case 'exec_shell': {
      const validation = validateCommand(args.command)
      if (!validation.valid) {
        return { success: false, output: validation.reason!, exitCode: 1 }
      }
      return sandbox.executeCommand(args.command)
    }
    case 'write_file':
      return sandbox.writeFile(args.path, args.content)
    case 'read_file':
      return sandbox.readFile(args.path)
    case 'list_dir':
      return sandbox.listDirectory(args.path ?? '.')
    default:
      return { success: false, output: `Unknown tool: ${toolName}`, exitCode: 1 }
  }
}
