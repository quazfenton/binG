/**
 * Incremental Verification System
 *
 * Verifies only impacted files based on dependency
 * Supports tiered verification (MINIMAL, STANDARD, STRICT, PARANOID)
 *
 * @see https://mastra.ai/docs/verification/incremental
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getModel } from '../models/model-router';

const execPromise = promisify(exec);

/**
 * Verification tier levels
 */
export enum VerificationTier {
  MINIMAL = 'MINIMAL',
  STANDARD = 'STANDARD',
  STRICT = 'STRICT',
  PARANOID = 'PARANOID',
}

/**
 * Verification result
 */
export interface VerificationResult {
  passed: boolean;
  errors?: string[];
  warnings?: string[];
  duration: number;
  tier: VerificationTier;
  filesChecked: number;
}

/**
 * Risk factors for tier allocation
 */
export interface RiskFactors {
  linesChanged: number;
  contractChanges: number;
  dependencyFanout: number;
  touchesSensitiveArea: boolean;
  historicalFailureRate: number;
  llmConfidence: number;
}

/**
 * Compute risk score from factors
 */
export function computeRisk(f: RiskFactors): number {
  let score = 0;

  score += f.linesChanged * 0.01;
  score += f.contractChanges * 2;
  score += f.dependencyFanout * 0.5;
  score += f.historicalFailureRate * 3;

  if (f.touchesSensitiveArea) score += 5;
  if (f.llmConfidence < 0.6) score += 4;

  return Math.min(score, 100);
}

/**
 * Determine verification tier from risk score
 */
export function tierFromRisk(score: number): VerificationTier {
  if (score < 5) return VerificationTier.MINIMAL;
  if (score < 15) return VerificationTier.STANDARD;
  if (score < 30) return VerificationTier.STRICT;
  return VerificationTier.PARANOID;
}

/**
 * Incremental verifier class
 */
export class IncrementalVerifier {
  private history: Array<{
    tier: VerificationTier;
    postMergeFailures: boolean;
    productionIncidents: boolean;
  }> = [];

  /**
   * Verify changed files with tiered approach
   */
  async verify(
    changedFiles: string[],
    dependencyGraph: Map<string, string[]>,
    tier: VerificationTier
  ): Promise<VerificationResult> {
    const start = Date.now();
    const impactedFiles = this.computeImpactedFiles(changedFiles, dependencyGraph);

    const results: VerificationResult[] = [];

    // Tier-based verification
    switch (tier) {
      case VerificationTier.MINIMAL:
        results.push(await this.incrementalTypeCheck(changedFiles));
        results.push(await this.runImpactedTests(impactedFiles));
        break;

      case VerificationTier.STANDARD:
        results.push(await this.incrementalTypeCheck(impactedFiles));
        results.push(await this.runImpactedTests(impactedFiles));
        results.push(await this.targetedSecurityScan(impactedFiles));
        break;

      case VerificationTier.STRICT:
        results.push(await this.fullTypeCheck());
        results.push(await this.runImpactedTests(impactedFiles));
        results.push(await this.targetedSecurityScan(impactedFiles));
        results.push(await this.llmDiffReview(changedFiles));
        break;

      case VerificationTier.PARANOID:
        results.push(await this.fullTypeCheck());
        results.push(await this.fullTestSuite());
        results.push(await this.fullSecurityScan());
        results.push(await this.multiModelConsensus(changedFiles));
        break;
    }

    const passed = results.every(r => r.passed);
    const duration = Date.now() - start;

    return {
      passed,
      errors: results.filter(r => !r.passed).flatMap(r => r.errors || []),
      warnings: results.flatMap(r => r.warnings || []),
      duration,
      tier,
      filesChecked: impactedFiles.length,
    };
  }

  /**
   * Compute impacted files based on dependency graph
   */
  private computeImpactedFiles(
    changedFiles: string[],
    graph: Map<string, string[]>
  ): string[] {
    const impacted = new Set(changedFiles);

    for (const [file, deps] of graph.entries()) {
      if (deps.some(d => changedFiles.includes(d))) {
        impacted.add(file);
      }
    }

    return [...impacted];
  }

  /**
   * Incremental TypeScript check
   */
  private async incrementalTypeCheck(files: string[]): Promise<VerificationResult> {
    try {
      await execPromise(`tsc --incremental --build ${files.join(' ')}`);
      return { passed: true, duration: 0, tier: VerificationTier.MINIMAL, filesChecked: files.length };
    } catch (error: any) {
      return {
        passed: false,
        errors: [error.stderr || error.message],
        duration: 0,
        tier: VerificationTier.MINIMAL,
        filesChecked: files.length,
      };
    }
  }

  /**
   * Run impacted tests
   */
  private async runImpactedTests(files: string[]): Promise<VerificationResult> {
    // Map files to test files
    const testFiles = files.map(f => f.replace('.ts', '.spec.ts').replace('.tsx', '.spec.tsx'));

    try {
      await execPromise(`npm test -- ${testFiles.join(' ')}`);
      return { passed: true, duration: 0, tier: VerificationTier.MINIMAL, filesChecked: files.length };
    } catch (error: any) {
      return {
        passed: false,
        errors: [error.stderr || error.message],
        duration: 0,
        tier: VerificationTier.MINIMAL,
        filesChecked: files.length,
      };
    }
  }

  /**
   * Targeted security scan
   */
  private async targetedSecurityScan(files: string[]): Promise<VerificationResult> {
    try {
      await execPromise(`semgrep --include ${files.join(' --include ')} --config=auto`);
      return { passed: true, duration: 0, tier: VerificationTier.STANDARD, filesChecked: files.length };
    } catch (error: any) {
      return {
        passed: false,
        errors: [error.stderr || error.message],
        duration: 0,
        tier: VerificationTier.STANDARD,
        filesChecked: files.length,
      };
    }
  }

  /**
   * Full TypeScript check
   */
  private async fullTypeCheck(): Promise<VerificationResult> {
    try {
      await execPromise('tsc --noEmit');
      return { passed: true, duration: 0, tier: VerificationTier.STRICT, filesChecked: -1 };
    } catch (error: any) {
      return {
        passed: false,
        errors: [error.stderr || error.message],
        duration: 0,
        tier: VerificationTier.STRICT,
        filesChecked: -1,
      };
    }
  }

  /**
   * Full test suite
   */
  private async fullTestSuite(): Promise<VerificationResult> {
    try {
      await execPromise('npm test');
      return { passed: true, duration: 0, tier: VerificationTier.PARANOID, filesChecked: -1 };
    } catch (error: any) {
      return {
        passed: false,
        errors: [error.stderr || error.message],
        duration: 0,
        tier: VerificationTier.PARANOID,
        filesChecked: -1,
      };
    }
  }

  /**
   * Full security scan
   */
  private async fullSecurityScan(): Promise<VerificationResult> {
    try {
      await execPromise('semgrep --config=auto .');
      return { passed: true, duration: 0, tier: VerificationTier.PARANOID, filesChecked: -1 };
    } catch (error: any) {
      return {
        passed: false,
        errors: [error.stderr || error.message],
        duration: 0,
        tier: VerificationTier.PARANOID,
        filesChecked: -1,
      };
    }
  }

  /**
   * LLM-based diff review
   */
  private async llmDiffReview(changedFiles: string[]): Promise<VerificationResult> {
    const agent = getModel('reasoning');

    const response = await agent.generate([
      {
        role: 'system',
        content: 'Review changed files for security issues, bugs, and regressions. Output JSON: { "safe": boolean, "issues": string[] }',
      },
      { role: 'user', content: JSON.stringify({ changedFiles }) },
    ]);

    try {
      const parsed = JSON.parse(response.text);
      return {
        passed: parsed.safe,
        errors: parsed.issues,
        duration: 0,
        tier: VerificationTier.STRICT,
        filesChecked: changedFiles.length,
      };
    } catch {
      return {
        passed: false,
        errors: ['Failed to parse LLM review'],
        duration: 0,
        tier: VerificationTier.STRICT,
        filesChecked: changedFiles.length,
      };
    }
  }

  /**
   * Multi-model consensus review
   */
  private async multiModelConsensus(changedFiles: string[]): Promise<VerificationResult> {
    // Run multiple models and vote
    const results = await Promise.all([
      this.llmDiffReview(changedFiles),
      // Add more model reviews here
    ]);

    const passed = results.filter(r => r.passed).length > results.length / 2;

    return {
      passed,
      errors: results.flatMap(r => r.errors || []),
      duration: 0,
      tier: VerificationTier.PARANOID,
      filesChecked: changedFiles.length,
    };
  }

  /**
   * Log outcome for historical analysis
   */
  logOutcome(tier: VerificationTier, outcome: { postMergeFailures: boolean; productionIncidents: boolean }): void {
    this.history.push({ tier, ...outcome });
  }

  /**
   * Get historical failure rate
   */
  getHistoricalFailureRate(): number {
    if (this.history.length === 0) return 0;
    return this.history.filter(h => h.postMergeFailures).length / this.history.length;
  }
}

/**
 * Create verifier with default configuration
 */
export function createVerifier(): IncrementalVerifier {
  return new IncrementalVerifier();
}
