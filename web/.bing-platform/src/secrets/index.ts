/**
 * Secrets Abstraction Layer
 *
 * Automatically selects the appropriate secrets backend based on the platform:
 * - Web: localStorage (INSECURE - development only)
 * - Desktop: OS Keychain/Credential Manager (secure)
 *
 * Usage:
 * ```ts
 * import { secrets } from '@/lib/platform/secrets';
 *
 * // Store API key securely
 * await secrets.set('openai-api-key', 'sk-...');
 *
 * // Retrieve API key
 * const key = await secrets.get('openai-api-key');
 * ```
 *
 * @security In production web, replace with a proper backend credential manager.
 */

import { isDesktopMode } from '../env';
import type { SecretsAdapter } from './web';

// Dynamic import to avoid bundling Tauri APIs in web build
let secretsPromise: Promise<SecretsAdapter> | null = null;

function getSecrets(): Promise<SecretsAdapter> {
  if (!secretsPromise) {
    secretsPromise = isDesktopMode()
      ? import('./desktop').then(m => m.secrets)
      : import('./web').then(m => m.secrets);
  }
  return secretsPromise;
}

// Export a proxy that forwards calls to the correct implementation
export const secrets: SecretsAdapter = {
  get: async (key: string) => (await getSecrets()).get(key),
  set: async (key: string, value: string) => (await getSecrets()).set(key, value),
  remove: async (key: string) => (await getSecrets()).remove(key),
};

export type { SecretsAdapter };
export default secrets;
