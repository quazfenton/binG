/**
 * Parameter Optimization Framework for Task-Specific Tuning
 * Dynamically adjusts parameters based on task characteristics and performance feedback
 */

export interface OptimizationProfile {
  name: string;
  description: string;
  parameters: {
    temperature: number;
    maxTokens: number;
    qualityMode: 'standard' | 'enhanced' | 'iterative';
    enableReflection: boolean;
    stepByStep: boolean;
    timeoutMultiplier: number;
  };
  conditions: {
    taskTypes: string[];
    complexityLevels: string[];
    contentPatterns: RegExp[];
  };
  performance: {
    successRate: number;
    averageQuality: number;
    averageLatency: number;
    usageCount: number;
  };
}

export interface OptimizationContext {
  taskType: string;
  complexity: 'simple' | 'moderate' | 'complex';
  contentLength: number;
  hasCode: boolean;
  hasFiles: boolean;
  hasMultiStep: boolean;
  isMultiModal: boolean;
  userPreferences?: Record<string, any>;
}

class ParameterOptimizer {
  private profiles: Map<string, OptimizationProfile> = new Map();
  private learningEnabled: boolean;
  private adaptationRate: number;

  constructor() {
    this.learningEnabled = process.env.FAST_AGENT_LEARNING_ENABLED !== 'false';
    this.adaptationRate = parseFloat(process.env.FAST_AGENT_ADAPTATION_RATE || '0.1');
    this.initializeDefaultProfiles();
  }

  /**
   * Initialize default optimization profiles
   */
  private initializeDefaultProfiles(): void {
    const defaultProfiles: OptimizationProfile[] = [
      {
        name: 'code_generation',
        description: 'Optimized for code generation and programming tasks',
        parameters: {
          temperature: 0.3,
          maxTokens: 4000,
          qualityMode: 'enhanced',
          enableReflection: true,
          stepByStep: true,
          timeoutMultiplier: 1.5
        },
        conditions: {
          taskTypes: ['code', 'programming', 'development'],
          complexityLevels: ['moderate', 'complex'],
          contentPatterns: [/\b(code|function|class|algorithm|debug)\b/i]
        },
        performance: {
          successRate: 0.85,
          averageQuality: 0.8,
          averageLatency: 12000,
          usageCount: 0
        }
      },
      {
        name: 'file_operations',
        description: 'Optimized for file handling and data processing',
        parameters: {
          temperature: 0.2,
          maxTokens: 3000,
          qualityMode: 'enhanced',
          enableReflection: false,
          stepByStep: true,
          timeoutMultiplier: 2.0
        },
        conditions: {
          taskTypes: ['file', 'data', 'processing'],
          complexityLevels: ['simple', 'moderate', 'complex'],
          contentPatterns: [/\b(file|save|load|csv|json|data)\b/i]
        },
        performance: {
          successRate: 0.9,
          averageQuality: 0.75,
          averageLatency: 8000,
          usageCount: 0
        }
      },
      {
        name: 'analysis_research',
        description: 'Optimized for analysis and research tasks',
        parameters: {
          temperature: 0.4,
          maxTokens: 6000,
          qualityMode: 'iterative',
          enableReflection: true,
          stepByStep: true,
          timeoutMultiplier: 2.5
        },
        conditions: {
          taskTypes: ['analysis', 'research', 'evaluation'],
          complexityLevels: ['moderate', 'complex'],
          contentPatterns: [/\b(analyze|research|evaluate|compare|study)\b/i]
        },
        performance: {
          successRate: 0.8,
          averageQuality: 0.85,
          averageLatency: 18000,
          usageCount: 0
        }
      },
      {
        name: 'creative_content',
        description: 'Optimized for creative and content generation',
        parameters: {
          temperature: 0.7,
          maxTokens: 4000,
          qualityMode: 'enhanced',
          enableReflection: false,
          stepByStep: false,
          timeoutMultiplier: 1.2
        },
        conditions: {
          taskTypes: ['creative', 'content', 'writing'],
          complexityLevels: ['simple', 'moderate'],
          contentPatterns: [/\b(write|create|generate|story|article)\b/i]
        },
        performance: {
          successRate: 0.88,
          averageQuality: 0.78,
          averageLatency: 10000,
          usageCount: 0
        }
      },
      {
        name: 'workflow_orchestration',
        description: 'Optimized for multi-step workflows and agent chaining',
        parameters: {
          temperature: 0.3,
          maxTokens: 5000,
          qualityMode: 'iterative',
          enableReflection: true,
          stepByStep: true,
          timeoutMultiplier: 3.0
        },
        conditions: {
          taskTypes: ['workflow', 'orchestration', 'chaining'],
          complexityLevels: ['complex'],
          contentPatterns: [/\b(workflow|chain|orchestrate|multi-step|pipeline)\b/i]
        },
        performance: {
          successRate: 0.75,
          averageQuality: 0.82,
          averageLatency: 25000,
          usageCount: 0
        }
      }
    ];

    defaultProfiles.forEach(profile => {
      this.profiles.set(profile.name, profile);
    });
  }

  /**
   * Find optimal parameters for given context
   */
  optimizeParameters(context: OptimizationContext): OptimizationProfile['parameters'] {
    const matchingProfiles = this.findMatchingProfiles(context);
    
    if (matchingProfiles.length === 0) {
      return this.getDefaultParameters(context);
    }

    // Select best profile based on performance metrics
    const bestProfile = this.selectBestProfile(matchingProfiles);
    
    // Apply context-specific adjustments
    return this.adjustParametersForContext(bestProfile.parameters, context);
  }

  /**
   * Find profiles that match the given context
   */
  private findMatchingProfiles(context: OptimizationContext): OptimizationProfile[] {
    const matching: OptimizationProfile[] = [];

    for (const profile of this.profiles.values()) {
      let score = 0;

      // Check task type match
      if (profile.conditions.taskTypes.some(type => 
        context.taskType.toLowerCase().includes(type.toLowerCase())
      )) {
        score += 3;
      }

      // Check complexity level match
      if (profile.conditions.complexityLevels.includes(context.complexity)) {
        score += 2;
      }

      // Check content pattern match
      const contentToCheck = `${context.taskType} ${context.hasCode ? 'code' : ''} ${context.hasFiles ? 'file' : ''}`;
      if (profile.conditions.contentPatterns.some(pattern => pattern.test(contentToCheck))) {
        score += 2;
      }

      // Minimum score threshold for matching
      if (score >= 2) {
        matching.push(profile);
      }
    }

    return matching;
  }

  /**
   * Select best profile based on performance metrics
   */
  private selectBestProfile(profiles: OptimizationProfile[]): OptimizationProfile {
    return profiles.reduce((best, current) => {
      const bestScore = this.calculateProfileScore(best);
      const currentScore = this.calculateProfileScore(current);
      return currentScore > bestScore ? current : best;
    });
  }

  /**
   * Calculate performance score for a profile
   */
  private calculateProfileScore(profile: OptimizationProfile): number {
    const { successRate, averageQuality, averageLatency, usageCount } = profile.performance;
    
    // Normalize latency (lower is better)
    const normalizedLatency = Math.max(0, 1 - (averageLatency / 30000));
    
    // Weight factors
    const weights = {
      success: 0.4,
      quality: 0.4,
      latency: 0.15,
      experience: 0.05
    };
    
    // Experience factor (more usage = more reliable)
    const experienceFactor = Math.min(1, usageCount / 100);
    
    return (
      successRate * weights.success +
      averageQuality * weights.quality +
      normalizedLatency * weights.latency +
      experienceFactor * weights.experience
    );
  }

  /**
   * Adjust parameters based on specific context
   */
  private adjustParametersForContext(
    baseParams: OptimizationProfile['parameters'],
    context: OptimizationContext
  ): OptimizationProfile['parameters'] {
    const adjusted = { ...baseParams };

    // Adjust for content length
    if (context.contentLength > 500) {
      adjusted.maxTokens = Math.min(adjusted.maxTokens * 1.5, 8000);
      adjusted.timeoutMultiplier *= 1.2;
    }

    // Adjust for multimodal content
    if (context.isMultiModal) {
      adjusted.timeoutMultiplier *= 1.5;
      adjusted.qualityMode = 'enhanced';
    }

    // Adjust for multi-step tasks
    if (context.hasMultiStep) {
      adjusted.stepByStep = true;
      adjusted.enableReflection = true;
      adjusted.timeoutMultiplier *= 1.3;
    }

    // Apply user preferences
    if (context.userPreferences) {
      if (context.userPreferences.prioritizeSpeed) {
        adjusted.qualityMode = 'standard';
        adjusted.enableReflection = false;
        adjusted.timeoutMultiplier *= 0.8;
      }
      if (context.userPreferences.prioritizeQuality) {
        adjusted.qualityMode = 'iterative';
        adjusted.enableReflection = true;
        adjusted.timeoutMultiplier *= 1.5;
      }
    }

    return adjusted;
  }

  /**
   * Get default parameters for unknown contexts
   */
  private getDefaultParameters(context: OptimizationContext): OptimizationProfile['parameters'] {
    return {
      temperature: context.complexity === 'simple' ? 0.5 : 0.3,
      maxTokens: context.complexity === 'complex' ? 5000 : 3000,
      qualityMode: context.complexity === 'complex' ? 'enhanced' : 'standard',
      enableReflection: context.complexity === 'complex',
      stepByStep: context.complexity !== 'simple',
      timeoutMultiplier: context.complexity === 'complex' ? 2.0 : 1.0
    };
  }

  /**
   * Record performance feedback for learning
   */
  recordPerformance(
    profileName: string,
    success: boolean,
    qualityScore: number,
    latency: number
  ): void {
    if (!this.learningEnabled) return;

    const profile = this.profiles.get(profileName);
    if (!profile) return;

    const perf = profile.performance;
    const rate = this.adaptationRate;

    // Update metrics using exponential moving average
    perf.successRate = perf.successRate * (1 - rate) + (success ? 1 : 0) * rate;
    perf.averageQuality = perf.averageQuality * (1 - rate) + qualityScore * rate;
    perf.averageLatency = perf.averageLatency * (1 - rate) + latency * rate;
    perf.usageCount++;

    this.profiles.set(profileName, profile);
  }

  /**
   * Get profile recommendations for context
   */
  getRecommendations(context: OptimizationContext): {
    recommended: string;
    alternatives: string[];
    reasoning: string;
  } {
    const matching = this.findMatchingProfiles(context);
    
    if (matching.length === 0) {
      return {
        recommended: 'default',
        alternatives: [],
        reasoning: 'No specific profiles match this context, using default parameters'
      };
    }

    const best = this.selectBestProfile(matching);
    const alternatives = matching
      .filter(p => p.name !== best.name)
      .sort((a, b) => this.calculateProfileScore(b) - this.calculateProfileScore(a))
      .slice(0, 2)
      .map(p => p.name);

    return {
      recommended: best.name,
      alternatives,
      reasoning: `Selected based on ${best.description.toLowerCase()} with ${(best.performance.successRate * 100).toFixed(1)}% success rate`
    };
  }

  /**
   * Get all available profiles
   */
  getProfiles(): OptimizationProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Add or update a custom profile
   */
  addProfile(profile: OptimizationProfile): void {
    this.profiles.set(profile.name, profile);
  }
}

export const parameterOptimizer = new ParameterOptimizer();
