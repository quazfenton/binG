import { getLLMProvider } from './providers/llm-factory'
import { getSandboxProvider } from './providers'
import { SANDBOX_TOOLS, validateCommand, type ToolName } from './sandbox-tools'
import { 
  validateToolInput, 
  WriteFileSchema, 
  ReadFileSchema, 
  ListDirectorySchema, 
  ExecShellSchema,
  validateShellCommand 
} from './validation-schemas'
import { createSandboxRateLimiter } from './providers/rate-limiter'
import type { ToolResult } from './types'
import type { SandboxHandle } from './providers/sandbox-provider'
import { sandboxEvents } from './sandbox-events'

// Create rate limiter instance (singleton per process)
const rateLimiter = createSandboxRateLimiter()

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
  userId?: string  // Added for rate limiting
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
  const { userMessage, sandboxId, userId, conversationHistory, onToolExecution, onStreamChunk } = options
  const providerType = (process.env.SANDBOX_PROVIDER || 'daytona') as any
  const provider = getSandboxProvider(providerType)
  const llm = getLLMProvider()

  const sandboxHandle = await provider.getSandbox(sandboxId)
  const systemPrompt = getSystemPrompt(sandboxHandle.workspaceDir)

  try {
    const result = await llm.runAgentLoop({
      userMessage,
      conversationHistory,
      tools: [...SANDBOX_TOOLS],
      systemPrompt,
      maxSteps: 15,
      onToolExecution(toolName: string, args: Record<string, any>, toolResult: ToolResult) {
        sandboxEvents.emit(sandboxId, 'agent:tool_result', { toolName, args, result: toolResult })
        onToolExecution?.(toolName, args, toolResult)
      },
      onStreamChunk(chunk: string) {
        sandboxEvents.emit(sandboxId, 'agent:stream', { text: chunk })
        onStreamChunk?.(chunk)
      },
      async executeTool(name: string, args: Record<string, any>): Promise<ToolResult> {
        sandboxEvents.emit(sandboxId, 'agent:tool_start', { toolName: name, args })
        return executeToolOnSandbox(sandboxHandle, name as ToolName, args, userId)
      },
    })

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

async function executeToolOnSandbox(
  sandbox: SandboxHandle,
  toolName: ToolName,
  args: Record<string, any>,
  userId?: string,
): Promise<ToolResult> {
  try {
    // Check rate limit before executing tool
    const rateLimitKey = userId || 'anonymous';
    let rateLimitResult;
    
    switch (toolName) {
      case 'exec_shell': {
        // Check rate limit for commands
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'commands');
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          };
        }
        
        // Validate command schema first
        const validated = validateToolInput(ExecShellSchema, args, 'exec_shell');
        
        // Then validate against blocked patterns
        const commandValidation = validateShellCommand(validated.command, validateCommand);
        if (!commandValidation.valid) {
          return { 
            success: false, 
            output: commandValidation.reason || 'Command validation failed', 
            exitCode: 1 
          };
        }
        
        // Record successful validation for rate limiting
        await rateLimiter.record(rateLimitKey, 'commands');
        
        return sandbox.executeCommand(commandValidation.command!);
      }
      
      case 'write_file': {
        // Check rate limit for file operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'fileOps');
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          };
        }
        
        const validated = validateToolInput(WriteFileSchema, args, 'write_file');
        await rateLimiter.record(rateLimitKey, 'fileOps');
        return sandbox.writeFile(validated.path, validated.content);
      }
      
      case 'read_file': {
        // Check rate limit for file operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'fileOps');
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          };
        }
        
        const validated = validateToolInput(ReadFileSchema, args, 'read_file');
        await rateLimiter.record(rateLimitKey, 'fileOps');
        return sandbox.readFile(validated.path);
      }
      
      case 'list_dir': {
        // Check rate limit for file operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'fileOps');
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          };
        }
        
        const validated = validateToolInput(ListDirectorySchema, args, 'list_dir');
        await rateLimiter.record(rateLimitKey, 'fileOps');
        return sandbox.listDirectory(validated.path);
      }
      
      default:
        return { success: false, output: `Unknown tool: ${toolName}`, exitCode: 1 };
    }
  } catch (error: any) {
    // Log validation errors with context
    console.error('[AgentLoop] Tool execution failed', {
      tool: toolName,
      error: error.message,
    });
    
    return {
      success: false,
      output: `Tool '${toolName}' failed: ${error.message}`,
      exitCode: 1,
    };
  }
}
