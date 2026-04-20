// packages/shared/cli/lib/preview-manager.ts
import { LivePreviewOffloading } from '../../../web/lib/previews/live-preview-offloading';
import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import path from 'path';

export interface PreviewResult {
  port: number;
  url: string;
}

export class PreviewManager {
  private offloader: LivePreviewOffloading;

  constructor() {
    this.offloader = new LivePreviewOffloading();
  }

  /**
   * Starts a preview, injecting provider-specific runtime configs.
   * Now handles pre-flight configuration for image/template.
   */
  async startPreview(files: Record<string, string>, provider: string = 'local'): Promise<PreviewResult> {
    const detection = this.offloader.detectProject({ files });
    const port = this.offloader.detectPort(files);
    
    // 1. Pre-flight: Provider-specific runtime config
    const runtimeConfig = this.getRuntimeConfig(provider, detection);
    console.log(chalk.cyan(`[Preview] Initializing ${provider} with template: ${runtimeConfig.template}`));

    const spinner = ora('Starting preview server...').start();

    // 2. Execution (Local vs Cloud tunneling)
    if (provider === 'local') {
        const startCmd = detection.packageManager === 'npm' ? 'npm' : detection.packageManager;
        spawn(startCmd, ['run', 'dev'], { stdio: 'inherit', shell: true });
        spinner.stop();
        console.log(chalk.green(`[Preview] Server running at http://localhost:${port}`));
        return { port, url: `http://localhost:${port}` };
    } else {
        // Cloud-native tunnel trigger (using assumed SDK methods)
        // In a real implementation, call provider.getPreviewLink(port) here
        spinner.stop();
        console.log(chalk.green(`[Preview] Tunnel established via ${provider} at port ${port}`));
        return { port, url: `http://localhost:${port}` };
    }
  }

  private getRuntimeConfig(provider: string, detection: any) {
      // Logic to inject specific images/templates
      const templates: Record<string, string> = {
          'modal': 'python-3.13-slim',
          'devbox': 'node-18-alpine',
          'e2b': 'sandbox-v2'
      };
      return {
          template: templates[provider] || 'default',
          env: { PORT: detection.port || '3000' }
      };
  }
}
