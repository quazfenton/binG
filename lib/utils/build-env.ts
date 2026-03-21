/**
 * Build Environment Detection Utility
 * 
 * Provides a centralized way to detect if we're in a build/Edge environment
 * where certain validations should be skipped.
 * 
 * This prevents code duplication across multiple files that all need
 * the same build environment checks.
 */

interface ProcessEnv {
  [key: string]: string | undefined;
}

/**
 * Get the current environment variables safely
 * Works in both Node.js and Edge Runtime environments
 */
function getEnv(): ProcessEnv {
  if (typeof process !== 'undefined' && process.env) {
    return process.env as ProcessEnv;
  }
  return {};
}

/**
 * Check if we're in a build/Edge environment where validation should be skipped
 *
 * Checks for explicit build environment signals:
 * - SKIP_DB_INIT environment variable
 * - NEXT_BUILD environment variable
 * - NEXT_PHASE set to 'build' or 'export'
 *
 * Note: Does NOT check for Edge Runtime (process.versions.node) to avoid
 * misclassifying actual Edge runtime traffic as build environment.
 *
 * @returns true if in build/Edge environment
 */
export function isBuildEnvironment(): boolean {
  const env = getEnv();

  return (
    env.SKIP_DB_INIT === 'true' ||
    env.SKIP_DB_INIT === '1' ||
    env.NEXT_BUILD === 'true' ||
    env.NEXT_BUILD === '1' ||
    env.NEXT_PHASE === 'build' ||
    env.NEXT_PHASE === 'export'
  );
}

/**
 * Get a fallback value for build environments
 * 
 * @param actualValue - The actual value to use in production
 * @param fallbackValue - The fallback value for build/Edge environments
 * @param warnMessage - Optional warning message to log in build environments
 * @returns The actual value in production, fallback in build
 */
export function getBuildSafeValue<T>(actualValue: T | null | undefined, fallbackValue: T, warnMessage?: string): T {
  if (isBuildEnvironment()) {
    if (warnMessage) {
      console.warn(`[BuildEnv] ${warnMessage}`);
    }
    return fallbackValue;
  }
  return actualValue ?? fallbackValue;
}

/**
 * Validate a required environment variable, with build-time bypass
 * 
 * @param envVarName - Name of the environment variable
 * @param errorMessage - Error message to throw in production if not set
 * @returns The environment variable value
 * @throws Error in production if not set
 */
export function validateRequiredEnv(envVarName: string, errorMessage: string): string {
  const env = getEnv();
  const value = env[envVarName];
  
  if (!value) {
    if (isBuildEnvironment()) {
      console.warn(`[BuildEnv] ${envVarName} not set - using fallback for build`);
      return 'dummy-key-for-build';
    }
    throw new Error(errorMessage);
  }
  
  return value;
}

export default { isBuildEnvironment, getBuildSafeValue, validateRequiredEnv };