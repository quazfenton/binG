// 9Router Integration Types

export interface RouterConfig {
  baseUrl: string
  adminKey: string
}

export interface OAuthStartResult {
  authUrl?: string
  deviceCode?: string
  userCode?: string
  verificationUri?: string
  pollInterval?: number
  codeVerifier?: string
  state?: string
  provider: string
}

export interface OAuthCompleteResult {
  success: boolean
  connection?: ProviderConnection
  error?: string
}

export interface ProviderConnection {
  id: string
  provider: string
  email?: string
  displayName?: string
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  expiresIn?: number
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  maxTokens?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'developer'
  content: string | ContentPart[]
}

export interface ContentPart {
  type: 'text' | 'image'
  text?: string
  source?: {
    type: 'base64' | 'url'
    mediaType?: string
    data?: string
    url?: string
  }
}

export interface ChatResponse {
  id: string
  model: string
  choices: Choice[]
  usage?: Usage
}

export interface Choice {
  index: number
  message: ChatMessage
  finishReason: string
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type OAuthProvider = 
  | 'claude-code' 
  | 'codex' 
  | 'cursor' 
  | 'copilot'
  | 'github'
  | 'kiro'
  | 'gitlab'
  | 'iflow'
  | 'kimi-coding'
  | 'kilocode'
  | 'codebuddy'
  | 'cline'

export interface UserProviderCredentials {
  id: string
  userId: string
  provider: string
  connectionId: string // 9Router's connection ID
  email?: string
  displayName?: string
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  createdAt: string
  updatedAt: string
}