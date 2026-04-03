/**
 * Productive Script Runner
 *
 * Executes productive scripts using capability chains.
 * Supports:
 * - Pre-defined script templates (build, test, deploy, etc.)
 * - Custom script composition
 * - Parallel execution for independent steps
 * - Error handling with automatic rollback
 *
 * @example
 * ```typescript
 * // Run build script
 * const result = await runProductiveScript('build', {
 *   projectPath: '/workspace/my-app',
 * });
 *
 * // Run test script with coverage
 * const result = await runProductiveScript('test', {
 *   projectPath: '/workspace/my-app',
 *   coverage: true,
 * });
 *
 * // Run custom script
 * const result = await runProductiveScript('custom', {
 *   steps: [
 *     { capability: 'sandbox.shell', config: { command: 'npm install' } },
 *     { capability: 'sandbox.shell', config: { command: 'npm run build' } },
 *   ],
 * });
 * ```
 */

import { createCapabilityChain, type CapabilityChain, type ChainConfig } from './capability-chain';
import type { CapabilityExecutor } from './capability-chain';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('ProductiveScripts');

// ============================================================================
// Pre-defined Script Templates
// ============================================================================

export type ScriptType =
  | 'build'
  | 'test'
  | 'lint'
  | 'typecheck'
  | 'deploy'
  | 'install'
  | 'clean'
  | 'dev'
  | 'custom';

export interface ScriptConfig {
  projectPath?: string;
  coverage?: boolean;
  parallel?: boolean;
  stopOnFailure?: boolean;
  timeout?: number;
  [key: string]: any;
}

export interface ScriptStep {
  capability: string;
  config: Record<string, any>;
  description?: string;
}

export interface ScriptDefinition {
  name: string;
  description: string;
  steps: ScriptStep[];
  parallel?: boolean;
}

// ============================================================================
// Script Templates
// ============================================================================

const SCRIPT_TEMPLATES: Record<ScriptType, ScriptDefinition> = {
  build: {
    name: 'Build Project',
    description: 'Build the project for production',
    parallel: false,
    steps: [
      {
        capability: 'sandbox.shell',
        config: { command: 'npm install', cwd: '{projectPath}' },
        description: 'Install dependencies',
      },
      {
        capability: 'sandbox.shell',
        config: { command: 'npm run build', cwd: '{projectPath}' },
        description: 'Run build',
      },
    ],
  },
  test: {
    name: 'Run Tests',
    description: 'Run test suite',
    parallel: false,
    steps: [
      {
        capability: 'sandbox.shell',
        config: { command: 'npm test', cwd: '{projectPath}' },
        description: 'Run tests',
      },
    ],
  },
  lint: {
    name: 'Lint Code',
    description: 'Run linter',
    parallel: false,
    steps: [
      {
        capability: 'sandbox.shell',
        config: { command: 'npm run lint', cwd: '{projectPath}' },
        description: 'Run linter',
      },
    ],
  },
  typecheck: {
    name: 'Type Check',
    description: 'Run TypeScript type checking',
    parallel: false,
    steps: [
      {
        capability: 'sandbox.shell',
        config: { command: 'npm run typecheck', cwd: '{projectPath}' },
        description: 'Run type check',
      },
    ],
  },
  deploy: {
    name: 'Deploy',
    description: 'Deploy to production',
    parallel: false,
    steps: [
      {
        capability: 'sandbox.shell',
        config: { command: 'npm run build', cwd: '{projectPath}' },
        description: 'Build for production',
      },
      {
        capability: 'sandbox.shell',
        config: { command: 'npm run deploy', cwd: '{projectPath}' },
        description: 'Deploy',
      },
    ],
  },
  install: {
    name: 'Install Dependencies',
    description: 'Install project dependencies',
    parallel: false,
    steps: [
      {
        capability: 'sandbox.shell',
        config: { command: 'npm install', cwd: '{projectPath}' },
        description: 'Install dependencies',
      },
    ],
  },
  clean: {
    name: 'Clean',
    description: 'Clean build artifacts',
    parallel: false,
    steps: [
      {
        capability: 'sandbox.shell',
        config: { command: 'npm run clean', cwd: '{projectPath}' },
        description: 'Clean build artifacts',
      },
    ],
  },
  dev: {
    name: 'Development Server',
    description: 'Start development server',
    parallel: false,
    steps: [
      {
        capability: 'sandbox.shell',
        config: { command: 'npm run dev', cwd: '{projectPath}' },
        description: 'Start dev server',
      },
    ],
  },
  custom: {
    name: 'Custom Script',
    description: 'Custom script execution',
    parallel: false,
    steps: [],
  },
};

// ============================================================================
// Script Runner
// ============================================================================

export interface ScriptExecutionResult {
  success: boolean;
  scriptType: ScriptType;
  steps: ScriptStep[];
  results: any[];
  errors: Array<{ step: string; error: string }>;
  duration: number;
}

/**
 * Create a script chain from template
 */
function createScriptChain(
  scriptType: ScriptType,
  config: ScriptConfig,
  executor: CapabilityExecutor
): CapabilityChain {
  const template = SCRIPT_TEMPLATES[scriptType];
  
  if (!template) {
    throw new Error(`Unknown script type: ${scriptType}`);
  }

  const chainConfig: ChainConfig = {
    name: template.name,
    enableParallel: config.parallel ?? template.parallel ?? false,
    stopOnFailure: config.stopOnFailure ?? true,
    timeout: config.timeout ?? 300000, // 5 minutes
    context: {
      projectPath: config.projectPath || '/workspace',
    },
  };

  const chain = createCapabilityChain(chainConfig);

  // Add steps from template
  for (const step of template.steps) {
    // Interpolate variables in config
    const interpolatedConfig = interpolateConfig(step.config, chainConfig.context!);
    
    chain.addStep(step.capability, interpolatedConfig, {
      id: step.description || step.capability,
    });
  }

  return chain;
}

/**
 * Interpolate variables in config
 */
function interpolateConfig(
  config: Record<string, any>,
  context: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      // Replace {variable} with context value
      result[key] = value.replace(/\{(\w+)\}/g, (_, key) => {
        return context[key] || `{${key}}`;
      });
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Run a productive script
 */
export async function runProductiveScript(
  scriptType: ScriptType,
  config: ScriptConfig,
  executor: CapabilityExecutor
): Promise<ScriptExecutionResult> {
  const startTime = Date.now();
  
  log.info('Running productive script', {
    scriptType,
    projectPath: config.projectPath,
    parallel: config.parallel,
  });

  try {
    // Create chain from template
    const chain = createScriptChain(scriptType, config, executor);
    
    // Execute chain
    const result = await chain.execute(executor);
    
    const duration = Date.now() - startTime;
    
    log.info('Productive script completed', {
      scriptType,
      success: result.success,
      duration: `${Math.round(duration / 1000)}s`,
      stepsCompleted: result.steps.filter(s => s.status === 'completed').length,
      stepsFailed: result.steps.filter(s => s.status === 'failed').length,
    });

    return {
      success: result.success,
      scriptType,
      steps: result.steps.map(s => ({
        capability: s.capability,
        config: s.config,
      })),
      results: Array.from(result.results.values()),
      errors: result.errors,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    log.error('Productive script failed', {
      scriptType,
      error: error.message,
      duration: `${Math.round(duration / 1000)}s`,
    });

    return {
      success: false,
      scriptType,
      steps: [],
      results: [],
      errors: [{ step: 'script', error: error.message }],
      duration,
    };
  }
}

/**
 * Run custom script with provided steps
 */
export async function runCustomScript(
  steps: ScriptStep[],
  config: ScriptConfig,
  executor: CapabilityExecutor
): Promise<ScriptExecutionResult> {
  const startTime = Date.now();
  
  log.info('Running custom script', {
    stepCount: steps.length,
    projectPath: config.projectPath,
    parallel: config.parallel,
  });

  const chainConfig: ChainConfig = {
    name: 'Custom Script',
    enableParallel: config.parallel ?? false,
    stopOnFailure: config.stopOnFailure ?? true,
    timeout: config.timeout ?? 300000,
    context: {
      projectPath: config.projectPath || '/workspace',
    },
  };

  const chain = createCapabilityChain(chainConfig);

  // Add custom steps
  for (const step of steps) {
    chain.addStep(step.capability, step.config, {
      id: step.description || step.capability,
    });
  }

  try {
    const result = await chain.execute(executor);
    const duration = Date.now() - startTime;
    
    log.info('Custom script completed', {
      success: result.success,
      duration: `${Math.round(duration / 1000)}s`,
    });

    return {
      success: result.success,
      scriptType: 'custom',
      steps: result.steps.map(s => ({
        capability: s.capability,
        config: s.config,
      })),
      results: Array.from(result.results.values()),
      errors: result.errors,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    log.error('Custom script failed', {
      error: error.message,
      duration: `${Math.round(duration / 1000)}s`,
    });

    return {
      success: false,
      scriptType: 'custom',
      steps: [],
      results: [],
      errors: [{ step: 'script', error: error.message }],
      duration,
    };
  }
}

/**
 * Get available script templates
 */
export function getAvailableScripts(): Array<{
  type: ScriptType;
  name: string;
  description: string;
  stepCount: number;
}> {
  return Object.entries(SCRIPT_TEMPLATES).map(([type, template]) => ({
    type: type as ScriptType,
    name: template.name,
    description: template.description,
    stepCount: template.steps.length,
  }));
}

/**
 * Get script template details
 */
export function getScriptTemplate(scriptType: ScriptType): ScriptDefinition | null {
  return SCRIPT_TEMPLATES[scriptType] || null;
}
