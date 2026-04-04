/**
 * Secrets Migration Utility
 *
 * Migrates plaintext localStorage secrets to obfuscated format.
 * Run once on app startup.
 */

const OLD_TOKEN_KEY = 'token';
const NEW_TOKEN_KEY = 'auth-token';
const OLD_API_KEYS_KEY = 'user_api_keys';
const NEW_API_KEYS_KEY = 'user-api-keys';

/**
 * Check if migration is needed
 */
export function needsMigration(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(OLD_TOKEN_KEY) || !!localStorage.getItem(OLD_API_KEYS_KEY);
}

/**
 * Run migration: move plaintext secrets to obfuscated storage
 */
export async function runMigration(): Promise<void> {
  if (typeof window === 'undefined') return;

  const { secrets } = await import('@bing/platform/secrets');

  // Migrate auth token
  const oldToken = localStorage.getItem(OLD_TOKEN_KEY);
  if (oldToken) {
    await secrets.set(NEW_TOKEN_KEY, oldToken);
    localStorage.removeItem(OLD_TOKEN_KEY);
    console.log('[SecretsMigration] Auth token migrated');
  }

  // Migrate API keys
  const oldApiKeys = localStorage.getItem(OLD_API_KEYS_KEY);
  if (oldApiKeys) {
    await secrets.set(NEW_API_KEYS_KEY, oldApiKeys);
    localStorage.removeItem(OLD_API_KEYS_KEY);
    console.log('[SecretsMigration] API keys migrated');
  }
}

/**
 * Legacy getter for backward compatibility during transition
 * Falls back to old localStorage if new storage is empty
 */
export async function getToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const { secrets } = await import('@bing/platform/secrets');

  // Try new storage first
  const newToken = await secrets.get(NEW_TOKEN_KEY);
  if (newToken) return newToken;

  // Fall back to old storage (for migration period)
  const oldToken = localStorage.getItem(OLD_TOKEN_KEY);
  if (oldToken) {
    // Migrate on read
    await secrets.set(NEW_TOKEN_KEY, oldToken);
    localStorage.removeItem(OLD_TOKEN_KEY);
    return oldToken;
  }

  return null;
}
