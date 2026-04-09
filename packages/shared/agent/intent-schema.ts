/**
 * Intent Schema — Declarative intent definitions
 *
 * Replaces hardcoded keyword arrays and regex patterns. Each intent defines:
 * - id: unique intent identifier
 * - routingTarget: which system handles it ('opencode', 'nullclaw', 'chat', 'advanced')
 * - patterns: regex patterns that indicate this intent (fast path)
 * - keywords: weighted keywords for scoring
 * - description: human-readable description for the LLM (used in stage 2)
 * - confidence: default confidence when regex matches (0-1)
 *
 * Stage 1 (fast): regex + keyword scoring — O(n) per pattern
 * Stage 2 (LLM): when confidence < threshold, use LLM with this schema
 */

export interface IntentDefinition {
  id: string;
  routingTarget: 'opencode' | 'nullclaw' | 'chat' | 'advanced';
  description: string;
  /** Regex patterns — if any matches, this intent gets a base confidence */
  patterns: { regex: RegExp; weight: number }[];
  /** Keywords for scoring — used when regex doesn't match definitively */
  keywords: { word: string; weight: number }[];
  /** Default confidence when a regex pattern matches */
  baseConfidence: number;
}

export const INTENT_SCHEMA: IntentDefinition[] = [
  // ─── Chat / Knowledge ──────────────────────────────────────────────
  {
    id: 'chat',
    routingTarget: 'chat',
    description: 'General conversation, knowledge questions, explanations, advice.',
    patterns: [
      { regex: /^\s*(how|what|why|when|where|can|could|would|should|is|are|do|does)\b/i, weight: 2 },
      { regex: /\b(explain|guide|tutorial|docs|documentation|overview|best practice)\b/i, weight: 2 },
    ],
    keywords: [
      { word: 'explain', weight: 2 }, { word: 'what', weight: 1 }, { word: 'how', weight: 1 },
      { word: 'why', weight: 1 }, { word: 'when', weight: 1 }, { word: 'where', weight: 1 },
      { word: 'should', weight: 1 }, { word: 'could', weight: 1 },
    ],
    baseConfidence: 0.6,
  },

  // ─── Coding (OpenCode) ────────────────────────────────────────────
  {
    id: 'coding',
    routingTarget: 'opencode',
    description: 'Code writing, file operations, shell commands, building, debugging, refactoring.',
    patterns: [
      { regex: /\b(run|execute|compile)\s+(this|the|my)?\s*(code|script|program)/i, weight: 3 },
      { regex: /\bnpm\s+(install|init|run|start)\b/i, weight: 2 },
      { regex: /\bpip\s+install\b/i, weight: 2 },
      { regex: /\b(create|write|build)\s+(a\s+)?(file|component|page|module|api|server)\b/i, weight: 2 },
      { regex: /\b(fix|debug|refactor)\s+(the\s+)?(code|error|bug|issue)\b/i, weight: 2 },
      { regex: /\b(git\s+(commit|push|pull|branch|status))\b/i, weight: 2 },
      { regex: /\b(typescript|javascript|python|rust|golang|java|react|vue)\b/i, weight: 1 },
    ],
    keywords: [
      { word: 'code', weight: 2 }, { word: 'function', weight: 2 }, { word: 'class', weight: 2 },
      { word: 'file', weight: 1 }, { word: 'write', weight: 2 }, { word: 'create', weight: 1 },
      { word: 'build', weight: 2 }, { word: 'run', weight: 1 }, { word: 'execute', weight: 2 },
      { word: 'compile', weight: 2 }, { word: 'debug', weight: 2 }, { word: 'fix', weight: 1 },
      { word: 'refactor', weight: 2 }, { word: 'test', weight: 1 }, { word: 'npm', weight: 2 },
      { word: 'python', weight: 2 }, { word: 'api', weight: 1 }, { word: 'server', weight: 1 },
      { word: 'database', weight: 2 }, { word: 'install', weight: 1 },
    ],
    baseConfidence: 0.7,
  },

  // ─── Tool / Integration (Nullclaw) ─────────────────────────────────
  {
    id: 'tool',
    routingTarget: 'nullclaw',
    description: 'Third-party service actions: email, calendar, GitHub, Slack, Discord, social media.',
    patterns: [
      { regex: /\b(send|draft|compose)\s+(an?\s+)?email\b/i, weight: 3 },
      { regex: /\b(create|add)\s+(a\s+)?calendar\s+(event|meeting)\b/i, weight: 3 },
      { regex: /\bpost\s+(to|on)\s+(twitter|x|reddit|slack|discord)\b/i, weight: 3 },
      { regex: /\b(create|open)\s+(a\s+)?(github|git)\s+(issue|pr|pull)\b/i, weight: 3 },
      { regex: /\bdeploy\s+(to|on)\s+(vercel|railway|aws)\b/i, weight: 3 },
      { regex: /\b(gmail|slack|discord|notion|stripe|hubspot)\b/i, weight: 2 },
      { regex: /\b(upload|download)\s+(to|from)\s+(drive|dropbox|s3)\b/i, weight: 2 },
    ],
    keywords: [
      { word: 'send', weight: 2 }, { word: 'email', weight: 3 }, { word: 'gmail', weight: 2 },
      { word: 'calendar', weight: 2 }, { word: 'github', weight: 2 }, { word: 'slack', weight: 2 },
      { word: 'discord', weight: 2 }, { word: 'notion', weight: 2 }, { word: 'deploy', weight: 3 },
      { word: 'post', weight: 2 }, { word: 'message', weight: 1 }, { word: 'upload', weight: 2 },
    ],
    baseConfidence: 0.7,
  },

  // ─── Advanced Agent (Background, Research, DAG, Skill-build) ──────
  {
    id: 'advanced',
    routingTarget: 'advanced',
    description: 'Long-running tasks: background monitoring, deep research, multi-step workflows, skill building.',
    patterns: [
      { regex: /\b(background|continuous|ongoing|monitor|watch|poll)\b/i, weight: 2 },
      { regex: /\b(research|deep dive|investigate|analyze|study)\b/i, weight: 2 },
      { regex: /\b(workflow|pipeline|chain|sequence|multi-step)\b/i, weight: 2 },
      { regex: /\b(learn|extract|pattern|template|reusable|skill)\b/i, weight: 2 },
      { regex: /\b(debate|discuss|multiple\s+agents|consensus)\b/i, weight: 2 },
    ],
    keywords: [
      { word: 'background', weight: 2 }, { word: 'research', weight: 2 }, { word: 'workflow', weight: 2 },
      { word: 'pipeline', weight: 2 }, { word: 'learn', weight: 2 }, { word: 'extract', weight: 2 },
      { word: 'monitor', weight: 2 }, { word: 'continuous', weight: 2 }, { word: 'schedule', weight: 1 },
      { word: 'recurring', weight: 2 }, { word: 'daemon', weight: 2 },
    ],
    baseConfidence: 0.6,
  },

  // ─── Sandbox Execution (Shell/Process) ────────────────────────────
  {
    id: 'sandbox',
    routingTarget: 'opencode',
    description: 'Shell execution, process management, port checking, terminal sessions.',
    patterns: [
      { regex: /\b(start|launch|run)\s+(a\s+)?(server|dev\s+server|process)\b/i, weight: 3 },
      { regex: /\bcheck\s+(which\s+)?ports?\s+(are\s+)?listening\b/i, weight: 2 },
      { regex: /\b(list|show|get)\s+(running\s+)?processes?\b/i, weight: 2 },
      { regex: /\b(stop|kill|terminate)\s+(process|port|server)\b/i, weight: 2 },
      { regex: /\b(open|start)\s+(a\s+)?(terminal|shell)\b/i, weight: 2 },
    ],
    keywords: [
      { word: 'server', weight: 2 }, { word: 'process', weight: 1 }, { word: 'port', weight: 2 },
      { word: 'terminal', weight: 2 }, { word: 'shell', weight: 1 }, { word: 'start', weight: 1 },
      { word: 'stop', weight: 1 }, { word: 'kill', weight: 2 }, { word: 'listening', weight: 2 },
    ],
    baseConfidence: 0.6,
  },
];

/**
 * Two-stage intent classifier.
 *
 * Stage 1: Fast regex + keyword scoring — O(n) per pattern, no LLM cost.
 * Stage 2: LLM-based disambiguation when confidence < threshold.
 */
export interface IntentMatch {
  intent: IntentDefinition;
  confidence: number;
  stage: 1 | 2;
  /** Which regex patterns matched (stage 1 only) */
  matchedPatterns?: { regex: RegExp; weight: number }[];
  /** Which keywords matched (stage 1 only) */
  matchedKeywords?: { word: string; weight: number }[];
}

/**
 * Stage 1: Score all intents against input text using regex + keywords.
 * Returns the best match or null if confidence is too low.
 */
export function classifyIntentStage1(
  text: string,
  options?: { minConfidence?: number; minScoreGap?: number },
): IntentMatch | null {
  const minConfidence = options?.minConfidence ?? 0.5;
  const minScoreGap = options?.minScoreGap ?? 0.15;
  const lowerText = text.toLowerCase();

  const scores: { intent: IntentDefinition; score: number; matchedPatterns: { regex: RegExp; weight: number }[]; matchedKeywords: { word: string; weight: number }[] }[] = [];

  for (const intent of INTENT_SCHEMA) {
    let score = 0;
    const matchedPatterns: { regex: RegExp; weight: number }[] = [];
    const matchedKeywords: { word: string; weight: number }[] = [];

    // Regex patterns
    for (const { regex, weight } of intent.patterns) {
      if (regex.test(lowerText)) {
        score += weight;
        matchedPatterns.push({ regex, weight });
      }
    }

    // Keyword scoring
    for (const { word, weight } of intent.keywords) {
      if (lowerText.includes(word)) {
        score += weight;
        matchedKeywords.push({ word, weight });
      }
    }

    if (score > 0) {
      // Normalize: max possible score for this intent
      const maxPossible = intent.patterns.reduce((s, p) => s + p.weight, 0)
        + intent.keywords.reduce((s, k) => s + k.weight, 0);
      const normalizedScore = maxPossible > 0 ? score / maxPossible : 0;
      const confidence = Math.max(normalizedScore, intent.baseConfidence * (score > 0 ? 1 : 0));

      scores.push({ intent, score: confidence, matchedPatterns, matchedKeywords });
    }
  }

  if (scores.length === 0) return null;

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  // Check confidence threshold
  if (best.score < minConfidence) return null;

  // Check score gap — if top 2 are too close, it's ambiguous
  if (scores.length > 1) {
    const gap = best.score - scores[1].score;
    if (gap < minScoreGap) return null; // ambiguous — needs stage 2
  }

  return {
    intent: best.intent,
    confidence: best.score,
    stage: 1,
    matchedPatterns: best.matchedPatterns,
    matchedKeywords: best.matchedKeywords,
  };
}

/**
 * Stage 2: LLM-based intent classification for ambiguous inputs.
 * Falls back to the highest-scoring stage 1 result if the LLM fails.
 */
export async function classifyIntentStage2(
  text: string,
  stage1Fallbacks: IntentMatch[],
): Promise<IntentMatch> {
  try {
    const intentDescriptions = INTENT_SCHEMA.map(i =>
      `- **${i.id}** (${i.routingTarget}): ${i.description}`
    ).join('\n');

    const prompt = `Classify the user intent into ONE of these categories:

${intentDescriptions}

User message: "${text}"

Return ONLY a JSON object with:
{ "intent_id": "the intent id", "confidence": 0.0-1.0, "reason": "brief explanation" }`;

    // Use a fast, cheap model for classification
    const { generateText } = await import('ai');
    const { createMistral } = await import('@ai-sdk/mistral');
    const model = createMistral({ apiKey: process.env.MISTRAL_API_KEY || '' })('mistral-small-latest');

    const { text: response } = await generateText({
      model,
      prompt,
      maxTokens: 200,
      temperature: 0.1,
    });

    // Parse JSON response
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const intent = INTENT_SCHEMA.find(i => i.id === parsed.intent_id);
      if (intent) {
        return {
          intent,
          confidence: parsed.confidence ?? 0.5,
          stage: 2,
        };
      }
    }
  } catch (error: any) {
    // LLM failed — fall back to stage 1 results
  }

  // Fallback: return best stage 1 match
  return stage1Fallbacks.length > 0
    ? stage1Fallbacks[0]
    : {
        intent: INTENT_SCHEMA.find(i => i.id === 'chat')!,
        confidence: 0.3,
        stage: 1,
      };
}

/**
 * Full two-stage intent classification.
 * Stage 1 is always tried first. Stage 2 only runs if stage 1 is ambiguous.
 */
export async function classifyIntent(
  text: string,
  options?: { minConfidence?: number; enableStage2?: boolean },
): Promise<IntentMatch> {
  const enableStage2 = options?.enableStage2 ?? true;
  const stage1Result = classifyIntentStage1(text, options);

  if (stage1Result) return stage1Result;

  if (enableStage2) {
    // Get all stage 1 scores for fallback
    const allStage1 = getAllStage1Scores(text);
    return classifyIntentStage2(text, allStage1);
  }

  // No stage 2 — return best stage 1 or default to chat
  const allStage1 = getAllStage1Scores(text);
  return allStage1.length > 0
    ? allStage1[0]
    : {
        intent: INTENT_SCHEMA.find(i => i.id === 'chat')!,
        confidence: 0.1,
        stage: 1,
      };
}

/**
 * Get all stage 1 scores sorted by confidence (for debugging/fallback).
 */
export function getAllStage1Scores(text: string): IntentMatch[] {
  const lowerText = text.toLowerCase();
  const results: { intent: IntentDefinition; score: number }[] = [];

  for (const intent of INTENT_SCHEMA) {
    let score = 0;
    for (const { regex, weight } of intent.patterns) {
      if (regex.test(lowerText)) score += weight;
    }
    for (const { word, weight } of intent.keywords) {
      if (lowerText.includes(word)) score += weight;
    }
    if (score > 0) {
      const maxPossible = intent.patterns.reduce((s, p) => s + p.weight, 0)
        + intent.keywords.reduce((s, k) => s + k.weight, 0);
      const normalizedScore = maxPossible > 0 ? score / maxPossible : 0;
      results.push({ intent, score: Math.max(normalizedScore, intent.baseConfidence) });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.map(r => ({
    intent: r.intent,
    confidence: r.score,
    stage: 1 as const,
  }));
}
