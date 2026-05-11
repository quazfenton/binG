/**
 * 9Router Provider Configuration
 * Defines OAuth flow types and UI labels for each provider
 */

export interface ProviderConfig {
  id: string
  name: string
  icon: string
  description: string
  oauthType: 'pkce' | 'device_code' | 'none'
  scopes?: string[]
  requiresRedirectUri: boolean
  color: string
}

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    icon: '/providers/claude.png',
    description: 'Anthropic Claude Code subscription',
    oauthType: 'pkce',
    scopes: ['profile', 'email'],
    requiresRedirectUri: true,
    color: '#ff6b6b'
  },
  'codex': {
    id: 'codex',
    name: 'OpenAI Codex',
    icon: '/providers/openai.png',
    description: 'OpenAI Codex subscription via OAuth proxy',
    oauthType: 'pkce',
    requiresRedirectUri: true,
    color: '#10a37f'
  },
  'cursor': {
    id: 'cursor',
    name: 'Cursor IDE',
    icon: '/providers/cursor.png',
    description: 'Cursor Pro subscription',
    oauthType: 'pkce',
    requiresRedirectUri: true,
    color: '#7c3aed'
  },
  'copilot': {
    id: 'copilot',
    name: 'GitHub Copilot',
    icon: '/providers/github.png',
    description: 'GitHub Copilot subscription',
    oauthType: 'pkce',
    requiresRedirectUri: true,
    color: '#6e5494'
  },
  'github': {
    id: 'github',
    name: 'GitHub',
    icon: '/providers/github.png',
    description: 'GitHub account for Copilot',
    oauthType: 'device_code',
    requiresRedirectUri: false,
    color: '#24292e'
  },
  'kiro': {
    id: 'kiro',
    name: 'Kiro AI',
    icon: '/providers/kiro.png',
    description: 'Free unlimited Claude 4.5 + GLM-5 + MiniMax',
    oauthType: 'device_code',
    requiresRedirectUri: false,
    color: '#3b82f6'
  },
  'gitlab': {
    id: 'gitlab',
    name: 'GitLab',
    icon: '/providers/gitlab.png',
    description: 'GitLab Duo (requires self-hosted)',
    oauthType: 'pkce',
    requiresRedirectUri: true,
    color: '#fc6d26'
  },
  'kimi-coding': {
    id: 'kimi-coding',
    name: 'Kimi Coding',
    icon: '/providers/kimi.png',
    description: 'Moonshot AI Kimi K2.5 subscription',
    oauthType: 'device_code',
    requiresRedirectUri: false,
    color: '#6366f1'
  },
  'kilocode': {
    id: 'kilocode',
    name: 'Kilo Code',
    icon: '/providers/kilocode.png',
    description: 'Kilo Code subscription',
    oauthType: 'device_code',
    requiresRedirectUri: false,
    color: '#0ea5e9'
  },
  'codebuddy': {
    id: 'codebuddy',
    name: 'CodeBuddy',
    icon: '/providers/codebuddy.png',
    description: 'CodeBuddy subscription',
    oauthType: 'device_code',
    requiresRedirectUri: false,
    color: '#f59e0b'
  },
  'cline': {
    id: 'cline',
    name: 'Cline',
    icon: '/providers/cline.png',
    description: 'Cline Pro subscription',
    oauthType: 'pkce',
    requiresRedirectUri: true,
    color: '#06b6d4'
  }
}

export function getProviderConfig(providerId: string): ProviderConfig | null {
  return PROVIDER_CONFIGS[providerId] || null
}

export function getAllProviders(): ProviderConfig[] {
  return Object.values(PROVIDER_CONFIGS)
}