/**
 * @deprecated Use lib/sandbox/types.ts instead
 *
 * This file has been consolidated into lib/sandbox/types.ts to avoid duplication.
 * All exports are re-exported from the main types file for backward compatibility.
 *
 * Migration guide:
 * - import { ExecutionPolicy } from '@/lib/sandbox/types/execution-policy'
 * + import { ExecutionPolicy } from '@/lib/sandbox/types'
 */

// Re-export all from main types file
export {
  ExecutionPolicy,
  RiskLevel,
  RiskFactor,
  RiskAssessment,
  RISK_PATTERNS,
  RISK_THRESHOLDS,
  assessRisk,
  // Also re-export existing types
  ExecutionPolicyConfig,
  EXECUTION_POLICY_CONFIGS,
  getExecutionPolicyConfig,
  determineExecutionPolicy,
  requiresCloudSandbox,
  allowsLocalFallback,
  getPreferredProviders,
} from '../types';
