/**
 * CI/CD Helper Utilities
 *
 * Common utilities for CI/CD pipeline integration.
 * Provides helpers for build, test, deploy, and validation workflows.
 *
 * Features:
 * - Build automation
 * - Test execution with reporting
 * - Deployment validation
 * - Artifact management
 * - Status reporting
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir, access } from 'fs/promises';
import { join } from 'path';

const execAsync = promisify(exec);

export interface BuildConfig {
  /** Build command (default: 'npm run build') */
  command: string;
  /** Working directory */
  cwd: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in ms (default: 5 minutes) */
  timeout?: number;
}

export interface TestConfig {
  /** Test command (default: 'npm test') */
  command: string;
  /** Working directory */
  cwd: string;
  /** Test pattern/filter */
  pattern?: string;
  /** Coverage enabled */
  coverage?: boolean;
  /** Timeout in ms (default: 10 minutes) */
  timeout?: number;
}

export interface DeployConfig {
  /** Deploy command */
  command: string;
  /** Working directory */
  cwd: string;
  /** Target environment */
  environment: 'staging' | 'production';
  /** Rollback on failure */
  rollbackOnFailure?: boolean;
}

export interface BuildResult {
  success: boolean;
  output: string;
  duration: number;
  artifacts?: string[];
  error?: string;
}

export interface TestResult {
  success: boolean;
  output: string;
  duration: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage?: {
    lines: number;
    functions: number;
    branches: number;
  };
  error?: string;
}

export interface DeployResult {
  success: boolean;
  output: string;
  duration: number;
  url?: string;
  version?: string;
  error?: string;
}

/**
 * Run build command with timeout and output capture
 */
export async function runBuild(config: BuildConfig): Promise<BuildResult> {
  const startTime = Date.now();
  const timeout = config.timeout || 5 * 60 * 1000;

  try {
    const { stdout, stderr } = await execAsync(config.command, {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const duration = Date.now() - startTime;

    // Check for common build artifacts
    const artifacts = await detectArtifacts(config.cwd);

    return {
      success: true,
      output: stdout || stderr,
      duration,
      artifacts,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || '',
      duration: Date.now() - startTime,
      error: error.message || stderr || 'Build failed',
    };
  }
}

/**
 * Run tests with coverage and reporting
 */
export async function runTests(config: TestConfig): Promise<TestResult> {
  const startTime = Date.now();
  const timeout = config.timeout || 10 * 60 * 1000;

  try {
    let command = config.command;

    // Add pattern if specified
    if (config.pattern) {
      command += ` -- ${config.pattern}`;
    }

    // Add coverage if enabled
    if (config.coverage) {
      command += ' --coverage';
    }

    const { stdout, stderr } = await execAsync(command, {
      cwd: config.cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });

    const duration = Date.now() - startTime;
    const output = stdout || stderr;

    // Parse test results
    const testResults = parseTestOutput(output);

    // Get coverage if enabled
    let coverage;
    if (config.coverage) {
      coverage = await readCoverage(config.cwd);
    }

    return {
      success: testResults.failed === 0,
      output,
      duration,
      ...testResults,
      coverage,
    };
  } catch (error: any) {
    const output = error.stdout || '';
    const testResults = parseTestOutput(output);

    return {
      success: false,
      output,
      duration: Date.now() - startTime,
      ...testResults,
      error: error.message || 'Test execution failed',
    };
  }
}

/**
 * Run deployment with validation
 */
export async function runDeploy(config: DeployConfig): Promise<DeployResult> {
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(config.command, {
      cwd: config.cwd,
      env: {
        ...process.env,
        NODE_ENV: config.environment,
      },
      timeout: 5 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const duration = Date.now() - startTime;
    const output = stdout || stderr;

    // Extract deployment info from output
    const url = extractDeploymentUrl(output);
    const version = extractVersion(output);

    return {
      success: true,
      output,
      duration,
      url,
      version,
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stdout || '',
      duration: Date.now() - startTime,
      error: error.message || 'Deployment failed',
    };
  }
}

/**
 * Validate deployment health
 */
export async function validateDeployment(url: string, timeout = 30000): Promise<{
  healthy: boolean;
  statusCode: number;
  responseTime: number;
  error?: string;
}> {
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'CI/CD Health Check' },
    });

    const responseTime = Date.now() - startTime;

    return {
      healthy: response.ok,
      statusCode: response.status,
      responseTime,
    };
  } catch (error: any) {
    return {
      healthy: false,
      statusCode: 0,
      responseTime: Date.now() - startTime,
      error: error.message || 'Health check failed',
    };
  }
}

/**
 * Generate CI/CD status report
 */
export async function generateStatusReport(results: {
  build?: BuildResult;
  test?: TestResult;
  deploy?: DeployResult;
}): Promise<string> {
  const lines: string[] = [];

  lines.push('# CI/CD Pipeline Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Build status
  if (results.build) {
    lines.push(`## Build ${results.build.success ? '✅' : '❌'}`);
    lines.push(`Duration: ${results.build.duration}ms`);
    if (results.build.artifacts?.length) {
      lines.push(`Artifacts: ${results.build.artifacts.join(', ')}`);
    }
    if (results.build.error) {
      lines.push(`Error: ${results.build.error}`);
    }
    lines.push('');
  }

  // Test status
  if (results.test) {
    lines.push(`## Tests ${results.test.success ? '✅' : '❌'}`);
    lines.push(`Duration: ${results.test.duration}ms`);
    lines.push(`Passed: ${results.test.passed}, Failed: ${results.test.failed}, Skipped: ${results.test.skipped}`);
    if (results.test.coverage) {
      lines.push(`Coverage: ${results.test.coverage.lines}% lines, ${results.test.coverage.functions}% functions`);
    }
    if (results.test.error) {
      lines.push(`Error: ${results.test.error}`);
    }
    lines.push('');
  }

  // Deploy status
  if (results.deploy) {
    lines.push(`## Deploy ${results.deploy.success ? '✅' : '❌'}`);
    lines.push(`Duration: ${results.deploy.duration}ms`);
    if (results.deploy.url) {
      lines.push(`URL: ${results.deploy.url}`);
    }
    if (results.deploy.version) {
      lines.push(`Version: ${results.deploy.version}`);
    }
    if (results.deploy.error) {
      lines.push(`Error: ${results.deploy.error}`);
    }
    lines.push('');
  }

  // Overall status
  const allSuccess = 
    (!results.build || results.build.success) &&
    (!results.test || results.test.success) &&
    (!results.deploy || results.deploy.success);

  lines.push(`## Overall: ${allSuccess ? '✅ SUCCESS' : '❌ FAILED'}`);

  return lines.join('\n');
}

/**
 * Save report to file
 */
export async function saveReport(report: string, outputPath: string): Promise<void> {
  await mkdir(join(outputPath, '..'), { recursive: true });
  await writeFile(outputPath, report);
}

// Helper functions

async function detectArtifacts(cwd: string): Promise<string[]> {
  const commonArtifacts = [
    'dist',
    'build',
    'out',
    '.next',
    'public',
  ];

  const found: string[] = [];

  for (const artifact of commonArtifacts) {
    try {
      await access(join(cwd, artifact));
      found.push(artifact);
    } catch {
      // Not found
    }
  }

  return found;
}

function parseTestOutput(output: string): { passed: number; failed: number; skipped: number } {
  // Parse common test output formats
  const passedMatch = output.match(/(\d+)\s+passing/);
  const failedMatch = output.match(/(\d+)\s+failing/);
  const skippedMatch = output.match(/(\d+)\s+skipped|pending/);

  return {
    passed: parseInt(passedMatch?.[1] || '0'),
    failed: parseInt(failedMatch?.[1] || '0'),
    skipped: parseInt(skippedMatch?.[1] || '0'),
  };
}

async function readCoverage(cwd: string): Promise<{ lines: number; functions: number; branches: number } | undefined> {
  try {
    const coveragePath = join(cwd, 'coverage', 'coverage-summary.json');
    const content = await readFile(coveragePath, 'utf8');
    const summary = JSON.parse(content);

    return {
      lines: Math.round(summary.total.lines.pct),
      functions: Math.round(summary.total.functions.pct),
      branches: Math.round(summary.total.branches.pct),
    };
  } catch {
    return undefined;
  }
}

function extractDeploymentUrl(output: string): string | undefined {
  // Common deployment URL patterns
  const patterns = [
    /Deployed to:\s*(https?:\/\/\S+)/i,
    /URL:\s*(https?:\/\/\S+)/i,
    /Live at:\s*(https?:\/\/\S+)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function extractVersion(output: string): string | undefined {
  const patterns = [
    /Version:\s*([^\s\n]+)/i,
    /v(\d+\.\d+\.\d+)/i,
    /Release:\s*([^\s\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Pipeline runner for complete CI/CD flow
 */
export async function runPipeline(config: {
  build?: BuildConfig;
  test?: TestConfig;
  deploy?: DeployConfig;
  reportPath?: string;
}): Promise<{
  success: boolean;
  build?: BuildResult;
  test?: TestResult;
  deploy?: DeployResult;
}> {
  const results: any = {};

  // Run build
  if (config.build) {
    results.build = await runBuild(config.build);
    if (!results.build.success) {
      const report = await generateStatusReport(results);
      if (config.reportPath) {
        await saveReport(report, config.reportPath);
      }
      return { success: false, build: results.build };
    }
  }

  // Run tests
  if (config.test) {
    results.test = await runTests(config.test);
    if (!results.test.success) {
      const report = await generateStatusReport(results);
      if (config.reportPath) {
        await saveReport(report, config.reportPath);
      }
      return { success: false, build: results.build, test: results.test };
    }
  }

  // Run deploy
  if (config.deploy) {
    results.deploy = await runDeploy(config.deploy);
    
    // Validate deployment if URL is available
    if (results.deploy.success && results.deploy.url) {
      const health = await validateDeployment(results.deploy.url);
      if (!health.healthy) {
        results.deploy.error = `Health check failed: ${health.error}`;
        results.deploy.success = false;
      }
    }
  }

  // Generate report
  const report = await generateStatusReport(results);
  if (config.reportPath) {
    await saveReport(report, config.reportPath);
  }

  return {
    success: true,
    ...results,
  };
}
