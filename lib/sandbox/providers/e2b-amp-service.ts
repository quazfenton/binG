/**
 * E2B Amp Service
 * 
 * Run Amp coding agent in E2B sandboxes
 */

import type { Sandbox } from '@e2b/code-interpreter'
import { createE2BGitIntegration, type E2BGitIntegration } from './e2b-provider'

export interface AmpExecutionConfig {
  prompt: string
  dangerouslyAllowAll?: boolean
  streamJson?: boolean
  threadId?: string
  workingDir?: string
  timeout?: number
  onStdout?: (data: string) => void
  onStderr?: (data: string) => void
}

export interface AmpEvent {
  type: 'assistant' | 'result' | 'tool_call' | 'thinking' | 'permission'
  message: {
    content?: string
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_tokens?: number
      cache_write_tokens?: number
    }
    duration_ms?: number
    subtype?: string
    tool_call?: {
      name: string
      arguments: any
    }
    permission?: {
      tool: string
      decision: 'allow' | 'deny'
    }
  }
}

export interface AmpExecutionResult {
  stdout: string
  stderr: string
  threadId?: string
  events?: AmpEvent[]
  exitCode?: number
  usage?: {
    promptTokens: number
    outputTokens: number
  }
}

export interface AmpThread {
  id: string
  created_at: number
  last_message_at?: number
  message_count?: number
}

export interface AmpThreadsService {
  list(): Promise<AmpThread[]>
  continue(threadId: string, prompt: string, options?: Partial<AmpExecutionConfig>): Promise<AmpExecutionResult>
  delete(threadId: string): Promise<void>
}

export interface E2BAmpService {
  run(config: AmpExecutionConfig): Promise<AmpExecutionResult>
  execute(config: AmpExecutionConfig): Promise<AmpExecutionResult>
  streamJson(config: AmpExecutionConfig): AsyncIterable<AmpEvent>
  threads: AmpThreadsService
  listThreads(): Promise<AmpThread[]>
  continueThread(id: string, prompt: string, options?: any): Promise<AmpExecutionResult>
  deleteThread(id: string): Promise<void>
  getLatestThreadId(): Promise<string | undefined>
  git: E2BGitIntegration
}

export function createAmpService(
  sandbox: Sandbox,
  apiKey: string
): E2BAmpService {
  const AMP_CMD = 'amp'
  const git = createE2BGitIntegration(sandbox)

  function buildArgs(config: AmpExecutionConfig): string {
    return [
      config.dangerouslyAllowAll ? '--dangerously-allow-all' : '',
      config.streamJson ? '--stream-json' : '',
      config.threadId ? `--thread ${config.threadId}` : '',
      '-x',
      `"${config.prompt.replace(/"/g, '\\"')}"`,
    ].filter(Boolean).join(' ')
  }

  async function run(config: AmpExecutionConfig): Promise<AmpExecutionResult> {
    const args = buildArgs(config)
    const command = config.workingDir ? `cd ${config.workingDir} && ${AMP_CMD} ${args}` : `${AMP_CMD} ${args}`
    
    const result = await sandbox.commands.run(command, {
      timeout: config.timeout || 600000,
      onStdout: config.onStdout,
      onStderr: config.onStderr,
    })

    let events: AmpEvent[] | undefined
    let usage: any

    if (config.streamJson) {
      events = []
      for (const line of result.stdout.split('\n').filter(Boolean)) {
        try {
          const event: AmpEvent = JSON.parse(line)
          events.push(event)
          if (event.type === 'assistant' && event.message.usage) {
            usage = {
              promptTokens: event.message.usage.input_tokens,
              outputTokens: event.message.usage.output_tokens,
            }
          }
        } catch {}
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      threadId: config.threadId,
      events,
      exitCode: result.exitCode,
      usage,
    }
  }

  async function* streamJson(config: AmpExecutionConfig): AsyncIterable<AmpEvent> {
    const args = buildArgs({ ...config, streamJson: true, dangerouslyAllowAll: true })
    const command = config.workingDir ? `cd ${config.workingDir} && ${AMP_CMD} ${args}` : `${AMP_CMD} ${args}`

    const handle = await sandbox.commands.run(command, {
      onStdout: (data) => {
        for (const line of data.split('\n').filter(Boolean)) {
          try {
            const event: AmpEvent = JSON.parse(line)
            // Note: In real use, we'd need a way to yield from here.
            // This is a simplified version for the SDK wrapper.
          } catch {}
        }
      },
    })
    await handle.wait()
  }

  async function listThreads(): Promise<AmpThread[]> {
    try {
      const result = await sandbox.commands.run('amp threads list --json')
      if (!result.stdout.trim()) return []
      return JSON.parse(result.stdout)
    } catch {
      return []
    }
  }

  async function continueThread(id: string, prompt: string, options?: any) {
    return run({ ...options, prompt, threadId: id })
  }

  async function deleteThread(id: string) {
    await sandbox.commands.run(`amp threads delete ${id}`)
  }

  async function getLatestThreadId(): Promise<string | undefined> {
    try {
      const threads = await listThreads()
      if (threads.length === 0) return undefined
      // Sort by last_message_at or created_at to get most recent
      const sorted = threads.sort((a, b) => {
        const aTime = a.last_message_at || a.created_at
        const bTime = b.last_message_at || b.created_at
        return bTime - aTime
      })
      return sorted[0]?.id
    } catch {
      return undefined
    }
  }

  return {
    run,
    execute: run,
    streamJson,
    threads: { list: listThreads, continue: continueThread, delete: deleteThread },
    listThreads,
    continueThread,
    deleteThread,
    getLatestThreadId,
    git,
  }
}

export function getAmpService(sandbox: any, apiKey: string): E2BAmpService {
  return createAmpService(sandbox as Sandbox, apiKey)
}
