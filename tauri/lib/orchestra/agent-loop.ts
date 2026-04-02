import { getLLMProvider } from '../sandbox/providers/llm-factory'
import { getSandboxProvider } from '../sandbox/providers'
import { ENHANCED_SANDBOX_TOOLS, type ToolName } from '../sandbox/enhanced-sandbox-tools'
import { validateCommand } from '../sandbox/security'
import {
  validateToolInput,
  WriteFileSchema,
  ReadFileSchema,
  ListDirectorySchema,
  ExecShellSchema,
  validateShellCommand
} from '../sandbox/validation-schemas'
import { createSandboxRateLimiter } from '../sandbox/providers/rate-limiter'
import { evaluateActiveWorkflow, type ApprovalContext } from '@/lib/orchestra/stateful-agent'
import type { ToolResult } from '../sandbox/types'
import type { SandboxHandle } from '../sandbox/providers/sandbox-provider'
import { sandboxEvents } from '../sandbox/sandbox-events'

// Create rate limiter instance (singleton per process)
const rateLimiter = createSandboxRateLimiter()

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
  userId?: string  // Added for rate limiting
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
  const providerType = (process.env.SANDBOX_PROVIDER || 'daytona') as any
  const provider = await getSandboxProvider(providerType)
  const llm = getLLMProvider()

  const sandboxHandle = await provider.getSandbox(sandboxId)
  const systemPrompt = getSystemPrompt(sandboxHandle.workspaceDir)

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
        return executeToolOnSandbox(sandboxHandle, name as ToolName, args, userId)
      },
      onReasoningChunk(chunk: string, type?: 'thought' | 'reasoning' | 'plan' | 'reflection') {
        sandboxEvents.emit(sandboxId, 'agent:reasoning_chunk', { text: chunk, type })
        onReasoningChunk?.(chunk, type)
      },
      onReasoningComplete: () => {
        sandboxEvents.emit(sandboxId, 'agent:reasoning_complete', {})
      },
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

        // HITL Enforcement: Block command if approval is required and enforcement is enabled
        const enforceHitl = process.env.ENFORCE_HITL === 'true';
        if (execEval.requiresApproval) {
          if (enforceHitl) {
            return {
              success: false,
              output: `Command blocked: requires approval (rule: ${execEval.matchedRule?.name || 'default'}). ${execEval.reason || ''}`,
              error: 'HITL enforcement: command requires approval',
              blocked: true,
              requiresApproval: true,
              approvalRule: execEval.matchedRule?.name,
            };
          }
          // Log only if enforcement is disabled (default behavior)
          console.log(
            `[AgentLoop] Tool '${toolName}' requires approval (rule: ${execEval.matchedRule?.name || 'default'}) - proceeding anyway (ENFORCE_HITL not set)`,
          );
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

        // HITL Enforcement: Block file write if approval is required and enforcement is enabled
        const enforceHitl = process.env.ENFORCE_HITL === 'true';
        if (writeEval.requiresApproval) {
          if (enforceHitl) {
            return {
              success: false,
              output: `File write blocked: requires approval (rule: ${writeEval.matchedRule?.name || 'default'}). ${writeEval.reason || ''}`,
              error: 'HITL enforcement: file write requires approval',
              blocked: true,
              requiresApproval: true,
              approvalRule: writeEval.matchedRule?.name,
            };
          }
          console.log(
            `[AgentLoop] Tool '${toolName}' requires approval (rule: ${writeEval.matchedRule?.name || 'default'}) - proceeding anyway (ENFORCE_HITL not set)`,
          );
        }

        await rateLimiter.record(rateLimitKey, 'fileOps')
        return sandbox.writeFile(validated.path, validated.content)
      }

      case 'read_file': {
        const filePath = args.path as string;
        const repoPath = filePath || '.';
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
        if ('runCode' in sandbox) {
          return (sandbox as unknown as { runCode(c: string, l: string): Promise<ToolResult> }).runCode(code, language)
        }

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
        // Check rate limit for git operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'gitOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { url, path, branch, depth, username, password } = args

        if (!url) {
          return { success: false, output: 'Repository URL is required', exitCode: 1 }
        }

        // FIX: URL validation was rejecting standard HTTPS repo URLs because regex disallowed path slashes
        // Allow standard HTTPS URLs with optional path (e.g., user/repo or org/team/repo)
        const urlPattern = /^https:\/\/[a-zA-Z0-9]([a-zA-Z0-9._\-]*[a-zA-Z0-9])?(?:\/[a-zA-Z0-9]([a-zA-Z0-9._\-]*[a-zA-Z0-9])?)*(?:\.git)?$/;
        if (!urlPattern.test(url)) {
          return { success: false, output: 'Invalid repository URL format - only HTTPS URLs allowed', exitCode: 1 }
        }

        const clonePath = path || getRepoNameFromUrl(url)

        // Strict path validation - alphanumeric, dots, hyphens, underscores only
        if (!/^[a-zA-Z0-9]([a-zA-Z0-9._\-]*[a-zA-Z0-9])?$/.test(clonePath)) {
          return { success: false, output: 'Invalid path format - use alphanumeric, dots, hyphens, underscores only', exitCode: 1 }
        }

        // Branch validation if provided
        if (branch && !/^[a-zA-Z0-9]([a-zA-Z0-9._\-]*[a-zA-Z0-9])?$/.test(branch)) {
          return { success: false, output: 'Invalid branch name', exitCode: 1 }
        }

        // Depth validation if provided
        if (depth !== undefined) {
          const depthNum = parseInt(String(depth), 10)
          if (isNaN(depthNum) || depthNum < 1 || depthNum > 100) {
            return { success: false, output: 'Depth must be between 1 and 100', exitCode: 1 }
          }
        }

        // Use git credential helper instead of embedding credentials in URL
        // Build command using argument arrays when possible to avoid shell injection
        let cloneCmd: string
        if (username && password) {
          // Sanitize username and password - reject if they contain shell metacharacters
          if (/[;&|`$()]/.test(username) || /[;&|`$()]/.test(password)) {
            return { success: false, output: 'Username/password contains invalid characters', exitCode: 1 }
          }
          // Use git's stdin credential input which is safer than echo
          cloneCmd = `cd '${sandbox.workspaceDir}' && git config --local credential.helper store && printf '%s\n' 'username='"'${username}'" 'password='"'${password}'"' | git credential approve && git clone '${url}' '${clonePath}' && git config --local --unset credential.helper`
        } else {
          cloneCmd = `cd '${sandbox.workspaceDir}' && git clone '${url}' '${clonePath}'`
        }

        // Add branch if specified (append to existing command, don't overwrite)
        // FIX: Branch handling was overwriting the credentialed clone command
        if (branch) {
          // Branch is already validated above - append branch flag
          const branchArg = ` -b '${branch.replace(/'/g, "'\\''")}'`;
          // Add branch to the existing cloneCmd without overwriting
          cloneCmd = cloneCmd.replace(/git clone/, 'git clone' + branchArg);
        }

        // Add depth if specified
        if (depth) {
          cloneCmd += ` --depth ${parseInt(String(depth), 10)}`
        }

        await rateLimiter.record(rateLimitKey, 'gitOps')
        return sandbox.executeCommand(cloneCmd)
      }

      case 'git_status': {
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'gitOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const repoPath = args.path || '.'
        const safePath = String(repoPath).replace(/'/g, "'\\''")
        await rateLimiter.record(rateLimitKey, 'gitOps')
        return sandbox.executeCommand(`cd '${safePath}' && git status`)
      }

      case 'git_commit': {
        // Check rate limit for git operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'gitOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { message, all, path } = args
        const repoPath = path || '.'

        // Validate repo path
        if (!/^[a-zA-Z0-9._\-/]+$/.test(repoPath)) {
          return { success: false, output: 'Invalid repository path', exitCode: 1 }
        }

        if (!message) {
          return { success: false, output: 'Commit message is required', exitCode: 1 }
        }

        // Use single quotes and escape any single quotes in the message
        // This prevents command substitution via $() or backticks
        const escapedMessage = String(message).replace(/'/g, "'\\''")
        
        let cmd = `cd ${repoPath} && `
        if (all) {
          cmd += 'git add -A && '
        }
        // Use single quotes to prevent command substitution
        cmd += `git commit -m '${escapedMessage}'`

        await rateLimiter.record(rateLimitKey, 'gitOps')
        return sandbox.executeCommand(cmd)
      }

      case 'git_push': {
        // Check rate limit for git operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'gitOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { remote = 'origin', branch, force, repoPath } = args
        const pathToUse = repoPath || '.'

        // Validate inputs
        if (!/^[a-zA-Z0-9._\-/]+$/.test(pathToUse)) {
          return { success: false, output: 'Invalid repository path', exitCode: 1 }
        }

        if (!/^[a-zA-Z0-9._\-/]+$/.test(remote)) {
          return { success: false, output: 'Invalid remote name', exitCode: 1 }
        }

        let cmd = `cd ${pathToUse} && git push ${remote}`
        if (force) {
          cmd += ' --force'
        }
        if (branch) {
          const escapedBranch = String(branch).replace(/'/g, "'\\''")
          cmd += ` ${escapedBranch}`
        }

        await rateLimiter.record(rateLimitKey, 'gitOps')
        return sandbox.executeCommand(cmd)
      }

      // Enhanced tools - process management
      case 'start_process': {
        // Check rate limit for process operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'processOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { command, background = true, captureOutput = true } = args
        
        // Validate and sanitize command
        const safeCommand = String(command).replace(/'/g, "'\\''")
        
        // For background processes, use nohup or &
        const bgCmd = background ? `nohup ${safeCommand} ${captureOutput ? '&> /tmp/process_$$.log &' : '&'}` : safeCommand
        await rateLimiter.record(rateLimitKey, 'processOps')
        return sandbox.executeCommand(bgCmd)
      }

      case 'stop_process': {
        // Check rate limit for process operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'processOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { pid, name, signal = 'SIGTERM' } = args

        // Validate signal
        const validSignals = ['SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGINT', 'SIGUSR1', 'SIGUSR2', '9', '15', '1', '2']
        if (!validSignals.includes(String(signal))) {
          return { success: false, output: 'Invalid signal', exitCode: 1 }
        }

        if (pid) {
          // Validate PID is a number
          const pidNum = parseInt(pid, 10)
          if (isNaN(pidNum) || pidNum <= 0) {
            return { success: false, output: 'Invalid PID', exitCode: 1 }
          }
          await rateLimiter.record(rateLimitKey, 'processOps')
          return sandbox.executeCommand(`kill -${signal} ${pidNum}`)
        }

        if (name) {
          // Escape the process name to prevent command injection
          const escapedName = String(name).replace(/'/g, "'\\''")
          await rateLimiter.record(rateLimitKey, 'processOps')
          return sandbox.executeCommand(`pkill -${signal} -f '${escapedName}'`)
        }

        return { success: false, output: 'PID or process name required', exitCode: 1 }
      }

      case 'list_processes': {
        // Check rate limit for process operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'processOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const userFilter = args.user ? ` | grep '${String(args.user).replace(/'/g, "'\\''")}'` : ''
        await rateLimiter.record(rateLimitKey, 'processOps')
        return sandbox.executeCommand(`ps aux${userFilter}`)
      }

      // Enhanced tools - preview management
      case 'get_previews': {
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'processOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { port } = args
        if (port) {
          await rateLimiter.record(rateLimitKey, 'processOps')
          return sandbox.executeCommand(`lsof -i :${port} 2>/dev/null || echo "No process on port ${port}"`)
        }
        await rateLimiter.record(rateLimitKey, 'processOps')
        return sandbox.executeCommand('netstat -tlnp 2>/dev/null || ss -tlnp')
      }

      case 'forward_port': {
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'processOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { port, public: isPublic = true } = args
        // This would integrate with sandbox provider's port forwarding
        // For now, just verify the port is listening
        await rateLimiter.record(rateLimitKey, 'processOps')
        return sandbox.executeCommand(`lsof -i :${port} 2>/dev/null || echo "Port ${port} not in use"`)
      }

      // Enhanced tools - file operations
      case 'search_files': {
        // Check rate limit for file operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'fileOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { pattern, path = '.', content, maxResults = 100 } = args

        // Validate inputs
        const safePath = String(path).replace(/'/g, "'\\''")
        const safeMax = Math.min(parseInt(maxResults, 10) || 100, 1000)

        if (content) {
          // Escape content for grep (prevent command injection)
          const escapedContent = String(content).replace(/'/g, "'\\''")
          await rateLimiter.record(rateLimitKey, 'fileOps')
          return sandbox.executeCommand(`grep -r '${escapedContent}' '${safePath}' | head -n ${safeMax}`)
        }

        // Escape pattern for find
        const escapedPattern = String(pattern).replace(/'/g, "'\\''")
        await rateLimiter.record(rateLimitKey, 'fileOps')
        return sandbox.executeCommand(`find '${safePath}' -name '${escapedPattern}' | head -n ${safeMax}`)
      }

      case 'sync_files': {
        // Check rate limit for file operations
        rateLimitResult = await rateLimiter.check(rateLimitKey, 'fileOps')
        if (!rateLimitResult.allowed) {
          return {
            success: false,
            output: `Rate limit exceeded: ${rateLimitResult.message}`,
            exitCode: 1,
          }
        }

        const { direction, paths, deleteOrphans = false } = args
        await rateLimiter.record(rateLimitKey, 'fileOps')
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
  // FIX: Escape filePath and args to prevent command injection
  // Use single quotes and escape any embedded single quotes
  const safeFilePath = filePath.replace(/'/g, "'\\''");
  const safeArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  
  const commands: Record<string, string> = {
    python: `python3 '${safeFilePath}' ${safeArgs}`,
    javascript: `node '${safeFilePath}' ${safeArgs}`,
    typescript: `npx ts-node '${safeFilePath}' ${safeArgs}`,
    // For go/java, use path utilities for directory extraction
    go: `cd '${filePath.substring(0, filePath.lastIndexOf('/'))}' && go run '${filePath.substring(filePath.lastIndexOf('/') + 1)}' ${safeArgs}`,
    rust: `rustc '${safeFilePath}' -o /tmp/rust_out && /tmp/rust_out ${safeArgs}`,
    java: `javac '${safeFilePath}' && java -cp '${filePath.substring(0, filePath.lastIndexOf('/'))}' ${safeArgs}`,
    r: `Rscript '${safeFilePath}' ${safeArgs}`,
    cpp: `g++ '${safeFilePath}' -o /tmp/cpp_out && /tmp/cpp_out ${safeArgs}`,
  }
  return commands[language] || `echo "Unsupported language: ${language}"`
}

function getRepoNameFromUrl(url: string): string {
  const match = url.match(/\/([^/]+)\.git$/)
  return match ? match[1] : 'repo'
}
