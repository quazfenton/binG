/**
 * Provider API Key Persistence
 *
 * Securely stores and retrieves user-provided LLM API keys using the
 * platform secrets module (IndexedDB + AES-GCM encryption on web,
 * OS keychain on desktop).
 *
 * Usage:
 * ```ts
 * // Store a key
 * await saveProviderApiKey('anthropic', 'sk-ant-...');
 *
 * // Retrieve all stored keys
 * const keys = getStoredProviderApiKeys();
 * // { anthropic: 'sk-ant-...', openai: 'sk-...' }
 *
 * // Remove a key
 * await removeProviderApiKey('anthropic');
 * ```
 *
 * @security Keys are encrypted at rest using AES-256-GCM with PBKDF2
 * key derivation (100k iterations). On desktop, they use the OS keychain.
 * Falls back to obfuscated localStorage if IndexedDB is unavailable.
 */

import { secrets } from '@bing/platform/secrets';

// Prefix for provider API key storage
const PROVIDER_KEY_PREFIX = 'llm-provider-key';
const FALLBACK_PREFIX = '__llm_fallback__';

/**
 * Check if IndexedDB is available and functional.
 * Returns false in private browsing or if disabled.
 */
function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Build the storage key for a provider API key.
 */
function providerKeyToStorageKey(provider: string): string {
  return `${PROVIDER_KEY_PREFIX}:${provider}`;
}

/**
 * Fallback: obfuscate a value for localStorage (NOT secure, just prevents casual inspection).
 * Used only when IndexedDB is unavailable.
 */
function obfuscate(value: string): string {
  const key = 0x5a;
  const bytes = new TextEncoder().encode(value);
  const xored = bytes.map(b => b ^ key);
  return btoa(String.fromCharCode(...xored));
}

/**
 * Fallback: deobfuscate a value from localStorage.
 */
function deobfuscate(encoded: string): string | null {
  try {
    const raw = atob(encoded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    const key = 0x5a;
    const xored = bytes.map(b => b ^ key);
    return new TextDecoder().decode(xored);
  } catch {
    return null;
  }
}

/**
 * Fallback: get a key from localStorage.
 */
async function getFallback(provider: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const encoded = localStorage.getItem(`${FALLBACK_PREFIX}${provider}`);
  if (!encoded) return null;
  return deobfuscate(encoded);
}

/**
 * Fallback: set a key in localStorage.
 */
async function setFallback(provider: string, value: string): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${FALLBACK_PREFIX}${provider}`, obfuscate(value));
}

/**
 * Fallback: remove a key from localStorage.
 */
async function removeFallback(provider: string): Promise<void> {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`${FALLBACK_PREFIX}${provider}`);
}

/**
 * Save a provider's API key to persistent storage.
 * The key is encrypted before storage using the platform secrets module.
 * Falls back to obfuscated localStorage if IndexedDB is unavailable.
 *
 * @param provider - Provider name (e.g., 'anthropic', 'openai')
 * @param apiKey - The API key value to store
 */
export async function saveProviderApiKey(provider: string, apiKey: string): Promise<void> {
  if (!provider || !apiKey) {
    return;
  }
  try {
    if (isIndexedDBAvailable()) {
      await secrets.set(providerKeyToStorageKey(provider), apiKey);
    } else {
      // Fallback to localStorage with obfuscation
      await setFallback(provider, apiKey);
    }
  } catch (error) {
    // If secrets module fails, try localStorage fallback
    console.warn(`[ProviderKeys] Secrets module failed, falling back to localStorage: ${error}`);
    try {
      await setFallback(provider, apiKey);
    } catch (fallbackError) {
      console.error(`[ProviderKeys] Failed to save API key for ${provider}:`, fallbackError);
    }
  }
}

/**
 * Retrieve a stored provider API key.
 * The key is decrypted on retrieval using the platform secrets module.
 * Falls back to obfuscated localStorage if IndexedDB is unavailable.
 *
 * @param provider - Provider name
 * @returns The API key, or null if not found
 */
export async function getProviderApiKey(provider: string): Promise<string | null> {
  try {
    if (isIndexedDBAvailable()) {
      const key = await secrets.get(providerKeyToStorageKey(provider));
      if (key !== null) return key;
    }
    // Try localStorage fallback
    return await getFallback(provider);
  } catch {
    // If secrets module fails, try localStorage fallback
    try {
      return await getFallback(provider);
    } catch {
      return null;
    }
  }
}

/**
 * Remove a stored provider API key.
 *
 * @param provider - Provider name
 */
export async function removeProviderApiKey(provider: string): Promise<void> {
  try {
    if (isIndexedDBAvailable()) {
      await secrets.remove(providerKeyToStorageKey(provider));
    }
    // Also clean up fallback if present
    await removeFallback(provider);
  } catch {
    // Best effort cleanup
    try {
      await removeFallback(provider);
    } catch {
      // Ignore
    }
  }
}

/**
 * Get all stored provider API keys.
 *
 * Note: This returns the actual key values for in-use during a request.
 * The secrets module encrypts at rest, so this is safe for in-memory use.
 *
 * @returns Record of provider name → API key
 */
export async function getStoredProviderApiKeys(): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};

  // Known providers — try to load keys for each
  const knownProviders = [
    'anthropic', 'openai', 'google', 'mistral', 'openrouter',
    'nvidia', 'github', 'groq', 'together', 'deepinfra',
    'fireworks', 'anyscale', 'lepton', 'chutes',
  ];

  for (const provider of knownProviders) {
    const key = await getProviderApiKey(provider);
    if (key) {
      keys[provider] = key;
    }
  }

  return keys;
}

/**
 * Check if any provider API keys are stored.
 */
export async function hasAnyStoredProviderKeys(): Promise<boolean> {
  const keys = await getStoredProviderApiKeys();
  return Object.keys(keys).length > 0;
}
