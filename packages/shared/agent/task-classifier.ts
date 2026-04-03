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

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('TaskClassifier');

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
   * Semantic analysis using lightweight LLM call
   */
  private async analyzeSemantics(message: string, reasoning: string[]): Promise<number> {
    try {
      // Quick LLM-based scope estimation
      // Uses fast model with minimal tokens
      const { generateObject } = await import('ai');
      const { z } = await import('zod');
      
      const result = await generateObject({
        model: process.env.FAST_MODEL || 'gpt-3.5-turbo',
        prompt: `Estimate task scope. Respond with JSON:
{
  "estimatedFiles": <number of files likely to be modified>,
  "estimatedSteps": <number of discrete steps>,
  "requiresResearch": <boolean>,
  "requiresTesting": <boolean>,
  "riskLevel": <low|medium|high>
}

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
      log.warn('Semantic analysis failed, using neutral score', error);
      reasoning.push('Semantic: skipped (error)');
      return 0.5; // neutral fallback
    }
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
    const confidence = Math.max(0.3, 1 - stdDev * 2);
    
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
