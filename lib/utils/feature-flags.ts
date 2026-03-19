/**
 * User Feature Flags Helper
 * 
 * Provides utilities for checking user-specific feature flag overrides.
 * User preferences override environment variables.
 * 
 * Usage:
 * ```typescript
 * const flags = await getEffectiveFeatureFlags(userId);
 * if (flags.OPENCODE_ENABLED) {
 *   // Use OpenCode integration
 * }
 * ```
 */

import { getDatabase } from '../database/connection';

const DB_FILE = process.env.SQLITE_DB_PATH || './data/bing.db';

/**
 * Default feature flags (from environment variables)
 */
const DEFAULT_FLAGS = {
  OPENCODE_ENABLED: process.env.OPENCODE_ENABLED === 'true',
  NULLCLAW_ENABLED: process.env.NULLCLAW_ENABLED === 'true',
};

/**
 * Get user preferences from database
 */
async function getUserPreferences(userId: string): Promise<Record<string, boolean> | null> {
  try {
    const db = getDatabase();
    const row = db.get(
      'SELECT preferences FROM user_preferences WHERE user_id = ?',
      [userId]
    );
    
    if (row?.preferences) {
      return JSON.parse(row.preferences);
    }
    
    return null;
  } catch (error) {
    console.error('[FeatureFlags] Failed to get user preferences:', error);
    return null;
  }
}

/**
 * Get effective feature flags for a user
 * User preferences override environment variables
 * 
 * @param userId - User ID (if null/undefined, returns env-based defaults)
 * @returns Effective feature flags
 */
export async function getEffectiveFeatureFlags(
  userId?: string | null
): Promise<typeof DEFAULT_FLAGS> {
  // Start with environment-based defaults
  const flags = { ...DEFAULT_FLAGS };
  
  // If no user, return env-based defaults
  if (!userId) {
    return flags;
  }
  
  // Get user preferences (if any)
  const userPrefs = await getUserPreferences(userId);
  
  // Apply user overrides
  if (userPrefs) {
    if (typeof userPrefs.OPENCODE_ENABLED === 'boolean') {
      flags.OPENCODE_ENABLED = userPrefs.OPENCODE_ENABLED;
    }
    if (typeof userPrefs.NULLCLAW_ENABLED === 'boolean') {
      flags.NULLCLAW_ENABLED = userPrefs.NULLCLAW_ENABLED;
    }
  }
  
  return flags;
}

/**
 * Check if a specific feature is enabled for a user
 * 
 * @param flag - Feature flag name (e.g., 'OPENCODE_ENABLED')
 * @param userId - User ID (optional)
 * @returns True if feature is enabled
 */
export async function isFeatureEnabled(
  flag: keyof typeof DEFAULT_FLAGS,
  userId?: string | null
): Promise<boolean> {
  const flags = await getEffectiveFeatureFlags(userId);
  return flags[flag];
}

/**
 * Get feature flags synchronously (uses env vars only, no DB lookup)
 * For use in client-side code or when DB is not available
 * 
 * @returns Environment-based feature flags
 */
export function getEnvFeatureFlags(): typeof DEFAULT_FLAGS {
  return { ...DEFAULT_FLAGS };
}
