/**
 * Budget Allocator for Verification
 *
 * Dynamically allocates verification budget based on risk assessment.
 * Adjusts tier based on historical failure rates.
 *
 * @see https://mastra.ai/docs/verification/budget-allocation
 */

import { VerificationTier, computeRisk, tierFromRisk } from './incremental-verifier';

/**
 * Risk factors for budget allocation
 */
export interface RiskFactors {
  linesChanged: number;
  contractChanges: number;
  dependencyFanout: number;
  touchesSensitiveArea: boolean;
  historicalFailureRate: number;
  llmConfidence: number;
}

/**
 * Verification budget constraints
 */
export interface VerificationBudget {
  tier: VerificationTier;
  maxTimeMs: number;
  maxTokens: number;
}

/**
 * Budget allocator class
 */
export class BudgetAllocator {
  private history: Array<{
    tier: VerificationTier;
    postMergeFailures: boolean;
    productionIncidents: boolean;
  }> = [];

  /**
   * Allocate budget based on risk factors
   */
  async allocate(changedFiles: string[], riskFactors: RiskFactors): Promise<VerificationBudget> {
    const risk = computeRisk(riskFactors);
    const tier = tierFromRisk(risk);

    // Adjust based on historical failure rate
    const adjustedTier = this.adjustTierBasedOnHistory(tier);

    // Budget constraints per tier
    const budgets: Record<VerificationTier, { maxTimeMs: number; maxTokens: number }> = {
      [VerificationTier.MINIMAL]: { maxTimeMs: 30000, maxTokens: 1000 },
      [VerificationTier.STANDARD]: { maxTimeMs: 120000, maxTokens: 4000 },
      [VerificationTier.STRICT]: { maxTimeMs: 300000, maxTokens: 10000 },
      [VerificationTier.PARANOID]: { maxTimeMs: 600000, maxTokens: 50000 },
    };

    return {
      tier: adjustedTier,
      ...budgets[adjustedTier],
    };
  }

  /**
   * Adjust tier based on historical failure rate
   */
  private adjustTierBasedOnHistory(currentTier: VerificationTier): VerificationTier {
    const recentHistory = this.history.slice(-20);
    const failureRate = recentHistory.filter(h => h.postMergeFailures).length / recentHistory.length;

    const tiers = Object.values(VerificationTier);
    const currentIndex = tiers.indexOf(currentTier);

    if (failureRate > 0.05) {
      // Increase strictness if failure rate > 5%
      return tiers[Math.min(currentIndex + 1, tiers.length - 1)];
    } else if (failureRate < 0.01) {
      // Reduce strictness if failure rate < 1%
      return tiers[Math.max(currentIndex - 1, 0)];
    }

    return currentTier;
  }

  /**
   * Log outcome for historical analysis
   */
  logOutcome(tier: VerificationTier, outcome: { postMergeFailures: boolean; productionIncidents: boolean }): void {
    this.history.push({ tier, ...outcome });
  }

  /**
   * Get budget statistics
   */
  getStats(): {
    totalAllocations: number;
    averageTier: string;
    failureRate: number;
    recommendations: string[];
  } {
    if (this.history.length === 0) {
      return {
        totalAllocations: 0,
        averageTier: 'N/A',
        failureRate: 0,
        recommendations: [],
      };
    }

    const tierCounts: Record<VerificationTier, number> = {
      [VerificationTier.MINIMAL]: 0,
      [VerificationTier.STANDARD]: 0,
      [VerificationTier.STRICT]: 0,
      [VerificationTier.PARANOID]: 0,
    };

    for (const entry of this.history) {
      tierCounts[entry.tier]++;
    }

    const failureRate = this.history.filter(h => h.postMergeFailures).length / this.history.length;

    const recommendations: string[] = [];

    if (failureRate > 0.1) {
      recommendations.push('High failure rate detected. Consider increasing default verification tier.');
    }

    if (tierCounts[VerificationTier.PARANOID] > this.history.length * 0.5) {
      recommendations.push('Many PARANOID tier allocations. Review risk thresholds.');
    }

    const mostCommonTier = Object.entries(tierCounts).sort((a, b) => b[1] - a[1])[0][0];

    return {
      totalAllocations: this.history.length,
      averageTier: mostCommonTier,
      failureRate,
      recommendations,
    };
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Get history
   */
  getHistory(): typeof this.history {
    return [...this.history];
  }
}

/**
 * Create budget allocator with default configuration
 */
export function createBudgetAllocator(): BudgetAllocator {
  return new BudgetAllocator();
}

/**
 * Quick budget allocation helper
 */
export async function allocateBudget(
  changedFiles: string[],
  riskFactors: RiskFactors
): Promise<VerificationBudget> {
  const allocator = createBudgetAllocator();
  return allocator.allocate(changedFiles, riskFactors);
}
