/**
 * Feedback Loop — Reinforcement and Learned Directionality
 * 
 * Manages positive and negative feedback loops that entrain the agent's behavior
 * toward preferred patterns. Tracks outcomes, computes reinforcement signals,
 * and adjusts the agent's directionalities based on accumulated experience.
 * 
 * @module agent-catalyst/feedback-loop
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('AgentCatalyst:Feedback');

export type FeedbackType = 'positive' | 'negative' | 'neutral' | 'ambiguous';
export type ValenceState = 'ascending' | 'peak' | 'descending' | 'trough';

export interface FeedbackEntry {
  id: string;
  type: FeedbackType;
  source: string;
  targetAction: string;
  intensity: number;         // 0-1
  timestamp: number;
  contextualFactors: string[];
}

export interface ReinforcementPattern {
  id: string;
  actionPattern: string;
  feedbackHistory: FeedbackEntry[];
  learnedValence: number;    // -1 to +1: accumulated reinforcement
  confidence: number;        // 0-1: how certain we are of this pattern
  lastUpdated: number;
}

export interface FeedbackLoopConfig {
  patternWindowSize?: number;
  decayRate?: number;
  positiveAmplification?: number;
  negativeAmplification?: number;
  minPatternConfidence?: number;
}

const DEFAULT_CONFIG: Required<FeedbackLoopConfig> = {
  patternWindowSize: 20,
  decayRate: 0.01,
  positiveAmplification: 1.2,
  negativeAmplification: 1.5,
  minPatternConfidence: 0.6,
};

export class FeedbackLoop {
  private config: Required<FeedbackLoopConfig>;
  private feedbackHistory: FeedbackEntry[] = [];
  private patterns: ReinforcementPattern[] = [];
  private currentValence = 0;
  private valenceTrend: 'ascending' | 'stable' | 'descending' = 'stable';
  private onFeedback: ((entry: FeedbackEntry) => void) | null = null;
  private onPatternLearned: ((pattern: ReinforcementPattern) => void) | null = null;

  constructor(config: FeedbackLoopConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  onFeedback(callback: (entry: FeedbackEntry) => void): void {
    this.onFeedback = callback;
  }

  onPatternLearned(callback: (pattern: ReinforcementPattern) => void): void {
    this.onPatternLearned = callback;
  }

  /**
   * Record a feedback event
   */
  record(options: {
    type: FeedbackType;
    source: string;
    targetAction: string;
    intensity: number;
    contextualFactors?: string[];
  }): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: `fb-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: options.type,
      source: options.source,
      targetAction: options.targetAction,
      intensity: Math.min(1, Math.max(0, options.intensity)),
      timestamp: Date.now(),
      contextualFactors: options.contextualFactors || [],
    };

    this.feedbackHistory.push(entry);

    // Enforce window size
    if (this.feedbackHistory.length > this.config.patternWindowSize * 5) {
      this.feedbackHistory = this.feedbackHistory.slice(-this.config.patternWindowSize * 5);
    }

    // Update current valence
    this.updateValence(entry);

    // Detect patterns
    this.detectPatterns(entry);

    // Notify
    if (this.onFeedback) this.onFeedback(entry);

    logger.debug('Feedback recorded', {
      type: entry.type,
      intensity: entry.intensity,
      currentValence: this.currentValence,
      valenceTrend: this.valenceTrend,
    });

    return entry;
  }

  /**
   * Get current valence state
   */
  getValenceState(): { valence: number; trend: string; phase: ValenceState } {
    let phase: ValenceState;
    if (this.valenceTrend === 'ascending') {
      phase = 'ascending';
    } else if (this.valenceTrend === 'descending') {
      phase = this.currentValence > 0 ? 'descending' : 'trough';
    } else {
      phase = this.currentValence > 0.3 ? 'peak' : 'trough';
    }

    return {
      valence: this.currentValence,
      trend: this.valenceTrend,
      phase,
    };
  }

  /**
   * Get learned reinforcement patterns
   */
  getPatterns(): ReinforcementPattern[] {
    return this.patterns
      .filter(p => p.confidence >= this.config.minPatternConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get feedback summary
   */
  getSummary(): {
    totalFeedback: number;
    positiveRatio: number;
    recentValence: number;
    topPatterns: ReinforcementPattern[];
  } {
    const recent = this.feedbackHistory.slice(-50);
    const positiveCount = recent.filter(f => f.type === 'positive').length;

    return {
      totalFeedback: this.feedbackHistory.length,
      positiveRatio: recent.length > 0 ? positiveCount / recent.length : 0.5,
      recentValence: this.currentValence,
      topPatterns: this.getPatterns().slice(0, 5),
    };
  }

  /**
   * Reset feedback state
   */
  reset(): void {
    this.feedbackHistory = [];
    this.patterns = [];
    this.currentValence = 0;
    this.valenceTrend = 'stable';
  }

  private updateValence(entry: FeedbackEntry): void {
    const previousValence = this.currentValence;

    // Calculate signed intensity
    let signedIntensity = 0;
    switch (entry.type) {
      case 'positive':
        signedIntensity = entry.intensity * this.config.positiveAmplification;
        break;
      case 'negative':
        signedIntensity = -entry.intensity * this.config.negativeAmplification;
        break;
      case 'ambiguous':
        signedIntensity = entry.intensity * 0.3;
        break;
      default:
        signedIntensity = 0;
    }

    // Apply decay and update
    const decay = this.config.decayRate * Math.abs(this.currentValence);
    this.currentValence = Math.max(-1, Math.min(1, this.currentValence + signedIntensity - decay));

    // Update trend
    if (this.currentValence > previousValence + 0.05) {
      this.valenceTrend = 'ascending';
    } else if (this.currentValence < previousValence - 0.05) {
      this.valenceTrend = 'descending';
    } else {
      this.valenceTrend = 'stable';
    }
  }

  private detectPatterns(entry: FeedbackEntry): void {
    // Find or create pattern for this action
    let pattern = this.patterns.find(p => p.actionPattern === entry.targetAction);
    if (!pattern) {
      pattern = {
        id: `pattern-${Date.now()}`,
        actionPattern: entry.targetAction,
        feedbackHistory: [],
        learnedValence: 0,
        confidence: 0,
        lastUpdated: Date.now(),
      };
      this.patterns.push(pattern);
    }

    pattern.feedbackHistory.push(entry);
    pattern.lastUpdated = Date.now();

    // Keep pattern window
    if (pattern.feedbackHistory.length > this.config.patternWindowSize) {
      pattern.feedbackHistory = pattern.feedbackHistory.slice(-this.config.patternWindowSize);
    }

    // Compute learned valence
    const history = pattern.feedbackHistory;
    const positiveCount = history.filter(f => f.type === 'positive').length;
    const negativeCount = history.filter(f => f.type === 'negative').length;
    const totalCount = history.length;

    pattern.learnedValence = totalCount > 0 ? (positiveCount - negativeCount) / totalCount : 0;
    pattern.confidence = Math.min(1, totalCount / this.config.patternWindowSize);

    // Notify if pattern just crossed confidence threshold
    if (pattern.confidence >= this.config.minPatternConfidence && this.onPatternLearned) {
      const previousConfidence = pattern.confidence - (1 / this.config.patternWindowSize);
      if (previousConfidence < this.config.minPatternConfidence) {
        this.onPatternLearned(pattern);
      }
    }
  }
}
