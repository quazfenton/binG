/**
 * Daytona LSP (Language Server Protocol) Service
 * 
 * Provides IDE-like code intelligence for multiple languages.
 * 
 * Features:
 * - Code completions
 * - Document symbols
 * - Sandbox-wide symbols
 * - File notifications
 * - Multiple language support
 * 
 * @see https://www.daytona.io/docs/en/language-server-protocol/
 */

export interface LSPServerConfig {
  language: LSPLanguageId
  args?: string[]
  env?: Record<string, string>
}

export interface LSPCompletionRequest {
  file: string
  line: number
  column: number
}

export interface LSPCompletionItem {
  label: string
  kind: number
  detail?: string
  documentation?: string
  sortText?: string
  filterText?: string
  insertText?: string
}

export interface LSPDocumentSymbolsRequest {
  file: string
}

export interface LSPSymbol {
  name: string
  kind: number
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  children?: LSPSymbol[]
}

export interface LSPSandboxSymbolsRequest {
  query: string
  limit?: number
}

export type LSPLanguageId = 
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'cpp'
  | 'c'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'scala'
  | 'elixir'
  | 'haskell'
  | 'lua'
  | 'r'
  | 'sql'
  | 'html'
  | 'css'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'shellscript'

/**
 * LSP Service for Daytona sandboxes
 */
export class LSPService {
  private sandboxId: string
  private apiBaseUrl: string
  private apiKey: string
  private activeServers = new Map<LSPLanguageId, LSPServerInfo>()

  constructor(sandboxId: string, apiKey: string, apiBaseUrl: string = 'https://app.daytona.io/api') {
    this.sandboxId = sandboxId
    this.apiKey = apiKey
    this.apiBaseUrl = apiBaseUrl
  }

  /**
   * Create LSP server for a language
   */
  async create(config: LSPServerConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/lsp`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to create LSP server: ${response.statusText}`)
      }

      this.activeServers.set(config.language, {
        language: config.language,
        status: 'running',
        createdAt: new Date().toISOString(),
      })

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Start LSP server
   */
  async start(language: LSPLanguageId): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/lsp/${language}/start`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to start LSP server: ${response.statusText}`)
      }

      const server = this.activeServers.get(language)
      if (server) {
        server.status = 'running'
        this.activeServers.set(language, server)
      }

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Stop LSP server
   */
  async stop(language: LSPLanguageId): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/lsp/${language}/stop`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to stop LSP server: ${response.statusText}`)
      }

      const server = this.activeServers.get(language)
      if (server) {
        server.status = 'stopped'
        this.activeServers.set(language, server)
      }

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Get code completions
   */
  async completions(request: LSPCompletionRequest): Promise<{
    success: boolean
    items?: LSPCompletionItem[]
    error?: string
  }> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/lsp/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to get completions: ${response.statusText}`)
      }

      const data = await response.json()
      return { success: true, items: data.items || [] }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Get document symbols
   */
  async documentSymbols(request: LSPDocumentSymbolsRequest): Promise<{
    success: boolean
    symbols?: LSPSymbol[]
    error?: string
  }> {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/lsp/symbols`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to get document symbols: ${response.statusText}`)
      }

      const data = await response.json()
      return { success: true, symbols: data.symbols || [] }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Get sandbox-wide symbols
   */
  async sandboxSymbols(request: LSPSandboxSymbolsRequest): Promise<{
    success: boolean
    symbols?: LSPSymbol[]
    error?: string
  }> {
    try {
      const params = new URLSearchParams({
        query: request.query,
        ...(request.limit ? { limit: request.limit.toString() } : {}),
      })

      const response = await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/lsp/sandbox-symbols?${params}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to get sandbox symbols: ${response.statusText}`)
      }

      const data = await response.json()
      return { success: true, symbols: data.symbols || [] }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Send file open notification
   */
  async fileDidOpen(file: string, text: string): Promise<{ success: boolean; error?: string }> {
    try {
      await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/lsp/notify/didOpen`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ file, text }),
        }
      )

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Send file close notification
   */
  async fileDidClose(file: string): Promise<{ success: boolean; error?: string }> {
    try {
      await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/lsp/notify/didClose`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ file }),
        }
      )

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Send file change notification
   */
  async fileDidChange(file: string, changes: Array<{
    range: {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    text: string
  }>): Promise<{ success: boolean; error?: string }> {
    try {
      await fetch(
        `${this.apiBaseUrl}/sandboxes/${this.sandboxId}/lsp/notify/didChange`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ file, changes }),
        }
      )

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * Get active LSP servers
   */
  getActiveServers(): Map<LSPLanguageId, LSPServerInfo> {
    return new Map(this.activeServers)
  }

  /**
   * Check if LSP server is running
   */
  isServerRunning(language: LSPLanguageId): boolean {
    const server = this.activeServers.get(language)
    return server?.status === 'running'
  }
}

export interface LSPServerInfo {
  language: LSPLanguageId
  status: 'running' | 'stopped' | 'error'
  createdAt: string
  lastActivity?: string
}

/**
 * Factory function to create LSP service
 */
export function createLSPService(
  sandboxId: string,
  apiKey: string,
  apiBaseUrl?: string
): LSPService {
  return new LSPService(sandboxId, apiKey, apiBaseUrl)
}
