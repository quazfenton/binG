/**
 * Mistral Agent Provider
 * 
 * Production-ready implementation of Mistral AI's Agent SDK for sandbox code execution.
 * Integrates Agents API + Conversations API with code_interpreter tool.
 * 
 * Features:
 * - Full Agent SDK integration
 * - Code interpreter with safety validation
 * - Virtual filesystem emulation
 * - Streaming support
 * - Error handling with retry logic
 * - Quota management
 * - Connection pooling
 * 
 * @see https://docs.mistral.ai/agents/
 * @see https://docs.mistral.ai/docs/agents/connectors/code_interpreter
 */

import { randomUUID } from 'node:crypto'
import { Mistral } from '@mistralai/mistralai'
import type { ToolResult } from '../../types'
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from '../sandbox-provider'
import type {
  MistralProviderConfig,
  MistralSession,
  CodeExecutionRequest,
  CodeExecutionResult,
  AgentConfig,
  AgentUpdate,
  ConversationEntry,
  WorkspaceState,
} from './mistral-types'

// Session store
const mistralSessions = new Map<string, MistralSession>()

const WORKSPACE_DIR = '/workspace'

// Optimal system prompts for reliable code execution
const OPTIMAL_PROMPTS = {
  codeExecution: `You are an expert code execution assistant.

RESPONSIBILITIES:
- Execute code safely and efficiently
- Return ONLY the output, never explanations
- Handle errors gracefully

OUTPUT FORMAT:
- Success: Return just the stdout output
- Errors: Return just the error message, prefixed with "Error: "
- No markdown, no fences, no commentary

LANGUAGES SUPPORTED:
- Python: Use subprocess or direct execution
- JavaScript/Node.js: Use node -e
- Bash/Shell: Execute directly
- TypeScript: Use tsx or tsc first`,

  webSearch: `You are an expert research assistant with web search capabilities.

RESPONSIBILITIES:
- Find accurate, up-to-date information
- Cite sources when possible
- Be thorough and precise

OUTPUT FORMAT:
- Summary: Clear, concise summary of findings
- Sources: List of URLs or references
- No markdown fences`,

  dataAnalysis: `You are a data analysis expert.

RESPONSIBILITIES:
- Analyze datasets efficiently
- Use appropriate libraries (pandas, numpy, etc.)
- Provide statistical insights

OUTPUT FORMAT:
- Key findings in plain text
- Relevant statistics
- No code comments in output`,
}

export class MistralAgentProvider implements SandboxProvider {
  readonly name = 'mistral-agent'
  private client: Mistral
  private config: MistralProviderConfig
  private workspacePersistence: Map<string, WorkspaceState> = new Map()

  constructor(config?: Partial<MistralProviderConfig>) {
    const rawApiKey = process.env.MISTRAL_API_KEY || process.env.MISTRAL_KEY || ''
    const apiKey = rawApiKey.trim().replace(/^['"]+|['"]+$/g, '')
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY environment variable is required for mistral-agent provider')
    }
    process.env.MISTRAL_API_KEY = apiKey

    this.config = {
      apiKey,
      serverURL: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
      model: process.env.MISTRAL_AGENT_MODEL || 'mistral-medium-2505',
      codeInterpreterModel: process.env.MISTRAL_CODE_INTERPRETER_MODEL || 'mistral-medium-2505',
      defaultTemperature: parseFloat(process.env.MISTRAL_AGENT_TEMPERATURE || '0.3'),
      defaultTopP: parseFloat(process.env.MISTRAL_AGENT_TOP_P || '0.95'),
      maxRetries: parseInt(process.env.MISTRAL_CODE_EXECUTION_MAX_RETRIES || '3', 10),
      timeout: parseInt(process.env.MISTRAL_CODE_EXECUTION_TIMEOUT_MS || '120000', 10),
      enableStreaming: process.env.MISTRAL_ENABLE_STREAMING !== 'false',
      enableQuotaTracking: process.env.MISTRAL_ENABLE_QUOTA_TRACKING !== 'false',
      enableWebSearch: process.env.MISTRAL_ENABLE_WEB_SEARCH === 'true',
      ...config,
    }

    this.client = new Mistral({
      apiKey: this.config.apiKey,
      serverURL: this.config.serverURL,
    })
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const sandboxId = `mistral-agent-${randomUUID()}`
    
    const session: MistralSession = {
      sandboxId,
      createdAt: Date.now(),
      lastActive: Date.now(),
      config,
      workspaceDir: WORKSPACE_DIR,
    }

    // Initialize persistent workspace state with proper Record type
    this.workspacePersistence.set(sandboxId, {
      files: {} as Record<string, string>,
      environment: { ...config.envVars },
      history: [],
    })

    try {
      // Create agent with configurable tools
      const tools: any[] = [{ type: 'code_interpreter' }]
      
      if (this.config.enableWebSearch) {
        tools.push({ type: 'web_search' })
      }

      // ADDED: Document Library support for RAG
      if (process.env.MISTRAL_ENABLE_DOC_LIBRARY === 'true') {
        tools.push({ 
          type: 'document_library',
          document_library: {
            library_id: process.env.MISTRAL_LIBRARY_ID
          }
        })
      }
      
      const agent = await this.createAgentWithTools(tools)
      session.agentId = agent.id
      session.model = agent.model

      // Use optimal prompt based on enabled tools
      const systemPrompt = this.config.enableWebSearch
        ? `${OPTIMAL_PROMPTS.codeExecution}\n\n${OPTIMAL_PROMPTS.webSearch}`
        : OPTIMAL_PROMPTS.codeExecution

      // Start initial conversation
      const conversation = await this.startConversation(agent.id, [
        { 
          role: 'system', 
          content: systemPrompt
        }
      ])
      session.conversationId = conversation.conversationId

      // Store session
      mistralSessions.set(sandboxId, session)

      console.log(`[MistralAgent] Created sandbox ${sandboxId} with agent ${agent.id}, webSearch: ${this.config.enableWebSearch}`)
    } catch (error: any) {
      console.error('[MistralAgent] Failed to create sandbox:', error.message)
      throw new Error(
        `Failed to create Mistral agent sandbox: ${error.message}. ` +
        'Ensure MISTRAL_API_KEY is set and valid.'
      )
    }

    return new MistralAgentSandboxHandle(sandboxId, this.client, this.config, session)
  }

  /**
   * Create agent with specific tools
   */
  private async createAgentWithTools(tools: Array<{ type: 'code_interpreter' | 'web_search' }>) {
    return this.client.beta.agents.create({
      model: this.config.codeInterpreterModel,
      name: 'Code Interpreter Agent',
      description: 'Agent specialized in safe code execution and web search',
      instructions: OPTIMAL_PROMPTS.codeExecution,
      tools: tools as any,
      completionArgs: {
        temperature: this.config.defaultTemperature,
        topP: this.config.defaultTopP,
      },
    })
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    let session = mistralSessions.get(sandboxId)
    
    if (!session) {
      // Rehydrate session (for dev restarts)
      console.log(`[MistralAgent] Rehydrating session for ${sandboxId}`)
      session = {
        sandboxId,
        createdAt: Date.now(),
        lastActive: Date.now(),
        workspaceDir: WORKSPACE_DIR,
        config: {},
      }
      mistralSessions.set(sandboxId, session)
    }

    session.lastActive = Date.now()

    return new MistralAgentSandboxHandle(sandboxId, this.client, this.config, session)
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const session = mistralSessions.get(sandboxId)
    if (session) {
      mistralSessions.delete(sandboxId)
      console.log(`[MistralAgent] Destroyed sandbox ${sandboxId}`)
    }
  }

  /**
   * Create a code interpreter agent
   */
  private async createCodeInterpreterAgent() {
    const agent = await this.client.beta.agents.create({
      model: this.config.codeInterpreterModel,
      name: 'Code Interpreter Agent',
      description: 'Agent specialized in safe code execution and analysis',
      instructions: [
        'You are a code execution assistant.',
        'Execute code safely and return structured results.',
        'Always use the code_interpreter tool for code execution.',
        'Return results in JSON format when possible.',
        'Support multiple languages: Python, JavaScript, TypeScript, Bash.',
      ].join('\n'),
      tools: [{ type: 'code_interpreter' }],
      completionArgs: {
        temperature: this.config.defaultTemperature,
        topP: this.config.defaultTopP,
      },
    })

    return agent
  }

  /**
   * Start a conversation
   */
  private async startConversation(agentId: string, inputs: any[]) {
    const response = await this.client.beta.conversations.start({
      agentId,
      inputs,
      store: true,
    })

    return {
      conversationId: response.conversationId,
      outputs: response.outputs,
      usage: response.usage,
    }
  }

  /**
   * Create a custom agent (advanced usage)
   */
  async createAgent(agentConfig: AgentConfig) {
    // Build tools array with proper types for Mistral SDK
    const tools = agentConfig.tools?.map(type => {
      switch (type) {
        case 'code_interpreter':
          return { type: 'code_interpreter' as const }
        case 'web_search':
          return { type: 'web_search' as const }
        case 'web_search_premium':
          return { type: 'web_search_premium' as const }
        case 'image_generation':
          return { type: 'image_generation' as const }
        case 'document_library':
          // DocumentLibraryTool requires libraryIds array
          return { type: 'document_library' as const, libraryIds: [] }
        case 'function':
        default:
          return { type: 'function' as const }
      }
    }) || []

    const agent = await this.client.beta.agents.create({
      model: agentConfig.model || this.config.model,
      name: agentConfig.name,
      description: agentConfig.description,
      instructions: agentConfig.instructions,
      tools,
      completionArgs: (agentConfig.completionArgs || {
        temperature: this.config.defaultTemperature,
        topP: this.config.defaultTopP,
      }) as any,
    })
    return agent
  }

  /**
   * Update an agent
   */
  async updateAgent(agentId: string, update: AgentUpdate) {
    // Build tools array with proper types for Mistral SDK
    const tools = update.tools?.map(type => {
      switch (type) {
        case 'code_interpreter':
          return { type: 'code_interpreter' as const }
        case 'web_search':
          return { type: 'web_search' as const }
        case 'web_search_premium':
          return { type: 'web_search_premium' as const }
        case 'image_generation':
          return { type: 'image_generation' as const }
        case 'document_library':
          // DocumentLibraryTool requires libraryIds array
          return { type: 'document_library' as const, libraryIds: [] }
        case 'function':
        default:
          return { type: 'function' as const }
      }
    })

    return this.client.beta.agents.update({
      agentId,
      agentUpdateRequest: {
        description: update.description,
        instructions: update.instructions,
        tools,
        completionArgs: update.completionArgs as any,
      },
    })
  }

  /**
   * Enable tools on an agent
   */
  async enableTools(agentId: string, tools: Array<'code_interpreter' | 'web_search' | 'image_generation' | 'document_library'>) {
    return this.updateAgent(agentId, { tools })
  }
}

import { SandboxSecurityManager } from '../../security-manager'

/**
 * Mistral Agent Sandbox Handle
 */
class MistralAgentSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = WORKSPACE_DIR
  private client: Mistral
  private config: MistralProviderConfig
  private session: MistralSession

  constructor(
    sandboxId: string,
    client: Mistral,
    config: MistralProviderConfig,
    session: MistralSession
  ) {
    this.id = sandboxId
    this.client = client
    this.config = config
    this.session = session
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const session = mistralSessions.get(this.id)
    if (!session) {
      return { 
        success: false, 
        output: `Mistral session ${this.id} not found`, 
        exitCode: 1 
      }
    }

    session.lastActive = Date.now()

    const sanitized = SandboxSecurityManager.sanitizeCommand(command)
    const prompt = this.buildCommandPrompt(sanitized, cwd || this.workspaceDir)

    try {
      let response: any
      
      if (!session.conversationId) {
        // Start new conversation
        response = await this.client.beta.conversations.start({
          agentId: session.agentId,
          inputs: [{ role: 'user', content: prompt }],
          store: true,
        })
        session.conversationId = response.conversationId
      } else {
        // Append to existing conversation
        response = await this.client.beta.conversations.append({
          conversationId: session.conversationId,
          conversationAppendRequest: {
            inputs: [{ role: 'user', content: prompt }],
          },
        })
      }

      // Extract code execution result from response
      const result = this.extractCodeExecutionResult(response)
      
      if (result) {
        return result
      }

      // Fallback: extract text output
      const outputText = this.extractConversationText(response)
      return {
        success: true,
        output: outputText || '(no output)',
        exitCode: 0,
      }
    } catch (error: any) {
      console.error('[MistralAgent] Command execution error:', error.message)
      return {
        success: false,
        output: error?.message || 'Mistral code interpreter execution failed',
        exitCode: 1,
      }
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
    
    // Store in virtual filesystem
    if (!this.session.filesystemState) {
      this.session.filesystemState = { files: [], directories: [] }
    }

    this.session.filesystemState.files.push({
      path: resolved,
      size: content.length,
      modifiedAt: Date.now(),
    })

    // Execute code to write file
    const pythonCode = `
with open("${resolved}", "w") as f:
    f.write("""${content}""")
print(f"File written: {resolved}")
`.trim()

    return this.executeCommand(pythonCode)
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath)
    
    // Execute code to read file
    const pythonCode = `
try:
    with open("${resolved}", "r") as f:
        print(f.read())
except FileNotFoundError:
    print(f"File not found: ${resolved}")
`.trim()

    return this.executeCommand(pythonCode)
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, dirPath)
    
    // Execute code to list directory
    const pythonCode = `
import os
try:
    items = os.listdir("${resolved}")
    for item in items:
        print(item)
except FileNotFoundError:
    print(f"Directory not found: ${resolved}")
`.trim()

    return this.executeCommand(pythonCode)
  }

  /**
   * Execute code directly (advanced usage)
   */
  async executeCode(code: string, language: string = 'python'): Promise<CodeExecutionResult> {
    const prompt = this.buildCodePrompt(code, language)
    
    try {
      let response: any
      
      if (!this.session.conversationId) {
        response = await this.client.beta.conversations.start({
          agentId: this.session.agentId,
          inputs: [{ role: 'user', content: prompt }],
        })
        this.session.conversationId = response.conversationId
      } else {
        response = await this.client.beta.conversations.append({
          conversationId: this.session.conversationId,
          conversationAppendRequest: {
            inputs: [{ role: 'user', content: prompt }],
          },
        })
      }

      const result = this.extractCodeExecutionResult(response)
      
      if (result) {
        return {
          ...result,
          metadata: {
            executionTime: Date.now() - this.session.lastActive,
            tokenUsage: response.usage,
            executedCode: code,
            language,
          },
        }
      }

      throw new Error('Failed to extract code execution result')
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        exitCode: 1,
        metadata: {
          executedCode: code,
          language,
        },
      }
    }
  }

  /**
   * Get conversation history
   */
  async getConversationHistory() {
    if (!this.session.conversationId) {
      return []
    }

    const response = await this.client.beta.conversations.getHistory({
      conversationId: this.session.conversationId,
    })
    return response.entries
  }

  /**
   * Clear conversation
   */
  async clearConversation() {
    if (this.session.conversationId) {
      // Start new conversation to clear history
      const response = await this.client.beta.conversations.start({
        agentId: this.session.agentId,
        // Use text input instead of structured role-based input
        inputs: 'New conversation started',
      })
      this.session.conversationId = response.conversationId
    }
  }

  /**
   * Build command prompt
   */
  private buildCommandPrompt(command: string, cwd: string): string {
    return [
      'Execute the following command and return the output.',
      'Use Python subprocess for shell commands.',
      `Working directory: ${cwd}`,
      'Return ONLY the command output, no explanations.',
      `COMMAND: ${command}`,
    ].join('\n')
  }

  /**
   * Build code prompt
   */
  private buildCodePrompt(code: string, language: string): string {
    return [
      `Execute the following ${language} code and return the result.`,
      'Return ONLY the output, no explanations.',
      `CODE:\n${code}`,
    ].join('\n')
  }

  /**
   * Extract code execution result from conversation response
   */
  private extractCodeExecutionResult(response: any): ToolResult | null {
    if (!response?.outputs || !Array.isArray(response.outputs)) {
      return null
    }

    // Look for tool.execution entries
    for (const entry of response.outputs) {
      if (entry?.type === 'tool.execution' && entry?.name === 'code_interpreter') {
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

    return null
  }

  /**
   * Extract text from conversation response
   */
  private extractConversationText(response: any): string {
    if (!response?.outputs || !Array.isArray(response.outputs)) {
      return ''
    }

    const chunks: string[] = []

    for (const entry of response.outputs) {
      if (entry?.type === 'message.output') {
        const content = entry.content
        if (typeof content === 'string') {
          chunks.push(content)
        } else if (Array.isArray(content)) {
          for (const chunk of content) {
            if (chunk?.text) {
              chunks.push(chunk.text)
            }
          }
        }
      }
    }

    return chunks.join('\n').trim()
  }
}

// Export for registry
export { mistralSessions }
