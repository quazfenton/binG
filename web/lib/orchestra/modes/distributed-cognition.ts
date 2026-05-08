/**
 * Distributed Cognition Mode (Harness Idea #44)
 *
 * Uses different LLMs for different cognitive roles, not just for cost —
 * but for cognitive diversity. Each model plays a distinct reasoning role:
 *
 *   Architect (strong model, 0.3 temp)    → High-level structure, abstractions
 *   Engineer (mid model, 0.5 temp)        → Precise implementation, details
 *   Critic (strong model, 0.8 temp)       → Adversarial review, edge cases
 *   Synthesizer (fast model, 0.4 temp)    → Merge, compress, produce final output
 *
 * Flow:
 *   1. Architect: "Design the structure and abstractions for this task"
 *   2. Engineer: "Implement the design from step 1 with precise, correct code"
 *   3. Critic: "Find flaws in the implementation. How would you break it?"
 *   4. If critic finds issues → Engineer revises
 *   5. Synthesizer: "Produce the final, clean output incorporating all feedback"
 *
 * Cost: 3-5 LLM calls (varies by model assignment).
 * Benefit: Leverages each model's strengths; catches errors through diverse reasoning.
 */

import { createLogger } from '@/lib/utils/logger';
import {
  processUnifiedAgentRequest,
  type UnifiedAgentConfig,
  type UnifiedAgentResult,
} from '../unified-agent-service';
import { configureSubCall, resolveEngine, type EngineArchitecture } from '../execution-engines';

const log = createLogger('DistributedCognitionMode');

// ─── Configuration ──────────────────────────────────────────────────────────

export interface DistributedConfig {
  /** Model assignments for each cognitive role */
  roles?: {
    /** Architecture/design role (default: gpt-4o) */
    architect?: { provider?: string; model?: string };
    /** Implementation/engineering role (default: gpt-4o-mini) */
    engineer?: { provider?: string; model?: string };
    /** Adversarial critique role (default: claude-sonnet-4-5 or gpt-4o) */
    critic?: { provider?: string; model?: string };
    /** Synthesis/merge role (default: gpt-4o-mini) */
    synthesizer?: { provider?: string; model?: string };
  };
  /** Maximum revision rounds if critic finds issues (default: 1) */
  maxRevisionRounds?: number;
  /** Temperature overrides per role */
  temperatures?: {
    architect?: number;
    engineer?: number;
    critic?: number;
    synthesizer?: number;
  };
  /** Max tokens overrides per role */
  maxTokens?: {
    architect?: number;
    engineer?: number;
    critic?: number;
    synthesizer?: number;
  };
  /** Architecture/engine for role calls (default: from baseConfig.engine or env) */
  engine?: EngineArchitecture;
}

// ─── Role System Prompts ───────────────────────────────────────────────────

const ROLE_PROMPTS: Record<string, string> = {
  architect: [
    'You are a software architect. Your role is to design the high-level',
    'structure, abstractions, and interfaces for the given task.',
    'Focus on:',
    '1. Overall system structure and component organization',
    '2. Key abstractions and design patterns',
    '3. Interface definitions and data flow',
    '4. Error handling strategy',
    'Do NOT write implementation code — provide the design blueprint only.',
    'Output a clear, structured design that an engineer can implement directly.',
  ].join('\n'),

  engineer: [
    'You are a senior software engineer. Your role is to implement the design',
    'with precise, correct, production-ready code.',
    'Focus on:',
    '1. Correct implementation of the provided design',
    '2. Proper error handling and edge cases',
    '3. Clean, readable code following best practices',
    '4. Type safety and input validation',
    '5. Complete, working code — no TODOs or placeholders',
    'Output the full implementation.',
  ].join('\n'),

  critic: [
    'You are an adversarial code reviewer. Your role is to find flaws in the',
    'provided implementation. Be thorough and critical.',
    'Look for:',
    '1. Logic errors and incorrect assumptions',
    '2. Unhandled edge cases and missing validation',
    '3. Security vulnerabilities (injection, auth bypass, data exposure)',
    '4. Performance issues (unnecessary complexity, O(n²) where O(n) is possible)',
    '5. Maintainability problems (tight coupling, missing documentation)',
    '',
    'Rate each issue as HIGH, MEDIUM, or LOW.',
    'If no issues found, respond with "Implementation looks solid."',
  ].join('\n'),

  synthesizer: [
    'You are a technical synthesizer. Your role is to merge the design,',
    'implementation, and review feedback into a final, polished output.',
    'Incorporate all HIGH and MEDIUM feedback from the reviewer.',
    'Produce the complete, final result.',
  ].join('\n'),
};

// ─── Mode Implementation ───────────────────────────────────────────────────

interface RoleResult {
  role: string;
  result: UnifiedAgentResult;
  provider: string;
  model: string;
}

/**
 * Run a single role's LLM call.
 */
async function runRole(
  roleName: string,
  baseConfig: UnifiedAgentConfig,
  rolePrompt: string,
  provider: string,
  model: string,
  temperature: number,
  maxTokens: number,
  context: string,
): Promise<RoleResult> {
  log.info(`[DistributedCognition] → ${roleName} executing`, {
    provider,
    model,
    temperature,
    contextLength: context.length,
  });

  const systemPrompt = [
    rolePrompt,
    context ? `\n## Context from previous roles:\n${context.slice(0, 6000)}` : '',
  ].join('\n');

  const engine = resolveEngine(options.engine, baseConfig.engine);
  const subCall = configureSubCall({
    ...baseConfig,
    provider,
    model,
    systemPrompt,
    temperature,
    maxTokens,
    mode: 'v1-api',
  }, engine);
  const result = await processUnifiedAgentRequest(subCall);

  return { role: roleName, result, provider, model };
}

/**
 * Run distributed cognition: Architect → Engineer → Critic → (Revise) → Synthesizer.
 */
export async function runDistributedCognitionMode(
  baseConfig: UnifiedAgentConfig,
  options: DistributedConfig = {}
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  // Resolve role configurations with defaults
  const roles = options.roles || {};
  const temps = options.temperatures || {};
  const maxTokens = options.maxTokens || {};

  const architectProvider = roles.architect?.provider || baseConfig.provider || process.env.LLM_PROVIDER || 'openai';
  const architectModel = roles.architect?.model || 'gpt-4o';
  const engineerProvider = roles.engineer?.provider || baseConfig.provider || process.env.LLM_PROVIDER || 'openai';
  const engineerModel = roles.engineer?.model || 'gpt-4o-mini';
  const criticProvider = roles.critic?.provider || baseConfig.provider || process.env.LLM_PROVIDER || 'openai';
  const criticModel = roles.critic?.model || 'gpt-4o';
  const synthesizerProvider = roles.synthesizer?.provider || baseConfig.provider || process.env.LLM_PROVIDER || 'openai';
  const synthesizerModel = roles.synthesizer?.model || 'gpt-4o-mini';

  const maxRevisionRounds = options.maxRevisionRounds ?? 1;

  log.info('[DistributedCognition] ┌─ ENTRY ───────────────────────');
  log.info('[DistributedCognition] │ architect:', `${architectProvider}/${architectModel}`);
  log.info('[DistributedCognition] │ engineer:', `${engineerProvider}/${engineerModel}`);
  log.info('[DistributedCognition] │ critic:', `${criticProvider}/${criticModel}`);
  log.info('[DistributedCognition] │ synthesizer:', `${synthesizerProvider}/${synthesizerModel}`);
  log.info('[DistributedCognition] │ maxRevisions:', maxRevisionRounds);
  log.info('[DistributedCognition] │ userMessageLength:', baseConfig.userMessage?.length || 0);
  log.info('[DistributedCognition] └────────────────────────────────');

  // ── Phase 1: Architect ────────────────────────────────────────────────────
  const architectResult = await runRole(
    'architect',
    baseConfig,
    ROLE_PROMPTS.architect,
    architectProvider,
    architectModel,
    temps.architect ?? 0.3,
    maxTokens.architect || 4096,
    '',
  );

  if (!architectResult.result.success) {
    log.info('[DistributedCognition] ✗ Architect failed', { error: architectResult.result.error });
    return architectResult.result;
  }

  log.info('[DistributedCognition] ✓ Architect succeeded');

  // ── Phase 2: Engineer ─────────────────────────────────────────────────────
  const engineerContext = `### Design from Architect:\n${architectResult.result.response}`;
  const engineerResult = await runRole(
    'engineer',
    baseConfig,
    ROLE_PROMPTS.engineer,
    engineerProvider,
    engineerModel,
    temps.engineer ?? 0.5,
    maxTokens.engineer || 16384,
    engineerContext,
  );

  if (!engineerResult.result.success) {
    log.info('[DistributedCognition] ✗ Engineer failed', { error: engineerResult.result.error });
    return engineerResult.result;
  }

  log.info('[DistributedCognition] ✓ Engineer succeeded');

  // ── Phase 3: Critic ───────────────────────────────────────────────────────
  let currentImplementation = engineerResult.result;
  let revisionRound = 0;
  let finalCritique: string | null = null;

  while (revisionRound <= maxRevisionRounds) {
    const criticContext = [
      `### Original Task:\n${baseConfig.userMessage.slice(0, 2000)}`,
      '',
      `### Design:\n${architectResult.result.response.slice(0, 2000)}`,
      '',
      `### Implementation:\n${currentImplementation.response.slice(0, 6000)}`,
    ].join('\n');

    const criticResult = await runRole(
      'critic',
      baseConfig,
      ROLE_PROMPTS.critic,
      criticProvider,
      criticModel,
      temps.critic ?? 0.8,
      maxTokens.critic || 4096,
      criticContext,
    );

    if (!criticResult.result.success) {
      log.info('[DistributedCognition] ⚠ Critic failed, proceeding without review');
      break;
    }

    finalCritique = criticResult.result.response;
    log.info(`[DistributedCognition] │ Critic review ${revisionRound + 1}: ${finalCritique.slice(0, 200)}...`);

    // Check if critic found issues
    const hasIssues = !/no\s+(issues|problems|flaws|solid)/i.test(finalCritique)
      && (finalCritique.includes('HIGH') || finalCritique.includes('MEDIUM') || finalCritique.length > 200);

    if (!hasIssues) {
      log.info('[DistributedCognition] ✓ Critic found no significant issues');
      break;
    }

    if (revisionRound < maxRevisionRounds) {
      // Engineer revises based on critique
      log.info(`[DistributedCognition] → Engineer revising (round ${revisionRound + 2})`);
      const revisionContext = [
        `### Original Implementation:\n${currentImplementation.response.slice(0, 4000)}`,
        '',
        `### Critic Feedback:\n${finalCritique}`,
        '',
        'Fix all HIGH and MEDIUM issues. Output the complete revised implementation.',
      ].join('\n');

      const revisedResult = await runRole(
        'engineer-revision',
        baseConfig,
        ROLE_PROMPTS.engineer,
        engineerProvider,
        engineerModel,
        temps.engineer ?? 0.5,
        maxTokens.engineer || 16384,
        revisionContext,
      );

      if (revisedResult.result.success) {
        currentImplementation = revisedResult.result;
        log.info('[DistributedCognition] ✓ Revision succeeded');
      } else {
        log.info('[DistributedCognition] ✗ Revision failed, keeping previous implementation');
      }
    }

    revisionRound++;
  }

  // ── Phase 4: Synthesizer ─────────────────────────────────────────────────
  const synthesizerContext = [
    `### Design:\n${architectResult.result.response.slice(0, 2000)}`,
    '',
    `### Implementation:\n${currentImplementation.response}`,
    ...(finalCritique ? [`\n### Review:\n${finalCritique.slice(0, 2000)}`] : []),
  ].join('\n');

  const synthesizerResult = await runRole(
    'synthesizer',
    baseConfig,
    ROLE_PROMPTS.synthesizer,
    synthesizerProvider,
    synthesizerModel,
    temps.synthesizer ?? 0.4,
    maxTokens.synthesizer || 16384,
    synthesizerContext,
  );

  if (!synthesizerResult.result.success) {
    // Fall back to implementation if synthesis fails
    log.info('[DistributedCognition] ✗ Synthesizer failed, returning implementation');
    return {
      ...currentImplementation,
      mode: 'distributed-cognition-no-synthesis',
      metadata: {
        ...currentImplementation.metadata,
        distributed: {
          roles: {
            architect: { provider: architectProvider, model: architectModel, success: true },
            engineer: { provider: engineerProvider, model: engineerModel, success: true },
            critic: { provider: criticProvider, model: criticModel, success: finalCritique !== null },
            synthesizer: { provider: synthesizerProvider, model: synthesizerModel, success: false },
          },
          revisionRound,
          critique: finalCritique?.slice(0, 500),
          duration: Date.now() - startTime,
        },
      },
    };
  }

  log.info('[DistributedCognition] ✓ Synthesizer succeeded');

  return {
    ...synthesizerResult.result,
    mode: 'distributed-cognition',
    metadata: {
      ...synthesizerResult.result.metadata,
      distributed: {
        roles: {
          architect: { provider: architectProvider, model: architectModel, success: true },
          engineer: { provider: engineerProvider, model: engineerModel, success: true },
          critic: { provider: criticProvider, model: criticModel, success: finalCritique !== null },
          synthesizer: { provider: synthesizerProvider, model: synthesizerModel, success: true },
        },
        revisionRound,
        critique: finalCritique?.slice(0, 500),
        duration: Date.now() - startTime,
      },
    },
  };
}
