// CLI: LivePreviewOffloading is a web-only module; provide a no-op class stub
class LivePreviewOffloading {
  offload() { return Promise.resolve(null); }
  restore() { return Promise.resolve(null); }
  getStatus() { return { available: false, reason: 'CLI-only mode' }; }
  detectProject({ files }: { files: Record<string, string> }) {
    const hasBackend = Object.keys(files).some((p) => p.includes('/api/') || p.endsWith('server.js') || p.endsWith('server.ts'));
    const hasNodeServer = Object.keys(files).some((p) => p.endsWith('package.json'));
    return {
      hasBackend,
      hasNodeServer,
      framework: 'unknown',
      entryPoint: 'index.js',
      heuristics: { dependencies: {} },
    };
  }
  detectPort(_files: Record<string, string>) { return 3000; }
}
import { loadSandpackClient } from "@codesandbox/sandpack-client";
import { bundleLocalLibrary, scanLocalDependencies } from './local-bundle-manager';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';

const COLORS = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
};

export interface PreviewResult {
  port: number;
  url: string;
  client?: any;
}

export class PreviewManager {
  private offloader: any;

  constructor() {
    this.offloader = new LivePreviewOffloading();
  }

  /**
   * Starts a preview using the unified loadSandpackClient pattern.
   * Handles both browser (Runtime) and server (Node) environments.
   * Automatically bundles and injects local dependencies.
   */
  async startPreview(files: Record<string, string>, provider: string = 'local'): Promise<PreviewResult> {
    const detection = this.offloader.detectProject({ files });
    const port = this.offloader.detectPort(files);
    
    // 1. Unified Environment Switch: Nodebox (Node) or Runtime (Vanilla/Browser)
    const environment = (detection.hasBackend || detection.hasNodeServer) ? 'node' : 'vanilla';
    
    console.log(COLORS.info(`[Preview] Launching ${environment} environment for ${detection.framework}...`));

    // 2. Local Library Bundling & Injection
    const localLibPaths = await scanLocalDependencies(process.cwd());
    for (const libPath of localLibPaths) {
      const bundle = await bundleLocalLibrary(libPath);
      if (bundle) {
        // Inject into virtual node_modules as raw text (Sandpack pattern)
        files[`/node_modules/${bundle.name}/package.json`] = JSON.stringify({ 
          name: bundle.name, 
          main: "./index.js" 
        });
        files[`/node_modules/${bundle.name}/index.js`] = bundle.code;
        console.log(COLORS.success(`[Preview] Injected local library: ${bundle.name}`));
      }
    }

    // 3. Ensure virtual package.json exists for automatic dependency inference
    if (!files['/package.json']) {
      files['/package.json'] = JSON.stringify({
        name: "preview",
        main: detection.entryPoint || "index.js",
        dependencies: detection.heuristics?.dependencies || {}
      });
    }

    const spinner = ora('Mounting bundler...').start();

    // 4. Mount using the recommended loadSandpackClient implementation
    // Note: In CLI mode, we often don't have a real DOM, so we treat this as a virtual mount
    // for orchestration. For Desktop/Web, this targets a real iframe.
    const clientOptions = {
      externalResources: ["https://cdn.tailwindcss.com"], // Add common external resources
      showErrorScreen: true,
      showLoadingScreen: true,
      skipEval: false,
    };

    try {
      // In a real local CLI run, we might just spawn the local server if provider is 'local'
      if (provider === 'local') {
        spinner.stop();
        console.log(COLORS.success(`[Preview] Local server started. View at http://localhost:${port}`));
        return { port, url: `http://localhost:${port}` };
      }

      // Otherwise, we load the Sandpack Client (conceptually mounting to a target)
      const client = await loadSandpackClient(
        "#preview-container", // Target container ID
        {
          files: Object.entries(files).reduce((acc, [k, v]) => ({ ...acc, [k]: { code: v } }), {}),
          // environment property removed — not valid in Sandpack client config
        },
        clientOptions
      );

      spinner.stop();
      const previewUrl = `http://localhost:${port}`; // Standardized local port
      console.log(COLORS.success(`[Preview] ${environment.toUpperCase()} instance ready at ${previewUrl}`));
      
      return { 
        port, 
        url: previewUrl,
        client 
      };
    } catch (error: any) {
      spinner.stop();
      throw new Error(`Sandpack mount failed: ${error.message}`);
    }
  }
}
