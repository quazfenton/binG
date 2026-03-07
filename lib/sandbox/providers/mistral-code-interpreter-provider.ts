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
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes for conversation context
const MAX_CONVERSATION_AGE_MS = 30 * 60 * 1000 // Reset conversation after 30 min of inactivity

// File-based persistence for conversation IDs (survives server restarts)
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const MISTRAL_SESSIONS_DIR = process.env.SESSIONS_DIR || '/tmp/mistral-sessions'

async function ensureSessionsDir(): Promise<void> {
  if (!existsSync(MISTRAL_SESSIONS_DIR)) {
    await mkdir(MISTRAL_SESSIONS_DIR, { recursive: true })
  }
}

async function saveMistralSession(sandboxId: string, session: MistralSession): Promise<void> {
  try {
    await ensureSessionsDir()
    const filePath = join(MISTRAL_SESSIONS_DIR, `${sandboxId}.json`)
    await writeFile(filePath, JSON.stringify(session), 'utf-8')
  } catch (error) {
    console.warn('[Mistral] Failed to save session:', error)
  }
}

async function loadMistralSession(sandboxId: string): Promise<MistralSession | null> {
  try {
    const filePath = join(MISTRAL_SESSIONS_DIR, `${sandboxId}.json`)
    if (!existsSync(filePath)) return null
    
    const content = await readFile(filePath, 'utf-8')
    const session = JSON.parse(content) as MistralSession
    
    // Check if session is still valid (not expired)
    if (Date.now() - session.lastActive > MAX_CONVERSATION_AGE_MS) {
      return null // Conversation too old, start fresh
    }
    
    return session
  } catch {
    return null
  }
}

async function deleteMistralSession(sandboxId: string): Promise<void> {
  try {
    const filePath = join(MISTRAL_SESSIONS_DIR, `${sandboxId}.json`)
    const { unlink } = await import('node:fs/promises')
    await unlink(filePath)
  } catch {
    // Best-effort deletion
  }
}

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
    const session: MistralSession = {
      sandboxId,
      createdAt: Date.now(),
      lastActive: Date.now(),
    }
    mistralSessions.set(sandboxId, session)
    await saveMistralSession(sandboxId, session)
    return new MistralCodeInterpreterSandboxHandle(sandboxId, this.client, this.model)
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    let session = mistralSessions.get(sandboxId)
    
    if (!session) {
      // Try loading from file-based persistence
      const persisted = await loadMistralSession(sandboxId)
      if (persisted) {
        session = persisted
        mistralSessions.set(sandboxId, session)
      }
    }
    
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
    
    // Check if conversation is too old
    if (session.conversationId && Date.now() - session.lastActive > MAX_CONVERSATION_AGE_MS) {
      session.conversationId = undefined // Start fresh conversation
    }
    
    session.lastActive = Date.now()
    await saveMistralSession(sandboxId, session)
    return new MistralCodeInterpreterSandboxHandle(sandboxId, this.client, this.model)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    mistralSessions.delete(sandboxId)
    await deleteMistralSession(sandboxId)
  }
}

class MistralCodeInterpreterSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR
  private client: Mistral
  private model: string
  private fileCache = new Map<string, string>()

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
        await saveMistralSession(this.id, session)
      } else {
        response = await this.client.beta.conversations.append({
          conversationId: session.conversationId,
          conversationAppendRequest: { inputs: prompt },
        })
      }

    session.lastActive = Date.now()
    await saveMistralSession(this.id, session)

      const outputText = extractConversationText(response)
      const parsed = parseExecutionEnvelope(outputText)

      if (parsed) {
        // Validate success as boolean, default to false if invalid
        const isValidSuccess = typeof parsed.success === 'boolean' && parsed.success === true;
        return {
          success: isValidSuccess,
          output: parsed.output || outputText || '(no output)',
          exitCode: isValidSuccess ? 0 : (parsed.exitCode ?? 1),
        }
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

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(filePath)
    this.fileCache.set(resolvedPath, content)
    
    const escapedContent = content.replace(/'/g, "'\\''").replace(/\n/g, '\\n')
    const command = `mkdir -p "$(dirname '${resolvedPath}')" && echo -n '${escapedContent}' > '${resolvedPath}'`
    
    return this.executeCommand(command)
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(filePath)
    
    if (this.fileCache.has(resolvedPath)) {
      return {
        success: true,
        output: this.fileCache.get(resolvedPath) || '',
        exitCode: 0,
      }
    }
    
    return this.executeCommand(`cat '${resolvedPath}' 2>&1`)
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(dirPath || '.')
    return this.executeCommand(`ls -la '${resolvedPath}' 2>&1`)
  }

  private resolvePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/')
    if (normalized.startsWith('/')) {
      return normalized.startsWith(WORKSPACE_DIR) ? normalized : `${WORKSPACE_DIR}/${normalized.replace(/^\/+/, '')}`
    }
    return `${WORKSPACE_DIR}/${normalized}`
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
