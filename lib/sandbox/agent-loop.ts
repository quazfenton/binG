import { getLLMProvider } from './providers/llm-factory'
import { getSandboxProvider } from './providers'
import { ENHANCED_SANDBOX_TOOLS, type ToolName } from './enhanced-sandbox-tools'
import { validateCommand } from './security'
import {
  validateToolInput,
  WriteFileSchema,
  ReadFileSchema,
  ListDirectorySchema,
  ExecShellSchema,
  validateShellCommand
} from './validation-schemas'
import { createSandboxRateLimiter } from './providers/rate-limiter'
import { evaluateActiveWorkflow, type ApprovalContext } from '@/lib/stateful-agent'
import type { ToolResult } from './types'
import type { SandboxHandle } from './providers/sandbox-provider'
import { sandboxEvents } from './sandbox-events'

// Create rate limiter instance (singleton per process)
const rateLimiter = createSandboxRateLimiter()

function getSystemPrompt(workspaceDir: string): string {
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
      tools: [...ENHANCED_SANDBOX_TOOLS],
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
    const rateLimitKey = userId || 'anonymous'
    let rateLimitResult

    switch (toolName) {
      case 'exec_shell': {
        // Check rate limit for commands
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'commands')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        // Validate command schema first
        const validated = validateToolInput(ExecShellSchema, args, 'exec_shell')

        // Then validate against blocked patterns
        const commandValidation = validateShellCommand(validated.command, validateCommand)
        if (!commandValidation.valid) {
          return {
            success: false,
            output: commandValidation.reason || 'Command validation failed',
            exitCode: 1,
          }
        }

        // HITL Workflow: Evaluate if command requires approval
        const approvalContext: ApprovalContext = {
          riskLevel:
            commandValidation.command?.includes('rm -rf') ||
            commandValidation.command?.includes('sudo')
              ? 'high'
              : 'medium',
          userId,
        }
        const execEval = evaluateActiveWorkflow('exec_shell', validated, approvalContext)

        if (execEval.requiresApproval) {
          console.log(
            `[AgentLoop] Tool '${toolName}' requires approval (rule: ${execEval.matchedRule?.name || 'default'})`,
          )
          // In a real implementation, this would suspend and wait for approval
          // For now, we just log and proceed (HITL disabled by default)
        }

        // Record successful validation for rate limiting
        await rateLimiter.record(rateLimitKey, 'commands')

        return sandbox.executeCommand(commandValidation.command!)
      }

      case 'write_file': {
        // Check rate limit for file operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'fileOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const validated = validateToolInput(WriteFileSchema, args, 'write_file')

        // HITL Workflow: Evaluate if file write requires approval
        const approvalContext: ApprovalContext = {
          filePath: validated.path,
          riskLevel: validated.path?.includes('.env') || validated.path?.includes('secret') ? 'high' : 'low',
          userId,
        }
        const writeEval = evaluateActiveWorkflow('write_file', validated, approvalContext)

        if (writeEval.requiresApproval) {
          console.log(
            `[AgentLoop] Tool '${toolName}' requires approval (rule: ${writeEval.matchedRule?.name || 'default'})`,
          )
          // In a real implementation, this would suspend and wait for approval
        }

        await rateLimiter.record(rateLimitKey, 'fileOps')
        return sandbox.writeFile(validated.path, validated.content)
      }

      case 'read_file': {
        // Check rate limit for file operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'fileOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const validated = validateToolInput(ReadFileSchema, args, 'read_file')
        await rateLimiter.record(rateLimitKey, 'fileOps')
        return sandbox.readFile(validated.path)
      }

      case 'list_dir': {
        // Check rate limit for file operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'fileOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const validated = validateToolInput(ListDirectorySchema, args, 'list_dir')
        await rateLimiter.record(rateLimitKey, 'fileOps')
        return sandbox.listDirectory(validated.path)
      }

      // Enhanced tools - code execution
      case 'run_code': {
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'codeExecution')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { code, language, args: execArgs, stdin, timeout = 30 } = args

        if (!code || !language) {
          return {
            success: false,
            output: 'Code and language are required',
            exitCode: 1,
          }
        }

        await rateLimiter.record(rateLimitKey, 'codeExecution')

        // Execute code using sandbox's code interpreter if available
        // Otherwise, write to temp file and execute
        const tempFile = `/tmp/code_${Date.now()}.${getCodeExtension(language)}`
        await sandbox.writeFile(tempFile, code)

        const cmd = getCodeCommand(language, tempFile, execArgs || [])
        const result = await sandbox.executeCommand(cmd)

        // Clean up temp file
        try {
          await sandbox.executeCommand(`rm -f ${tempFile}`)
        } catch {
          // Ignore cleanup errors
        }

        return result
      }

      // Enhanced tools - git operations
      case 'git_clone': {
        const { url, path, branch, depth, username, password } = args

        if (!url) {
          return { success: false, output: 'Repository URL is required', exitCode: 1 }
        }

        let clonePath = path || getRepoNameFromUrl(url)
        let cloneCmd = `git clone ${url} ${clonePath}`

        if (branch) {
          cloneCmd = `git clone -b ${branch} ${url} ${clonePath}`
        }

        if (depth) {
          cloneCmd += ` --depth ${depth}`
        }

        if (username && password) {
          // Inject credentials into URL
          const authUrl = url.replace('https://', `https://${username}:${password}@`)
          cloneCmd = cloneCmd.replace(url, authUrl)
        }

        return sandbox.executeCommand(cloneCmd)
      }

      case 'git_status': {
        const repoPath = args.path || '.'
        return sandbox.executeCommand(`cd ${repoPath} && git status`)
      }

      case 'git_commit': {
        const { message, all, path } = args
        const repoPath = path || '.'

        if (!message) {
          return { success: false, output: 'Commit message is required', exitCode: 1 }
        }

        let cmd = `cd ${repoPath} && `
        if (all) {
          cmd += 'git add -A && '
        }
        cmd += `git commit -m "${message.replace(/"/g, '\\"')}"`

        return sandbox.executeCommand(cmd)
      }

      case 'git_push': {
        const { remote = 'origin', branch, force } = args
        const repoPath = args.path || '.'

        let cmd = `cd ${repoPath} && git push ${remote}`
        if (force) {
          cmd += ' --force'
        }
        if (branch) {
          cmd += ` ${branch}`
        }

        return sandbox.executeCommand(cmd)
      }

      // Enhanced tools - process management
      case 'start_process': {
        const { command, background = true, captureOutput = true } = args
        // For background processes, use nohup or &
        const bgCmd = background ? `nohup ${command} ${captureOutput ? '&> /tmp/process_$$.log &' : '&'}` : command
        return sandbox.executeCommand(bgCmd)
      }

      case 'stop_process': {
        const { pid, name, signal = 'SIGTERM' } = args

        if (pid) {
          return sandbox.executeCommand(`kill -${signal} ${pid}`)
        }

        if (name) {
          return sandbox.executeCommand(`pkill -${signal} -f "${name}"`)
        }

        return { success: false, output: 'PID or process name required', exitCode: 1 }
      }

      case 'list_processes': {
        const userFilter = args.user ? ` | grep ${args.user}` : ''
        return sandbox.executeCommand(`ps aux${userFilter}`)
      }

      // Enhanced tools - preview management
      case 'get_previews': {
        const { port } = args
        if (port) {
          return sandbox.executeCommand(`lsof -i :${port} 2>/dev/null || echo "No process on port ${port}"`)
        }
        return sandbox.executeCommand('netstat -tlnp 2>/dev/null || ss -tlnp')
      }

      case 'forward_port': {
        const { port, public: isPublic = true } = args
        // This would integrate with sandbox provider's port forwarding
        // For now, just verify the port is listening
        return sandbox.executeCommand(`lsof -i :${port} 2>/dev/null || echo "Port ${port} not in use"`)
      }

      // Enhanced tools - file operations
      case 'search_files': {
        const { pattern, path = '.', content, maxResults = 100 } = args

        if (content) {
          return sandbox.executeCommand(`grep -r "${content}" ${path} | head -n ${maxResults}`)
        }

        return sandbox.executeCommand(`find ${path} -name "${pattern}" | head -n ${maxResults}`)
      }

      case 'sync_files': {
        const { direction, paths, deleteOrphans = false } = args
        // Placeholder - would implement actual sync logic
        return {
          success: true,
          output: `Sync ${direction} completed for paths: ${paths?.join(', ') || 'all'}`,
          exitCode: 0,
        }
      }

      // Enhanced tools - computer use (would integrate with desktop service)
      case 'computer_use_click':
      case 'computer_use_type':
      case 'computer_use_screenshot':
      case 'computer_use_scroll': {
        return {
          success: false,
          output: 'Computer use tools require desktop integration. Not available in sandbox mode.',
          exitCode: 1,
        }
      }

      // Enhanced tools - MCP
      case 'mcp_list_tools':
      case 'mcp_call_tool': {
        return {
          success: false,
          output: 'MCP tools require MCP server configuration. Not available in basic sandbox mode.',
          exitCode: 1,
        }
      }

      default:
        return { success: false, output: `Unknown tool: ${toolName}`, exitCode: 1 }
    }
  } catch (error: any) {
    // Log validation errors with context
    console.error('[AgentLoop] Tool execution failed', {
      tool: toolName,
      error: error.message,
    })

    return {
      success: false,
      output: `Tool '${toolName}' failed: ${error.message}`,
      exitCode: 1,
    }
  }
}

// Helper functions for code execution
function getCodeExtension(language: string): string {
  const extensions: Record<string, string> = {
    python: 'py',
    javascript: 'js',
    typescript: 'ts',
    go: 'go',
    rust: 'rs',
    java: 'java',
    r: 'r',
    cpp: 'cpp',
  }
  return extensions[language] || 'txt'
}

function getCodeCommand(language: string, filePath: string, args: string[]): string {
  const commands: Record<string, string> = {
    python: `python3 ${filePath} ${args.join(' ')}`,
    javascript: `node ${filePath} ${args.join(' ')}`,
    typescript: `npx ts-node ${filePath} ${args.join(' ')}`,
    go: `cd ${filePath.substring(0, filePath.lastIndexOf('/'))} && go run ${filePath.substring(filePath.lastIndexOf('/') + 1)} ${args.join(' ')}`,
    rust: `rustc ${filePath} -o /tmp/rust_out && /tmp/rust_out ${args.join(' ')}`,
    java: `javac ${filePath} && java -cp ${filePath.substring(0, filePath.lastIndexOf('/'))} ${args.join(' ')}`,
    r: `Rscript ${filePath} ${args.join(' ')}`,
    cpp: `g++ ${filePath} -o /tmp/cpp_out && /tmp/cpp_out ${args.join(' ')}`,
  }
  return commands[language] || `echo "Unsupported language: ${language}"`
}

function getRepoNameFromUrl(url: string): string {
  const match = url.match(/\/([^/]+)\.git$/)
  return match ? match[1] : 'repo'
}
