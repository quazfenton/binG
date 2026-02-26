import { randomUUID } from 'node:crypto'
import { Mistral } from '@mistralai/mistralai'
import type { ToolResult } from '../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from './sandbox-provider'

type MistralSession = {
  sandboxId: string
  conversationId?: string
  createdAt: number
  lastActive: number
}

const WORKSPACE_DIR = '/workspace'
const mistralSessions = new Map<string, MistralSession>()

export class MistralCodeInterpreterProvider implements SandboxProvider {
  readonly name = 'mistral'
  private client: Mistral
  private model: string

  constructor() {
    const apiKey = process.env.MISTRAL_API_KEY
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY environment variable is required')
    }

    this.client = new Mistral({
      apiKey,
      serverURL: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
    })
    this.model = process.env.MISTRAL_CODE_INTERPRETER_MODEL || 'mistral-medium-latest'
  }

  async createSandbox(_config: SandboxCreateConfig): Promise<SandboxHandle> {
    const sandboxId = `mistral-${randomUUID()}`
    mistralSessions.set(sandboxId, {
      sandboxId,
      createdAt: Date.now(),
      lastActive: Date.now(),
    })
    return new MistralCodeInterpreterSandboxHandle(sandboxId, this.client, this.model)
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    let session = mistralSessions.get(sandboxId)
    if (!session) {
      // Session store persists sandbox IDs, but in-memory provider state is reset on dev
      // recompiles/restarts. Rehydrate a lightweight session so existing IDs remain usable.
      session = {
        sandboxId,
        createdAt: Date.now(),
        lastActive: Date.now(),
      }
      mistralSessions.set(sandboxId, session)
    }
    session.lastActive = Date.now()
    return new MistralCodeInterpreterSandboxHandle(sandboxId, this.client, this.model)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    mistralSessions.delete(sandboxId)
  }
}

class MistralCodeInterpreterSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR
  private client: Mistral
  private model: string

  constructor(sandboxId: string, client: Mistral, model: string) {
    this.id = sandboxId
    this.client = client
    this.model = model
  }

  async executeCommand(command: string, cwd?: string, _timeout?: number): Promise<ToolResult> {
    const session = mistralSessions.get(this.id)
    if (!session) {
      return { success: false, output: `Mistral session ${this.id} not found`, exitCode: 1 }
    }

    const prompt = this.buildCommandPrompt(command, cwd || this.workspaceDir)

    try {
      let response: any
      if (!session.conversationId) {
        response = await this.client.beta.conversations.start({
          model: this.model,
          tools: [{ type: 'code_interpreter' }],
          inputs: prompt,
        })
        session.conversationId = response.conversationId
      } else {
        response = await this.client.beta.conversations.append({
          conversationId: session.conversationId,
          conversationAppendRequest: { inputs: prompt },
        })
      }

      session.lastActive = Date.now()

      const outputText = extractConversationText(response)
      const parsed = parseExecutionEnvelope(outputText)

      if (parsed) {
        return parsed
      }

      return {
        success: true,
        output: outputText || '(no output)',
        exitCode: 0,
      }
    } catch (error: any) {
      return {
        success: false,
        output: error?.message || 'Mistral code interpreter execution failed',
        exitCode: 1,
      }
    }
  }

  async writeFile(_filePath: string, _content: string): Promise<ToolResult> {
    return {
      success: false,
      output: 'Mistral code interpreter provider does not support direct filesystem writes',
      exitCode: 1,
    }
  }

  async readFile(_filePath: string): Promise<ToolResult> {
    return {
      success: false,
      output: 'Mistral code interpreter provider does not support direct filesystem reads',
      exitCode: 1,
    }
  }

  async listDirectory(_dirPath: string): Promise<ToolResult> {
    return {
      success: false,
      output: 'Mistral code interpreter provider does not support directory listing',
      exitCode: 1,
    }
  }

  private buildCommandPrompt(command: string, cwd: string): string {
    return [
      'Run the following command in code interpreter and return ONLY JSON.',
      'Use a shell execution method from Python (subprocess).',
      `Working directory: ${cwd}`,
      'JSON schema: {"success": boolean, "exitCode": number, "output": string}',
      'No markdown fences, no explanations, no extra keys.',
      `COMMAND: ${command}`,
    ].join('\n')
  }
}

function extractConversationText(response: any): string {
  const outputs = Array.isArray(response?.outputs) ? response.outputs : []
  const chunks: string[] = []

  for (const entry of outputs) {
    if (entry?.type !== 'message.output') continue
    const content = entry?.content
    if (typeof content === 'string') {
      chunks.push(content)
      continue
    }
    if (Array.isArray(content)) {
      for (const chunk of content) {
        if (chunk && typeof chunk.text === 'string') {
          chunks.push(chunk.text)
        }
      }
    }
  }

  return chunks.join('\n').trim()
}

function parseExecutionEnvelope(text: string): ToolResult | null {
  if (!text) return null

  const candidates: string[] = []
  const fencedJson = text.match(/```json\s*([\s\S]*?)```/i)
  if (fencedJson?.[1]) candidates.push(fencedJson[1].trim())
  const plainJson = text.match(/\{[\s\S]*\}/)
  if (plainJson?.[0]) candidates.push(plainJson[0].trim())

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed !== 'object' || parsed === null) continue
      const success = Boolean((parsed as any).success)
      const exitCode = Number.isFinite((parsed as any).exitCode) ? Number((parsed as any).exitCode) : (success ? 0 : 1)
      const output = typeof (parsed as any).output === 'string' ? (parsed as any).output : JSON.stringify((parsed as any).output ?? '')
      return { success, exitCode, output }
    } catch {
      // Keep trying.
    }
  }

  return null
}
