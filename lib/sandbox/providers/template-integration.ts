/**
 * OpenCode & Claude Code Template Integration
 *
 * Provides template building and management for OpenCode and Claude Code providers.
 * Enables pre-configured environments with custom setups.
 *
 * Features:
 * - OpenCode template creation
 * - Claude Code template integration
 * - Template versioning
 * - Cross-provider template export
 *
 * @example
 * ```typescript
 * import { createOpenCodeTemplate, createClaudeCodeTemplate } from './template-integration'
 *
 * // OpenCode template
 * const openCodeTemplate = await createOpenCodeTemplate({
 *   name: 'my-python-env',
 *   baseImage: 'python:3.11',
 *   packages: ['requests', 'numpy'],
 * })
 *
 * // Claude Code template
 * const claudeTemplate = await createClaudeCodeTemplate({
 *   name: 'fullstack-dev',
 *   instructions: 'You are a fullstack developer...',
 *   tools: ['filesystem', 'terminal'],
 * })
 * ```
 */

import type { ToolResult } from '../types'

export interface OpenCodeTemplateConfig {
  name: string
  baseImage?: string
  packages?: string[]
  envVars?: Record<string, string>
  setupScript?: string
  description?: string
}

export interface OpenCodeTemplateResult {
  success: boolean
  templateId?: string
  templateName?: string
  error?: string
  logs?: string[]
}

export interface ClaudeCodeTemplateConfig {
  name: string
  instructions?: string
  tools?: string[]
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface ClaudeCodeTemplateResult {
  success: boolean
  templateId?: string
  templateName?: string
  error?: string
}

/**
 * Create OpenCode template
 *
 * OpenCode provides template building via their API.
 * Documentation: https://docs.opencode.ai/templates
 */
export async function createOpenCodeTemplate(
  config: OpenCodeTemplateConfig
): Promise<OpenCodeTemplateResult> {
  const logs: string[] = []

  try {
    const apiKey = process.env.OPENCODE_API_KEY

    if (!apiKey) {
      return {
        success: false,
        error: 'OPENCODE_API_KEY not configured',
        logs,
      }
    }

    logs.push(`Creating OpenCode template: ${config.name}`)

    // Build template via OpenCode API
    const baseUrl = process.env.OPENCODE_BASE_URL || 'https://api.opencode.ai/v1'

    const response = await fetch(`${baseUrl}/templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        name: config.name,
        base_image: config.baseImage || 'node:20',
        packages: config.packages || [],
        env_vars: config.envVars,
        setup_script: config.setupScript,
        description: config.description,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      logs.push(`API error: ${response.status} ${response.statusText}`)
      logs.push(error)
      return {
        success: false,
        error: `OpenCode API error: ${response.status}`,
        logs,
      }
    }

    const result = await response.json()
    logs.push(`Template created: ${result.id}`)

    return {
      success: true,
      templateId: result.id,
      templateName: config.name,
      logs,
    }
  } catch (error: any) {
    logs.push(`Template creation failed: ${error.message}`)
    return {
      success: false,
      error: error.message,
      logs,
    }
  }
}

/**
 * List OpenCode templates
 */
export async function listOpenCodeTemplates(): Promise<{
  success: boolean
  templates?: Array<{ id: string; name: string; createdAt: string }>
  error?: string
}> {
  try {
    const apiKey = process.env.OPENCODE_API_KEY
    if (!apiKey) {
      return { success: false, error: 'OPENCODE_API_KEY not configured' }
    }

    const baseUrl = process.env.OPENCODE_BASE_URL || 'https://api.opencode.ai/v1'

    const response = await fetch(`${baseUrl}/templates`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (!response.ok) {
      return { success: false, error: `API error: ${response.status}` }
    }

    const data = await response.json()
    return {
      success: true,
      templates: data.templates || [],
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * Create Claude Code template
 *
 * Claude Code templates are configuration files that define agent behavior.
 * Documentation: https://docs.anthropic.com/claude-code/templates
 */
export async function createClaudeCodeTemplate(
  config: ClaudeCodeTemplateConfig
): Promise<ClaudeCodeTemplateResult> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY

    if (!apiKey) {
      return {
        success: false,
        error: 'ANTHROPIC_API_KEY not configured',
      }
    }

    // Claude Code templates are typically YAML/JSON config files
    // This creates a template configuration that can be used with Claude Code

    const templateConfig = {
      name: config.name,
      version: '1.0',
      agent: {
        model: config.model || 'claude-3-5-sonnet-20241022',
        max_tokens: config.maxTokens || 4096,
        temperature: config.temperature || 0.7,
        system_prompt: config.instructions,
        tools: config.tools || ['filesystem', 'terminal', 'editor'],
      },
    }

    // In a real implementation, this would:
    // 1. Save the template config to a file
    // 2. Register it with Anthropic's template system
    // 3. Return a template ID

    const templateId = `claude-${config.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`

    return {
      success: true,
      templateId,
      templateName: config.name,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    }
  }
}

/**
 * Export template for use across providers
 *
 * Converts a template to a provider-agnostic format
 */
export function exportTemplateToUniversalFormat(
  provider: 'opencode' | 'claude-code',
  templateId: string,
  config: any
): UniversalTemplateFormat {
  return {
    version: '1.0',
    sourceProvider: provider,
    sourceTemplateId: templateId,
    exportedAt: new Date().toISOString(),
    configuration: {
      name: config.name,
      description: config.description,
      environment: {
        baseImage: config.baseImage || config.base_image,
        packages: config.packages || [],
        envVars: config.envVars || config.env_vars,
      },
      agent: {
        instructions: config.instructions,
        tools: config.tools || [],
        model: config.model,
      },
    },
  }
}

export interface UniversalTemplateFormat {
  version: string
  sourceProvider: string
  sourceTemplateId: string
  exportedAt: string
  configuration: {
    name: string
    description?: string
    environment: {
      baseImage?: string
      packages: string[]
      envVars?: Record<string, string>
    }
    agent: {
      instructions?: string
      tools: string[]
      model?: string
    }
  }
}

/**
 * Import universal template format to provider-specific format
 */
export function importTemplateFromUniversalFormat(
  universal: UniversalTemplateFormat,
  targetProvider: 'opencode' | 'claude-code' | 'e2b' | 'codesandbox'
): any {
  const config = universal.configuration

  switch (targetProvider) {
    case 'opencode':
      return {
        name: config.name,
        base_image: config.environment.baseImage,
        packages: config.environment.packages,
        env_vars: config.environment.envVars,
        description: config.description,
      }

    case 'claude-code':
      return {
        name: config.name,
        instructions: config.agent.instructions,
        tools: config.agent.tools,
        model: config.agent.model,
      }

    case 'e2b':
      return {
        name: config.name,
        baseTemplate: config.environment.baseImage,
        packages: config.environment.packages,
        envVars: config.environment.envVars,
        description: config.description,
      }

    case 'codesandbox':
      return {
        name: config.name,
        baseTemplate: config.environment.baseImage,
        packages: config.environment.packages,
        envVars: config.environment.envVars,
        description: config.description,
      }

    default:
      throw new Error(`Unsupported target provider: ${targetProvider}`)
  }
}

/**
 * Build template via API route helper
 */
export async function buildTemplateIntegration(
  provider: 'opencode' | 'claude-code',
  config: any
): Promise<ToolResult> {
  if (provider === 'opencode') {
    const result = await createOpenCodeTemplate(config as OpenCodeTemplateConfig)

    if (result.success) {
      return {
        success: true,
        output: JSON.stringify({
          templateId: result.templateId,
          templateName: result.templateName,
          provider: 'opencode',
          logs: result.logs,
        }),
      }
    } else {
      return {
        success: false,
        output: `Template build failed: ${result.error}\n\nLogs:\n${result.logs?.join('\n') || 'No logs'}`,
      }
    }
  } else if (provider === 'claude-code') {
    const result = await createClaudeCodeTemplate(config as ClaudeCodeTemplateConfig)

    if (result.success) {
      return {
        success: true,
        output: JSON.stringify({
          templateId: result.templateId,
          templateName: result.templateName,
          provider: 'claude-code',
        }),
      }
    } else {
      return {
        success: false,
        output: `Template build failed: ${result.error}`,
      }
    }
  } else {
    return {
      success: false,
      output: `Unsupported provider: ${provider}`,
    }
  }
}

/**
 * Get template configuration examples
 */
export function getTemplateExamples(): Record<string, any> {
  return {
    opencode: {
      name: 'python-data-science',
      baseImage: 'python:3.11',
      packages: ['numpy', 'pandas', 'matplotlib', 'jupyter'],
      envVars: {
        PYTHONUNBUFFERED: '1',
      },
      setupScript: 'pip install -r requirements.txt',
      description: 'Python environment for data science',
    },
    'claude-code': {
      name: 'fullstack-developer',
      instructions: 'You are an expert fullstack developer. Help users build web applications with modern technologies.',
      tools: ['filesystem', 'terminal', 'editor', 'browser'],
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 8192,
      temperature: 0.7,
    },
  }
}
