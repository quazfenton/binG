/**
 * 9Router Integration Client
 * 
 * Provides seamless OAuth integration with 9Router for your chat app.
 * Handles OAuth flows and manages per-user provider credentials.
 * 
 * Multi-tenancy: Pass userId in constructor or via setUserId() to have
 * all API calls include the x-user-id header for user-scoped data access.
 */

import { RouterConfig, OAuthStartResult, OAuthCompleteResult, ChatRequest, ChatResponse, OAuthProvider } from './types'
import { encodeBase64URL } from './oauth-utils'

export class RouterClient {
  private baseUrl: string
  private adminKey: string
  private userId: string | null = null
  private timeoutMs: number = 30000 // Default 30s timeout for API calls
  private streamTimeoutMs: number = 120000 // Default 120s timeout for streaming

  constructor(config: RouterConfig, timeoutMs?: number) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.adminKey = config.adminKey
    if (timeoutMs) {
      this.timeoutMs = timeoutMs
    }
  }

  /**
   * Set the request timeout for non-streaming API calls
   */
  setTimeout(ms: number): void {
    this.timeoutMs = ms
  }

  /**
   * Set the timeout for streaming requests (default: 120s)
   */
  setStreamTimeout(ms: number): void {
    this.streamTimeoutMs = ms
  }

  /**
   * Set the user ID for multi-tenant API calls.
   * When set, all subsequent API requests will include the x-user-id header.
   */
  setUserId(userId: string): void {
    this.userId = userId
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    return this.userId
  }

  /**
   * Get admin configuration for internal use (refresh service, etc.)
   * Returns baseUrl and adminKey without exposing them publicly
   */
  getAdminConfig(): { baseUrl: string; adminKey: string } {
    return {
      baseUrl: this.baseUrl,
      adminKey: this.adminKey,
    }
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.adminKey}`,
      ...(options.headers as Record<string, string>),
    }

    // Add userId header for multi-tenancy if set
    if (this.userId) {
      headers['x-user-id'] = this.userId
    }

    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`9Router API error ${response.status}: ${error}`)
    }

    return response.json()
  }

  /**
   * Start OAuth flow for a provider
   * Returns auth URL for popup-based OAuth or device code for CLI-style flow
   */
  async startOAuth(provider: OAuthProvider, redirectUri?: string): Promise<OAuthStartResult> {
    // Determine flow type based on provider
    const deviceCodeProviders = ['github', 'kiro', 'kimi-coding', 'kilocode', 'codebuddy']
    const usesDeviceCode = deviceCodeProviders.includes(provider)

    if (usesDeviceCode) {
      return this.startDeviceCodeFlow(provider)
    }

    return this.startAuthorizationCodeFlow(provider, redirectUri)
  }

  /**
   * Authorization Code flow (PKCE) - for Claude Code, Codex, Cursor, Copilot
   */
  private async startAuthorizationCodeFlow(provider: OAuthProvider, redirectUri?: string): Promise<OAuthStartResult> {
    const callbackUrl = redirectUri || `${typeof window !== 'undefined' ? window.location.origin : ''}/api/9router/callback`
    
    const authData = await this.request<{ authUrl: string, codeVerifier: string, state: string }>(
      `/api/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(callbackUrl)}`
    )

    return {
      authUrl: authData.authUrl,
      codeVerifier: authData.codeVerifier,
      state: authData.state,
      provider
    }
  }

  /**
   * Device Code flow - for GitHub, Kiro, etc.
   */
  private async startDeviceCodeFlow(provider: OAuthProvider): Promise<OAuthStartResult> {
    const deviceData = await this.request<{
      deviceCode: string
      userCode: string
      verificationUri: string
      pollInterval: number
      codeVerifier?: string
    }>(`/api/oauth/${provider}/device-code`)

    return {
      deviceCode: deviceData.deviceCode,
      userCode: deviceData.userCode,
      verificationUri: deviceData.verificationUri,
      pollInterval: deviceData.pollInterval,
      codeVerifier: deviceData.codeVerifier,
      provider
    }
  }

  /**
   * Poll for device code completion
   */
  async pollDeviceCode(provider: OAuthProvider, deviceCode: string, codeVerifier?: string): Promise<OAuthCompleteResult> {
    const result = await this.request<{
      success: boolean
      error?: string
      pending?: boolean
      connection?: { id: string; provider: string }
    }>(`/api/oauth/${provider}/poll`, {
      method: 'POST',
      body: JSON.stringify({ deviceCode, codeVerifier })
    })

    if (result.success && result.connection) {
      return {
        success: true,
        connection: await this.getConnection(result.connection.id)
      }
    }

    return {
      success: false,
      error: result.error || 'pending'
    }
  }

  /**
   * Complete OAuth by exchanging authorization code for tokens
   */
  async completeOAuth(provider: OAuthProvider, code: string, redirectUri: string, codeVerifier?: string): Promise<OAuthCompleteResult> {
    const result = await this.request<{
      success: boolean
      connection?: { id: string; provider: string; email?: string; displayName?: string }
      error?: string
    }>(`/api/oauth/${provider}/exchange`, {
      method: 'POST',
      body: JSON.stringify({
        code,
        redirectUri,
        codeVerifier
      })
    })

    if (result.success && result.connection) {
      return {
        success: true,
        connection: await this.getConnection(result.connection.id)
      }
    }

    return {
      success: false,
      error: result.error
    }
  }

  /**
   * Get connection details by ID
   */
  async getConnection(connectionId: string): Promise<any> {
    return this.request(`/api/providers/${connectionId}`)
  }

  /**
   * List all available providers (connections) for the current user
   */
  async listConnections(): Promise<any[]> {
    const result = await this.request<{ connections: any[] }>('/api/providers')
    return result.connections
  }

  /**
   * Delete a provider connection
   */
  async deleteConnection(connectionId: string): Promise<void> {
    await this.request(`/api/providers/${connectionId}`, { method: 'DELETE' })
  }

  /**
   * Create API key for a user
   */
  async createApiKey(name: string, userId?: string): Promise<{ key: string; id: string }> {
    return this.request('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ 
        name: `${name}${userId ? ` (${userId})` : ''}`,
        userId: userId || this.userId
      })
    })
  }

  /**
   * Forward chat request to 9Router /v1 endpoint
   * Uses the user's API key to route to their providers
   */
  async chat(userApiKey: string, request: ChatRequest): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userApiKey}`
    }

    // Add userId header for multi-tenancy if set
    if (this.userId) {
      headers['x-user-id'] = this.userId
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.streamTimeoutMs),
    })

    return response
  }

  /**
   * Stream chat request
   */
  async *streamChat(userApiKey: string, request: ChatRequest): AsyncGenerator<string, void, unknown> {
    const response = await this.chat(userApiKey, { ...request, stream: true })
    
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Chat error: ${response.status} - ${error}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') return
          yield data
        }
      }
    }
  }

  /**
   * Get available models
   */
  async listModels(userApiKey: string): Promise<any> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${userApiKey}`
    }

    // Add userId header for multi-tenancy if set
    if (this.userId) {
      headers['x-user-id'] = this.userId
    }

    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    return response.json()
  }
}

// Singleton instance for convenience
let globalClient: RouterClient | null = null

export function getRouterClient(config?: RouterConfig): RouterClient {
  if (!config) {
    if (!globalClient) {
      throw new Error('RouterClient not initialized. Call getRouterClient(config) first.')
    }
    return globalClient
  }
  
  globalClient = new RouterClient(config)
  return globalClient
}

/**
 * Create a RouterClient with multi-tenancy support.
 * The userId will be included in all API calls as the x-user-id header.
 */
export function createRouterClient(config: RouterConfig, userId: string): RouterClient {
  const client = new RouterClient(config)
  client.setUserId(userId)
  return client
}