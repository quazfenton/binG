/**
 * E2B Template Building Helpers
 * 
 * Provides utilities for building and managing custom E2B templates.
 * Simplifies template creation, building, and deployment.
 * 
 * @see https://e2b.dev/docs/templates E2B Templates
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Template configuration
 */
export interface TemplateConfig {
  /**
   * Template alias/name
   */
  alias: string;
  
  /**
   * Base template to extend
   */
  baseTemplate?: string;
  
  /**
   * Base Docker image
   */
  baseImage?: string;
  
  /**
   * Commands to run during build
   */
  commands?: string[];
  
  /**
   * Files to copy
   */
  files?: Array<{
    source: string;
    destination: string;
  }>;
  
  /**
   * Environment variables
   */
  envVars?: Record<string, string>;
  
  /**
   * CPU count
   */
  cpuCount?: number;
  
  /**
   * Memory in MB
   */
  memoryMB?: number;
}

/**
 * Template build result
 */
export interface TemplateBuildResult {
  /**
   * Whether build succeeded
   */
  success: boolean;
  
  /**
   * Template alias
   */
  alias: string;
  
  /**
   * Build output
   */
  output?: string;
  
  /**
   * Error message if failed
   */
  error?: string;
  
  /**
   * Build duration in ms
   */
  duration: number;
}

/**
 * E2B Template Builder
 * 
 * Manages template creation and building.
 */
export class E2BTemplateBuilder {
  private readonly config: TemplateConfig;
  private readonly workingDir: string;

  constructor(config: TemplateConfig, workingDir?: string) {
    this.config = config;
    this.workingDir = workingDir || process.cwd();
  }

  /**
   * Generate template.ts file
   * 
   * @returns Template file content
   */
  generateTemplateFile(): string {
    const lines: string[] = [];
    
    lines.push('import { Template } from "e2b";');
    lines.push('');
    lines.push('export const template = Template()');
    
    // Base template or image
    if (this.config.baseTemplate) {
      lines.push(`  .fromTemplate('${this.config.baseTemplate}')`);
    } else if (this.config.baseImage) {
      lines.push(`  .fromBaseImage('${this.config.baseImage}')`);
    }
    
    // Commands
    if (this.config.commands && this.config.commands.length > 0) {
      for (const cmd of this.config.commands) {
        lines.push(`  .runCmd(['${cmd.replace(/'/g, "\\'")}'])`);
      }
    }
    
    // Files
    if (this.config.files && this.config.files.length > 0) {
      for (const file of this.config.files) {
        lines.push(`  .copyFile('${file.source}', '${file.destination}')`);
      }
    }
    
    // Environment variables
    if (this.config.envVars && Object.keys(this.config.envVars).length > 0) {
      const envStr = JSON.stringify(this.config.envVars);
      lines.push(`  .setEnvVars(${envStr})`);
    }
    
    // Start command (if specified)
    // Note: E2B templates don't typically set start commands
    
    lines.push(';');
    lines.push('');
    
    return lines.join('\n');
  }

  /**
   * Generate build.ts file
   * 
   * @returns Build file content
   */
  generateBuildFile(): string {
    const lines: string[] = [];
    
    lines.push('import { Template, defaultBuildLogger } from "e2b";');
    lines.push('import { template as customTemplate } from "./template";');
    lines.push('');
    lines.push('async function build() {');
    lines.push('  await Template.build(customTemplate, {');
    lines.push(`    alias: '${this.config.alias}',`);
    
    if (this.config.cpuCount) {
      lines.push(`    cpuCount: ${this.config.cpuCount},`);
    }
    
    if (this.config.memoryMB) {
      lines.push(`    memoryMB: ${this.config.memoryMB},`);
    }
    
    lines.push('    onBuildLogs: defaultBuildLogger(),');
    lines.push('  });');
    lines.push('}');
    lines.push('');
    lines.push('build().catch(console.error);');
    lines.push('');
    
    return lines.join('\n');
  }

  /**
   * Write template files to disk
   * 
   * @param outputDir - Output directory
   * @returns Whether write succeeded
   */
  writeTemplateFiles(outputDir?: string): boolean {
    const dir = outputDir || join(this.workingDir, `template-${this.config.alias}`);
    
    try {
      // Create directory
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      // Write template.ts
      const templatePath = join(dir, 'template.ts');
      writeFileSync(templatePath, this.generateTemplateFile());
      
      // Write build.ts
      const buildPath = join(dir, 'build.ts');
      writeFileSync(buildPath, this.generateBuildFile());
      
      // Write package.json
      const packagePath = join(dir, 'package.json');
      const packageJson = {
        name: `e2b-template-${this.config.alias}`,
        version: '1.0.0',
        type: 'module',
        scripts: {
          build: 'tsx build.ts',
        },
        dependencies: {
          e2b: '^1.0.0',
        },
        devDependencies: {
          tsx: '^4.0.0',
        },
      };
      writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
      
      // Write README.md
      const readmePath = join(dir, 'README.md');
      const readme = `# E2B Template: ${this.config.alias}\n\n`;
      readme += `Custom E2B template based on ${this.config.baseTemplate || this.config.baseImage || 'default'}.\n\n`;
      readme += '## Build\n\n';
      readme += '```bash\n';
      readme += 'npm install\n';
      readme += 'npm run build\n';
      readme += '```\n\n';
      readme += '## Usage\n\n';
      readme += '```typescript\n';
      readme += `import { Sandbox } from 'e2b';\n`;
      readme += `const sandbox = await Sandbox.create('${this.config.alias}');\n`;
      readme += '```\n';
      writeFileSync(readmePath, readme);
      
      return true;
    } catch (error: any) {
      console.error('[E2BTemplateBuilder] Failed to write template files:', error.message);
      return false;
    }
  }

  /**
   * Build template
   * 
   * @param options - Build options
   * @returns Build result
   */
  async build(options?: {
    installDeps?: boolean;
    clean?: boolean;
  }): Promise<TemplateBuildResult> {
    const startTime = Date.now();
    const dir = join(this.workingDir, `template-${this.config.alias}`);
    
    try {
      // Write template files
      if (!this.writeTemplateFiles()) {
        return {
          success: false,
          alias: this.config.alias,
          error: 'Failed to write template files',
          duration: Date.now() - startTime,
        };
      }
      
      // Install dependencies
      if (options?.installDeps !== false) {
        await this.runCommand('npm', ['install'], dir);
      }
      
      // Build template
      const output = await this.runCommand('npm', ['run', 'build'], dir);
      
      return {
        success: true,
        alias: this.config.alias,
        output,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        alias: this.config.alias,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Run command in directory
   */
  private async runCommand(cmd: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let output = '';
      let errorOutput = '';
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(errorOutput || `Command exited with code ${code}`));
        }
      });
      
      proc.on('error', (error) => {
        reject(error);
      });
    });
  }
}

/**
 * Create template builder
 * 
 * @param config - Template configuration
 * @param workingDir - Working directory
 * @returns Template builder
 */
export function createTemplateBuilder(
  config: TemplateConfig,
  workingDir?: string
): E2BTemplateBuilder {
  return new E2BTemplateBuilder(config, workingDir);
}

/**
 * Quick template build helper
 * 
 * @param config - Template configuration
 * @param options - Build options
 * @returns Build result
 */
export async function quickBuildTemplate(
  config: TemplateConfig,
  options?: {
    installDeps?: boolean;
    workingDir?: string;
  }
): Promise<TemplateBuildResult> {
  const builder = createTemplateBuilder(config, options?.workingDir);
  return await builder.build({
    installDeps: options?.installDeps,
  });
}

/**
 * Pre-configured template builders
 */
export const TemplatePresets = {
  /**
   * Python data science template
   */
  pythonDataScience: (alias: string) => createTemplateBuilder({
    alias,
    baseTemplate: 'base',
    commands: [
      'pip install pandas numpy matplotlib scikit-learn jupyter',
    ],
    envVars: {
      PYTHONUNBUFFERED: '1',
    },
    memoryMB: 2048,
    cpuCount: 2,
  }),

  /**
   * Node.js development template
   */
  nodejsDev: (alias: string) => createTemplateBuilder({
    alias,
    baseTemplate: 'base',
    commands: [
      'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -',
      'apt-get install -y nodejs',
      'npm install -g typescript tsx eslint prettier',
    ],
    memoryMB: 2048,
    cpuCount: 2,
  }),

  /**
   * Go development template
   */
  golangDev: (alias: string) => createTemplateBuilder({
    alias,
    baseTemplate: 'base',
    commands: [
      'wget https://go.dev/dl/go1.21.0.linux-amd64.tar.gz',
      'tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz',
      'rm go1.21.0.linux-amd64.tar.gz',
    ],
    envVars: {
      PATH: '/usr/local/go/bin:$PATH',
    },
    memoryMB: 2048,
    cpuCount: 2,
  }),

  /**
   * Rust development template
   */
  rustDev: (alias: string) => createTemplateBuilder({
    alias,
    baseTemplate: 'base',
    commands: [
      'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
    ],
    envVars: {
      PATH: '/root/.cargo/bin:$PATH',
    },
    memoryMB: 4096,
    cpuCount: 4,
  }),

  /**
   * Claude Code template
   */
  claudeCode: (alias: string) => createTemplateBuilder({
    alias,
    baseTemplate: 'claude',
    commands: [
      'pip install pandas numpy requests',
    ],
    memoryMB: 2048,
    cpuCount: 2,
  }),

  /**
   * Codex template
   */
  codex: (alias: string) => createTemplateBuilder({
    alias,
    baseTemplate: 'codex',
    commands: [
      'pip install pandas numpy requests',
    ],
    memoryMB: 2048,
    cpuCount: 2,
  }),
};
