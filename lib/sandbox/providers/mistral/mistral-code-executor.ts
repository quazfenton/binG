/**
 * Mistral Code Executor
 * 
 * Advanced code execution with validation, multi-language support, and retry logic.
 * Additive module that enhances the core provider with sophisticated execution capabilities.
 * 
 * Features:
 * - Multi-language code execution (Python, JavaScript, TypeScript, Bash)
 * - Code safety validation
 * - Batch execution
 * - Retry with exponential backoff
 * - Execution metadata tracking
 * - Result parsing and formatting
 */

import type { Mistral } from '@mistralai/mistralai'
import type { ToolResult } from '../../types'
import type {
  CodeExecutionRequest,
  CodeExecutionResult,
  CodeLanguage,
  ExecutionEnvironment,
  MistralProviderConfig,
} from './mistral-types'
import { MistralConversationManager } from './mistral-conversation-manager'

export interface ExecutionStats {
  totalExecutions: number
  successfulExecutions: number
  failedExecutions: number
  averageExecutionTime: number
  languageBreakdown: Record<string, number>
}

export class MistralCodeExecutor {
  private client: Mistral
  private config: MistralProviderConfig
  private conversationManager: MistralConversationManager
  private stats: ExecutionStats

  constructor(client: Mistral, config: MistralProviderConfig) {
    this.client = client
    this.config = config
    this.conversationManager = new MistralConversationManager(client)
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      languageBreakdown: {},
    }
  }

  /**
   * Execute code with full validation and retry logic
   */
  async executeCode(
    request: CodeExecutionRequest,
    conversationId?: string
  ): Promise<CodeExecutionResult> {
    const startTime = Date.now()
    this.stats.totalExecutions++

    try {
      // Validate code
      const validation = await this.validateCode(request.code, request.language)
      if (!validation.safe) {
        this.stats.failedExecutions++
        return {
          success: false,
          output: `Code safety validation failed: ${validation.reason}`,
          exitCode: 1,
          validationErrors: validation.errors,
          metadata: {
            executedCode: request.code,
            language: request.language,
          },
        }
      }

      // Build execution prompt
      const prompt = this.buildExecutionPrompt(request)

      // Execute via conversation
      let response: any
      if (!conversationId) {
        response = await this.conversationManager.startConversation(
          'code-interpreter', // Will use agent ID from context
          [{ role: 'user', content: prompt, type: 'message.input', object: 'entry' }],
          { completionArgs: request.completionArgs }
        )
      } else {
        response = await this.conversationManager.appendMessage(
          conversationId,
          [{ role: 'user', content: prompt, type: 'message.input', object: 'entry' }]
        )
      }

      // Extract result
      const result = this.extractExecutionResult(response)
      const executionTime = Date.now() - startTime

      if (result.success) {
        this.stats.successfulExecutions++
        this.updateStats(request.language, executionTime)
      } else {
        this.stats.failedExecutions++
      }

      return {
        ...result,
        metadata: {
          executionTime,
          tokenUsage: response.usage,
          executedCode: request.code,
          language: request.language,
        },
      }
    } catch (error: any) {
      this.stats.failedExecutions++
      return {
        success: false,
        output: error.message || 'Code execution failed',
        exitCode: 1,
        metadata: {
          executedCode: request.code,
          language: request.language,
        },
      }
    }
  }

  /**
   * Execute code with automatic retry
   */
  async executeWithRetry(
    request: CodeExecutionRequest,
    options?: {
      maxRetries?: number
      backoffMs?: number
      conversationId?: string
    }
  ): Promise<CodeExecutionResult> {
    const maxRetries = options?.maxRetries ?? this.config.maxRetries
    const backoffMs = options?.backoffMs ?? 1000
    let lastError: Error | undefined
    let lastResult: CodeExecutionResult | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeCode(request, options?.conversationId)
        
        if (result.success) {
          return result
        }

        lastResult = result

        // Don't retry validation errors
        if (result.validationErrors?.length > 0) {
          return result
        }

        // Don't retry certain errors
        if (this.isNonRetryableError(result.output)) {
          return result
        }

      } catch (error: any) {
        lastError = error
        
        if (!this.isRetryableError(error)) {
          throw error
        }
      }

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = backoffMs * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    // Return last result or throw error
    if (lastResult) {
      return lastResult
    }
    throw lastError || new Error('Code execution failed after retries')
  }

  /**
   * Execute batch of code snippets
   */
  async executeBatch(
    requests: CodeExecutionRequest[],
    options?: {
      stopOnFailure?: boolean
      conversationId?: string
    }
  ): Promise<CodeExecutionResult[]> {
    const results: CodeExecutionResult[] = []
    let convId = options?.conversationId

    for (const request of requests) {
      const result = await this.executeCode(request, convId)
      results.push(result)

      // Use same conversation for context
      if (!convId && result.metadata?.conversationId) {
        convId = result.metadata.conversationId
      }

      // Stop on first failure if requested
      if (options?.stopOnFailure && !result.success) {
        break
      }
    }

    return results
  }

  /**
   * Execute Python code
   */
  async executePython(
    code: string,
    env?: ExecutionEnvironment
  ): Promise<CodeExecutionResult> {
    return this.executeCode({
      code,
      language: 'python',
      ...env,
    })
  }

  /**
   * Execute JavaScript code
   */
  async executeJavaScript(
    code: string,
    env?: ExecutionEnvironment
  ): Promise<CodeExecutionResult> {
    return this.executeCode({
      code,
      language: 'javascript',
      ...env,
    })
  }

  /**
   * Execute TypeScript code
   */
  async executeTypeScript(
    code: string,
    env?: ExecutionEnvironment
  ): Promise<CodeExecutionResult> {
    return this.executeCode({
      code,
      language: 'typescript',
      ...env,
    })
  }

  /**
   * Execute Bash command
   */
  async executeBash(
    command: string,
    env?: ExecutionEnvironment
  ): Promise<CodeExecutionResult> {
    return this.executeCode({
      code: command,
      language: 'bash',
      ...env,
    })
  }

  /**
   * Get execution statistics
   */
  getStats(): ExecutionStats {
    return { ...this.stats }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      languageBreakdown: {},
    }
  }

  /**
   * Validate code for safety
   */
  private async validateCode(
    code: string,
    language: string
  ): Promise<{
    safe: boolean
    reason?: string
    errors: string[]
    warnings: string[]
  }> {
    const errors: string[] = []
    const warnings: string[] = []

    // Dangerous patterns
    const dangerousPatterns: RegExp[] = [
      /rm\s+-rf\s+\//,
      /mkfs\./,
      /dd\s+if=.*of=\/dev/,
      /:\(\)\{\s*:\|:\s*&\s*\}\s*:/, // Fork bomb
      /chmod\s+-R\s+777\s+\//,
      /wget.*\|.*sh/,
      /curl.*\|.*sh/,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        errors.push(`Dangerous pattern detected: ${pattern.source}`)
      }
    }

    // Language-specific checks
    if (language === 'python') {
      const pythonWarnings = this.validatePython(code)
      warnings.push(...pythonWarnings)
    } else if (['javascript', 'typescript'].includes(language)) {
      const jsWarnings = this.validateJavaScript(code)
      warnings.push(...jsWarnings)
    }

    return {
      safe: errors.length === 0,
      reason: errors.length > 0 ? errors.join('; ') : undefined,
      errors,
      warnings,
    }
  }

  /**
   * Python-specific validation
   */
  private validatePython(code: string): string[] {
    const warnings: string[] = []

    const dangerousFunctions = [
      'os.system',
      'subprocess.call',
      'subprocess.Popen',
      'eval(',
      'exec(',
      '__import__',
      'compile(',
    ]

    for (const func of dangerousFunctions) {
      if (code.includes(func)) {
        warnings.push(`Potentially dangerous function: ${func}`)
      }
    }

    return warnings
  }

  /**
   * JavaScript-specific validation
   */
  private validateJavaScript(code: string): string[] {
    const warnings: string[] = []

    if (/\beval\s*\(/.test(code)) {
      warnings.push('Use of eval() detected')
    }

    if (/\bFunction\s*\(/.test(code)) {
      warnings.push('Use of Function constructor detected')
    }

    if (/require\s*\(\s*[^'"]/.test(code)) {
      warnings.push('Dynamic require path detected')
    }

    if (/vm\.runInContext/.test(code)) {
      warnings.push('Use of Node vm module detected')
    }

    return warnings
  }

  /**
   * Build execution prompt
   */
  private buildExecutionPrompt(request: CodeExecutionRequest): string {
    const parts: string[] = []

    parts.push(`Execute the following ${request.language} code:`)
    parts.push('')
    parts.push('```' + request.language)
    parts.push(request.code)
    parts.push('```')
    parts.push('')

    if (request.cwd) {
      parts.push(`Working directory: ${request.cwd}`)
    }

    if (request.env && Object.keys(request.env).length > 0) {
      parts.push(`Environment variables: ${JSON.stringify(request.env)}`)
    }

    parts.push('Return ONLY the code output, no explanations.')
    parts.push('Format the response as JSON if possible.')

    return parts.join('\n')
  }

  /**
   * Extract execution result from conversation response
   */
  private extractExecutionResult(response: any): CodeExecutionResult {
    if (!response?.outputs || !Array.isArray(response.outputs)) {
      return {
        success: false,
        output: 'No output received',
        exitCode: 1,
      }
    }

    // Look for tool execution
    for (const entry of response.outputs) {
      if (entry.type === 'tool.execution' && entry.name === 'code_interpreter') {
        const info = entry.info
        if (info?.code_output !== undefined) {
          return {
            success: true,
            output: typeof info.code_output === 'string'
              ? info.code_output
              : JSON.stringify(info.code_output, null, 2),
            exitCode: 0,
          }
        }
      }
    }

    // Fallback to text extraction
    const texts: string[] = []
    for (const entry of response.outputs) {
      if (entry.type === 'message.output') {
        if (typeof entry.content === 'string') {
          texts.push(entry.content)
        } else if (Array.isArray(entry.content)) {
          for (const chunk of entry.content) {
            if (chunk.type === 'text' && chunk.text) {
              texts.push(chunk.text)
            }
          }
        }
      }
    }

    return {
      success: texts.length > 0,
      output: texts.join('\n').trim() || 'No output',
      exitCode: texts.length > 0 ? 0 : 1,
    }
  }

  /**
   * Update statistics
   */
  private updateStats(language: string, executionTime: number): void {
    // Update language breakdown
    this.stats.languageBreakdown[language] = 
      (this.stats.languageBreakdown[language] || 0) + 1

    // Update average execution time
    const total = this.stats.totalExecutions
    this.stats.averageExecutionTime = 
      ((this.stats.averageExecutionTime * (total - 1)) + executionTime) / total
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    const message = error.message?.toLowerCase() || ''
    return (
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('temporary') ||
      message.includes('network')
    )
  }

  /**
   * Check if error is non-retryable
   */
  private isNonRetryableError(output: string): boolean {
    const lower = output.toLowerCase()
    return (
      lower.includes('syntax error') ||
      lower.includes('validation failed') ||
      lower.includes('permission denied') ||
      lower.includes('not found')
    )
  }
}
