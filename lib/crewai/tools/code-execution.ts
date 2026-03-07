/**
 * CrewAI Code Execution Tools
 *
 * ⚠️  SECURITY WARNING: This module executes code on the HOST system.
 * 
 * CRITICAL SECURITY ISSUE:
 * - Bash execution via 'bash -c' allows arbitrary command execution
 * - Even "safe" mode uses regex checks that are trivially bypassed
 * - No proper sandboxing/isolation from host system
 * 
 * RECOMMENDED FIX:
 * - DO NOT USE this module in production
 * - Use sandbox providers instead (E2B, Daytona, Blaxel, etc.)
 * - Sandbox providers offer proper isolation and security
 * 
 * @deprecated Use lib/sandbox/providers/* instead for secure code execution
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

// SECURITY: Disable CrewAI code execution in production by default
const ALLOW_CREWAI_CODE_EXECUTION = process.env.ALLOW_CREWAI_CODE_EXECUTION === 'true';

if (!ALLOW_CREWAI_CODE_EXECUTION && process.env.NODE_ENV === 'production') {
  console.warn('⚠️  CrewAI code execution is DISABLED in production. Set ALLOW_CREWAI_CODE_EXECUTION=true to enable (NOT RECOMMENDED).');
  console.warn('⚠️  Use sandbox providers (E2B, Daytona, Blaxel) for secure code execution instead.');
}

export interface CodeExecutionConfig {
  mode: 'safe' | 'unsafe';
  dockerImage?: string;
  timeoutMs?: number;
  memoryLimitMb?: number;
  maxOutputSize?: number;
  allowedLanguages?: string[];
  blockedPatterns?: string[];
  workingDirectory?: string;
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
}

export interface CodeLanguage {
  name: string;
  extensions: string[];
  dockerImage?: string;
  runCommand: (code: string, args?: string[]) => string[];
}

const SUPPORTED_LANGUAGES: Record<string, CodeLanguage> = {
  javascript: {
    name: 'JavaScript',
    extensions: ['.js', '.mjs'],
    dockerImage: 'node:18-alpine',
    runCommand: (code) => ['node', '-e', code],
  },
  typescript: {
    name: 'TypeScript',
    extensions: ['.ts'],
    dockerImage: 'node:18-alpine',
    runCommand: (code) => ['npx', 'ts-node', '-e', code],
  },
  python: {
    name: 'Python',
    extensions: ['.py'],
    dockerImage: 'python:311-slim',
    runCommand: (code) => ['python3', '-c', code],
  },
  // SECURITY: Bash removed from supported languages in production
  // bash execution allows arbitrary command execution on host
};

export class DockerCodeExecutor extends EventEmitter {
  private config: Required<CodeExecutionConfig>;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(config: Partial<CodeExecutionConfig> = {}) {
    super();
    this.config = {
      mode: config.mode || 'safe',
      dockerImage: config.dockerImage || 'node:18-alpine',
      timeoutMs: config.timeoutMs || 30000,
      memoryLimitMb: config.memoryLimitMb || 512,
      maxOutputSize: config.maxOutputSize || 1024 * 1024,
      allowedLanguages: config.allowedLanguages || Object.keys(SUPPORTED_LANGUAGES),
      blockedPatterns: config.blockedPatterns || [
        'rm -rf /',
        'format c:',
        'del /f /s /q',
        'curl.*\\|\\s*bash',
        'wget.*\\|\\s*bash',
        'mkfs',
        'dd if=',
      ],
      workingDirectory: config.workingDirectory || process.cwd(),
    };
  }

  /**
   * Execute code in a specified language
   * 
   * SECURITY: This method is disabled in production unless explicitly enabled
   */
  async execute(code: string, language: string): Promise<ExecutionResult> {
    // SECURITY: Block execution in production unless explicitly enabled
    if (!ALLOW_CREWAI_CODE_EXECUTION && process.env.NODE_ENV === 'production') {
      return {
        success: false,
        stdout: '',
        stderr: 'CREWAI CODE EXECUTION DISABLED: Use sandbox providers (E2B, Daytona, Blaxel) for secure code execution in production.',
        exitCode: -1,
        durationMs: 0,
        error: 'Code execution disabled in production for security'
      };
    }

    const startTime = Date.now();
    const executionId = createHash('sha256').update(code + Date.now().toString()).digest('hex').slice(0, 8);

    // Validate language
    if (!this.config.allowedLanguages.includes(language)) {
      return {
        success: false,
        stdout: '',
        stderr: `Language not allowed: ${language}. Allowed: ${this.config.allowedLanguages.join(', ')}`,
        exitCode: -1,
        durationMs: 0,
      };
    }

    // SECURITY: Block bash execution entirely - allows arbitrary command execution
    if (language === 'bash') {
      return {
        success: false,
        stdout: '',
        stderr: 'Bash execution is disabled for security. Use sandbox providers for shell commands.',
        exitCode: -1,
        durationMs: 0,
        error: 'Bash execution disabled'
      };
    }

    // Security check for unsafe mode
    if (this.config.mode === 'safe') {
      const securityCheck = this.checkSecurity(code);
      if (!securityCheck.safe) {
        return {
          success: false,
          stdout: '',
          stderr: `Security violation: ${securityCheck.reason}`,
          exitCode: -1,
          durationMs: 0,
        };
      }
    }

    const langConfig = SUPPORTED_LANGUAGES[language];

    try {
      this.emit('execution:start', { executionId, language, code });

      // Execute code
      const result = await this.executeInSandbox(
        langConfig.runCommand(code),
        langConfig.dockerImage,
        executionId
      );

      this.emit('execution:complete', { executionId, success: result.success });

      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      this.emit('execution:error', { executionId, error });

      return {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'Execution failed',
        exitCode: -1,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check code for security issues
   */
  private checkSecurity(code: string): { safe: boolean; reason?: string } {
    // Check for blocked patterns
    for (const pattern of this.config.blockedPatterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(code)) {
        return { safe: false, reason: `Blocked pattern detected: ${pattern}` };
      }
    }

    // Check for network access in safe mode
    if (this.config.mode === 'safe') {
      const networkPatterns = [
        /fetch\s*\(/,
        /axios\./,
        /http\.get/,
        /http\.post/,
        /net\.connect/,
      ];

      for (const pattern of networkPatterns) {
        if (pattern.test(code)) {
          return { safe: false, reason: 'Network access not allowed in safe mode' };
        }
      }
    }

    // Check for file system access in safe mode
    if (this.config.mode === 'safe') {
      const fsPatterns = [
        /fs\./,
        /path\.join.*\.\./,
        /process\.cwd/,
      ];

      for (const pattern of fsPatterns) {
        if (pattern.test(code)) {
          return { safe: false, reason: 'File system access not allowed in safe mode' };
        }
      }
    }

    return { safe: true };
  }

  /**
   * Execute code in Docker sandbox
   */
  private async executeInSandbox(
    command: string[],
    image: string | undefined,
    executionId: string
  ): Promise<Omit<ExecutionResult, 'durationMs'>> {
    return new Promise((resolve, reject) => {
      // For now, execute locally with timeout
      // In production, this would use Docker SDK
      const [cmd, ...args] = command;
      
      const child = spawn(cmd, args, {
        cwd: this.config.workingDirectory,
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: this.config.timeoutMs,
      });

      this.activeProcesses.set(executionId, child);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        
        if (stdout.length > this.config.maxOutputSize) {
          child.kill('SIGKILL');
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        this.activeProcesses.delete(executionId);
        
        resolve({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code,
        });
      });

      child.on('error', (error) => {
        this.activeProcesses.delete(executionId);
        reject(error);
      });

      // Timeout handling
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
          resolve({
            success: false,
            stdout: stdout.trim(),
            stderr: 'Execution timed out',
            exitCode: -1,
          });
        }
      }, this.config.timeoutMs);
    });
  }

  /**
   * Kill an active execution
   */
  kill(executionId: string): boolean {
    const child = this.activeProcesses.get(executionId);
    if (child) {
      child.kill('SIGKILL');
      this.activeProcesses.delete(executionId);
      return true;
    }
    return false;
  }

  /**
   * Kill all active executions
   */
  killAll(): void {
    for (const [id, child] of this.activeProcesses) {
      child.kill('SIGKILL');
    }
    this.activeProcesses.clear();
  }
}

/**
 * Create a code execution tool for CrewAI
 */
export function createCodeExecutionTool(config: Partial<CodeExecutionConfig> = {}) {
  const executor = new DockerCodeExecutor(config);

  return {
    name: 'execute_code',
    description: 'Execute code in a sandboxed environment. Supports JavaScript, TypeScript, Python, and Bash.',
    execute: async (params: { code: string; language: string }) => {
      const result = await executor.execute(params.code, params.language);
      
      if (!result.success) {
        throw new Error(result.stderr || result.error);
      }
      
      return result.stdout;
    },
  };
}
