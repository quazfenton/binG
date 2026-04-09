/**
 * Request Type Detector — Two-Stage Intent Classification
 *
 * Stage 1: Fast regex + keyword scoring using the declarative intent schema.
 * Stage 2: LLM-based disambiguation for ambiguous inputs (when stage 1 confidence is low).
 *
 * Replaces the old hardcoded pattern arrays with a data-driven schema that can be
 * extended without code changes.
 *
 * @example
 * ```typescript
 * const { classifyIntent } = await import('@bing/shared/agent/intent-schema');
 * const match = await classifyIntent(userMessage, { minConfidence: 0.5 });
 * // match.intent.routingTarget → 'opencode' | 'nullclaw' | 'chat' | 'advanced'
 * // match.confidence → 0.0-1.0
 * // match.stage → 1 (regex) | 2 (LLM)
 * ```
 */

import type { LLMMessage } from '@/lib/chat/llm-providers';
import { createHash } from 'crypto';

// Cache for stage 1 results (fast path — no LLM cost)
const detectionCache = new Map<string, { type: 'tool' | 'sandbox' | 'chat'; confidence: number }>();
const CACHE_MAX_SIZE = 1000;

function createCacheKey(messages: LLMMessage[]): string {
  const content = messages.map(m => `${m.role}:${JSON.stringify(m.content)}`).join('|');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function cleanupCache(): void {
  if (detectionCache.size > CACHE_MAX_SIZE) {
    const toRemove = Math.floor(CACHE_MAX_SIZE * 0.1);
    const keys = Array.from(detectionCache.keys()).slice(0, toRemove);
    for (const key of keys) {
      detectionCache.delete(key);
    }
  }
}

/**
 * Map intent routing targets to legacy request types.
 */
function intentToRequestType(target: string): 'tool' | 'sandbox' | 'chat' {
  switch (target) {
    case 'nullclaw':
    case 'tool':
      return 'tool';
    case 'opencode':
    case 'advanced':
    case 'sandbox':
      return 'sandbox';
    default:
      return 'chat';
  }
}

/**
 * Detect the type of request using the two-stage intent classifier.
 *
 * Stage 1 (fast): Regex + keyword scoring from the declarative intent schema.
 * Stage 2 (LLM): Only when stage 1 confidence is below threshold.
 */
export async function detectRequestType(messages: LLMMessage[]): Promise<{
  type: 'tool' | 'sandbox' | 'chat';
  confidence: number;
  stage: 1 | 2;
}> {
  // Check cache first
  const cacheKey = createCacheKey(messages);
  const cached = detectionCache.get(cacheKey);
  if (cached) {
    return { ...cached, stage: 1 };
  }

  const userMessages = messages.filter(m => m.role === 'user');
  const lastUserContent = userMessages[userMessages.length - 1]?.content;

  const extractText = (value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map((part: any) => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text') return part?.text || '';
          if (typeof part?.text === 'string') return part.text;
          if (typeof part?.content === 'string') return part.content;
          return '';
        })
        .join(' ');
    }
    if (typeof value?.text === 'string') return value.text;
    if (typeof value?.content === 'string') return value.content;
    if (Array.isArray(value?.parts)) return extractText(value.parts);
    return '';
  };

  const text = extractText(lastUserContent).trim();
  if (!text) return { type: 'chat', confidence: 0, stage: 1 };

  // Import the two-stage intent classifier
  const { classifyIntent, getAllStage1Scores, INTENT_SCHEMA } = await import('@bing/shared/agent/intent-schema');

  // Try stage 1 first (fast, no LLM cost)
  const stage1Result = await classifyIntent(text, { minConfidence: 0.5, enableStage2: false });

  if (stage1Result.confidence >= 0.5) {
    const requestType = intentToRequestType(stage1Result.intent.routingTarget);
    const result = { type: requestType, confidence: stage1Result.confidence, stage: 1 as const };

    // Cache the result
    detectionCache.set(cacheKey, { type: result.type, confidence: result.confidence });
    cleanupCache();

    return result;
  }

  // Stage 1 was ambiguous — try stage 2 (LLM-based)
  const stage2Result = await classifyIntent(text, { minConfidence: 0.3, enableStage2: true });
  const requestType = intentToRequestType(stage2Result.intent.routingTarget);

  return {
    type: requestType,
    confidence: stage2Result.confidence,
    stage: stage2Result.stage,
  };
}

/**
 * Synchronous fallback for environments where async imports aren't available.
 * Uses only stage 1 (regex + keyword scoring).
 */
export function detectRequestTypeSync(messages: LLMMessage[]): 'tool' | 'sandbox' | 'chat' {
  const userMessages = messages.filter(m => m.role === 'user');
  const lastUserContent = userMessages[userMessages.length - 1]?.content;

  const extractText = (value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map((part: any) => typeof part === 'string' ? part : part?.text || '').join(' ');
    }
    if (typeof value?.text === 'string') return value.text;
    if (typeof value?.content === 'string') return value.content;
    return '';
  };

  const text = extractText(lastUserContent).trim().toLowerCase();
  if (!text) return 'chat';

  // Quick intent matching using the schema's patterns (no LLM)
  const { INTENT_SCHEMA } = require('@bing/shared/agent/intent-schema');
  const { getAllStage1Scores } = require('@bing/shared/agent/intent-schema');
  const scores = getAllStage1Scores(text);

  if (scores.length > 0) {
    return intentToRequestType(scores[0].intent.routingTarget);
  }

  return 'chat';
}
