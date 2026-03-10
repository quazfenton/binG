/**
 * Phase 2: Live Preview Offloading
 * 
 * Smart preview provider selection with:
 * - Sandpack for lightweight frontend previews
 * - Provider URLs for full-stack/backend apps
 * - Auto-detection of app requirements
 * - Seamless fallback between providers
 * 
 * Supported preview providers:
 * - Sandpack (React, Vue, vanilla JS)
 * - Daytona preview URLs (full-stack)
 * - E2B preview URLs (backend-capable)
 * - CodeSandbox preview URLs (task-based)
 * - Sprites public URLs (persistent apps)
 * 
 * @example
 * ```typescript
 * import { livePreviewOffloading } from '@/lib/sandbox/phase2-integration';
 * 
 * // Auto-select preview provider
 * const preview = await livePreviewOffloading.getPreview({
 *   framework: 'react',
 *   hasBackend: false,
 * });
 * // Returns: { provider: 'sandpack', ... }
 * 
 * // Get provider preview URL
 * const url = await livePreviewOffloading.getProviderPreviewUrl(sandboxId, 3000);
 * 
 * // Smart preview component
 * const PreviewComponent = await livePreviewOffloading.createSmartPreview({
 *   sandboxId,
 *   port: 3000,
 *   framework: 'next',
 *   hasBackend: true,
 * });
 * ```
 */

import { getSandboxProvider, type SandboxProviderType } from './providers';
import { createLogger } from '../utils/logger';

const logger = createLogger('Phase2:LivePreview');

/**
 * Preview provider type
 */
export type PreviewProvider = 'sandpack' | 'daytona' | 'e2b' | 'codesandbox' | 'sprites' | 'webcontainer';

/**
 * App framework
 */
export type AppFramework = 'react' | 'vue' | 'svelte' | 'next' | 'nuxt' | 'sveltekit' | 'vanilla' | 'other';

/**
 * Preview context for provider selection
 */
export interface PreviewContext {
  /** App framework */
  framework?: AppFramework;
  
  /** Has backend server (Node.js, Python, etc.) */
  hasBackend?: boolean;
  
  /** Requires database */
  requiresDatabase?: boolean;
  
  /** Is full-stack application */
  isFullStack?: boolean;
  
  /** Port number */
  port?: number;
  
  /** Sandbox ID */
  sandboxId?: string;
  
  /** Provider type */
  providerType?: SandboxProviderType;
}

/**
 * Preview result
 */
export interface PreviewResult {
  /** Selected provider */
  provider: PreviewProvider;
  
  /** Preview URL */
  url: string;
  
  /** Provider-specific metadata */
  metadata?: {
    sandboxId?: string;
    port?: number;
    token?: string;
    [key: string]: any;
  };
  
  /** Selection reason */
  reason: string;
  
  /** Fallback URL (if primary unavailable) */
  fallbackUrl?: string;
}

/**
 * Smart preview configuration
 */
export interface SmartPreviewConfig {
  /** Container element ID */
  containerId: string;
  
  /** Preview context */
  context: PreviewContext;
  
  /** Width */
  width?: string | number;
  
  /** Height */
  height?: string | number;
  
  /** Auto-refresh on changes */
  autoRefresh?: boolean;
}

/**
 * Live Preview Offloading
 */
export class LivePreviewOffloading {
  /**
   * Get optimal preview provider
   */
  getPreviewProvider(context: PreviewContext): { provider: PreviewProvider; reason: string } {
    // Full-stack or backend → Use provider preview URL
    if (context.hasBackend || context.requiresDatabase || context.isFullStack) {
      if (context.providerType === 'daytona') {
        return { provider: 'daytona', reason: 'Full-stack app with Daytona' };
      }
      if (context.providerType === 'e2b') {
        return { provider: 'e2b', reason: 'Backend-capable with E2B' };
      }
      if (context.providerType === 'codesandbox') {
        return { provider: 'codesandbox', reason: 'Task-based preview with CodeSandbox' };
      }
      if (context.providerType === 'sprites') {
        return { provider: 'sprites', reason: 'Persistent app with Sprites' };
      }
      // Default to Daytona for full-stack
      return { provider: 'daytona', reason: 'Default for full-stack apps' };
    }
    
    // Frontend-only → Sandpack (lightweight)
    if (context.framework && !context.hasBackend) {
      if (['react', 'vue', 'svelte', 'vanilla'].includes(context.framework)) {
        return { provider: 'sandpack', reason: `Lightweight ${context.framework} preview` };
      }
      if (['next', 'nuxt', 'sveltekit'].includes(context.framework)) {
        // SSR frameworks need provider preview
        return { provider: 'daytona', reason: `${context.framework} requires server` };
      }
    }
    
    // Default to provider preview
    return { provider: 'daytona', reason: 'Default provider preview' };
  }
  
  /**
   * Get preview URL from provider
   */
  async getProviderPreviewUrl(
    sandboxId: string,
    port: number,
    providerType?: SandboxProviderType
  ): Promise<{ url: string; token?: string }> {
    const type = providerType || this.inferProviderType(sandboxId);
    
    try {
      const provider = await getSandboxProvider(type);
      const handle = await provider.getSandbox(sandboxId);
      
      if (!handle.getPreviewLink) {
        throw new Error(`Provider ${type} does not support preview URLs`);
      }
      
      const preview = await handle.getPreviewLink(port);
      
      return {
        url: preview.url,
        token: preview.token,
      };
    } catch (error: any) {
      logger.error('Failed to get preview URL:', error);
      throw error;
    }
  }
  
  /**
   * Get preview for context
   */
  async getPreview(context: PreviewContext): Promise<PreviewResult> {
    const { provider, reason } = this.getPreviewProvider(context);
    
    // Sandpack doesn't need sandbox
    if (provider === 'sandpack') {
      return {
        provider: 'sandpack',
        url: 'sandpack://local',
        reason,
        metadata: { framework: context.framework },
      };
    }
    
    // Provider-based preview
    if (!context.sandboxId) {
      throw new Error('Sandbox ID required for provider preview');
    }
    
    const port = context.port || 3000;
    const { url, token } = await this.getProviderPreviewUrl(
      context.sandboxId,
      port,
      context.providerType
    );
    
    return {
      provider,
      url,
      reason,
      metadata: {
        sandboxId: context.sandboxId,
        port,
        token,
      },
    };
  }
  
  /**
   * Create smart preview component
   */
  async createSmartPreview(config: SmartPreviewConfig): Promise<{
    type: 'iframe' | 'sandpack';
    props: any;
  }> {
    const { provider } = this.getPreviewProvider(config.context);
    
    if (provider === 'sandpack') {
      // Return Sandpack configuration
      return {
        type: 'sandpack',
        props: {
          template: this.getSandpackTemplate(config.context.framework),
          // Files would be passed separately
        },
      };
    }
    
    // Get preview URL for iframe
    if (!config.context.sandboxId) {
      throw new Error('Sandbox ID required for iframe preview');
    }
    
    const port = config.context.port || 3000;
    const { url } = await this.getProviderPreviewUrl(
      config.context.sandboxId,
      port,
      config.context.providerType
    );
    
    return {
      type: 'iframe',
      props: {
        src: url,
        width: config.width || '100%',
        height: config.height || 600,
        style: { border: 'none' },
      },
    };
  }
  
  /**
   * Get Sandpack template for framework
   */
  private getSandpackTemplate(framework?: AppFramework): string {
    switch (framework) {
      case 'react':
        return 'react';
      case 'vue':
        return 'vue';
      case 'svelte':
        return 'svelte';
      case 'vanilla':
        return 'vanilla';
      case 'next':
        return 'next';
      default:
        return 'react';
    }
  }
  
  /**
   * Infer provider type from sandbox ID
   */
  private inferProviderType(sandboxId: string): SandboxProviderType {
    if (sandboxId.startsWith('daytona-') || sandboxId.startsWith('dt-')) return 'daytona';
    if (sandboxId.startsWith('e2b-')) return 'e2b';
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox';
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites';
    if (sandboxId.startsWith('wc-')) return 'webcontainer';
    return 'daytona';
  }
}

/**
 * Singleton instance
 */
export const livePreviewOffloading = new LivePreviewOffloading();

/**
 * Convenience functions
 */
export const getPreviewProvider = (context: PreviewContext) =>
  livePreviewOffloading.getPreviewProvider(context);

export const getProviderPreviewUrl = (sandboxId: string, port: number, providerType?: SandboxProviderType) =>
  livePreviewOffloading.getProviderPreviewUrl(sandboxId, port, providerType);

export const getPreview = (context: PreviewContext) =>
  livePreviewOffloading.getPreview(context);

export const createSmartPreview = (config: SmartPreviewConfig) =>
  livePreviewOffloading.createSmartPreview(config);
