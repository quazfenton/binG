import { spawn, type ChildProcess } from 'child_process'
import type { ToolResult } from '../types'
import type {
  LLMProvider,
  LLMAgentOptions,
  LLMAgentResult,
  LLMAgentStep,
} from './llm-provider'

const DEFAULT_MAX_STEPS = 15
const PROCESS_TIMEOUT_MS = 300_000 // 5 minutes

export class OpencodeProvider implements LLMProvider {
  readonly name = 'opencode'

  async runAgentLoop(options: LLMAgentOptions): Promise<LLMAgentResult> {
    const {
      userMessage,
      tools,
      systemPrompt,
      maxSteps = DEFAULT_MAX_STEPS,
      executeTool,
      onToolExecution,
      onStreamChunk,
    } = options

    const steps: LLMAgentStep[] = []
    let finalResponse = ''

    return new Promise<LLMAgentResult>((resolve, reject) => {
      const args = ['chat', '--json']
      const model = process.env.OPENCODE_MODEL
      if (model) {
        args.push('--model', model)
      }

      const proc = spawn(process.env.OPENCODE_BIN ?? 'opencode', args, {
        env: {
          ...process.env,
          OPENCODE_SYSTEM_PROMPT: systemPrompt,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      const initialPayload = JSON.stringify({
        prompt: userMessage,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      })
      proc.stdin.write(initialPayload + '\n')

      let stepCount = 0
      let buffer = ''

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM')
        resolve({
          response: finalResponse || 'Process timed out.',
          steps,
          totalSteps: stepCount,
        })
      }, PROCESS_TIMEOUT_MS)

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        processBuffer()
      })

      // Sequential buffer processor to prevent race conditions
      let processing = false
      const processBuffer = async () => {
        if (processing) return
        processing = true

        try {
          while (true) {
            const newlineIdx = buffer.indexOf('\n')
            if (newlineIdx === -1) break

            const line = buffer.slice(0, newlineIdx)
            buffer = buffer.slice(newlineIdx + 1)

            if (!line.trim()) continue

            let parsed: any
            try {
              parsed = JSON.parse(line)
            } catch {
              onStreamChunk?.(line)
              finalResponse += line
              continue
            }

            if (parsed.tool_call && stepCount < maxSteps) {
              stepCount++
              const { name, arguments: toolArgs } = parsed.tool_call

              let toolResult: ToolResult
              try {
                toolResult = await executeTool(name, toolArgs ?? {})
              } catch (err) {
                // Tool execution failed - kill process and reject the promise
                clearTimeout(timeout)
                proc.kill('SIGTERM')
                reject(
                  err instanceof Error
                    ? err
                    : new Error(`Tool execution failed for '${name}': ${String(err)}`),
                )
                return
              }
              
              steps.push({ toolName: name, args: toolArgs ?? {}, result: toolResult })
              onToolExecution?.(name, toolArgs ?? {}, toolResult)

              const resultPayload = JSON.stringify({
                tool_result: {
                  name,
                  result: toolResult.output,
                  exit_code: toolResult.exitCode,
                  success: toolResult.success,
                },
              })

              if (!proc.killed && !proc.stdin.destroyed) {
                proc.stdin.write(resultPayload + '\n')
              }
            } else if (parsed.tool_call && stepCount >= maxSteps) {
              // Inform the process we've hit the step limit - prevents hanging
              const resultPayload = JSON.stringify({
                tool_result: {
                  name: parsed.tool_call.name,
                  result: 'Maximum tool execution steps reached',
                  exit_code: 1,
                  success: false,
                },
              })
              
              if (!proc.killed && !proc.stdin.destroyed) {
                proc.stdin.write(resultPayload + '\n')
              }
              
              // Add sentinel step for tracking
              steps.push({ 
                toolName: parsed.tool_call.name, 
                args: parsed.tool_call.arguments ?? {}, 
                result: { success: false, output: 'Maximum steps reached', exitCode: 1 }
              })
            } else if (parsed.text) {
              onStreamChunk?.(parsed.text)
              finalResponse += parsed.text
            } else if (parsed.done || parsed.complete) {
              finalResponse = parsed.response ?? parsed.text ?? finalResponse
            }
          }
        } finally {
          processing = false
          // Process any remaining data that arrived while processing
          if (buffer.includes('\n')) {
            processBuffer()
          }
        }
      }

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        if (process.env.NODE_ENV === 'development') {
          console.error('[opencode stderr]', text)
        }
      })

      proc.on('close', (code) => {
        clearTimeout(timeout)
        resolve({
          response: finalResponse || `Process exited with code ${code}`,
          steps,
          totalSteps: stepCount,
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        reject(new Error(`Opencode process error: ${err.message}`))
      })
    })
  }
}
