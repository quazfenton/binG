/**
 * Preview Offloader
 * 
 * Routes heavy preview requests to cloud providers:
 * - Daytona: Full desktop, GUI apps, recordings
 * - CodeSandbox: Batch jobs, parallel testing
 * - Vercel: Production deployments
 * - Local Sandpack: Default for lightweight apps
 * 
 * Decision Tree:
 * - Framework: Next.js, Nuxt, Django, Flask → Daytona/Vercel
 * - Size: >50 files or >5MB node_modules → Daytona
 * - Backend: requires database/Redis → Daytona/Vercel
 * - GUI/Desktop apps → Daytona Computer Use
 * - Default → Local Sandpack
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Preview:Offloader');

export interface PreviewRequest {
  files: Record<string, string>;
  framework?: string;
  entryPoint?: string;
  dependencies?: Record<string, string>;
  envVars?: Record<string, string>;
}

export interface PreviewResult {
  success: boolean;
  provider: 'local' | 'daytona' | 'codesandbox' | 'vercel';
  url?: string;
  error?: string;
  metadata?: {
    sandboxId?: string;
    duration?: number;
    cost?: number;
  };
}

export interface PreviewDecision {
  recommendedProvider: 'local' | 'daytona' | 'codesandbox' | 'vercel';
  reason: string;
  estimatedCost?: number;
  estimatedDuration?: number;
}

const HEAVY_FRAMEWORKS = [
  'next', 'next.js', 'nuxt', 'nuxt.js', 'remix',
  'django', 'flask', 'fastapi', 'rails', 'laravel',
  'nest', 'express-server', 'koa',
];

const GUI_INDICATORS = [
  'electron', 'tauri', 'nw.js', 'neutralino',
  '.desktop', 'gtk', 'qt', 'wingui',
];

const LARGE_PROJECT_THRESHOLD = {
  files: 50,
  nodeModulesMB: 5,
};

class PreviewOffloader {
  /**
   * Decide which provider to use for preview
   */
  decide(request: PreviewRequest): PreviewDecision {
    const { files, framework, dependencies = {} } = request;
    
    const fileCount = Object.keys(files).length;
    const hasNodeModules = Object.keys(dependencies).some(
      dep => dep === 'node_modules' || dependencies[dep]?.includes('node_modules')
    );
    const frameworkLower = (framework || '').toLowerCase();

    // Check for heavy frameworks
    const isHeavyFramework = HEAVY_FRAMEWORKS.some(f => frameworkLower.includes(f));
    
    // Check for GUI apps
    const isGUI = GUI_INDICATORS.some(g => 
      frameworkLower.includes(g) || 
      Object.keys(files).some(f => f.toLowerCase().includes(g))
    );

    // Check for large projects
    const isLargeProject = fileCount > LARGE_PROJECT_THRESHOLD.files || hasNodeModules;

    // Decision logic
    if (isGUI) {
      return {
        recommendedProvider: 'daytona',
        reason: 'GUI/Desktop application detected - requires full desktop environment',
        estimatedCost: 0.05, // $0.05/min
        estimatedDuration: 60,
      };
    }

    if (isHeavyFramework && isLargeProject) {
      return {
        recommendedProvider: 'daytona',
        reason: `Heavy framework (${framework}) with large project detected`,
        estimatedCost: 0.05,
        estimatedDuration: 120,
      };
    }

    if (isHeavyFramework) {
      return {
        recommendedProvider: 'daytona',
        reason: `Heavy framework (${framework}) requires backend services`,
        estimatedCost: 0.03,
        estimatedDuration: 60,
      };
    }

    if (isLargeProject) {
      return {
        recommendedProvider: 'daytona',
        reason: `Large project (${fileCount} files) exceeds local preview capacity`,
        estimatedCost: 0.02,
        estimatedDuration: 45,
      };
    }

    // Default to local
    return {
      recommendedProvider: 'local',
      reason: 'Lightweight application suitable for local Sandpack preview',
      estimatedCost: 0,
      estimatedDuration: 5,
    };
  }

  /**
   * Execute preview on selected provider
   */
  async execute(request: PreviewRequest): Promise<PreviewResult> {
    const decision = this.decide(request);
    const startTime = Date.now();

    logger.info(`PreviewOffloader: Using ${decision.recommendedProvider} provider`);

    switch (decision.recommendedProvider) {
      case 'daytona':
        return this.executeDaytona(request, startTime);
      case 'codesandbox':
        return this.executeCodeSandbox(request, startTime);
      case 'vercel':
        return this.executeVercel(request, startTime);
      default:
        return {
          success: true,
          provider: 'local',
          url: undefined,
          metadata: {
            duration: Date.now() - startTime,
          },
        };
    }
  }

  /**
   * Execute preview on Daytona
   */
  private async executeDaytona(request: PreviewRequest, startTime: number): Promise<PreviewResult> {
    try {
      const { getSandboxProvider } = await import('../sandbox/providers');
      const provider = await getSandboxProvider('daytona');
      
      const handle = await provider.createSandbox({
        language: 'typescript',
        envVars: {
          ...request.envVars,
          TERM: 'xterm-256color',
        },
      });

      // Write files to sandbox
      for (const [path, content] of Object.entries(request.files)) {
        await handle.writeFile(path, content);
      }

      // Install dependencies if any
      if (request.dependencies && Object.keys(request.dependencies).length > 0) {
        const deps = Object.entries(request.dependencies)
          .map(([name, version]) => `${name}@${version}`)
          .join(' ');
        await handle.executeCommand(`npm install ${deps}`);
      }

      // Start preview server
      const entryPoint = request.entryPoint || 'npm run dev';
      await handle.executeCommand(entryPoint);

      // Get preview URL
      const previewInfo = await handle.getPreviewLink?.(3000);

      return {
        success: true,
        provider: 'daytona',
        url: previewInfo?.url,
        metadata: {
          sandboxId: handle.id,
          duration: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      logger.error('Daytona preview failed', error);
      return {
        success: false,
        provider: 'daytona',
        error: error.message,
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Execute preview on CodeSandbox
   */
  private async executeCodeSandbox(request: PreviewRequest, startTime: number): Promise<PreviewResult> {
    try {
      const { getSandboxProvider } = await import('../sandbox/providers');
      const provider = await getSandboxProvider('codesandbox');
      
      const handle = await provider.createSandbox({
        language: 'typescript',
      });

      // Write files
      for (const [path, content] of Object.entries(request.files)) {
        await handle.writeFile(path, content);
      }

      const previewInfo = await handle.getPreviewLink?.(3000);

      return {
        success: true,
        provider: 'codesandbox',
        url: previewInfo?.url,
        metadata: {
          sandboxId: handle.id,
          duration: Date.now() - startTime,
        },
      };
    } catch (error: any) {
      logger.error('CodeSandbox preview failed', error);
      return {
        success: false,
        provider: 'codesandbox',
        error: error.message,
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Execute preview on Vercel
   */
  private async executeVercel(request: PreviewRequest, startTime: number): Promise<PreviewResult> {
    // TODO: Implement Vercel deployment
    // This would use the Vercel API to deploy the project
    logger.warn('Vercel preview not yet implemented');
    
    return {
      success: false,
      provider: 'vercel',
      error: 'Vercel deployment not yet implemented',
      metadata: {
        duration: Date.now() - startTime,
      },
    };
  }

  /**
   * Get cost estimate for provider
   */
  getCostEstimate(provider: 'daytona' | 'codesandbox' | 'vercel', durationMinutes: number): number {
    const rates: Record<string, number> = {
      daytona: 0.05, // $0.05/min
      codesandbox: 0.02, // $0.02/min
      vercel: 0.01, // $0.01/min (serverless)
    };
    
    return (rates[provider] || 0) * durationMinutes;
  }
}

export const previewOffloader = new PreviewOffloader();
