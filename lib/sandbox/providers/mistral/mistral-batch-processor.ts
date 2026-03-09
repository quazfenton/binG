/**
 * Mistral Batch Processing
 * 
 * Execute multiple code snippets in parallel with Mistral's Batch API.
 * 
 * @see https://docs.mistral.ai/api/#tag/batch
 */

import { Mistral } from '@mistralai/mistralai'
import type { CodeLanguage } from './mistral-types'

export interface BatchJobConfig {
  /** Unique identifier for the batch job */
  jobId?: string
  /** Array of code snippets to execute */
  codeSnippets: Array<{
    id: string
    code: string
    language: CodeLanguage
    timeout?: number
  }>
  /** Maximum parallel executions */
  maxParallel?: number
  /** Continue execution on individual failure */
  continueOnFailure?: boolean
  /** Callback URL for completion notification */
  callbackUrl?: string
}

export interface BatchJobResult {
  jobId: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  totalTasks: number
  completedTasks: number
  failedTasks: number
  results: BatchTaskResult[]
  createdAt: string
  completedAt?: string
}

export interface BatchTaskResult {
  id: string
  success: boolean
  output?: string
  error?: string
  exitCode: number
  executionTimeMs?: number
}

export interface BatchExecutionOptions {
  maxParallel?: number
  timeoutPerTask?: number
  onTaskComplete?: (result: BatchTaskResult) => void
  onTaskError?: (id: string, error: Error) => void
}

const DEFAULT_MAX_PARALLEL = 5
const DEFAULT_TIMEOUT = 60000

export class MistralBatchProcessor {
  private client: Mistral
  private apiKey: string

  constructor(apiKey: string, serverURL?: string) {
    this.apiKey = apiKey
    this.client = new Mistral({
      apiKey,
      serverURL: serverURL || 'https://api.mistral.ai/v1',
    })
  }

  /**
   * Execute multiple code snippets in parallel
   * Uses Mistral's chat completions for synchronous batch execution
   */
  async executeBatch(
    snippets: Array<{ id: string; code: string; language: CodeLanguage }>,
    options: BatchExecutionOptions = {}
  ): Promise<BatchTaskResult[]> {
    const maxParallel = options.maxParallel || DEFAULT_MAX_PARALLEL
    const results: BatchTaskResult[] = []
    const executing: Promise<void>[] = []
    let currentIndex = 0

    const executeSnippet = async (snippet: { id: string; code: string; language: CodeLanguage }): Promise<BatchTaskResult> => {
      const startTime = Date.now()
      
      try {
        const prompt = this.buildExecutionPrompt(snippet.code, snippet.language)
        
        const response = await this.client.chat.complete({
          model: 'mistral-medium-latest',
          messages: [
            { role: 'system', content: this.getSystemPrompt(snippet.language) },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          maxTokens: 4096,
        })

        const output = typeof response.choices?.[0]?.message?.content === 'string' 
          ? response.choices[0].message.content 
          : JSON.stringify(response.choices?.[0]?.message?.content || '')
        const executionTimeMs = Date.now() - startTime

        const result: BatchTaskResult = {
          id: snippet.id,
          success: true,
          output,
          exitCode: 0,
          executionTimeMs,
        }

        options.onTaskComplete?.(result)
        return result

      } catch (error) {
        const executionTimeMs = Date.now() - startTime
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        
        const result: BatchTaskResult = {
          id: snippet.id,
          success: false,
          error: errorMessage,
          exitCode: 1,
          executionTimeMs,
        }

        options.onTaskError?.(snippet.id, error instanceof Error ? error : new Error(errorMessage))
        return result
      }
    }

    const processNext = async (): Promise<void> => {
      if (currentIndex >= snippets.length) return
      
      const snippet = snippets[currentIndex++]
      const result = await executeSnippet(snippet)
      results.push(result)
    }

    // Start initial batch
    const initialBatch = Math.min(maxParallel, snippets.length)
    for (let i = 0; i < initialBatch; i++) {
      executing.push(processNext())
    }

    // Process remaining
    while (currentIndex < snippets.length || executing.length > 0) {
      await Promise.race(executing)
      
      const completedIndex = executing.findIndex(async p => {
        const result = await Promise.race([
          p.then(() => true),
          new Promise<false>(() => false)
        ])
        return result === true || currentIndex >= snippets.length
      })
      
      if (completedIndex >= 0 && currentIndex < snippets.length) {
        executing.splice(completedIndex, 1)
        executing.push(processNext())
      }
    }

    await Promise.all(executing)

    return results.sort((a, b) => {
      const aIndex = snippets.findIndex(s => s.id === a.id)
      const bIndex = snippets.findIndex(s => s.id === b.id)
      return aIndex - bIndex
    })
  }

  /**
   * Submit batch job to Mistral Batch API (for very large batches)
   */
  async submitBatchJob(config: BatchJobConfig): Promise<BatchJobResult> {
    const jobId = config.jobId || `batch-${Date.now()}`
    
    const batchInput = config.codeSnippets.map((snippet) => ({
      custom_id: snippet.id,
      body: {
        model: 'mistral-medium-latest',
        messages: [
          { role: 'system', content: this.getSystemPrompt(snippet.language) },
          { role: 'user', content: this.buildExecutionPrompt(snippet.code, snippet.language) },
        ],
        temperature: 0.2,
        max_tokens: 4096,
      },
    }))

    try {
      const response = await (this.client as any).batch.create({
        input_jsonl: batchInput,
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        metadata: {
          job_id: jobId,
          ...(config.callbackUrl ? { callback_url: config.callbackUrl } : {}),
        },
      })

      return {
        jobId: response.id || jobId,
        status: 'pending',
        totalTasks: config.codeSnippets.length,
        completedTasks: 0,
        failedTasks: 0,
        results: [],
        createdAt: new Date().toISOString(),
      }
    } catch (error) {
      throw new Error(`Failed to submit batch job: ${error instanceof Error ? error.message : error}`)
    }
  }

  /**
   * Get status of a batch job
   */
  async getBatchJobStatus(jobId: string): Promise<BatchJobResult> {
    try {
      const response = await (this.client as any).batch.retrieve(jobId)
      
      return {
        jobId: response.id || jobId,
        status: this.mapBatchStatus(response.status),
        totalTasks: response.response_counts?.total || 0,
        completedTasks: response.response_counts?.completed || 0,
        failedTasks: response.response_counts?.failed || 0,
        results: [],
        createdAt: response.created_at || new Date().toISOString(),
        completedAt: response.completed_at,
      }
    } catch (error) {
      throw new Error(`Failed to get batch job status: ${error instanceof Error ? error.message : error}`)
    }
  }

  private mapBatchStatus(status: string): BatchJobResult['status'] {
    const statusMap: Record<string, BatchJobResult['status']> = {
      'pending': 'pending',
      'processing': 'processing',
      'completed': 'completed',
      'failed': 'failed',
      'cancelled': 'cancelled',
    }
    return statusMap[status] || 'pending'
  }

  private getSystemPrompt(language: CodeLanguage): string {
    const prompts: Record<CodeLanguage, string> = {
      python: `You are a Python code execution assistant. 
Execute the provided code and return ONLY the output.
If there are errors, return ONLY the error message.
Do not include any explanations or markdown.`,
      
      python3: `You are a Python 3 code execution assistant.
Execute the provided code and return ONLY the output.
If there are errors, return ONLY the error message.
Do not include any explanations or markdown.`,

      javascript: `You are a JavaScript code execution assistant.
Execute the provided code using Node.js and return ONLY the output.
If there are errors, return ONLY the error message.
Do not include any explanations or markdown.`,

      typescript: `You are a TypeScript code execution assistant.
Execute the provided code using Node.js with TypeScript and return ONLY the output.
If there are errors, return ONLY the error message.
Do not include any explanations or markdown.`,

      bash: `You are a Bash shell execution assistant.
Execute the provided shell command and return ONLY the output.
If there are errors, return ONLY the error message.
Do not include any explanations or markdown.`,

      shell: `You are a shell execution assistant.
Execute the provided command and return ONLY the output.
If there are errors, return ONLY the error message.
Do not include any explanations or markdown.`,
    }

    return prompts[language] || prompts.python
  }

  private buildExecutionPrompt(code: string, language: CodeLanguage): string {
    return `Execute this ${language} code and return ONLY the output:\n\n\`\`\`${language}\n${code}\n\`\`\``
  }
}

export function createBatchProcessor(apiKey: string, serverURL?: string): MistralBatchProcessor {
  return new MistralBatchProcessor(apiKey, serverURL)
}
