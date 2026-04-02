/**
 * Code Executor
 *
 * Executes code in sandboxed environments
 * Uses existing sandbox providers for isolation
 */

import { coreSandboxService } from '@/lib/sandbox/core-sandbox-service';

export interface ExecutionOptions {
  input?: string;
  timeout?: number;
  memoryLimit?: number;
}

export interface ExecutionResult {
  output: string;
  error?: string;
  executionTime: number;
  memoryUsed?: number;
  exitCode: number;
}

/**
 * Execute code in sandbox
 */
export async function executeInSandbox(
  code: string,
  language: string,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    // Create temporary sandbox
    const sandbox = await coreSandboxService.createSandbox({
      language: getLanguageTemplate(language),
      timeout: options.timeout || 5000,
    });

    try {
      // Write code to file
      const filename = getFilenameForLanguage(language);
      await coreSandboxService.writeFile(sandbox.id, filename, code);

      // Get execution command
      const command = getExecutionCommand(language, filename);

      // Execute code
      const result = await coreSandboxService.executeCommand(sandbox.id, command, {
        timeout: options.timeout || 5000,
      });

      const executionTime = Date.now() - startTime;

      return {
        output: result.output || '',
        error: result.error,
        executionTime,
        exitCode: result.exitCode,
      };
    } finally {
      // Clean up sandbox
      await coreSandboxService.destroySandbox(sandbox.id);
    }
  } catch (error: any) {
    const executionTime = Date.now() - startTime;

    return {
      output: '',
      error: error.message || 'Execution failed',
      executionTime,
      exitCode: 1,
    };
  }
}

/**
 * Get language template for sandbox
 */
function getLanguageTemplate(language: string): string {
  const templates: Record<string, string> = {
    javascript: 'node',
    python: 'python',
    typescript: 'node',
    go: 'go',
    rust: 'rust',
    java: 'java',
  };

  return templates[language.toLowerCase()] || 'node';
}

/**
 * Get filename for language
 */
function getFilenameForLanguage(language: string): string {
  const filenames: Record<string, string> = {
    javascript: 'index.js',
    python: 'main.py',
    typescript: 'index.ts',
    go: 'main.go',
    rust: 'main.rs',
    java: 'Main.java',
  };

  return filenames[language.toLowerCase()] || 'index.js';
}

/**
 * Get execution command for language
 */
function getExecutionCommand(language: string, filename: string): string {
  const commands: Record<string, string> = {
    javascript: `node ${filename}`,
    python: `python3 ${filename}`,
    typescript: `npx ts-node ${filename}`,
    go: `go run ${filename}`,
    rust: `rustc ${filename} && ./main`,
    java: `javac ${filename} && java Main`,
  };

  return commands[language.toLowerCase()] || `node ${filename}`;
}
