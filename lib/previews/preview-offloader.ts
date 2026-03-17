/**
 * Preview Offloader
 *
 * Routes heavy preview requests to cloud providers:
 * - Daytona: Full desktop, GUI apps, recordings
 * - CodeSandbox: Batch jobs, parallel testing, framework-specific templates
 * - Vercel: Production deployments
 * - Local Sandpack: Default for lightweight apps
 *
 * CodeSandbox Configuration:
 * - CSB_API_KEY: Required - Get from https://codesandbox.io/t/api
 * - CSB_PRIVACY: Optional - 'public' | 'private' | 'public-hosts' (default: 'public-hosts')
 * - CSB_DEFAULT_TEMPLATE: Optional - Default template if auto-detection fails
 * - CSB_HIBERNATION_TIMEOUT: Optional - Seconds before hibernation (default: 86400)
 *
 * Preview URL Format:
 * - Public: https://<sandbox-id>-<port>.csb.app
 * - Private: Requires host tokens for custom domains
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
  provider: 'local' | 'daytona' | 'codesandbox' | 'vercel' | 'opensandbox';
  url?: string;
  error?: string;
  metadata?: {
    sandboxId?: string;
    duration?: number;
    cost?: number;
  };
}

export interface PreviewDecision {
  recommendedProvider: 'local' | 'daytona' | 'codesandbox' | 'vercel' | 'opensandbox';
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
   * 
   * Features:
   * - CodeSandbox template mapping based on framework detection
   * - Port waiting with waitForPort() for reliable preview URLs
   * - Privacy configuration via CSB_PRIVACY environment variable
   */
  private async executeCodeSandbox(request: PreviewRequest, startTime: number): Promise<PreviewResult> {
    try {
      const { getSandboxProvider } = await import('../sandbox/providers');
      const provider = await getSandboxProvider('codesandbox');

      // Detect framework for template mapping
      const detection = this.detectFramework(request.files);
      const template = this.getCodeSandboxTemplate(detection.framework);

      logger.info(`CodeSandbox: Using template "${template}" for framework "${detection.framework}"`);

      // Create sandbox with detected template
      const handle = await provider.createSandbox({
        language: detection.language || 'typescript',
        template,
      });

      // Write files to sandbox
      for (const [path, content] of Object.entries(request.files)) {
        await handle.writeFile(path, content);
      }

      // Detect port from package.json or use default
      const port = this.detectPort(request.files);
      logger.info(`CodeSandbox: Waiting for port ${port} to become available...`);

      // Wait for port to open (more reliable than getPreviewLink)
      const previewInfo = await handle.waitForPort?.(port, 60000) 
        || await handle.getPreviewLink?.(port);

      if (!previewInfo?.url) {
        throw new Error(`Port ${port} did not become available within timeout`);
      }

      logger.info(`CodeSandbox: Preview ready at ${previewInfo.url}`);

      return {
        success: true,
        provider: 'codesandbox',
        url: previewInfo.url,
        metadata: {
          sandboxId: handle.id,
          port,
          template,
          duration: Date.now() - startTime,
          privacy: process.env.CSB_PRIVACY || 'public-hosts',
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
          privacy: process.env.CSB_PRIVACY || 'public-hosts',
        },
      };
    }
  }

  /**
   * Detect framework from files
   */
  private detectFramework(files: Record<string, string>): { framework: string; language?: string } {
    const fileNames = Object.keys(files);
    
    // Check for Python frameworks
    if (fileNames.some(f => f.endsWith('.py'))) {
      if (fileNames.some(f => f.includes('streamlit'))) return { framework: 'streamlit', language: 'python' };
      if (fileNames.some(f => f.includes('gradio'))) return { framework: 'gradio', language: 'python' };
      if (fileNames.some(f => f.includes('flask'))) return { framework: 'flask', language: 'python' };
      return { framework: 'python', language: 'python' };
    }

    // Check for Node.js frameworks
    const packageJson = files['package.json'] || files['/package.json'];
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        
        if (deps.next) return { framework: 'nextjs', language: 'typescript' };
        if (deps.nuxt) return { framework: 'nuxt', language: 'typescript' };
        if (deps.vite) return { framework: 'vite', language: 'typescript' };
        if (deps.react) return { framework: 'react', language: 'typescript' };
        if (deps.vue) return { framework: 'vue', language: 'typescript' };
        if (deps.svelte) return { framework: 'svelte', language: 'typescript' };
      } catch (e) {
        // Invalid package.json
      }
    }

    return { framework: 'node', language: 'typescript' };
  }

  /**
   * Get CodeSandbox template for framework
   * 
   * Maps detected frameworks to CodeSandbox templates:
   * @see https://codesandbox.io/docs/sdk/templates
   */
  private getCodeSandboxTemplate(framework: string): string {
    const templateMap: Record<string, string> = {
      // JavaScript/TypeScript
      'react': 'react',
      'react-ts': 'react-ts',
      'vue': 'vue',
      'vue-ts': 'vue-ts',
      'svelte': 'svelte',
      'svelte-ts': 'svelte-ts',
      'vanilla': 'vanilla',
      'vanilla-ts': 'vanilla-ts',
      
      // Meta-frameworks
      'nextjs': 'nextjs',
      'nuxt': 'nuxt',
      'remix': 'remix',
      'astro': 'astro',
      
      // Backend
      'node': 'node',
      'express': 'node',
      'python': 'python',
      'flask': 'python',
      'django': 'python',
      'fastapi': 'python',
      
      // ML/Data
      'streamlit': 'python',
      'gradio': 'python',
      'jupyter': 'python',
      
      // Other
      'vite': 'vanilla-vite',
      'webpack': 'node',
      'parcel': 'node',
    };

    return templateMap[framework] || 'node';
  }

  /**
   * Detect port from files
   */
  private detectPort(files: Record<string, string>): number {
    const packageJson = files['package.json'] || files['/package.json'];
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        const scripts = pkg.scripts || {};
        const startScript = scripts.dev || scripts.start || '';
        
        // Extract port from start script
        const portMatch = startScript.match(/-p\s+(\d+)|--port\s+(\d+)|PORT=(\d+)/);
        if (portMatch) {
          return parseInt(portMatch[1] || portMatch[2] || portMatch[3], 10);
        }
        
        // Framework defaults
        if (pkg.dependencies?.next) return 3000;
        if (pkg.dependencies?.nuxt) return 3000;
        if (pkg.dependencies?.vite) return 5173;
        if (pkg.dependencies?.react) return 3000;
      } catch (e) {
        // Invalid package.json
      }
    }

    // Check Python files for port
    for (const [path, content] of Object.entries(files)) {
      if (path.endsWith('.py')) {
        const portMatch = content.match(/run\(.*port\s*=\s*(\d+)|app\.run\(.*(\d+)/);
        if (portMatch) {
          return parseInt(portMatch[1] || portMatch[2], 10);
        }
      }
    }

    // Default port
    return 3000;
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
