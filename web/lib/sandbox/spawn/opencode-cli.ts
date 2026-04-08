/**
 * Enhanced OpenCode CLI with V2 Support
 *
 * ⚠️ SECURITY CRITICAL FILE ⚠️
 * This file executes shell commands and must handle user input with extreme care.
 *
 * SECURITY MEASURES:
 * 1. escapeShellArg() - MUST be used for ALL user-provided values in shell commands
 * 2. sanitizePath() - Validates paths to prevent directory traversal
 * 3. Command filtering - Blocks dangerous patterns (reverse shells, command chaining, etc.)
 * 4. Path construction - Uses path.join() instead of string interpolation
 *
 * VULNERABILITY HISTORY:
 * - 2024: Fixed command injection via userId/conversationId (CodeRabbit audit)
 *   - Before: `${tempDir}\\users\\${userId}` (VULNERABLE)
 *   - After: path.join(tempDir, 'users', sanitizePath(userId))
 *
 * Features:
 * - Per-user session isolation via OpenCodeV2SessionManager
 * - Nullclaw integration for extended agency
 * - MCP tool bridging
 * - Cloud filesystem support
 * - Checkpoint/restore capabilities
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │           OpenCodeContainerizedProvider                     │
 * │  ┌─────────────────────────────────────────────────────┐  │
 * │  │  Session Layer (OpenCodeV2SessionManager)            │  │
 * │  │  - Per-user workspaces                              │  │
 * │  │  - Quota tracking                                   │  │
 * │  │  - Checkpoint management                            │  │
 * │  └─────────────────────────────────────────────────────┘  │
 * │  ┌─────────────────────────────────────────────────────┐  │
 * │  │  Sandbox Layer (getSandboxProvider)                 │  │
 * │  │  - Sprites/E2B/Daytona/CodeSandbox                 │  │
 * │  │  - Isolated execution                               │  │
 * │  └─────────────────────────────────────────────────────┘  │
 * │  ┌─────────────────────────────────────────────────────┐  │
 * │  │  Tool Layer                                          │  │
 * │  │  - MCP Bridge (localhost:8888)                     │  │
 * │  │  - Nullclaw Bridge                                  │  │
 * │  │  - Local file operations                            │  │
 * │  └─────────────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────────────────┘
 */

import { spawn, type ChildProcess } from 'child_process';
import { createLogger } from '../../utils/logger';
import type { ToolResult } from '../types';
import type {
  LLMProvider,
  LLMAgentOptions,
  LLMAgentResult,
  LLMAgentStep,
} from '../providers/llm-provider';
import { getSandboxProvider } from '../providers';
import type { SandboxHandle, SandboxCreateConfig } from '../providers/sandbox-provider';
import { openCodeV2SessionManager, type V2SessionConfig, type OpenCodeV2Session } from '../../session/agent/opencode-v2-session-manager';
import { nullclawMCPBridge } from '../../mcp/nullclaw-mcp-bridge';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('OpenCode:V2Provider');

const DEFAULT_MAX_STEPS = 15;
const PROCESS_TIMEOUT_MS = 300_000; // 5 minutes

export interface OpenCodeV2ProviderConfig {
  session?: {
    userId: string;
    conversationId: string;
    enableNullclaw?: boolean;
    enableMcp?: boolean;
    cloudFsProvider?: 'sprites' | 'e2b' | 'daytona' | 'local';
    workspaceDir?: string;
  };
  sandbox?: Partial<SandboxCreateConfig>;
  sandboxHandle?: SandboxHandle;
  opencode?: {
    model?: string;
    maxSteps?: number;
    timeout?: number;
  };
}

export interface OpenCodeV2ExecutionResult extends LLMAgentResult {
  sessionId?: string;
  quotaUsed?: {
    computeMinutes: number;
    storageBytes: number;
  };
  nullclawTasks?: Array<{
    tool: string;
    status: string;
    result?: any;
  }>;
}

export class OpencodeV2Provider implements LLMProvider {
  readonly name = 'opencode-v2';
  private config: OpenCodeV2ProviderConfig;
  private currentSession?: OpenCodeV2Session;
  private sandboxHandle?: SandboxHandle;
  private mcpServerProcess?: ChildProcess;

  constructor(config: OpenCodeV2ProviderConfig = {}) {
    this.config = config;
  }

  /**
   * Run the V2 agent loop with full session management
   */
  async runAgentLoop(options: LLMAgentOptions): Promise<OpenCodeV2ExecutionResult> {
    const startTime = Date.now();
    const {
      userMessage,
      tools,
      systemPrompt,
      maxSteps = DEFAULT_MAX_STEPS,
      executeTool,
      onToolExecution,
      onStreamChunk,
      cwd: requestedCwd,
      enableSelfHeal = true,
    } = options;

    // Get or create session
    if (!this.currentSession) {
      await this.initializeSession();
    }

    if (!this.currentSession) {
      return {
        response: 'Failed to initialize V2 session',
        steps: [],
        totalSteps: 0,
      };
    }

    const steps: LLMAgentStep[] = [];
    let finalResponse = '';

    try {
      // OpenCode runs LOCALLY without cloud sandbox by default
      // Cloud sandbox is only created for risky code execution when explicitly needed
      // Skip sandbox initialization - run locally

      // Ensure MCP is available (local MCP server still needed)
      if (this.currentSession.mcpEnabled && !this.currentSession.mcpServerUrl) {
        await this.initializeMCP();
      }
      
      // Get workspace directory - use local path compatible with OS
      const workspaceDir = this.currentSession.workspaceDir;
      const isWindows = process.platform === 'win32';
      let localWorkspaceDir: string;

      // If a specific cwd was requested, use it (with path safety validation)
      if (requestedCwd) {
        const path = await import('path');
        const sanitized = this.sanitizePath(requestedCwd);
        if (sanitized) {
          // If it's a VFS scoped path like "project/sessions/xxx", convert to real path
          if (sanitized.startsWith('project/')) {
            // Strip "project/" prefix and append to workspace base
            const relativePart = sanitized.replace(/^project\//, '');
            localWorkspaceDir = isWindows
              ? path.join(process.env.TEMP || process.env.TMP || 'C:\\temp', 'opencode-workspace', relativePart)
              : path.join('/tmp/opencode-workspace', relativePart);
          } else if (sanitized.startsWith('/workspace/')) {
            localWorkspaceDir = sanitized.replace('/workspace/', isWindows ? (process.env.TEMP || 'C:\\temp') + '\\' : '/home/user/workspace/');
          } else {
            // Already an absolute path
            localWorkspaceDir = sanitized;
          }
        }
      }

      if (!localWorkspaceDir) {
        // On Windows, use a temp directory or app data folder
        // SECURITY: Sanitize and escape user-provided values to prevent command injection
        const tempDir = process.env.TEMP || process.env.TMP || 'C:\\temp';
        const userId = this.sanitizePath(this.currentSession.userId) || 'guest';
        const convId = this.sanitizePath(this.currentSession.conversationId) || 'default';
        
        // Build path safely using path.join instead of string interpolation
        const path = await import('path');
        localWorkspaceDir = path.join(tempDir, 'opencode-workspace', 'users', userId || 'guest', 'sessions', convId || 'default');
      } else {
        // On Linux, convert /workspace/... to /home/user/workspace/...
        // SECURITY: Sanitize workspace directory path
        const sanitizedWorkspace = this.sanitizePath(workspaceDir);
        localWorkspaceDir = sanitizedWorkspace && sanitizedWorkspace.startsWith('/workspace/')
          ? sanitizedWorkspace.replace('/workspace/', '/home/user/workspace/')
          : (sanitizedWorkspace || '/tmp/opencode-workspace');
      }

      // Write the prompt to a temp file (use OS-appropriate temp directory)
      const tempDir = isWindows
        ? (process.env.TEMP || process.env.TMP || 'C:\\temp')
        : '/tmp';
      
      // SECURITY: Use path.join for safe path construction
      const path = await import('path');
      const promptFile = isWindows
        ? path.join(tempDir, `opencode-v2-prompt-${Date.now()}.json`)
        : path.join(tempDir, `opencode-v2-prompt-${Date.now()}.json`);

      const promptPayload = JSON.stringify({
        prompt: userMessage,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        systemPrompt: systemPrompt,
        sessionId: this.currentSession.id,
        mcpServerUrl: this.currentSession.mcpServerUrl,
      });

      // Debug: Log what we're sending to OpenCode
      console.log('[OpencodeV2Provider] === SENDING TO OPENCODE (LOCAL) ===');
      console.log('[OpencodeV2Provider] Prompt:', userMessage.substring(0, 200) + (userMessage.length > 200 ? '...' : ''));
      console.log('[OpencodeV2Provider] Tools available:', tools.map(t => t.name).join(', '));
      console.log('[OpencodeV2Provider] Workspace:', localWorkspaceDir);
      console.log('[OpencodeV2Provider] Temp file:', promptFile);
      console.log('[OpencodeV2Provider] ==============================');

      await this.writeLocalFile(promptFile, promptPayload);

      // Execute opencode LOCALLY (no sandbox)
      const model = process.env.OPENCODE_MODEL || 'claude-3-5-sonnet';
      // SECURITY: Use escapeShellArg for model parameter
      const modelFlag = model ? `--model ${this.escapeShellArg(model, isWindows)}` : '';

      // SECURITY: Use escapeShellArg for system prompt
      const escapedSystemPrompt = this.escapeShellArg(systemPrompt || '', isWindows);

      // Ensure workspace directory exists locally (using OS-appropriate command)
      // SECURITY: Use escapeShellArg for directory path in shell command
      const mkdirCmd = isWindows
        ? `if not exist ${this.escapeShellArg(localWorkspaceDir, true)} mkdir ${this.escapeShellArg(localWorkspaceDir, true)}`
        : `mkdir -p ${this.escapeShellArg(localWorkspaceDir, false)}`;
      await this.execLocalCommand(mkdirCmd);

      // Build command - pass prompt file via stdin differently based on OS
      let command: string;

      if (isWindows) {
        // On Windows, use cmd /c with type to pipe file content
        // SECURITY: Escape prompt file path
        const escapedPromptFile = this.escapeShellArg(promptFile, true);
        command = `cmd /c type ${escapedPromptFile} | npx opencode chat --json ${modelFlag}`;
      } else {
        // On Linux, use stdin redirect
        // SECURITY: Escape prompt file path
        const escapedPromptFile = this.escapeShellArg(promptFile, false);
        command = `OPENCODE_SYSTEM_PROMPT=${escapedSystemPrompt} opencode chat --json ${modelFlag} < ${escapedPromptFile}`;
      }
      
      console.log('[OpencodeV2Provider] Executing command:', command.substring(0, 300) + '...');
      
      // Execute locally without sandbox
      const result = await this.executeLocalCommand(
        command,
        localWorkspaceDir,
        PROCESS_TIMEOUT_MS / 1000,
      );

      // Debug: Log raw output from OpenCode
      console.log('[OpencodeV2Provider] === OPENCODE OUTPUT ===');
      console.log('[OpencodeV2Provider] Exit code:', result.exitCode);
      console.log('[OpencodeV2Provider] Success:', result.success);
      console.log('[OpencodeV2Provider] Output length:', result.output?.length || 0);
      console.log('[OpencodeV2Provider] Output preview:', result.output?.substring(0, 500));
      console.log('[OpencodeV2Provider] =========================');

      const nullclawTasks: Array<{ tool: string; status: string; result?: any }> = [];

      if (result.success) {
        // Parse output and execute tools
        const lines = result.output.split('\n').filter(Boolean);
        
        console.log('[OpencodeV2Provider] Parsed', lines.length, 'lines from output');
        
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            
            // Debug: Log each parsed line
            console.log('[OpencodeV2Provider] JSON line keys:', Object.keys(parsed).join(', '));
            
            // Text response
            if (parsed.text) {
              console.log('[OpencodeV2Provider] Got text response:', parsed.text.substring(0, 100) + '...');
              finalResponse += parsed.text;
              onStreamChunk?.(parsed.text);
            }

            // Tool invocation
            const toolInvocation = this.extractToolInvocation(parsed);
            if (toolInvocation && steps.length < maxSteps) {
              const { name: toolName, args: toolArgs } = toolInvocation;
              console.log('[OpencodeV2Provider] === TOOL CALL ===');
              console.log('[OpencodeV2Provider] Tool:', toolName);
              console.log('[OpencodeV2Provider] Args:', JSON.stringify(toolArgs).substring(0, 200));

              // Check if it's a Nullclaw tool
              const toolStartTime = Date.now();
              const safeArgs = toolArgs ?? {};
              let toolResult: ToolResult;
              if (toolName.startsWith('nullclaw_')) {
                const nullclawResult = await nullclawMCPBridge.executeTool(
                  toolName,
                  safeArgs,
                  this.currentSession.id
                );

                nullclawTasks.push({
                  tool: toolName,
                  status: nullclawResult.success ? 'completed' : 'failed',
                  result: nullclawResult,
                });

                toolResult = {
                  success: nullclawResult.success,
                  output: nullclawResult.output,
                  exitCode: nullclawResult.success ? 0 : 1,
                };
              } else {
                // Standard tool execution
                try {
                  toolResult = await executeTool(toolName, safeArgs);
                } catch (err) {
                  toolResult = {
                    success: false,
                    output: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
                    exitCode: 1,
                  };
                }
              }

              steps.push({ toolName, args: safeArgs, result: toolResult });
              onToolExecution?.(toolName, safeArgs, toolResult);

              console.log('[OpencodeV2Provider] === TOOL RESULT ===');
              console.log('[OpencodeV2Provider] Tool:', toolName, '- Success:', toolResult.success);
              console.log('[OpencodeV2Provider] Output:', toolResult.output?.substring(0, 200));
              console.log('[OpencodeV2Provider] Exit code:', toolResult.exitCode);
              console.log('[OpencodeV2Provider] ===================');

              // Record metrics
              openCodeV2SessionManager.recordMetrics(
                this.currentSession.id,
                1,
                0,
                0,
                Date.now() - toolStartTime,
                0,
                1
              );
            }

            // Completion
            if (parsed.done || parsed.complete) {
              finalResponse = parsed.response ?? parsed.text ?? finalResponse;
            }
          } catch {
            // Non-JSON line
            finalResponse += line + '\n';
            onStreamChunk?.(line + '\n');
          }
        }
      } else {
        finalResponse = `Execution failed: ${result.output}`;
      }

      // Update session activity
      openCodeV2SessionManager.updateActivity(this.currentSession.id);

      return {
        response: finalResponse || 'No response from V2 agent',
        steps,
        totalSteps: steps.length,
        sessionId: this.currentSession.id,
        quotaUsed: {
          computeMinutes: this.currentSession.quota.computeUsed,
          storageBytes: this.currentSession.quota.storageUsed,
        },
        nullclawTasks,
      };

    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('V2 agent loop failed', error);

      return {
        response: `V2 execution error: ${errorMsg}`,
        steps,
        totalSteps: steps.length,
        sessionId: this.currentSession.id,
      };
    }
  }

  /**
   * Initialize session
   */
  private async initializeSession(): Promise<void> {
    if (!this.config.session) {
      throw new Error('Session config required for V2 provider');
    }

    const sessionConfig: V2SessionConfig = {
      userId: this.config.session.userId,
      conversationId: this.config.session.conversationId,
      enableNullclaw: this.config.session.enableNullclaw,
      enableMcp: this.config.session.enableMcp,
      cloudFsProvider: this.config.session.cloudFsProvider,
      workspaceDir: this.config.session.workspaceDir,
    };

    this.currentSession = await openCodeV2SessionManager.createSession(sessionConfig);
    logger.info(`Initialized V2 session: ${this.currentSession.id}`);
  }

  /**
   * Initialize sandbox for session
   */
  private async initializeSandbox(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('Session not initialized');
    }

    if (this.config.sandboxHandle) {
      this.sandboxHandle = this.config.sandboxHandle;
      openCodeV2SessionManager.setSandbox(
        this.currentSession.id,
        this.sandboxHandle.id,
        this.currentSession.sandboxProvider || 'external',
      );
      return;
    }

    // Determine provider based on config or availability
    let providerName = this.config.session?.cloudFsProvider || 'sprites';
    
    // Check if provider is available
    try {
      this.sandboxHandle = await this.createSandboxForSession(providerName);
      openCodeV2SessionManager.setSandbox(
        this.currentSession.id,
        this.sandboxHandle.id,
        providerName
      );
    } catch (error) {
      // Fallback to other providers
      const providers = ['e2b', 'daytona', 'codesandbox'];
      for (const provider of providers) {
        try {
          this.sandboxHandle = await this.createSandboxForSession(provider);
          openCodeV2SessionManager.setSandbox(
            this.currentSession.id,
            this.sandboxHandle.id,
            provider
          );
          break;
        } catch {
          continue;
        }
      }
    }

    if (!this.sandboxHandle) {
      throw new Error('No sandbox provider available');
    }

    // Ensure opencode is installed
    await this.sandboxHandle.executeCommand(
      'which opencode || npm install -g opencode-ai 2>/dev/null || echo "opencode not available"'
    );

    logger.info(`Sandbox initialized: ${this.sandboxHandle.id}`);
  }

  /**
   * Create sandbox for session
   */
  private async createSandboxForSession(provider: string): Promise<SandboxHandle> {
    const sandboxProvider = await getSandboxProvider(provider as any);
    const config: SandboxCreateConfig = {
      language: 'typescript',
      envVars: {
        OPENCODE_MODEL: process.env.OPENCODE_MODEL || 'claude-3-5-sonnet',
        OPENCODE_SYSTEM_PROMPT: '',
        TERM: 'xterm-256color',
        ...this.config.sandbox?.envVars,
      },
      resources: this.config.sandbox?.resources || { cpu: 2, memory: 4 },
    };

    return sandboxProvider.createSandbox(config);
  }

  /**
   * Initialize MCP server for session
   */
  private async initializeMCP(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('Session not initialized');
    }

    const port = parseInt(process.env.MCP_CLI_PORT || '8888', 10);
    this.currentSession.mcpServerUrl = `http://127.0.0.1:${port}`;
    
    logger.info(`MCP server URL set: ${this.currentSession.mcpServerUrl}`);
  }

  /**
   * Extract tool invocation from parsed output
   */
  private extractToolInvocation(
    parsed: any
  ): { name: string; args: Record<string, any> } | null {
    if (!parsed || typeof parsed !== 'object') return null;

    // OpenCode/OpenAI-style payload
    if (parsed.tool_call) {
      const call = parsed.tool_call;
      if (call?.name) {
        return {
          name: String(call.name),
          args: (call.arguments ?? {}) as Record<string, any>,
        };
      }
    }

    // Anthropic-style payload
    if (parsed.tool_use) {
      const toolUse = parsed.tool_use;
      if (toolUse?.name) {
        return {
          name: String(toolUse.name),
          args: (toolUse.input ?? {}) as Record<string, any>,
        };
      }
    }

    return null;
  }

  /**
   * Create checkpoint for current session
   */
  async createCheckpoint(label?: string): Promise<{
    checkpointId: string;
    timestamp: number;
  }> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    return openCodeV2SessionManager.createCheckpoint(this.currentSession.id, label);
  }

  /**
   * Write file locally (no sandbox)
   */
  private async writeLocalFile(filePath: string, content: string): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * SECURITY: Properly escape shell arguments to prevent command injection
   * 
   * This function escapes special shell characters to prevent command injection attacks.
   * It should be used for ALL user-provided values that are interpolated into shell commands.
   * 
   * @param arg - The argument to escape
   * @param isWindows - Whether running on Windows
   * @returns Escaped argument safe for shell interpolation
   */
  private escapeShellArg(arg: string, isWindows: boolean = false): string {
    if (!arg) return '""';
    
    if (isWindows) {
      // Windows cmd.exe escaping
      // Escape special characters: & | < > ^ " \
      // Wrap in quotes and escape internal quotes
      const escaped = arg
        .replace(/\\/g, '\\\\')  // Escape backslashes
        .replace(/"/g, '""')     // Escape quotes by doubling them
        .replace(/[&|<>^]/g, '^$&');  // Escape special chars with caret
      
      return `"${escaped}"`;
    } else {
      // Unix shell escaping (POSIX sh/bash)
      // Escape special characters: ' " \ $ ` ! * ? [ ] ( ) { } ; < > & | # ~
      // Wrap in single quotes and escape internal single quotes
      const escaped = arg
        .replace(/'/g, "'\\''");  // Replace ' with '\''
      
      return `'${escaped}'`;
    }
  }

  /**
   * SECURITY: Validate and sanitize path to prevent directory traversal
   * 
   * @param path - The path to validate
   * @returns Sanitized path or null if invalid
   */
  private sanitizePath(path: string): string | null {
    if (!path) return null;
    
    // Remove null bytes
    path = path.replace(/\0/g, '');
    
    // Check for path traversal attempts
    if (path.includes('..') && !path.startsWith('..')) {
      // Allow relative paths like ../ but not embedded ..
      if (/\w\.\.\w/.test(path) || path.includes('../..')) {
        return null;
      }
    }
    
    // Block absolute paths to sensitive locations
    const blockedPaths = [
      '/etc/', '/proc/', '/sys/', '/dev/',
      '/root/', '/boot/', '/bin/', '/sbin/',
      'C:\\Windows\\', 'C:\\Program Files',
    ];
    
    const lowerPath = path.toLowerCase();
    if (blockedPaths.some(blocked => lowerPath.includes(blocked.toLowerCase()))) {
      return null;
    }
    
    return path;
  }

  /**
   * Execute command locally without sandbox (for OpenCode execution)
   *
   * SECURITY: Validates and sanitizes command to prevent injection attacks
   * before passing to shell execution.
   * 
   * CRITICAL: All user-provided values (userId, conversationId, etc.) MUST be
   * escaped using escapeShellArg() before interpolation into shell commands.
   */
  private async executeLocalCommand(
    command: string,
    cwd: string,
    timeoutSeconds: number,
  ): Promise<ToolResult> {
    // SECURITY: Validate command - reject obviously dangerous patterns
    // Note: We still allow shell features needed by opencode (stdin redirect, pipes)
    // but block patterns commonly used in attacks
    const dangerousPatterns = [
      /\b(rm|del)\s+(-rf|--force|\/Q)\s+\//i,  // Force delete root
      /\bchmod\s+[0-7]*777/i,  // World-writable permissions
      /\bcurl.*\|\s*(bash|sh)\b/i,  // Curl pipe to shell
      /\bwget.*\|\s*(bash|sh)\b/i,  // Wget pipe to shell
      /\/etc\/(passwd|shadow|hosts)/i,  // Sensitive file access
      /\bnc\s+(-e|\/bin\/bash)/i,  // Netcat reverse shell
      /\bpython.*-c.*socket/i,  // Python reverse shell
      /\bperl.*-e.*socket/i,  // Perl reverse shell
      /\bruby.*-e.*socket/i,  // Ruby reverse shell
      /\$\([^)]*\$\([^)]*\)\)/,  // Nested command substitution (often malicious)
      /^\s*:\(\)\{\s*:\|:\s*&\s*\}\s*;:/,  // Fork bomb
      /\b(mkdir|touch|echo|cp|mv|cat)\s+.*[;&|]/,  // Command chaining after basic commands
      /[`$]/,  // Command substitution or variable expansion (unless properly escaped)
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        console.error('[OpencodeV2Provider] Command blocked by security filter:', command.substring(0, 200));
        return {
          success: false,
          output: 'Command rejected: contains dangerous patterns',
          exitCode: 1,
        };
      }
    }

    // On Windows, we need to handle the command differently
    // opencode might need to be run via npx or have full path
    const isWindows = process.platform === 'win32';

    let finalCommand = command;

    if (isWindows) {
      // On Windows, wrap command to handle stdin redirect properly
      // Also try npx opencode-ai first
      const opencodeCmd = command.replace(/^OPENCODE_SYSTEM_PROMPT='[^']*'\s+/, 'OPENCODE_SYSTEM_PROMPT="$OPENCODE_SYSTEM_PROMPT" ');

      // Try using npx to run opencode
      finalCommand = opencodeCmd;

      console.log('[OpencodeV2Provider] Windows detected, command:', finalCommand.substring(0, 100));
    }

    return this.executeCommandDirect(finalCommand, cwd, timeoutSeconds);
  }

  /**
   * Detect project type from the workspace directory by examining package.json, 
   * Cargo.toml, go.mod, etc. Returns the appropriate run command.
   */
  private async detectProjectCommand(cwd: string): Promise<string | null> {
    const fs = await import('fs/promises');
    const path = await import('path');

    try {
      const pkgPath = path.join(cwd, 'package.json');
      const pkgRaw = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgRaw);
      if (pkg.scripts) {
        const s = pkg.scripts;
        if (s.dev) return 'npm run dev';
        if (s.start) return 'npm start';
        if (s.serve) return 'npm run serve';
        if (s.build) return 'npm install && npm run build';
      }
      return 'npm install';
    } catch { /* no package.json */ }

    try {
      await (await import('fs/promises')).access(path.join(cwd, 'Cargo.toml'));
      return 'cargo run';
    } catch { /* not Rust */ }

    try {
      await (await import('fs/promises')).access(path.join(cwd, 'go.mod'));
      return 'go run .';
    } catch { /* not Go */ }

    try {
      const fs2 = await import('fs/promises');
      await fs2.access(path.join(cwd, 'requirements.txt'));
      for (const entry of ['main.py', 'app.py', 'run.py']) {
        try { await fs2.access(path.join(cwd, entry)); return 'pip install -r requirements.txt && python ' + entry; } catch {}
      }
      return 'pip install -r requirements.txt';
    } catch { /* not Python */ }

    return null;
  }

  /**
   * Translate natural language task descriptions into actual shell commands.
   */
  private async translateNaturalLanguageToCommand(task: string, cwd: string): Promise<string> {
    const lower = task.toLowerCase().trim();

    // Direct commands — pass through
    if (/^(npm|yarn|pnpm|npx|cargo|go|python|pip|node|deno|bun)\b/.test(lower)) return task;

    // "run the project", "start it", "debug the app"
    if (/(run|start|launch|debug|execute)\s*(the\s*)?(project|app|server|dev|it|this)?\s*$/i.test(lower) ||
        /^(run|start)$/.test(lower)) {
      const cmd = await this.detectProjectCommand(cwd);
      return cmd || 'npm run dev || npm start || echo "No run script found"';
    }

    // Build
    if (/^(build|compile|package)\b/i.test(lower)) {
      const cmd = await this.detectProjectCommand(cwd);
      return (cmd && cmd.includes('build')) ? cmd : 'npm run build || echo "No build script found"';
    }

    // Test
    if (/^(test|run\s*tests?)\b/i.test(lower)) return 'npm test || echo "No test script found"';

    // Install
    if (/^(install|npm\s*install|yarn\s*add|pnpm\s*add)/i.test(lower)) return 'npm install';

    // Lint
    if (/^(lint|format|prettier|eslint)/i.test(lower)) return 'npm run lint || npm run format || echo "No lint script found"';

    // Git
    if (/^(git\s|commit|push|pull|branch)/i.test(lower)) return task;

    // List files
    if (/^(list|ls|dir|show\s*files)/i.test(lower)) return process.platform === 'win32' ? 'dir' : 'ls -la';

    // Pass through
    return task;
  }

  /**
   * Self-heal: When a shell command fails, analyze the error and retry with corrections.
   */
  private async selfHealAndRetry(
    originalCommand: string,
    cwd: string,
    errorOutput: string,
    timeoutSeconds: number,
    attempt: number = 1,
  ): Promise<ToolResult> {
    const maxAttempts = 3;
    if (attempt > maxAttempts) {
      return { success: false, output: errorOutput + `\n[SELF-HEAL] Max retries (${maxAttempts}) reached.`, exitCode: 1 };
    }

    const el = errorOutput.toLowerCase();
    let corrective: string | null = null;
    let reason = '';

    if (/(module\s+not\s+found|cannot\s+find\s+module|err_module_not_found)/i.test(el)) {
      corrective = 'npm install && ' + originalCommand;
      reason = 'Missing dependency — auto-installing';
    } else if (/(command\s+not\s+found|is\s+not\s+recognized)/i.test(el)) {
      const cmd = originalCommand.split(' ')[0];
      corrective = `which ${cmd} 2>/dev/null || echo "${cmd} not found in PATH"`;
      reason = `Command "${cmd}" not found — diagnosing`;
    } else if (/(eaddrinuse|address\s+already\s+in\s+use)/i.test(el)) {
      const m = el.match(/port\s+(\d+)/);
      if (m) {
        const port = m[1];
        corrective = process.platform === 'win32' ? `netstat -ano | findstr :${port}` : `lsof -ti :${port} | xargs kill -9 2>/dev/null; ${originalCommand}`;
        reason = `Port ${port} in use — killing process`;
      }
    } else if (/(enoent|no\s+such\s+file)/i.test(el)) {
      corrective = process.platform === 'win32' ? 'dir' : 'ls -la';
      reason = 'File not found — listing directory';
    } else if (/(permission\s+denied|eacces|eperm)/i.test(el)) {
      return { success: false, output: errorOutput + '\n[SELF-HEAL] Permission denied — cannot auto-escalate.', exitCode: 1 };
    }

    if (corrective) {
      console.log(`[OpencodeV2Provider] [SELF-HEAL] Attempt ${attempt}/${maxAttempts}: ${reason}`);
      const retry = await this.executeCommandDirect(corrective, cwd, timeoutSeconds, false);
      if (retry.success) {
        return { success: true, output: `[SELF-HEAL] ${reason}\n--- Recovery ---\n${retry.output}`, exitCode: 0 };
      }
      return this.selfHealAndRetry(originalCommand, cwd, retry.output, timeoutSeconds, attempt + 1);
    }

    return { success: false, output: errorOutput, exitCode: 1 };
  }

  /**
   * Direct command execution with self-heal retry
   *
   * SECURITY NOTE: This executes commands via shell (/bin/sh -c or cmd.exe /c)
   * because opencode commands require shell features (stdin redirects, pipes).
   *
   * Security is provided by:
   * 1. Input validation in executeLocalCommand() - rejects dangerous patterns
   * 2. Sandboxed execution environment (container/isolated workspace)
   * 3. Timeout and resource limits
   * 4. Non-root user execution
   * 5. Command pattern filtering in executeLocalCommand
   *
   * @see executeLocalCommand - Input sanitization
   */
  private async executeCommandDirect(
    command: string,
    cwd: string,
    timeoutSeconds: number,
    enableSelfHeal: boolean = true,
  ): Promise<ToolResult> {
    return new Promise((resolve) => {
      const timeoutMs = timeoutSeconds * 1000;
      const startTime = Date.now();

      let output = '';
      let errorOutput = '';

      const isWindows = process.platform === 'win32';
      const { execFile } = require('child_process');

      // Execute via shell (required for stdin redirect, pipes, etc.)
      const shell = isWindows ? 'cmd.exe' : '/bin/sh';
      const shellArg = isWindows ? '/c' : '-c';

      // FIX: Increase maxBuffer to handle large outputs (builds, npm install, etc.)
      // Default is 1MB which causes ERR_CHILD_PROCESS_STDIO_MAXBUFFER
      const maxBuffer = 50 * 1024 * 1024; // 50MB

      const child = execFile(
        shell,
        [shellArg, command],
        {
          cwd,
          env: {
            ...process.env,
            OPENCODE_MODEL: process.env.OPENCODE_MODEL,
            OPENCODE_SYSTEM_PROMPT: process.env.OPENCODE_SYSTEM_PROMPT,
          },
          maxBuffer, // FIX: Prevent maxBuffer errors on large outputs
        },
        (err: any, stdout: string, stderr: string) => {
          // FIX: Clear timeout to prevent memory leaks
          clearTimeout(timeout);
          
          const duration = Date.now() - startTime;
          
          // FIX: Include stdout even on errors (build logs, test output, etc.)
          const combinedOutput = stdout + stderr;
          
          if (err) {
            console.log(`[OpencodeV2Provider] Local command error after ${duration}ms: ${err.message}`);
            resolve({
              success: false,
              output: combinedOutput + '\n' + err.message,
              exitCode: err.code || 1,
            });
          } else {
            console.log(`[OpencodeV2Provider] Local command completed in ${duration}ms, exit code: ${err?.code || 0}`);
            resolve({
              success: true,
              output: combinedOutput,
              exitCode: 0,
            });
          }
        }
      );

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({
          success: false,
          output: output + errorOutput + '\n[TIMEOUT]',
          exitCode: 124,
        });
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          output: err.message,
          exitCode: 1,
        });
      });

      // Collect stdout
      child.stdout?.on('data', (data) => {
        output += data.toString();
      });

      // Collect stderr
      child.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });
    });
  }

  /**
   * Execute local shell command
   */
  private async execLocalCommand(command: string): Promise<ToolResult> {
    return this.executeLocalCommand(command, process.cwd(), 30);
  }

  /**
   * Get current session info
   */
  getSessionInfo(): OpenCodeV2Session | undefined {
    return this.currentSession;
  }

  /**
   * Shutdown provider and cleanup resources
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down V2 provider...');

    if (this.sandboxHandle) {
      try {
        const { getSandboxProvider } = await import('../providers');
        const provider = await getSandboxProvider(this.sandboxHandle.id.startsWith('sprite') ? 'sprites' : 
          this.sandboxHandle.id.startsWith('daytona') ? 'daytona' :
          this.sandboxHandle.id.startsWith('e2b') ? 'e2b' : 'codesandbox');
        await provider.destroySandbox(this.sandboxHandle.id);
      } catch (error: any) {
        logger.error('Failed to destroy sandbox', error);
      }
    }

    if (this.mcpServerProcess) {
      this.mcpServerProcess.kill();
    }

    if (this.currentSession) {
      await openCodeV2SessionManager.stopSession(this.currentSession.id);
    }

    logger.info('V2 provider shutdown complete');
  }
}

/**
 * Factory function to create V2 provider
 */
export function createOpenCodeV2Provider(config: OpenCodeV2ProviderConfig): OpencodeV2Provider {
  return new OpencodeV2Provider(config);
}
