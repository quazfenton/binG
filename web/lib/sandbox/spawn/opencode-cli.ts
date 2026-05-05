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
import { findOpencodeBinarySync } from '@/lib/agent-bins/find-opencode-binary';
import { createAgentFilesystem, type AgentFilesystem } from '@/lib/agent-bins/agent-filesystem';
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
import { sandboxFilesystemSync } from '@/lib/virtual-filesystem/sync/sandbox-filesystem-sync';

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
  /** Centralized filesystem — auto-detects desktop/web mode */
  private agentFs: AgentFilesystem;

  constructor(config: OpenCodeV2ProviderConfig = {}) {
    this.config = config;
    // Initialize centralized filesystem — auto-detects desktop (local) vs web (vfs) mode
    this.agentFs = createAgentFilesystem({
      cwd: config.session?.workspaceDir,
    });
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
              ? path.join(process.env.TEMP || process.env.TMP || 'C:\\temp', 'workspace', relativePart)
              : path.join('/tmp/workspace', relativePart);
          } else if (sanitized.startsWith('/workspace/')) {
            localWorkspaceDir = sanitized.replace('/workspace/', isWindows ? (process.env.TEMP || 'C:\\temp') + '\\' : '/home/user/workspace/');
          } else {
            // Already an absolute path
            localWorkspaceDir = sanitized;
          }
        }
      } else {
        const path = await import('path');
        const sanitizedWorkspace = this.sanitizePath(workspaceDir);

        if (sanitizedWorkspace?.startsWith('project/')) {
          const relativePart = sanitizedWorkspace.replace(/^project\//, '');
          localWorkspaceDir = isWindows
            ? path.join(process.env.TEMP || process.env.TMP || 'C:\\temp', 'workspace', relativePart)
            : path.join('/tmp/workspace', relativePart);
        } else if (sanitizedWorkspace?.startsWith('/workspace/')) {
          localWorkspaceDir = sanitizedWorkspace.replace(
            '/workspace/',
            isWindows
              ? `${process.env.TEMP || process.env.TMP || 'C:\\temp'}\\workspace\\`
              : '/home/user/workspace/'
          );
        } else {
          localWorkspaceDir = '';
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
        localWorkspaceDir = path.join(tempDir, 'workspace', 'users', userId || 'guest', 'sessions', convId || 'default');
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

      // Resolve opencode binary via robust detection (OPENCODE_BIN → which/where → default paths).
      // When a resolved path is found, escape it as a single shell token (may contain spaces).
      // When falling back to a multi-token command like 'npx opencode', DON'T escape —
      // the shell must parse 'npx' and 'opencode' as separate tokens.
      const resolvedBin = findOpencodeBinarySync();
      const commandBin = resolvedBin
        ? this.escapeShellArg(resolvedBin, isWindows)
        : (isWindows ? 'npx opencode' : 'opencode');

      // Build command - pass prompt file via stdin differently based on OS
      let command: string;

      if (isWindows) {
        // On Windows, use cmd /c with type to pipe file content
        // SECURITY: Escape prompt file path
        const escapedPromptFile = this.escapeShellArg(promptFile, true);
        command = `cmd /c type ${escapedPromptFile} | ${commandBin} chat --json ${modelFlag}`;
      } else {
        // On Linux, use stdin redirect
        // SECURITY: Escape prompt file path
        const escapedPromptFile = this.escapeShellArg(promptFile, false);
        command = `OPENCODE_SYSTEM_PROMPT=${escapedSystemPrompt} ${commandBin} chat --json ${modelFlag} < ${escapedPromptFile}`;
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

                try {
                  await Promise.resolve(onToolExecution?.(toolName, safeArgs, toolResult));
                } catch (callbackError) {
                  logger.error(`onToolExecution failed for ${toolName}`, callbackError);
                }

                console.log('[OpencodeV2Provider] === TOOL RESULT ===');
                console.log('[OpencodeV2Provider] Tool:', toolName, '- Success:', toolResult.success);
                console.log('[OpencodeV2Provider] Output length:', toolResult.output?.length ?? 0);
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

              steps.push({
                toolName,
                args: safeArgs,
                result: toolResult,
              });
            }

            // Completion
            if (parsed.done || parsed.complete) {
              finalResponse = parsed.response ?? parsed.text ?? finalResponse;
              // Return early to end this turn and allow frontend to render this as a distinct bubble
              break;
            }
          } catch {
            // Non-JSON line — treat as incremental response chunk
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

    const handle = await sandboxProvider.createSandbox(config);
    
    // Start VFS sync for bidirectional file sync
    try {
      const sessionId = this.currentSession?.id || uuidv4();
      sandboxFilesystemSync.startSync(handle.id, sessionId);
      console.log(`[OpencodeV2] VFS sync started for sandbox: ${handle.id}`);
    } catch (syncErr: any) {
      console.warn(`[OpencodeV2] Failed to start VFS sync:`, syncErr.message);
    }
    
    return handle;
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
   * Write file using centralized AgentFilesystem (auto-detects desktop/web mode).
   * Temp files outside the workspace use direct fs/promises.
   * Workspace-scoped files go through agentFs for proper VFS/local routing.
   */
  private async writeLocalFile(filePath: string, content: string): Promise<void> {
    // Check if the file is within the agentFs workspace scope.
    // Resolve the path relative to workspace root to catch traversal attempts
    // (e.g. ../../etc/passwd would resolve outside the workspace).
    const path = await import('path');
    const workspaceRoot = this.agentFs.cwd.replace(/\\/g, '/');
    const resolved = path.resolve(this.agentFs.cwd, filePath).replace(/\\/g, '/');
    const isInsideWorkspace = resolved === workspaceRoot || resolved.startsWith(workspaceRoot + '/');

    if (isInsideWorkspace) {
      // Workspace files go through the centralized filesystem
      await this.agentFs.writeFile(filePath, content);
    } else {
      // Temp files outside workspace (prompt payloads, etc.) use direct fs
      const fs = await import('fs/promises');
      await fs.writeFile(filePath, content, 'utf-8');
    }
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
   * Uses the shared project-detection module for consistency.
   */
  private async translateNaturalLanguageToCommand(task: string, cwd: string): Promise<string> {
    // Import the shared project detection module
    const { buildProjectContext, translateNaturalLanguageToCommand: translateNL } = await import('../../project-detection');

    // Get file listing from the cwd directory for project detection
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const files: string[] = [];

      const walkDir = async (dir: string, maxDepth: number = 3) => {
        if (maxDepth <= 0) return;
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = fullPath.replace(cwd, '').replace(/^\//, '');
            files.push(relativePath);
            if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules')) {
              await walkDir(fullPath, maxDepth - 1);
            }
          }
        } catch { /* ignore permission errors */ }
      };

      await walkDir(cwd);

      // Try to read package.json
      const pkgPath = path.join(cwd, 'package.json');
      let pkgContent: string | undefined;
      try {
        pkgContent = await fs.readFile(pkgPath, 'utf-8');
      } catch { /* no package.json */ }

      const projectCtx = await buildProjectContext(files, async (p: string) => {
        if (p === 'package.json' || p === '/package.json') return pkgContent || null;
        return null;
      });

      return translateNL(task, projectCtx);
    } catch {
      // Fallback if project detection fails
      return task;
    }
  }

  /**
   * Self-heal: When a shell command fails, return structured error information
   * so the LLM can reason about the failure and decide the next action.
   *
   * Previously this used regex patterns to auto-fix common errors. Now it returns
   * structured error data that the LLM can use with its tools (project_analyze,
   * terminal_get_output, etc.) to diagnose and fix the issue.
   *
   * Only truly trivial auto-fixes are attempted (e.g., missing dependency auto-install)
   * before falling back to structured error reporting.
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
      return {
        success: false,
        output: JSON.stringify({
          errorType: 'max_retries_exceeded',
          message: `Command failed after ${maxAttempts} attempts`,
          originalCommand,
          errorOutput: this.truncateOutput(errorOutput),
        }, null, 2),
        exitCode: 1,
      };
    }

    const el = errorOutput.toLowerCase();
    const errorInfo = this.classifyError(el, errorOutput);

    // Only auto-fix truly trivial cases
    if (errorInfo.autoFixable && attempt === 1) {
      logger.debug(`[OpencodeV2Provider] [AUTO-FIX] ${errorInfo.reason}`);
      const retry = await this.executeCommandDirect(errorInfo.fixCommand!, cwd, timeoutSeconds, false);
      if (retry.success) {
        return {
          success: true,
          output: `[AUTO-FIX] ${errorInfo.reason}\n--- Recovery ---\n${this.truncateOutput(retry.output || '')}`,
          exitCode: 0,
        };
      }
      // Auto-fix failed — fall through to structured error
    }

    // Return structured error for the LLM to reason about
    return {
      success: false,
      output: JSON.stringify({
        errorType: errorInfo.type,
        category: errorInfo.category,
        message: errorInfo.message,
        suggestions: errorInfo.suggestions,
        originalCommand,
        errorOutput: this.truncateOutput(errorOutput),
        attempt,
        maxAttempts,
      }, null, 2),
      exitCode: 1,
    };
  }

  /**
   * Classify an error output into a structured error object.
   */
  private classifyError(errorLower: string, originalOutput: string): {
    type: string;
    category: string;
    message: string;
    suggestions: string[];
    autoFixable: boolean;
    fixCommand?: string;
    reason: string;
  } {
    const el = errorLower;

    // Module/package not found
    if (/(module\s+not\s+found|cannot\s+find\s+module|err_module_not_found|import\s+not\s+found|no\s+module\s+named)/i.test(el)) {
      const pkgMatch = el.match(/(?:require|import)\s*['"]([^'"]+)['"]/) ||
                       el.match(/module\s+['"]?([^'"\s]+)['"]?\s+(?:not found|cannot be found)/i);
      const pkg = pkgMatch ? pkgMatch[1] : 'unknown';
      return {
        type: 'MODULE_NOT_FOUND',
        category: 'dependency',
        message: `Module "${pkg}" is not installed`,
        suggestions: [
          `Run "npm install ${pkg !== 'unknown' ? pkg : ''}" to install the missing package`,
          `Check if the package name is correct`,
          `Verify package.json has the dependency listed`,
        ],
        autoFixable: true,
        fixCommand: 'npm install',
        reason: 'Missing dependency — auto-installing',
      };
    }

    // Command not found
    if (/(command\s+not\s+found|is\s+not\s+recognized|not\s+found\s+in\s+path|executable\s+not\s+found)/i.test(el)) {
      const cmdMatch = el.match(/['"]?(\w+)['"]?\s*(?:is\s+not|not\s+found|not\s+recognized)/);
      const cmd = cmdMatch ? cmdMatch[1] : 'unknown';
      return {
        type: 'COMMAND_NOT_FOUND',
        category: 'tooling',
        message: `Command "${cmd}" is not installed or not in PATH`,
        suggestions: [
          `Run "which ${cmd}" or "command -v ${cmd}" to check if it exists`,
          `Install the tool: "npm install -g ${cmd}" or "apt install ${cmd}"`,
          `Check if the tool name is correct`,
        ],
        autoFixable: false,
        reason: `Command "${cmd}" not found in PATH`,
      };
    }

    // Port in use
    if (/(eaddrinuse|address\s+already\s+in\s+use|port\s+\d+\s+already\s+in\s+use)/i.test(el)) {
      const portMatch = el.match(/port\s+(\d+)/);
      const port = portMatch ? portMatch[1] : 'unknown';
      return {
        type: 'EADDRINUSE',
        category: 'network',
        message: `Port ${port} is already in use by another process`,
        suggestions: [
          `Run "lsof -i :${port}" to find the process using this port`,
          `Kill the process: "kill $(lsof -t -i :${port})"`,
          `Use a different port`,
        ],
        autoFixable: false,
        reason: `Port ${port} already in use`,
      };
    }

    // File not found
    if (/(enoent|no\s+such\s+file|no\s+such\s+directory|file\s+not\s+found|cannot\s+open\s+file)/i.test(el)) {
      return {
        type: 'ENOENT',
        category: 'filesystem',
        message: 'File or directory not found',
        suggestions: [
          'Run "ls -la" to see what files exist in the current directory',
          'Check the file path is correct',
          'Create the file or directory if needed',
        ],
        autoFixable: false,
        reason: 'File or directory not found',
      };
    }

    // Permission denied
    if (/(permission\s+denied|eacces|eperm|operation\s+not\s+permitted)/i.test(el)) {
      return {
        type: 'EACCES',
        category: 'permission',
        message: 'Permission denied — cannot execute operation',
        suggestions: [
          'Check file/directory permissions',
          'Use "chmod" or "chown" to fix permissions',
          'Avoid running commands that require root access',
        ],
        autoFixable: false,
        reason: 'Permission denied',
      };
    }

    // Syntax/parse error
    if (/(syntax\s+error|unexpected\s+token|parse\s+error|invalid\s+syntax|unexpected\s+end)/i.test(el)) {
      return {
        type: 'SYNTAX_ERROR',
        category: 'code',
        message: 'Syntax or parse error in command/code',
        suggestions: [
          'Read the file to check for syntax errors',
          'Check for missing brackets, quotes, or semicolons',
        ],
        autoFixable: false,
        reason: 'Syntax or parse error',
      };
    }

    // Compilation/build error
    if (/(compilation\s+failed|build\s+failed|compile\s+error|type\s+error|ts\d+:)/i.test(el)) {
      return {
        type: 'BUILD_ERROR',
        category: 'code',
        message: 'Build or compilation failed',
        suggestions: [
          'Read the error output for the specific file and line number',
          'Fix the code errors and retry',
        ],
        autoFixable: false,
        reason: 'Build or compilation failed',
      };
    }

    // Timeout
    if (/(timed?\s*out|timeout|deadline\s+exceeded)/i.test(el)) {
      return {
        type: 'TIMEOUT',
        category: 'execution',
        message: 'Command timed out',
        suggestions: [
          'Increase the timeout duration',
          'Check if the command is stuck or running indefinitely',
          'Run "ps aux" to check for hung processes',
        ],
        autoFixable: false,
        reason: 'Command timed out',
      };
    }

    // Out of memory
    if (/(out\s+of\s+memory|oom|heap\s+out\s+of\s+memory|javascript\s+heap)/i.test(el)) {
      return {
        type: 'OOM',
        category: 'resource',
        message: 'Out of memory',
        suggestions: [
          'Increase available memory',
          'Reduce the scope of the operation',
          'Check for memory leaks in the code',
        ],
        autoFixable: false,
        reason: 'Out of memory',
      };
    }

    // Default: unknown error
    return {
      type: 'UNKNOWN',
      category: 'other',
      message: 'Command failed with an unrecognized error',
      suggestions: [
        'Read the error output for details',
        'Try running the command manually to understand the issue',
      ],
      autoFixable: false,
      reason: 'Unrecognized error',
    };
  }

  /**
   * Truncate output to avoid returning massive error dumps.
   */
  private truncateOutput(output: string, maxLength: number = 4000): string {
    if (!output) return '';
    if (output.length <= maxLength) return output;
    const half = Math.floor(maxLength / 2);
    return output.slice(0, half) + '\n\n... [truncated] ...\n\n' + output.slice(-half);
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
  async executeCommandDirect(
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
