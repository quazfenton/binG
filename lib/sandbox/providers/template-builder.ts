/**
 * Sandbox Template Builder
 *
 * Build and manage custom sandbox templates for E2B and CodeSandbox providers.
 * Templates allow pre-configured environments with installed packages, reducing
 * sandbox creation time.
 *
 * Features:
 * - Build templates from base images
 * - Install packages during build
 * - Version control for templates
 * - Cross-provider template support
 *
 * @example
 * ```typescript
 * import { createTemplateBuilder } from './template-builder'
 *
 * const builder = createTemplateBuilder({ provider: 'e2b' })
 *
 * const template = await builder.build({
 *   name: 'my-python-template',
 *   baseTemplate: 'python-base',
 *   packages: ['requests', 'numpy', 'pandas'],
 *   setupScript: 'pip install -r requirements.txt',
 * })
 *
 * console.log(`Template built: ${template.id}`)
 * ```
 */

import type { ToolResult } from '../types'

export interface TemplateBuildConfig {
  name: string
  baseTemplate?: string
  packages?: string[]
  setupScript?: string
  envVars?: Record<string, string>
  description?: string
  version?: string
  isPublic?: boolean
}

export interface GenericTemplateBuildResult {
  success: boolean
  templateId?: string
  templateName?: string
  provider?: string
  duration?: number
  error?: string
  logs?: string[]
}

// Alias for backwards compatibility
export type TemplateBuildResult = GenericTemplateBuildResult;

export interface TemplateInfo {
  id: string
  name: string
  provider: string
  baseTemplate?: string
  packages?: string[]
  createdAt?: string
  updatedAt?: string
  isPublic: boolean
  version?: string
}

export interface TemplateBuilder {
  /**
   * Build a new template
   */
  build(config: TemplateBuildConfig): Promise<TemplateBuildResult>

  /**
   * List available templates
   */
  listTemplates(): Promise<TemplateInfo[]>

  /**
   * Get template details
   */
  getTemplate(templateId: string): Promise<TemplateInfo | null>

  /**
   * Delete a template
   */
  deleteTemplate(templateId: string): Promise<boolean>

  /**
   * Check if template building is available
   */
  isAvailable(): boolean
}

class E2BTemplateBuilder implements TemplateBuilder {
  private client: any = null
  private apiKey?: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.E2B_API_KEY
  }

  private async ensureClient(): Promise<any> {
    if (this.client) return this.client

    try {
      // @ts-ignore - Optional package
      const { Template } = await import('e2b')
      this.client = Template
      return this.client
    } catch (error: any) {
      throw new Error(
        `E2B SDK not available. Install with: npm install e2b. Error: ${error.message}`
      )
    }
  }

  async build(config: TemplateBuildConfig): Promise<TemplateBuildResult> {
    const startTime = Date.now()
    const logs: string[] = []

    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'E2B_API_KEY not configured',
          logs,
        }
      }

      const Template = await this.ensureClient()

      // Build template
      logs.push(`Building template: ${config.name}`)
      logs.push(`Base template: ${config.baseTemplate || 'default'}`)

      if (config.packages && config.packages.length > 0) {
        logs.push(`Installing packages: ${config.packages.join(', ')}`)
      }

      // E2B template building via SDK
      const template = await Template.build(
        config.name,
        config.baseTemplate || 'base',
        {
          cpuCount: 2,
          memoryMB: 2048,
          envVars: config.envVars,
        }
      )

      logs.push(`Template built successfully: ${template.id}`)

      return {
        success: true,
        templateId: template.id,
        templateName: config.name,
        provider: 'e2b',
        duration: Date.now() - startTime,
        logs,
      }
    } catch (error: any) {
      logs.push(`Build failed: ${error.message}`)
      return {
        success: false,
        error: error.message,
        logs,
      }
    }
  }

  async listTemplates(): Promise<TemplateInfo[]> {
    try {
      if (!this.apiKey) return []

      const Template = await this.ensureClient()
      const templates = await Template.list()

      return templates.map((t: any) => ({
        id: t.templateID,
        name: t.templateName,
        provider: 'e2b',
        isPublic: t.isPublic || false,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }))
    } catch {
      return []
    }
  }

  async getTemplate(templateId: string): Promise<TemplateInfo | null> {
    try {
      const templates = await this.listTemplates()
      return templates.find(t => t.id === templateId) || null
    } catch {
      return null
    }
  }

  async deleteTemplate(templateId: string): Promise<boolean> {
    try {
      if (!this.apiKey) return false

      const Template = await this.ensureClient()
      await Template.delete(templateId)
      return true
    } catch {
      return false
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }
}

class CodeSandboxTemplateBuilder implements TemplateBuilder {
  private apiKey?: string
  private sdkModule?: any

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.CSB_API_KEY
  }

  private async ensureModule(): Promise<any> {
    if (this.sdkModule) return this.sdkModule

    try {
      const mod = await import('@codesandbox/sdk')
      this.sdkModule = mod
      return mod
    } catch (error: any) {
      throw new Error(
        `CodeSandbox SDK not available. Install with: npm install @codesandbox/sdk. Error: ${error.message}`
      )
    }
  }

  async build(config: TemplateBuildConfig): Promise<TemplateBuildResult> {
    const startTime = Date.now()
    const logs: string[] = []

    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'CSB_API_KEY not configured',
          logs,
        }
      }

      const { CodeSandbox } = await this.ensureModule()
      const sdk = new CodeSandbox(this.apiKey)

      logs.push(`Building template: ${config.name}`)

      // Create sandbox from base
      const sandbox = await sdk.sandboxes.create({
        template: config.baseTemplate || 'node',
        title: config.name,
        description: config.description,
        privacy: config.isPublic ? 'public' : 'private',
      })

      logs.push(`Sandbox created: ${sandbox.id}`)

      // Install packages
      if (config.packages && config.packages.length > 0) {
        logs.push(`Installing packages...`)
        await sandbox.fs.mkdir('/app', true)
        
        // Write package.json
        const packageJson = {
          name: config.name,
          version: config.version || '1.0.0',
          dependencies: config.packages.reduce((acc, pkg) => ({ ...acc, [pkg]: 'latest' }), {}),
        }
        await sandbox.fs.writeFile('/app/package.json', JSON.stringify(packageJson, null, 2))

        // Run install
        await sandbox.commands.run('npm install', { cwd: '/app' })
        logs.push(`Packages installed: ${config.packages.join(', ')}`)
      }

      // Run setup script
      if (config.setupScript) {
        logs.push(`Running setup script...`)
        await sandbox.commands.run(config.setupScript, { cwd: '/app' })
      }

      // Create template from sandbox
      const template = await sandbox.exportTemplate({
        name: config.name,
        description: config.description,
      })

      logs.push(`Template created: ${template.id}`)

      return {
        success: true,
        templateId: template.id,
        templateName: config.name,
        provider: 'codesandbox',
        duration: Date.now() - startTime,
        logs,
      }
    } catch (error: any) {
      logs.push(`Build failed: ${error.message}`)
      return {
        success: false,
        error: error.message,
        logs,
      }
    }
  }

  async listTemplates(): Promise<TemplateInfo[]> {
    try {
      if (!this.apiKey) return []

      const { CodeSandbox } = await this.ensureModule()
      const sdk = new CodeSandbox(this.apiKey)

      // CodeSandbox doesn't have direct template listing
      // Return empty or implement via API calls
      return []
    } catch {
      return []
    }
  }

  async getTemplate(templateId: string): Promise<TemplateInfo | null> {
    try {
      const templates = await this.listTemplates()
      return templates.find(t => t.id === templateId) || null
    } catch {
      return null
    }
  }

  async deleteTemplate(templateId: string): Promise<boolean> {
    // CodeSandbox doesn't support template deletion via SDK
    return false
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }
}

/**
 * Create template builder for specified provider
 */
export function createTemplateBuilder(options: {
  provider: 'e2b' | 'codesandbox'
  apiKey?: string
}): TemplateBuilder {
  const { provider, apiKey } = options

  switch (provider) {
    case 'e2b':
      return new E2BTemplateBuilder(apiKey)
    case 'codesandbox':
      return new CodeSandboxTemplateBuilder(apiKey)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

/**
 * Create template builder from environment configuration
 */
export function createTemplateBuilderFromEnv(): TemplateBuilder {
  const provider = (process.env.TEMPLATE_BUILDER_PROVIDER || 'e2b') as 'e2b' | 'codesandbox'
  return createTemplateBuilder({ provider })
}

/**
 * Build template via API route helper
 */
export async function buildTemplate(
  provider: string,
  config: TemplateBuildConfig
): Promise<ToolResult> {
  try {
    const builder = createTemplateBuilder({ provider: provider as 'e2b' | 'codesandbox' })

    if (!builder.isAvailable()) {
      return {
        success: false,
        output: `Template builder not available for provider: ${provider}. Configure API key.`,
      }
    }

    const result = await builder.build(config)

    if (result.success) {
      return {
        success: true,
        output: JSON.stringify({
          templateId: result.templateId,
          templateName: result.templateName,
          provider: result.provider,
          duration: result.duration,
          logs: result.logs,
        }),
      }
    } else {
      return {
        success: false,
        output: `Template build failed: ${result.error}\n\nLogs:\n${result.logs?.join('\n') || 'No logs'}`,
      }
    }
  } catch (error: any) {
    return {
      success: false,
      output: `Template build error: ${error.message}`,
    }
  }
}
