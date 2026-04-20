/**
 * Desktop Secrets Implementation (Tauri Custom Commands)
 *
 * Uses custom Rust commands defined in desktop/src-tauri/
 * for secure storage via OS keychain/credential manager.
 *
 * On macOS: Keychain
 * On Windows: Credential Manager
 * On Linux: libsecret (GNOME Keyring / KDE Wallet)
 */

export interface SecretsAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const SERVICE_NAME = 'binG';

async function getWebSecrets() {
  return import('./web');
}

/**
 * Error categories that determine fallback behavior.
 *
 * - TAURI_UNAVAILABLE: Tauri runtime not loaded yet (e.g. during SSR or early
 *   bootstrap). Safe to fall back to web secrets since the Tauri keychain was
 *   never in play.
 *
 * - NOT_FOUND: The requested key doesn't exist. Expected — return null / no-op.
 *
 * - TAURI_ERROR: Tauri is loaded but the command failed (permission denied,
 *   keychain locked, OS error). Do NOT fall back to web secrets — that would
 *   silently write to localStorage when the user expects keychain storage,
 *   creating a split-brain state where secrets exist in two places.
 */
export type SecretErrorCategory = 'TAURI_UNAVAILABLE' | 'NOT_FOUND' | 'TAURI_ERROR';

export function categorizeError(error: unknown): SecretErrorCategory {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('not found') || msg.includes('NotFound')) return 'NOT_FOUND';
  // Detect Tauri unavailability via message patterns.
  // - Our own synthetic 'Tauri invoke is unavailable' from the invoke check.
  // - 'Failed to fetch dynamically imported module' — Vite/webpack message
  //   when the @tauri-apps/api/core module is missing (not installed).
  // - 'window is not defined' — during SSR or non-browser environments.
  // - TypeError whose message mentions import/load — module resolution failure.
  // NOTE: We do NOT use bare `error instanceof TypeError` because that
  // would mis-categorize a TypeError from passing wrong args to invoke().
  const isImportTypeError =
    error instanceof TypeError && /import|load|module|fetch/i.test(msg);
  if (
    isImportTypeError ||
    msg.includes('Tauri invoke is unavailable') ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('window is not defined')
  ) return 'TAURI_UNAVAILABLE';
  return 'TAURI_ERROR';
}

class DesktopSecrets implements SecretsAdapter {
  async get(key: string): Promise<string | null> {
    try {
      const mod = await import('@tauri-apps/api/core');
      if (typeof mod?.invoke !== 'function') {
        throw new Error('Tauri invoke is unavailable');
      }
      return await mod.invoke<string>('get_secret', { service: SERVICE_NAME, key });
    } catch (error) {
      const category = categorizeError(error);
      if (category === 'NOT_FOUND') return null;
      // Only fall back to web secrets when Tauri isn't available at all.
      // If Tauri IS loaded but the command failed, the error is real —
      // falling back would silently store secrets in the wrong backend.
      if (category === 'TAURI_UNAVAILABLE') {
        console.warn('[DesktopSecrets] Tauri unavailable — falling back to web secrets for get():',
          error instanceof Error ? error.message : String(error));
        const { secrets } = await getWebSecrets();
        return secrets.get(key);
      }
      // Real Tauri error (keychain locked, permission denied, etc.)
      // Throw so callers can distinguish "key doesn't exist" (null) from
      // "keychain is broken" (exception). Returning null here would cause
      // callers to think the secret doesn't exist and potentially re-create
      // it in web storage, creating a split-brain state.
      console.error('[DesktopSecrets] Tauri keychain error on get():',
        error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to read secret "${key}" from Tauri keychain: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const mod = await import('@tauri-apps/api/core');
      if (typeof mod?.invoke !== 'function') {
        throw new Error('Tauri invoke is unavailable');
      }
      await mod.invoke('set_secret', { service: SERVICE_NAME, key, value });
    } catch (error) {
      const category = categorizeError(error);
      if (category === 'TAURI_UNAVAILABLE') {
        console.warn('[DesktopSecrets] Tauri unavailable — falling back to web secrets for set():',
          error instanceof Error ? error.message : String(error));
        const { secrets } = await getWebSecrets();
        await secrets.set(key, value);
        return;
      }
      // Real Tauri error or not-found — do NOT silently fall back to web storage.
      // Throwing lets callers surface the keychain failure to the user.
      console.error('[DesktopSecrets] Tauri keychain error on set():',
        error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to store secret "${key}" in Tauri keychain: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const mod = await import('@tauri-apps/api/core');
      if (typeof mod?.invoke !== 'function') {
        throw new Error('Tauri invoke is unavailable');
      }
      await mod.invoke('delete_secret', { service: SERVICE_NAME, key });
    } catch (error) {
      const category = categorizeError(error);
      if (category === 'NOT_FOUND') return; // Already gone — idempotent
      if (category === 'TAURI_UNAVAILABLE') {
        console.warn('[DesktopSecrets] Tauri unavailable — falling back to web secrets for remove():',
          error instanceof Error ? error.message : String(error));
        const { secrets } = await getWebSecrets();
        await secrets.remove(key);
        return;
      }
      console.error('[DesktopSecrets] Tauri keychain error on remove():',
        error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to remove secret "${key}" from Tauri keychain: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }
}

export const secrets = new DesktopSecrets();
export default secrets;
