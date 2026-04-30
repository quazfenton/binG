/**
 * Task Classifier - Multi-Factor Complexity Detection
 *
 * Replaces fragile regex with structured scoring system:
 * 1. Keyword scoring (weighted, not binary)
 * 2. Semantic analysis (task scope estimation)
 * 3. Context-aware factors (project size, file dependencies)
 * 4. Historical patterns (learn from past classifications)
 *
 * @example
 * ```typescript
 * const classifier = createTaskClassifier();
 * const result = await classifier.classify({
 *   userMessage: 'Add authentication to the app',
 *   context: { projectSize: 'large', existingFiles: [...] }
 * });
 * // result: { complexity: 'high', recommendedMode: 'stateful-agent', confidence: 0.85 }
 * ```
 */

// FIX: Use native console logging since @/lib/utils/logger is a web alias not accessible from shared package
// This prevents build failures when shared package is used standalone
const log = {
  debug: (...args: any[]) => { if (process.env.DEBUG) console.log('[TaskClassifier]', ...args); },
  warn: (...args: any[]) => console.warn('[TaskClassifier]', ...args),
  error: (...args: any[]) => console.error('[TaskClassifier]', ...args),
  info: (...args: any[]) => console.log('[TaskClassifier]', ...args),
};

export interface TaskClassification {
  complexity: 'simple' | 'moderate' | 'complex';
  recommendedMode: 'v1-api' | 'v2-native' | 'stateful-agent' | 'mastra-workflow';
  confidence: number; // 0-1
  factors: {
    keywordScore: number;
    semanticScore: number;
    contextScore: number;
    historicalScore: number;
  };
  reasoning: string[];
}

export interface ClassificationContext {
  projectSize?: 'small' | 'medium' | 'large';
  existingFiles?: string[];
  recentTasks?: Array<{ message: string; complexity: string }>;
  userPreference?: 'fast' | 'balanced' | 'thorough';
}

export interface TaskClassifierConfig {
  // Thresholds
  simpleThreshold?: number; // < this = simple
  complexThreshold?: number; // > this = complex
  minConfidence?: number; // minimum confidence for auto-routing
  
  // Weights
  keywordWeight?: number;
  semanticWeight?: number;
  contextWeight?: number;
  historicalWeight?: number;
  
  // Feature flags
  enableSemanticAnalysis?: boolean;
  enableHistoricalLearning?: boolean;
  enableContextAwareness?: boolean;
}

/**
 * Weighted keyword categories
 */
const KEYWORD_CATEGORIES = {
  // High complexity indicators (weight: 3)
  highComplexity: [
    'authentication', 'authorization', 'oauth', 'jwt', 'session',
    'database', 'migration', 'schema', 'orm', 'prisma', 'sequelize',
    'api', 'endpoint', 'route', 'controller', 'service', 'repository',
    'deployment', 'ci/cd', 'pipeline', 'docker', 'kubernetes',
    'architecture', 'refactor', 'migrate', 'restructure',
    'full-stack', 'end-to-end', 'integration', 'synchronization',
  ],
  
  // Medium complexity indicators (weight: 2)
  mediumComplexity: [
    'create', 'build', 'implement', 'add feature', 'new file',
    'multiple files', 'component', 'page', 'module', 'service',
    'dashboard', 'form', 'validation', 'state management',
    'testing', 'unit test', 'integration test', 'e2e test',
    'optimization', 'performance', 'caching', 'indexing',
  ],
  
  // Low complexity indicators (weight: 1)
  lowComplexity: [
    'fix', 'bug', 'error', 'issue', 'problem',
    'update', 'change', 'modify', 'adjust', 'tweak',
    'remove', 'delete', 'cleanup', 'refactor small',
    'question', 'explain', 'what', 'how', 'why',
  ],
  
  // Multi-step indicators (add +0.5 each)
  multiStep: [
    'and then', 'after that', 'first', 'next', 'finally',
    'also', 'plus', 'in addition', 'step', 'phase',
    'before', 'once', 'when', 'if', 'else',
  ],
};

export class TaskClassifier {
  private config: Required<TaskClassifierConfig>;
  private historicalPatterns: Map<string, number> = new Map();

  constructor(config: TaskClassifierConfig = {}) {
    this.config = {
      simpleThreshold: 0.3,
      complexThreshold: 0.7,
      minConfidence: 0.6,
      keywordWeight: 0.4,
      semanticWeight: 0.3,
      contextWeight: 0.2,
      historicalWeight: 0.1,
      enableSemanticAnalysis: true,
      enableHistoricalLearning: true,
      enableContextAwareness: true,
      ...config,
    };
  }

  /**
   * Classify task complexity and recommend execution mode
   */
  async classify(
    userMessage: string,
    context: ClassificationContext = {}
  ): Promise<TaskClassification> {
    const reasoning: string[] = [];
    
    // 1. Keyword Analysis (weighted scoring)
    const keywordScore = this.analyzeKeywords(userMessage, reasoning);
    
    // 2. Semantic Analysis (LLM-based scope estimation)
    let semanticScore = 0.5; // neutral default
    if (this.config.enableSemanticAnalysis) {
      semanticScore = await this.analyzeSemantics(userMessage, reasoning);
    }
    
    // 3. Context Analysis (project-aware)
    let contextScore = 0.5; // neutral default
    if (this.config.enableContextAwareness && context) {
      contextScore = this.analyzeContext(userMessage, context, reasoning);
    }
    
    // 4. Historical Patterns (learning from past)
    let historicalScore = 0.5; // neutral default
    if (this.config.enableHistoricalLearning) {
      historicalScore = this.analyzeHistory(userMessage, reasoning);
    }
    
    // Calculate weighted final score
    const finalScore = 
      keywordScore * this.config.keywordWeight +
      semanticScore * this.config.semanticWeight +
      contextScore * this.config.contextWeight +
      historicalScore * this.config.historicalWeight;
    
    // Determine complexity level
    const complexity = finalScore < this.config.simpleThreshold
      ? 'simple'
      : finalScore > this.config.complexThreshold
      ? 'complex'
      : 'moderate';
    
    // Calculate confidence (based on score distribution)
    const confidence = this.calculateConfidence({
      keywordScore,
      semanticScore,
      contextScore,
      historicalScore,
    });
    
    // Recommend mode
    const recommendedMode = this.recommendMode(complexity, confidence, context);
    
    const classification: TaskClassification = {
      complexity,
      recommendedMode,
      confidence,
      factors: {
        keywordScore,
        semanticScore,
        contextScore,
        historicalScore,
      },
      reasoning,
    };
    
    log.debug('Task classified', {
      userMessageLength: userMessage.length,
      classification,
    });
    
    return classification;
  }

  /**
   * Analyze keywords with weighted scoring
   */
  private analyzeKeywords(message: string, reasoning: string[]): number {
    const lowerMessage = message.toLowerCase();
    let score = 0;
    let maxPossibleScore = 0;
    const matches: string[] = [];
    
    // High complexity keywords (weight: 3)
    for (const keyword of KEYWORD_CATEGORIES.highComplexity) {
      maxPossibleScore += 3;
      if (lowerMessage.includes(keyword)) {
        score += 3;
        matches.push(`+3 "${keyword}"`);
      }
    }
    
    // Medium complexity keywords (weight: 2)
    for (const keyword of KEYWORD_CATEGORIES.mediumComplexity) {
      maxPossibleScore += 2;
      if (lowerMessage.includes(keyword)) {
        score += 2;
        matches.push(`+2 "${keyword}"`);
      }
    }
    
    // Low complexity keywords (weight: 1)
    for (const keyword of KEYWORD_CATEGORIES.lowComplexity) {
      maxPossibleScore += 1;
      if (lowerMessage.includes(keyword)) {
        score += 1;
        matches.push(`+1 "${keyword}"`);
      }
    }
    
    // Multi-step indicators (+0.5 each, max +2)
    let multiStepBonus = 0;
    for (const indicator of KEYWORD_CATEGORIES.multiStep) {
      if (lowerMessage.includes(indicator)) {
        multiStepBonus += 0.5;
        matches.push(`+0.5 multi-step "${indicator}"`);
      }
    }
    multiStepBonus = Math.min(multiStepBonus, 2); // cap at +2
    score += multiStepBonus;
    
    // Normalize to 0-1 range
    const normalizedScore = maxPossibleScore > 0 ? score / maxPossibleScore : 0.5;
    
    if (matches.length > 0) {
      reasoning.push(`Keywords: ${matches.slice(0, 5).join(', ')}${matches.length > 5 ? '...' : ''}`);
    }
    
    return normalizedScore;
  }

  /**
   * Semantic analysis using lightweight LLM call.
   * Uses the same fast-model selection as spec amplification (telemetry-based
   * latency ranking, with Mistral Small fallback) — NOT process.env.FAST_MODEL.
   * Gracefully skips when no model can be obtained.
   */
  private async analyzeSemantics(message: string, reasoning: string[]): Promise<number> {
    try {
      // Use model ranker for fast model selection (same as spec amplification)
      let fastModelProvider: string | undefined;
      let fastModelName: string | undefined;

      // FIX: Use conditional import for model-ranker (web-only path)
      // This path is only available when running in the web context, not in standalone shared package
      try {
        const { getSpecGenerationModel, isRateLimited, recordRateLimitError } = await import('@/lib/models/model-ranker');
        const ranked = await getSpecGenerationModel();
        if (ranked) {
          // FIX: Check circuit breaker before using this model
          if (isRateLimited(ranked.provider, ranked.model)) {
            log.debug('Model ranker suggested rate-limited model, skipping');
            throw new Error('Model rate limited');
          }
          fastModelProvider = ranked.provider;
          fastModelName = ranked.model;
        }
      } catch {
        // Model ranker unavailable in this context (shared package running standalone)
        log.debug('Model ranker not available or model rate-limited, using fallback selection');
      }

      // FIX: Fallback to model rotation (which also checks rate limits)
      if (!fastModelProvider || !fastModelName) {
        try {
          const { getModelForRotation, isRateLimited, recordRateLimitError } = await import('@/lib/models/model-ranker');
          const rotationPick = getModelForRotation();
          if (rotationPick && !isRateLimited(rotationPick.provider, rotationPick.model)) {
            fastModelProvider = rotationPick.provider;
            fastModelName = rotationPick.model;
          }
        } catch {
          // Rotation not available
        }
      }

      // Final fallback: if rotation also unavailable, use a common working model
      if (!fastModelProvider || !fastModelName) {
        fastModelProvider = 'mistral';
        fastModelName = 'mistral-small-latest';
      }

      // Quick LLM-based scope estimation
      const { generateObject } = await import('ai');
      const { z } = await import('zod');
      const { createMistral } = await import('@ai-sdk/mistral');
      const { createOpenAI } = await import('@ai-sdk/openai');
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');

      // Build model from the ranked provider
      // Use explicit cases — unknown providers fall back safely to mistral-small-latest
      // rather than trying createMistral('claude-3-5-sonnet') which would crash.
      let model: any;
switch (fastModelProvider) {
      case 'openai':
        model = createOpenAI({ apiKey: process.env.OPENAI_API_KEY || '' })(fastModelName);
        break;
      case 'openrouter':
        model = createOpenAI({
          apiKey: process.env.OPENROUTER_API_KEY || '',
          baseURL: 'https://openrouter.ai/api/v1',
        })(fastModelName);
        break;
      case 'google':
        model = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY || '' })(fastModelName);
        break;
      case 'mistral':
        model = createMistral({ apiKey: process.env.MISTRAL_API_KEY || '' })(fastModelName);
        break;
      case 'anthropic':
        // Using OpenAI SDK as a generic fallback for providers not explicitly supported
        model = createOpenAI({ apiKey: process.env.ANTHROPIC_API_KEY || '' })(fastModelName);
        break;
      case 'groq':
        model = createOpenAI({ apiKey: process.env.GROQ_API_KEY || '' })(fastModelName);
        break;
      default:
        // Fallback: try any known API key environment variable
        const fallbackKey =
          process.env.OPENAI_API_KEY ||
          process.env.OPENROUTER_API_KEY ||
          process.env.GOOGLE_API_KEY ||
          process.env.MISTRAL_API_KEY ||
          '';
        if (fallbackKey) {
          model = createOpenAI({ apiKey: fallbackKey })(fastModelName);
        } else {
          console.warn(`[TaskClassifier] Provider '${fastModelProvider}' not supported and no API key found, using mistral-small-latest`);
          model = createMistral({ apiKey: process.env.MISTRAL_API_KEY || '' })('mistral-small-latest');
        }
    }

    const result = await generateObject({
      model,
      prompt: `Estimate task scope. Respond with JSON only. No extra text. Do not include any text before or after the JSON object.

{"estimatedFiles": <number>, "estimatedSteps": <number>, "requiresResearch": <true|false>, "requiresTesting": <true|false>, "riskLevel": "low"|"medium"|"high"}

Task: ${message.substring(0, 500)}`,
      schema: z.object({
        estimatedFiles: z.number(),
        estimatedSteps: z.number(),
        requiresResearch: z.boolean(),
        requiresTesting: z.boolean(),
        riskLevel: z.enum(['low', 'medium', 'high']),
      }),
      maxOutputTokens: 200,
    });

    const analysis = result.object;
    let score = 0.5;
    const factors: string[] = [];

    // File count factor
    if (analysis.estimatedFiles > 5) {
      score += 0.2;
      factors.push(`${analysis.estimatedFiles} files`);
    } else if (analysis.estimatedFiles <= 1) {
      score -= 0.2;
    }

    // Step count factor
    if (analysis.estimatedSteps > 5) {
      score += 0.15;
      factors.push(`${analysis.estimatedSteps} steps`);
    }

    // Research requirement
    if (analysis.requiresResearch) {
      score += 0.1;
      factors.push('requires research');
    }

    // Testing requirement
    if (analysis.requiresTesting) {
      score += 0.1;
      factors.push('requires testing');
    }

    // Risk level
    if (analysis.riskLevel === 'high') {
      score += 0.15;
      factors.push('high risk');
    } else if (analysis.riskLevel === 'low') {
      score -= 0.1;
    }

    // Clamp to 0-1
    score = Math.max(0, Math.min(1, score));

    reasoning.push(`Semantic: ${factors.join(', ') || 'neutral'}`);

    return score;
  } catch (error) {
    log.warn('Semantic analysis failed, using fallback estimation', error);

    // Enhanced fallback: use message characteristics as complexity proxies
    const fallbackScore = this.semanticFallback(message, reasoning);
    reasoning.push(`Semantic: fallback analysis (score=${fallbackScore.toFixed(2)})`);
    return fallbackScore;
  }
}

  /**
   * Fallback semantic analysis when LLM is unavailable
   * Uses message structure and content as complexity proxies
   */
  private semanticFallback(message: string, reasoning: string[]): number {
    let score = 0.5;
    const factors: string[] = [];

    // Message length as complexity proxy
    const length = message.length;
    if (length > 200) {
      score += 0.15;
      factors.push('detailed description');
    } else if (length > 100) {
      score += 0.05;
      factors.push('moderate detail');
    } else if (length < 30) {
      score -= 0.1;
      factors.push('very short task');
    }

    // Multi-sentence indicates multiple aspects
    const sentenceCount = (message.match(/[.!?]+/g) || []).length;
    if (sentenceCount > 3) {
      score += 0.1;
      factors.push(`${sentenceCount} sentences`);
    }

    // Question marks indicate uncertainty/complexity
    const questionCount = (message.match(/\?/g) || []).length;
    if (questionCount > 0) {
      score += 0.05 * questionCount;
      factors.push(`${questionCount} question(s)`);
    }

    // Lists/numbered items
    if (message.match(/\d+\.\s/) || message.includes('- ') || message.includes('* ')) {
      score += 0.1;
      factors.push('has list/items');
    }

    // Technical terms density
    const techTerms = message.match(/\b[A-Z][a-z]+[A-Z]\w*|\b[A-Z]{2,}\b/g);
    if (techTerms && techTerms.length > 2) {
      score += 0.1;
      factors.push(`${techTerms.length} technical terms`);
    }

    // Clamp to 0-1
    score = Math.max(0, Math.min(1, score));

    if (factors.length > 0) {
      reasoning.push(`Fallback: ${factors.join(', ')}`);
    }

    return score;
  }

  /**
   * Context-aware analysis
   */
  private analyzeContext(
    message: string,
    context: ClassificationContext,
    reasoning: string[]
  ): number {
    let score = 0.5;
    const factors: string[] = [];
    
    // Project size factor
    if (context.projectSize === 'large') {
      score += 0.15;
      factors.push('large project');
    } else if (context.projectSize === 'small') {
      score -= 0.1;
      factors.push('small project');
    }
    
    // File dependency analysis
    if (context.existingFiles && context.existingFiles.length > 0) {
      const mentionedFiles = this.extractMentionedFiles(message, context.existingFiles);
      if (mentionedFiles.length > 3) {
        score += 0.2;
        factors.push(`${mentionedFiles.length} file dependencies`);
      }
    }
    
    // User preference
    if (context.userPreference === 'thorough') {
      score += 0.1; // prefer more capable mode
      factors.push('thorough preference');
    } else if (context.userPreference === 'fast') {
      score -= 0.1; // prefer faster mode
      factors.push('fast preference');
    }
    
    // Clamp to 0-1
    score = Math.max(0, Math.min(1, score));
    
    reasoning.push(`Context: ${factors.join(', ') || 'neutral'}`);
    
    return score;
  }

  /**
   * Historical pattern matching
   */
  private analyzeHistory(message: string, reasoning: string[]): number {
    if (!this.config.enableHistoricalLearning || this.historicalPatterns.size === 0) {
      return 0.5;
    }
    
    // Simple keyword-based pattern matching
    const lowerMessage = message.toLowerCase();
    let matchedScore = 0;
    let matchCount = 0;
    
    for (const [pattern, score] of this.historicalPatterns.entries()) {
      if (lowerMessage.includes(pattern.toLowerCase())) {
        matchedScore += score;
        matchCount++;
      }
    }
    
    if (matchCount > 0) {
      const avgScore = matchedScore / matchCount;
      reasoning.push(`History: ${matchCount} patterns matched (avg: ${avgScore.toFixed(2)})`);
      return avgScore;
    }
    
    reasoning.push('History: no matches');
    return 0.5;
  }

  /**
   * Calculate confidence based on factor agreement
   */
  private calculateConfidence(factors: {
    keywordScore: number;
    semanticScore: number;
    contextScore: number;
    historicalScore: number;
  }): number {
    const scores = [
      factors.keywordScore,
      factors.semanticScore,
      factors.contextScore,
      factors.historicalScore,
    ];

    // Calculate standard deviation
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // Low stdDev = high confidence (factors agree)
    // High stdDev = low confidence (factors disagree)
    let confidence = Math.max(0.3, 1 - stdDev * 2);

    // Reduce confidence when all factors are near-neutral (no signal)
    const allNearNeutral = scores.every(s => s >= 0.4 && s <= 0.6);
    if (allNearNeutral) {
      confidence = Math.min(confidence, 0.5); // Cap confidence at 0.5 when no real signal
    }

    // Reduce confidence when semantic used fallback (detected by reasoning)
    const semanticOnlyFallback = factors.semanticScore >= 0.45 && factors.semanticScore <= 0.55 &&
                                  factors.keywordScore === 0;
    if (semanticOnlyFallback) {
      confidence = Math.min(confidence, 0.55); // Moderate cap for fallback scenarios
    }

    return Math.round(confidence * 100) / 100;
  }

  /**
   * Recommend execution mode based on classification
   */
  private recommendMode(
    complexity: string,
    confidence: number,
    context: ClassificationContext
  ): TaskClassification['recommendedMode'] {
    // Low confidence = prefer safer, more capable mode
    if (confidence < this.config.minConfidence) {
      return 'stateful-agent';
    }
    
    // Mastra workflow for specific known patterns
    const mastraPatterns = ['workflow', 'pipeline', 'automation', 'scheduled', 'batch'];
    if (mastraPatterns.some(p => context.existingFiles?.join(' ').includes(p))) {
      return 'mastra-workflow';
    }
    
    switch (complexity) {
      case 'simple':
        return 'v1-api';
      case 'moderate':
        return 'v2-native';
      case 'complex':
      default:
        return 'stateful-agent';
    }
  }

  /**
   * Extract mentioned files from message
   */
  private extractMentionedFiles(message: string, existingFiles: string[]): string[] {
    const mentioned: string[] = [];
    const lowerMessage = message.toLowerCase();
    
    for (const file of existingFiles) {
      const fileName = file.split('/').pop()?.toLowerCase() || '';
      if (lowerMessage.includes(fileName)) {
        mentioned.push(file);
      }
    }
    
    return mentioned;
  }

  /**
   * Record classification result for historical learning
   */
  recordOutcome(task: string, actualComplexity: 'simple' | 'moderate' | 'complex'): void {
    if (!this.config.enableHistoricalLearning) return;
    
    // Extract key terms from task
    const terms = task
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4 && !['the', 'and', 'for', 'with', 'this', 'that'].includes(w));
    
    // Update historical patterns
    for (const term of terms.slice(0, 10)) {
      const currentScore = this.historicalPatterns.get(term) || 0.5;
      const targetScore = actualComplexity === 'simple' ? 0.2 : actualComplexity === 'moderate' ? 0.5 : 0.8;
      
      // Exponential moving average
      const newScore = currentScore * 0.7 + targetScore * 0.3;
      this.historicalPatterns.set(term, newScore);
    }
    
    // Limit memory size
    if (this.historicalPatterns.size > 1000) {
      const entries = Array.from(this.historicalPatterns.entries());
      for (let i = 0; i < 100; i++) {
        this.historicalPatterns.delete(entries[i][0]);
      }
    }
  }

  /**
   * Get statistics about historical patterns
   */
  getStats(): {
    patternCount: number;
    avgComplexity: number;
  } {
    const scores = Array.from(this.historicalPatterns.values());
    return {
      patternCount: this.historicalPatterns.size,
      avgComplexity: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.5,
    };
  }
}

/**
 * Create task classifier instance
 */
export function createTaskClassifier(config?: TaskClassifierConfig): TaskClassifier {
  return new TaskClassifier(config);
}

/**
 * Quick classification helper
 */
export async function classifyTask(
  userMessage: string,
  context?: ClassificationContext
): Promise<TaskClassification> {
  const classifier = createTaskClassifier();
  return classifier.classify(userMessage, context);
}
