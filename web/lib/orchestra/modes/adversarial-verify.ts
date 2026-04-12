/**
 * Adversarial Verify Mode (Harness Idea #7)
 *
 * Self-Verification via Counterfactual Forking.
 *
 * After the primary LLM produces output, spawn N independent "critic"
 * LLM calls with different adversarial system prompts. Aggregate their
 * critiques and feed back to the primary for revision if significant
 * issues are found.
 *
 * Flow:
 *   1. Primary LLM produces output
 *   2. Spawn critics:
 *      - Critic 1: "Find bugs, edge cases, and logic errors"
 *      - Critic 2: "Find security vulnerabilities and injection risks"
 *      - Critic 3: "Does this actually solve the user's task? Check requirements"
 *   3. Aggregate critiques → rank by severity
 *   4. If no significant issues → return primary output
 *   5. If issues found → revision pass with critique summary
 *
 * Cost: 1 primary + N critics + optional 1 revision = 2-4 LLM calls.
 * Benefit: Catches bugs the primary model misses; independent verification.
 */

import { createLogger } from '@/lib/utils/logger';
import {
  processUnifiedAgentRequest,
  type UnifiedAgentConfig,
  type UnifiedAgentResult,
} from '../unified-agent-service';

const log = createLogger('AdversarialVerifyMode');

// ─── Configuration ──────────────────────────────────────────────────────────

export interface AdversarialConfig {
  /** Number of critics to spawn (default: 3) */
  numCritics?: number;
  /** Model for critic calls (default: same as primary) */
  criticModel?: string;
  /** Provider for critic calls (default: same as primary) */
  criticProvider?: string;
  /** Severity threshold: only revise if any critique meets this level (default: 'medium') */
  severityThreshold?: 'low' | 'medium' | 'high';
  /** Temperature for critic calls (default: 0.5) */
  criticTemperature?: number;
  /** Max tokens for critic calls (default: 2048) */
  criticMaxTokens?: number;
  /** Max tokens for revision call (default: from primary config) */
  revisionMaxTokens?: number;
}

// ─── Critic System Prompts ─────────────────────────────────────────────────

const CRITIC_PROMPTS: Record<string, string> = {
  correctness: [
    'You are an expert code reviewer focused on correctness, bugs, and edge cases.',
    'Review the following code and response for:',
    '1. Logic errors and incorrect behavior',
    '2. Unhandled edge cases',
    '3. Type mismatches and runtime errors',
    '4. Off-by-one errors, null/undefined access',
    '5. Incorrect assumptions about inputs or environment',
    '',
    'For each issue found, rate severity as HIGH, MEDIUM, or LOW.',
    'HIGH: Will cause runtime errors or incorrect behavior',
    'MEDIUM: Could fail in edge cases or unusual conditions',
    'LOW: Minor issue, works but not ideal',
    '',
    'If no issues found, respond with "No correctness issues found."',
  ].join('\n'),

  security: [
    'You are a security expert reviewing code for vulnerabilities.',
    'Review the following code and response for:',
    '1. Injection attacks (SQL, XSS, command injection)',
    '2. Unvalidated inputs and missing sanitization',
    '3. Exposed secrets or credentials',
    '4. Insecure defaults or missing access controls',
    '5. Path traversal, SSRF, or other OWASP Top 10 issues',
    '',
    'For each issue found, rate severity as HIGH, MEDIUM, or LOW.',
    'HIGH: Directly exploitable vulnerability',
    'MEDIUM: Potentially exploitable under certain conditions',
    'LOW: Minor security concern or best practice violation',
    '',
    'If no issues found, respond with "No security issues found."',
  ].join('\n'),

  requirements: [
    'You are a QA engineer verifying that the output satisfies the original requirements.',
    'Compare the user\'s task against the produced output and check:',
    '1. Does the output actually solve the task? (not just related code)',
    '2. Are all requirements addressed? (nothing missing or marked TODO)',
    '3. Is the output complete and usable? (not partial or placeholder)',
    '4. Does it match the expected format/interface?',
    '5. Are there any contradictions between the task and the solution?',
    '',
    'For each issue found, rate severity as HIGH, MEDIUM, or LOW.',
    'HIGH: Does not solve the task or missing critical requirement',
    'MEDIUM: Partially solves task, some requirements unmet',
    'LOW: Task solved but could be improved or clarified',
    '',
    'If no issues found, respond with "Requirements fully satisfied."',
  ].join('\n'),

  performance: [
    'You are a performance engineer reviewing code for efficiency.',
    'Review the following code and response for:',
    '1. Unnecessary complexity or over-engineering',
    '2. Inefficient algorithms (O(n²) or worse where O(n) is possible)',
    '3. Redundant computations or duplicated code',
    '4. Missing caching or memoization opportunities',
    '5. Excessive memory usage or resource leaks',
    '',
    'For each issue found, rate severity as HIGH, MEDIUM, or LOW.',
    'HIGH: Will cause performance issues at scale',
    'MEDIUM: Could be inefficient in certain scenarios',
    'LOW: Minor optimization opportunity',
    '',
    'If no issues found, respond with "No performance issues found."',
  ].join('\n'),

  maintainability: [
    'You are a senior developer reviewing code for maintainability.',
    'Review the following code and response for:',
    '1. Poor naming conventions or confusing identifiers',
    '2. Missing comments or documentation for complex logic',
    '3. Violation of DRY principle (duplicated logic)',
    '4. Tight coupling or poor separation of concerns',
    '5. Inconsistent style or anti-patterns',
    '',
    'For each issue found, rate severity as HIGH, MEDIUM, or LOW.',
    'HIGH: Will make the code difficult to maintain or extend',
    'MEDIUM: Could confuse future developers',
    'LOW: Style nit or minor improvement',
    '',
    'If no issues found, respond with "No maintainability issues found."',
  ].join('\n'),
};

// ─── Critic Interface ───────────────────────────────────────────────────────

interface CriticIssue {
  description: string;
  severity: 'high' | 'medium' | 'low';
}

interface CriticResult {
  criticType: string;
  issues: CriticIssue[];
  summary: string;
  rawResponse: string;
}

// ─── Critic Execution ───────────────────────────────────────────────────────

/**
 * Run a single critic LLM call with read-only file access.
 * Critics can read files via VFS tools to independently verify claims.
 */
async function runCritic(
  criticType: string,
  systemPrompt: string,
  task: string,
  primaryOutput: string,
  model: string,
  provider: string,
  temperature: number,
  maxTokens: number,
  baseConfig: UnifiedAgentConfig,
): Promise<CriticResult> {
  // Define read-only tool definitions so critics can independently verify
  const readOnlyTools = [
    {
      name: 'read_file',
      description: 'Read the content of a file. Required: path (e.g. "src/app.tsx").',
      parameters: {
        type: 'object' as const,
        properties: { path: { type: 'string' as const } },
        required: ['path'],
      },
    },
    {
      name: 'list_files',
      description: 'List files and directories. Optional: path (default: "/"), recursive (default: false).',
      parameters: {
        type: 'object' as const,
        properties: {
          path: { type: 'string' as const },
          recursive: { type: 'boolean' as const },
        },
      },
    },
  ];

  const userMessage = [
    `### Original Task:\n${task.slice(0, 2000)}`,
    '',
    `### Produced Output:\n${primaryOutput.slice(0, 8000)}`,
    '',
    'Review the output above and report your findings.',
    'You have read_file and list_files tools available if you need to inspect files independently.',
  ].join('\n');

  try {
    const result = await processUnifiedAgentRequest({
      ...baseConfig,
      userMessage,
      systemPrompt,
      provider,
      model,
      temperature,
      maxTokens,
      tools: readOnlyTools,
      // Critics are read-only — no executeTool callback needed
      mode: 'v1-api',
    });

    const rawResponse = result.response || '';
    const issues = parseCriticIssues(rawResponse);

    return {
      criticType,
      issues,
      summary: rawResponse.slice(0, 200),
      rawResponse,
    };
  } catch (error) {
    log.warn(`Critic ${criticType} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      criticType,
      issues: [],
      summary: `Critic failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      rawResponse: '',
    };
  }
}

/**
 * Parse critic response to extract structured issues.
 * Uses regex patterns to find severity-rated issues.
 */
function parseCriticIssues(response: string): CriticIssue[] {
  const issues: CriticIssue[] = [];

  // Check if the critic found nothing
  if (/no\s+(correctness|security|requirements|performance|maintainability)\s+issues\s+found/i.test(response)) {
    return [];
  }

  // Parse numbered/bulleted issues with severity
  // Pattern: "1. HIGH: description" or "- MEDIUM: description" or "**LOW** description"
  const issuePattern = /(?:^|\n)\s*(?:\d+[\.\)]\s*|\-\s*|\*\s*)?(HIGH|MEDIUM|LOW)[:\s\-]+(.+?)(?=\n\s*(?:\d+[\.\)]\s*|\-\s*|\*\s*)?(?:HIGH|MEDIUM|LOW)[:\s\-]|\n\s*$|$)/gis;

  let match;
  while ((match = issuePattern.exec(response)) !== null) {
    const severity = match[1].toLowerCase() as 'high' | 'medium' | 'low';
    const description = match[2].trim();
    if (description.length > 5) {
      issues.push({ severity, description });
    }
  }

  // Fallback: if no structured issues found but response is long, extract key sentences
  if (issues.length === 0 && response.length > 100) {
    const sentences = response.split(/[.!?]\s+/).filter(s => s.length > 20);
    for (const sentence of sentences.slice(0, 5)) {
      let severity: 'high' | 'medium' | 'low' = 'medium';
      const lower = sentence.toLowerCase();
      if (/\b(critical|must fix|severe|breaks|wrong|incorrect)\b/.test(lower)) severity = 'high';
      else if (/\b(minor|style|nit|cosmetic|optional)\b/.test(lower)) severity = 'low';
      issues.push({ severity, description: sentence.trim() });
    }
  }

  return issues;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

interface AggregatedCritique {
  allIssues: Array<CriticIssue & { criticType: string }>;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  shouldRevise: boolean;
  summary: string;
}

/**
 * Aggregate results from multiple critics and decide if revision is needed.
 */
function aggregateCritiques(
  results: CriticResult[],
  severityThreshold: 'low' | 'medium' | 'high'
): AggregatedCritique {
  const allIssues: Array<CriticIssue & { criticType: string }> = [];
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  for (const result of results) {
    for (const issue of result.issues) {
      allIssues.push({ ...issue, criticType: result.criticType });
      if (issue.severity === 'high') highCount++;
      else if (issue.severity === 'medium') mediumCount++;
      else lowCount++;
    }
  }

  // Sort by severity (high first)
  const severityOrder = { high: 0, medium: 1, low: 2 };
  allIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Decide if revision is needed
  let shouldRevise = false;
  if (severityThreshold === 'high') {
    shouldRevise = highCount > 0;
  } else if (severityThreshold === 'medium') {
    shouldRevise = highCount > 0 || mediumCount > 0;
  } else {
    shouldRevise = allIssues.length > 0;
  }

  // Build summary
  const summary = [
    `${results.length} critics reviewed the output.`,
    `Found: ${highCount} HIGH, ${mediumCount} MEDIUM, ${lowCount} LOW issues.`,
  ].join(' ');

  if (shouldRevise && allIssues.length > 0) {
    const topIssues = allIssues.slice(0, 5).map(i =>
      `[${i.severity.toUpperCase()}] (${i.criticType}) ${i.description}`
    );
    return {
      allIssues,
      highCount,
      mediumCount,
      lowCount,
      shouldRevise,
      summary: summary + '\n\nTop issues:\n' + topIssues.join('\n'),
    };
  }

  return {
    allIssues,
    highCount,
    mediumCount,
    lowCount,
    shouldRevise,
    summary,
  };
}

// ─── Mode Implementation ───────────────────────────────────────────────────

/**
 * Run adversarial verification mode.
 *
 * Primary LLM produces output → N independent critics review it →
 * aggregate findings → revise if significant issues found.
 */
export async function runAdversarialVerifyMode(
  baseConfig: UnifiedAgentConfig,
  options: AdversarialConfig = {}
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  const numCritics = options.numCritics ?? 3;
  const criticModel = options.criticModel || baseConfig.model || process.env.DEFAULT_MODEL || 'gpt-4o';
  const criticProvider = options.criticProvider || baseConfig.provider || process.env.LLM_PROVIDER || 'openai';
  const severityThreshold = options.severityThreshold ?? 'medium';
  const criticTemperature = options.criticTemperature ?? 0.5;
  const criticMaxTokens = options.criticMaxTokens ?? 2048;

  log.info('[AdversarialVerify] ┌─ ENTRY ───────────────────────────');
  log.info('[AdversarialVerify] │ numCritics:', numCritics);
  log.info('[AdversarialVerify] │ criticModel:', `${criticProvider}/${criticModel}`);
  log.info('[AdversarialVerify] │ severityThreshold:', severityThreshold);
  log.info('[AdversarialVerify] │ userMessageLength:', baseConfig.userMessage?.length || 0);
  log.info('[AdversarialVerify] └────────────────────────────────────');

  // ── Primary Execution ─────────────────────────────────────────────────────
  log.info('[AdversarialVerify] → Primary execution');
  const primaryResult = await processUnifiedAgentRequest({
    ...baseConfig,
    mode: 'v1-api',
  });

  if (!primaryResult.success) {
    log.info('[AdversarialVerify] ✗ Primary execution failed', { error: primaryResult.error });
    return primaryResult;
  }

  log.info('[AdversarialVerify] ✓ Primary succeeded, spawning critics');

  // ── Spawn Critics ────────────────────────────────────────────────────────
  const criticTypes = Object.keys(CRITIC_PROMPTS).slice(0, Math.max(numCritics, 3));
  // If numCritics < 4, use the first N; if >= 4, use all 5

  log.info('[AdversarialVerify] → Running critics', { types: criticTypes.join(', ') });

  const criticPromises = criticTypes.map(async (type) => {
    return runCritic(
      type,
      CRITIC_PROMPTS[type],
      baseConfig.userMessage,
      primaryResult.response,
      criticModel,
      criticProvider,
      criticTemperature,
      criticMaxTokens,
      baseConfig,
    );
  });

  const criticResults = await Promise.all(criticPromises);

  // Log critic results
  for (const cr of criticResults) {
    log.info(`[AdversarialVerify] │ ${cr.criticType}: ${cr.issues.length} issues`, {
      high: cr.issues.filter(i => i.severity === 'high').length,
      medium: cr.issues.filter(i => i.severity === 'medium').length,
      low: cr.issues.filter(i => i.severity === 'low').length,
    });
  }

  // ── Aggregate ────────────────────────────────────────────────────────────
  const aggregated = aggregateCritiques(criticResults, severityThreshold);

  log.info('[AdversarialVerify] ┌─ AGGREGATION ───────────────────────');
  log.info('[AdversarialVerify] │ high:', aggregated.highCount);
  log.info('[AdversarialVerify] │ medium:', aggregated.mediumCount);
  log.info('[AdversarialVerify] │ low:', aggregated.lowCount);
  log.info('[AdversarialVerify] │ shouldRevise:', aggregated.shouldRevise);
  log.info('[AdversarialVerify] └──────────────────────────────────────');

  if (!aggregated.shouldRevise) {
    log.info('[AdversarialVerify] ✓ No significant issues, returning primary result');
    return {
      ...primaryResult,
      mode: 'adversarial-verify',
      metadata: {
        ...primaryResult.metadata,
        adversarial: {
          critics: criticResults.map(c => ({
            type: c.criticType,
            issues: c.issues.length,
            summary: c.summary,
          })),
          aggregated,
          revised: false,
          duration: Date.now() - startTime,
        },
      },
    };
  }

  // ── Revision Pass ────────────────────────────────────────────────────────
  log.info('[AdversarialVerify] → Revision pass needed');

  const revisionSystemPrompt = [
    baseConfig.systemPrompt || 'You are an expert software engineer.',
    '',
    '## CODE REVIEW FEEDBACK',
    'Independent reviewers found issues with your previous output.',
    'Address each issue below and produce a corrected version.',
    '',
    '### Review Summary:',
    aggregated.summary,
    '',
    'Fix all HIGH and MEDIUM issues. Address LOW issues if practical.',
    'Do NOT add new features — only fix the identified problems.',
    'Output the complete corrected result.',
  ].join('\n');

  const revisionResult = await processUnifiedAgentRequest({
    ...baseConfig,
    systemPrompt: revisionSystemPrompt,
    maxTokens: options.revisionMaxTokens || baseConfig.maxTokens,
    mode: 'v1-api',
  });

  if (revisionResult.success) {
    log.info('[AdversarialVerify] ✓ Revision succeeded');
  } else {
    log.info('[AdversarialVerify] ✗ Revision failed', { error: revisionResult.error });
    // Return primary result with critique metadata if revision fails
    return {
      ...primaryResult,
      mode: 'adversarial-verify-revision-failed',
      metadata: {
        ...primaryResult.metadata,
        adversarial: {
          critics: criticResults.map(c => ({
            type: c.criticType,
            issues: c.issues.length,
            summary: c.summary,
          })),
          aggregated,
          revised: false,
          revisionError: revisionResult.error,
          duration: Date.now() - startTime,
        },
      },
    };
  }

  return {
    ...revisionResult,
    mode: 'adversarial-verify-revised',
    metadata: {
      ...revisionResult.metadata,
      adversarial: {
        critics: criticResults.map(c => ({
          type: c.criticType,
          issues: c.issues.length,
          summary: c.summary,
        })),
        aggregated,
        revised: true,
        primaryResponse: primaryResult.response.slice(0, 500),
        duration: Date.now() - startTime,
      },
    },
  };
}
