/**
 * Mastra Evals & Scorers
 *
 * Quality measurement for AI-generated code and responses.
 * Provides automated scoring for code quality, security, and correctness.
 *
 * Features:
 * - Code quality scoring (1-10 scale)
 * - Security vulnerability detection
 * - Best practices validation
 * - Test coverage estimation
 * - Performance impact assessment
 *
 * @see https://mastra.ai/docs/evals/overview
 */

import { z } from 'zod';
import { getModel } from '../models/model-router';

// ===========================================
// Scorer Types
// ===========================================

export interface ScorerResult {
  score: number;
  maxScore: number;
  feedback: string;
  issues: string[];
  passed: boolean;
}

export interface CodeQualityMetrics {
  correctness: number;
  maintainability: number;
  readability: number;
  errorHandling: number;
  bestPractices: number;
}

// ===========================================
// Code Quality Scorer
// ===========================================

/**
 * Score generated code quality on 1-10 scale
 *
 * @param code - Code to evaluate
 * @param language - Programming language
 * @returns ScorerResult with score and feedback
 */
export async function scoreCodeQuality(
  code: string,
  language: string = 'typescript'
): Promise<ScorerResult> {
  const agent = getModel('coder');

  const response = await agent.generate([
    {
      role: 'system',
      content: `You are an expert code reviewer. Rate code quality from 1-10.

Consider:
- Correctness: Does the code work as intended?
- Maintainability: Is it easy to modify and extend?
- Readability: Is it clear and well-structured?
- Error Handling: Are edge cases handled?
- Best Practices: Does it follow language conventions?

Output JSON:
{
  "score": number (1-10),
  "feedback": string,
  "issues": string[],
  "metrics": {
    "correctness": number (1-10),
    "maintainability": number (1-10),
    "readability": number (1-10),
    "errorHandling": number (1-10),
    "bestPractices": number (1-10)
  }
}`,
    },
    {
      role: 'user',
      content: `Review this ${language} code:\n\n${code}`,
    },
  ]);

  try {
    const trimmedText = response.text.trim();
    const parsed = JSON.parse(trimmedText);

    return {
      score: parsed.score,
      maxScore: 10,
      feedback: parsed.feedback,
      issues: parsed.issues || [],
      passed: parsed.score >= 7,
    };
  } catch (error) {
    // Fallback if JSON parsing fails
    return {
      score: 5,
      maxScore: 10,
      feedback: 'Code review completed with parsing error',
      issues: ['Failed to parse detailed review'],
      passed: false,
    };
  }
}

// ===========================================
// Security Scorer
// ===========================================

/**
 * Detect security vulnerabilities in code
 *
 * @param code - Code to evaluate
 * @param language - Programming language
 * @returns ScorerResult with security assessment
 */
export async function scoreSecurity(
  code: string,
  language: string = 'typescript'
): Promise<ScorerResult> {
  const agent = getModel('coder');

  const response = await agent.generate([
    {
      role: 'system',
      content: `You are a security expert. Identify security vulnerabilities in code.

Look for:
- Command injection risks
- Path traversal vulnerabilities
- SQL injection potential
- Hardcoded secrets/credentials
- Insecure API usage
- Missing input validation
- XSS vulnerabilities

Output JSON:
{
  "score": number (1-10, 10 = most secure),
  "feedback": string,
  "issues": string[],
  "severity": "low" | "medium" | "high" | "critical"
}`,
    },
    {
      role: 'user',
      content: `Review this ${language} code for security issues:\n\n${code}`,
    },
  ]);

  try {
    const trimmedText = response.text.trim();
    const parsed = JSON.parse(trimmedText);

    return {
      score: parsed.score,
      maxScore: 10,
      feedback: parsed.feedback,
      issues: parsed.issues || [],
      passed: parsed.severity !== 'critical' && parsed.severity !== 'high',
    };
  } catch (error) {
    return {
      score: 5,
      maxScore: 10,
      feedback: 'Security review completed with parsing error',
      issues: ['Failed to parse detailed review'],
      passed: false,
    };
  }
}

// ===========================================
// Best Practices Scorer
// ===========================================

/**
 * Validate code against language best practices
 *
 * @param code - Code to evaluate
 * @param language - Programming language
 * @returns ScorerResult with best practices assessment
 */
export async function scoreBestPractices(
  code: string,
  language: string = 'typescript'
): Promise<ScorerResult> {
  const agent = getModel('coder');

  const response = await agent.generate([
    {
      role: 'system',
      content: `You are a senior developer. Validate code against best practices.

For TypeScript/JavaScript, check:
- Proper type annotations
- Error handling (try/catch, Promise rejection)
- Consistent naming conventions
- Function length and complexity
- DRY principle (no unnecessary duplication)
- Proper imports/exports
- Async/await usage

Output JSON:
{
  "score": number (1-10),
  "feedback": string,
  "issues": string[],
  "suggestions": string[]
}`,
    },
    {
      role: 'user',
      content: `Review this ${language} code for best practices:\n\n${code}`,
    },
  ]);

  try {
    const trimmedText = response.text.trim();
    const parsed = JSON.parse(trimmedText);

    return {
      score: parsed.score,
      maxScore: 10,
      feedback: parsed.feedback,
      issues: parsed.issues || [],
      passed: parsed.score >= 7,
    };
  } catch (error) {
    return {
      score: 5,
      maxScore: 10,
      feedback: 'Best practices review completed with parsing error',
      issues: ['Failed to parse detailed review'],
      passed: false,
    };
  }
}

// ===========================================
// Comprehensive Code Evaluation
// ===========================================

export interface ComprehensiveEvalResult {
  overall: ScorerResult;
  quality: ScorerResult;
  security: ScorerResult;
  bestPractices: ScorerResult;
  metrics?: CodeQualityMetrics;
  recommendation: 'approve' | 'revise' | 'reject';
}

/**
 * Run comprehensive code evaluation
 *
 * @param code - Code to evaluate
 * @param language - Programming language
 * @returns ComprehensiveEvalResult with all scores
 */
export async function evaluateCode(
  code: string,
  language: string = 'typescript'
): Promise<ComprehensiveEvalResult> {
  const [quality, security, bestPractices] = await Promise.all([
    scoreCodeQuality(code, language),
    scoreSecurity(code, language),
    scoreBestPractices(code, language),
  ]);

  // Calculate overall score (weighted average)
  const weights = {
    quality: 0.4,
    security: 0.4,
    bestPractices: 0.2,
  };

  const overallScore =
    quality.score * weights.quality +
    security.score * weights.security +
    bestPractices.score * weights.bestPractices;

  const allIssues = [
    ...quality.issues,
    ...security.issues,
    ...bestPractices.issues,
  ];

  // Determine recommendation
  let recommendation: 'approve' | 'revise' | 'reject';

  if (overallScore >= 8 && security.passed) {
    recommendation = 'approve';
  } else if (overallScore >= 6 && !security.issues.some(i => i.includes('critical') || i.includes('high'))) {
    recommendation = 'revise';
  } else {
    recommendation = 'reject';
  }

  return {
    overall: {
      score: Math.round(overallScore * 10) / 10,
      maxScore: 10,
      feedback: `Overall score: ${overallScore.toFixed(1)}/10`,
      issues: allIssues,
      passed: recommendation === 'approve',
    },
    quality,
    security,
    bestPractices,
    recommendation,
  };
}

// ===========================================
// Workflow Integration
// ===========================================

/**
 * Add code evaluation step to workflow
 *
 * Usage in criticStep:
 * ```typescript
 * import { evaluateCode } from '@/lib/mastra/evals';
 *
 * const evalResult = await evaluateCode(generatedCode);
 * if (evalResult.recommendation === 'reject') {
 *   return { needsSelfHealing: true, fixInstructions: evalResult.overall.feedback };
 * }
 * ```
 */

// ===========================================
// Configuration
// ===========================================

export interface EvalsConfig {
  enabled: boolean;
  minQualityScore: number;
  minSecurityScore: number;
  autoRejectCritical: boolean;
}

export const DEFAULT_EVALS_CONFIG: EvalsConfig = {
  enabled: process.env.MASTRA_EVALS_ENABLED === 'true',
  minQualityScore: parseInt(process.env.MASTRA_EVALS_MIN_QUALITY || '7', 10),
  minSecurityScore: parseInt(process.env.MASTRA_EVALS_MIN_SECURITY || '8', 10),
  autoRejectCritical: process.env.MASTRA_EVALS_AUTO_REJECT !== 'false',
};

/**
 * Check if code passes evaluation thresholds
 *
 * @param result - Evaluation result
 * @param config - Evaluation configuration
 * @returns boolean indicating if code passes
 */
export function passesEvaluation(
  result: ComprehensiveEvalResult,
  config: EvalsConfig = DEFAULT_EVALS_CONFIG
): boolean {
  if (!config.enabled) return true;

  if (config.autoRejectCritical && result.security.issues.some(i => i.includes('critical'))) {
    return false;
  }

  return (
    result.quality.score >= config.minQualityScore &&
    result.security.score >= config.minSecurityScore
  );
}
