/**
 * Agent Loop Detection
 *
 * Detects and prevents infinite agent loops by tracking:
 * - Tool call fingerprints
 * - Argument similarity
 * - Repetition patterns
 *
 * Prevents:
 * - Same tool called repeatedly
 * - Same arguments used multiple times
 * - Circular tool call patterns
 */

import { createLogger } from '@/lib/utils/logger';

const log = createLogger('Agent:LoopDetection');

export interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  timestamp: number;
  result?: any;
}

export interface LoopDetectionConfig {
  /** Max consecutive similar calls before flagging (default: 3) */
  maxConsecutiveSimilar: number;
  /** Max total repetitions in window (default: 5) */
  maxRepetitionsInWindow: number;
  /** Window size in seconds (default: 60) */
  windowSizeSeconds: number;
  /** Enable loop detection (default: true) */
  enabled: boolean;
}

const DEFAULT_CONFIG: LoopDetectionConfig = {
  maxConsecutiveSimilar: 3,
  maxRepetitionsInWindow: 5,
  windowSizeSeconds: 60,
  enabled: true,
};

export interface LoopDetectionResult {
  isLoop: boolean;
  reason?: string;
  severity: 'low' | 'medium' | 'high';
  suggestedAction: 'continue' | 'warn' | 'terminate';
}

/**
 * Hash function for tool arguments
 */
function hashArgs(args: Record<string, any>): string {
  try {
    const sorted = JSON.stringify(args, Object.keys(args).sort());
    return simpleHash(sorted);
  } catch {
    return 'invalid-args';
  }
}

/**
 * Simple hash function for strings
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Loop Detector for Agent Tool Calls
 */
export class LoopDetector {
  private callHistory: ToolCallRecord[] = [];
  private config: LoopDetectionConfig;
  private consecutiveSimilar: number = 0;
  private lastCallFingerprint: string = '';

  constructor(config: Partial<LoopDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a tool call and check for loops
   */
  recordToolCall(toolName: string, args: Record<string, any>, result?: any): LoopDetectionResult {
    if (!this.config.enabled) {
      return { isLoop: false, severity: 'low', suggestedAction: 'continue' };
    }

    const argsHash = hashArgs(args);
    const fingerprint = `${toolName}:${argsHash}`;
    const now = Date.now();

    // Check for consecutive similar calls
    if (fingerprint === this.lastCallFingerprint) {
      this.consecutiveSimilar++;
    } else {
      this.consecutiveSimilar = 1;
      this.lastCallFingerprint = fingerprint;
    }

    // Add to history
    this.callHistory.push({
      toolName,
      argsHash,
      timestamp: now,
      result,
    });

    // Clean old entries outside window
    const windowStart = now - (this.config.windowSizeSeconds * 1000);
    this.callHistory = this.callHistory.filter(record => record.timestamp > windowStart);

    // Check for loops
    const loopResult = this.detectLoop(toolName, argsHash);

    if (loopResult.isLoop) {
      log.warn('Loop detected', {
        toolName,
        argsHash,
        consecutiveSimilar: this.consecutiveSimilar,
        historySize: this.callHistory.length,
        reason: loopResult.reason,
        severity: loopResult.severity,
      });
    }

    return loopResult;
  }

  /**
   * Detect loop patterns
   */
  private detectLoop(toolName: string, argsHash: string): LoopDetectionResult {
    // Check 1: Consecutive similar calls
    if (this.consecutiveSimilar >= this.config.maxConsecutiveSimilar) {
      return {
        isLoop: true,
        reason: `Tool ${toolName} called ${this.consecutiveSimilar} times with same arguments`,
        severity: 'high',
        suggestedAction: 'terminate',
      };
    }

    // Check 2: Repetitions in window
    const recentCalls = this.callHistory.filter(
      record => record.toolName === toolName && record.argsHash === argsHash
    );

    if (recentCalls.length >= this.config.maxRepetitionsInWindow) {
      return {
        isLoop: true,
        reason: `Tool ${toolName} called ${recentCalls.length} times in ${this.config.windowSizeSeconds}s window`,
        severity: 'medium',
        suggestedAction: 'warn',
      };
    }

    // Check 3: Circular patterns (A → B → C → A)
    if (this.detectCircularPattern()) {
      return {
        isLoop: true,
        reason: 'Circular tool call pattern detected',
        severity: 'high',
        suggestedAction: 'terminate',
      };
    }

    return { isLoop: false, severity: 'low', suggestedAction: 'continue' };
  }

  /**
   * Detect circular patterns in call history
   */
  private detectCircularPattern(): boolean {
    if (this.callHistory.length < 4) return false;

    // Look for patterns like A-B-C-A-B-C
    const last6 = this.callHistory.slice(-6);
    if (last6.length < 6) return false;

    const pattern = last6.map(r => `${r.toolName}:${r.argsHash}`).join(',');
    const first3 = pattern.split(',').slice(0, 3).join(',');
    const second3 = pattern.split(',').slice(3, 6).join(',');

    return first3 === second3;
  }

  /**
   * Get loop detection statistics
   */
  getStats() {
    const now = Date.now();
    const windowStart = now - (this.config.windowSizeSeconds * 1000);
    const recentCalls = this.callHistory.filter(record => record.timestamp > windowStart);

    const toolCounts = new Map<string, number>();
    for (const call of recentCalls) {
      toolCounts.set(call.toolName, (toolCounts.get(call.toolName) || 0) + 1);
    }

    return {
      totalCalls: this.callHistory.length,
      recentCalls: recentCalls.length,
      consecutiveSimilar: this.consecutiveSimilar,
      toolDistribution: Object.fromEntries(toolCounts),
    };
  }

  /**
   * Reset loop detector
   */
  reset() {
    this.callHistory = [];
    this.consecutiveSimilar = 0;
    this.lastCallFingerprint = '';
  }
}

/**
 * Create loop detector with config
 */
export function createLoopDetector(config?: Partial<LoopDetectionConfig>): LoopDetector {
  return new LoopDetector(config);
}
